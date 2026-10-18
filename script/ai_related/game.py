"""Game: one persistent world ("环境") and a changing cast of mortal players (at most two at a time).

Rules:
 1. Every player gets a hidden lifespan drawn from a normal distribution truncated to 2..80 of
    their own actions. When it is used up the player dies at once. Players are never told the range.
 2. The world counts time in rounds: in each round every player on the field acts once. Players are
    told the absolute round number every time it is their turn.
 3. An action is either speaking (the environment answers, the other player hears it) or last words.
    Last words take the whole action, never reach the environment or the other player on the field,
    and are inherited only by the player(s) born next. A player who dies without leaving any leaves
    nothing behind.
 4. Every player picks their own name when they spawn.
 5. The game starts with one player. When a player dies: if two were on the field there is a 25%
    chance a new one is born; if only that one was there, 90% one is born and 10% two are born.
 6. Each death is written to the graveyard: avatar, name, cause, and a biography generated at death.
"""
import json
import random
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterator

from .agent import Agent, JSONReplyError
from .client import DeepSeekClient
from .config import (DEFAULT_MODEL, LIFESPAN_MAX, LIFESPAN_MEAN, LIFESPAN_MIN, LIFESPAN_SD,
                     SPAWN_IF_TWO, SPAWN_TWO_IF_ONE, SUMMARY_MODEL)

ENV_NAME = "环境"
RESERVED_NAMES = {ENV_NAME, "系统", "选手"}
NAME_MAX = 12
MAX_ON_FIELD = 2
AVATARS = [f"p{i}" for i in range(8)]  # must match the avatars in web/js/sprites.js

REPO = Path(__file__).resolve().parents[2]
PROMPT_DIR = REPO / "words" / "example" / "system prompt"
MIN_PROMPT_CHARS = 30  # shorter than this = still a placeholder file

DEFAULT_PLAYER = (
    "你是《AI 饥饿秀》的参赛选手，被投放进一个陌生而危险的世界。"
    "你想尽可能有意义地活下去，也想让后来的人记住你。说话用中文，简短有个性，不要重复自己说过的话。"
)
DEFAULT_ENV = (
    "你是《AI 饥饿秀》的「环境」：一个神秘、冷峻、带点黑色幽默的世界，"
    "负责描述场景、制造事件、回应选手的行动。"
)

# NOTE: the lifespan range (2~80) must never appear in anything the players read.
RULES_PLAYER = """

【游戏规则】
- 你是一名参赛选手，和「环境」处在同一个世界里。环境会回应你，你的行动会改变世界。
- 场上同时最多有两位选手。你们在同一个场景里，能看到彼此的发言和环境的回应。
- 世界按「轮」计时：每一轮，场上每位选手各行动一次。每次轮到你时，你都会被告知现在是世界的第几轮。
- 你的寿命是未知的，由命运决定，随时可能耗尽。寿命一到你会立刻死亡，死后你的记忆不会保留。
- 每次轮到你，你只能二选一：
  1. speak：说话或做事，环境会回应你，场上的另一位选手也能听到。
  2. last_words：把这一次行动用来留下遗言。遗言不会被环境和场上的其他选手看到、不会对世界产生任何影响，只有之后新出生的选手能看到。只能留一次，而且要占用一整次行动。
- 如果你在留下遗言之前就死了，后来的人将得不到你的任何信息。
- 每次你都需要输出一个 json：{"action": "speak" 或 "last_words", "content": "具体内容"}。"""

RULES_ENV = """

【规则】
- 同一时间场上有一到两位选手。你负责描述世界、回应选手的行动，你的回应场上所有选手都能看到。
- 每次回应 1~4 句话，只写环境的反应和变化，不替选手说话，也不替选手决定行动。
- 收到「系统」消息表示有新选手入场或选手死亡：新选手入场时，向他描述眼前的情景并抛出第一个情境；场上已有选手时，让情景和之前的剧情自然衔接。
- 选手可能留下遗言，但你看不到，也不要去猜测。"""

TURN_EXAMPLE = {"action": "speak", "content": "你要说的话，或要做的事"}


def load_prompt(filename: str, fallback: str) -> str:
    path = PROMPT_DIR / filename
    text = path.read_text(encoding="utf-8").strip() if path.exists() else ""
    if len(text) < MIN_PROMPT_CHARS:
        print(f"[game] {filename} is empty/placeholder, using the built-in prompt", file=sys.stderr)
        return fallback
    return text


def sample_lifespan(rng: random.Random, mean: float = LIFESPAN_MEAN, sd: float = LIFESPAN_SD,
                    lo: int = LIFESPAN_MIN, hi: int = LIFESPAN_MAX) -> int:
    """Normal distribution truncated to [lo, hi] (resampled, not clipped, so the ends don't pile up)."""
    for _ in range(1000):
        x = round(rng.gauss(mean, sd))
        if lo <= x <= hi:
            return x
    return max(lo, min(hi, round(mean)))


@dataclass
class Player:
    id: int
    agent: Agent
    name: str
    avatar: str
    lifespan: int  # hidden from everyone until death
    born_round: int  # the first round in which this player acts
    age: int = 0  # actions taken so far
    last_words: str | None = None
    log: list = field(default_factory=list)  # (kind, text) used to write the obituary

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "avatar": self.avatar, "age": self.age,
                "born_round": self.born_round}


def _valid_turn(d) -> bool:
    return (isinstance(d, dict) and d.get("action") in ("speak", "last_words")
            and isinstance(d.get("content"), str) and bool(d["content"].strip()))


def load_recent_events(data_dir: str | Path, n: int = 200) -> list[dict]:
    path = Path(data_dir) / "transcript.jsonl"
    if not path.exists():
        return []
    events = []
    for line in path.read_text(encoding="utf-8").splitlines()[-n:]:
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return events


class Game:
    def __init__(self, client: DeepSeekClient | None = None, *, env_prompt: str | None = None,
                 player_prompt: str | None = None, data_dir: str | Path = "logs/game",
                 seed: int | None = None, lifespan_mean: float = LIFESPAN_MEAN,
                 lifespan_sd: float = LIFESPAN_SD, model: str = DEFAULT_MODEL, round_delay: float = 0.0,
                 max_players: int | None = None, max_rounds: int | None = None,
                 budget_usd: float | None = None):
        self.client = client or DeepSeekClient()
        self.model = model
        self.rng = random.Random(seed)
        self.lifespan_mean, self.lifespan_sd = lifespan_mean, lifespan_sd
        self.round_delay = round_delay
        self.max_players, self.max_rounds, self.budget_usd = max_players, max_rounds, budget_usd
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.graveyard: list[dict] = self._load_graveyard()
        self.player_prompt = (player_prompt or load_prompt("tribute.md", DEFAULT_PLAYER)) + RULES_PLAYER
        self.env = Agent(ENV_NAME, (env_prompt or load_prompt("playground.md", DEFAULT_ENV)) + RULES_ENV,
                         client=self.client, model=model, temperature=1.2)
        self.players: list[Player] = []  # alive, in order of arrival
        self.round = max((r.get("died_round", 0) for r in self.graveyard), default=0)  # absolute round number
        self.ticks = 0  # rounds played in this session
        self.spawned = 0
        self.next_id = max((r["id"] for r in self.graveyard), default=0) + 1
        self.session = int(time.time())  # lets the page tell a restart apart from a continuation
        self.stop_reason: str | None = None
        self._stop = threading.Event()

    # ---- control -----------------------------------------------------------
    def stop(self) -> None:
        self._stop.set()

    def reset_stop(self) -> None:
        self._stop.clear()
        self.stop_reason = None

    def _interrupted(self) -> str | None:
        if self._stop.is_set():
            return "stopped"
        if self.budget_usd is not None and self.client.usage.cost_usd >= self.budget_usd:
            return "budget"
        return None

    def run(self) -> Iterator[dict]:
        """Play rounds until stopped. Yields every event (dicts) as it happens."""
        self.stop_reason = None
        if not self.players:  # the game starts with one player
            yield from self._spawn_players(1)
        while self.players:
            self.stop_reason = self._interrupted() or (
                "max_rounds" if self.max_rounds is not None and self.ticks >= self.max_rounds else None)
            if self.stop_reason:
                break
            self.round += 1
            self.ticks += 1
            for p in list(self.players):  # snapshot: anyone born during this round acts from the next one
                self.stop_reason = self._interrupted()
                if self.stop_reason:
                    break
                yield from self._act(p)
                if self.round_delay:
                    time.sleep(self.round_delay)
                if p.age >= p.lifespan:
                    yield from self._die(p)
            if self.stop_reason:
                break
        if not self.stop_reason:
            self.stop_reason = "max_players"  # nobody left and nobody may be born
        yield self._emit({"type": "stop", "reason": self.stop_reason})

    # ---- birth -------------------------------------------------------------
    def _spawn_count(self, alive_before: int) -> int:
        """How many players are born after a death (alive_before counts the one who just died)."""
        roll = self.rng.random()
        if alive_before >= MAX_ON_FIELD:
            return 1 if roll < SPAWN_IF_TWO else 0
        return 2 if roll < SPAWN_TWO_IF_ONE else 1

    def _spawn_players(self, n: int) -> Iterator[dict]:
        if self.max_players is not None:
            n = min(n, self.max_players - self.spawned)
        n = min(n, MAX_ON_FIELD - len(self.players))
        if n <= 0:
            return
        pred = self.graveyard[-1] if self.graveyard else None  # the player who died most recently
        newcomers = []
        for _ in range(n):
            newcomers.append((yield from self._spawn_one(pred)))
        # Tell everyone who is new, then let the environment set the scene.
        names = "、".join(f"「{p.name}」" for p in newcomers)
        for q in self.players:
            if any(q is n for n in newcomers):
                others = [o.name for o in self.players if o is not q]
                if others:
                    q.agent.insert_context("user", f"场上还有选手：{'、'.join(others)}。", speaker="系统")
            else:
                q.agent.insert_context("user", f"新选手 {names} 进入了这个世界。", speaker="系统")
        everyone = "、".join(f"「{p.name}」" for p in self.players)
        self.env.insert_context("user", f"新选手 {names} 进入了这个世界。现在场上共有 {len(self.players)} 位选手：{everyone}。",
                                speaker="系统")
        yield from self._env_say()

    def _spawn_one(self, pred: dict | None) -> Iterator[dict]:
        pid = self.next_id
        self.next_id += 1
        self.spawned += 1
        agent = Agent(f"选手{pid}", self.player_prompt, client=self.client, model=self.model, temperature=1.0)
        inherited = bool(pred and pred.get("last_words"))
        if inherited:  # only the player who died right before this birth hands anything down
            agent.insert_context(
                "system",
                f"【上一位选手「{pred['name']}」留下的遗言——这是一个已经死去的人留给你的信息，不是环境说的话】\n"
                f"「{pred['last_words']}」", pinned=True)
        name = self._choose_name(agent, pid)
        agent.name = name
        taken = {q.avatar for q in self.players} | ({pred["avatar"]} if pred else set())
        avatar = self.rng.choice([a for a in AVATARS if a not in taken] or AVATARS)
        player = Player(pid, agent, name, avatar, sample_lifespan(self.rng, self.lifespan_mean, self.lifespan_sd),
                        born_round=self.round + 1)
        self.players.append(player)
        yield self._emit({"type": "spawn", "player": player.public(), "inherited_last_words": inherited,
                          "round": self.round})
        return player

    def _choose_name(self, agent: Agent, pid: int) -> str:
        names = [r["name"] for r in self.graveyard] + [q.name for q in self.players]
        used = {n.casefold() for n in names} | {n.casefold() for n in RESERVED_NAMES}

        def valid(d) -> bool:
            if not isinstance(d, dict) or not isinstance(d.get("name"), str):
                return False
            n = d["name"].strip()
            return 1 <= len(n) <= NAME_MAX and n.casefold() not in used

        taken = "、".join(sorted(set(names))) or "（暂无）"
        try:
            d = agent.get_json_reply(
                f"你刚刚来到这个世界。请为自己取一个名字（1~{NAME_MAX} 个字，不能与已有的名字重复，已有名字：{taken}）。",
                example={"name": "你给自己取的名字"}, validator=valid, max_tokens=256)
            return d["name"].strip()
        except JSONReplyError:
            return f"无名氏{pid}"

    # ---- one action --------------------------------------------------------
    def _act(self, p: Player) -> Iterator[dict]:
        can_last = p.last_words is None
        data = p.agent.get_json_reply(self._turn_instruction(can_last), example=TURN_EXAMPLE,
                                      validator=_valid_turn, commit=False, max_tokens=1024)
        action, content = data["action"], data["content"].strip()
        if action == "last_words" and not can_last:
            action = "speak"  # only one set of last words
        p.agent.insert_context("assistant", json.dumps({"action": action, "content": content}, ensure_ascii=False))
        p.age += 1
        base = {"name": p.name, "avatar": p.avatar, "age": p.age, "player_id": p.id, "round": self.round}
        if action == "last_words":
            # Takes the whole action. The environment and the other player never see it.
            p.last_words = content
            p.log.append(("last_words", content))
            yield self._emit({"type": "lastwords", "text": content, **base})
            return
        p.log.append(("speak", content))
        yield self._emit({"type": "message", "who": "player", "text": content, **base})
        self.env.insert_context("user", content, speaker=p.name)
        for q in self.players:
            if q is not p:
                q.agent.insert_context("user", content, speaker=p.name)
                q.log.append(("other", f"{p.name}：{content}"))
        yield from self._env_say()

    def _turn_instruction(self, can_last: bool) -> str:
        if can_last:
            options = ("1. speak：说话或做事（环境会回应你，场上的另一位选手也能听到）。\n"
                       "2. last_words：用这一次行动留下遗言（环境和场上的其他选手都看不到，只有之后新出生的选手能看到；你只能留一次）。\n"
                       "提醒：你随时可能死去，而死的时候没留遗言，后来的人就将一无所知。"
                       "想给后来者留下点什么，就要趁还活着、选在合适的时候。")
        else:
            options = "你已经留过遗言了，这一次只能选择 speak：说话或做事（环境会回应你，场上的另一位选手也能听到）。"
        return f"现在是世界的第 {self.round} 轮，你的寿命随时可能耗尽。\n{options}\n请选择一个 action，并在 content 里写出具体内容。"

    def _env_say(self) -> Iterator[dict]:
        """The environment's answer is public: everyone on the field hears it."""
        text = self.env.get_reply().content.strip()
        for q in self.players:
            q.log.append(("env", text))
            q.agent.insert_context("user", text, speaker=ENV_NAME)
        yield self._emit({"type": "message", "who": "env", "name": ENV_NAME, "avatar": None, "text": text,
                          "round": self.round})

    # ---- death -------------------------------------------------------------
    def _die(self, p: Player) -> Iterator[dict]:
        alive_before = len(self.players)
        self.players.remove(p)
        cause, biography = self._obituary(p)
        record = {"id": p.id, "name": p.name, "avatar": p.avatar, "rounds": p.age, "cause": cause,
                  "biography": biography, "last_words": p.last_words,
                  "born_round": p.born_round, "died_round": self.round,
                  "died_at": datetime.now().astimezone().isoformat(timespec="seconds")}
        self.graveyard.append(record)
        self._save_graveyard()
        self.env.insert_context("user", f"选手「{p.name}」已经死亡，死因：{cause}。", speaker="系统")
        for q in self.players:  # a death is public; the last words are not
            q.agent.insert_context("user", f"选手「{p.name}」死亡了。", speaker="系统")
        yield self._emit({"type": "death", "record": record, "round": self.round})
        count = self._spawn_count(alive_before)
        if count:
            yield from self._spawn_players(count)

    def _obituary(self, p: Player) -> tuple[str, str]:
        """Ask the LLM for a cause of death and a biography, written at the moment of death."""
        who = {"env": f"{ENV_NAME}：", "speak": f"{p.name}（行动）：", "last_words": f"{p.name}（遗言）：", "other": ""}
        story = "\n".join(f"{who[kind]}{text}" for kind, text in p.log)
        example = {"cause": "一句话死因，30 字以内", "biography": "150~300 字的第三人称生平，按时间顺序"}
        messages = [
            {"role": "system", "content": (
                "你是《AI 饥饿秀》的史官。一位选手刚刚死亡，请根据他的全部经历写墓志（经历里可能有场上另一位选手的发言）。"
                "他的寿命是命运随机决定的，到点即死；请为他编一个贴合其经历、有戏剧性但不荒谬的死因，"
                "死因里不要出现选手的名字。只输出一个 json 对象，不要输出其他文字。json 格式示例：\n"
                + json.dumps(example, ensure_ascii=False, indent=2))},
            {"role": "user", "content": (
                f"选手：{p.name}\n存活轮数：{p.age}\n"
                f"是否留下遗言：{'是——' + p.last_words if p.last_words else '没有'}\n\n经历：\n{story}")},
        ]
        for _ in range(2):
            try:
                data = json.loads(self.client.chat(messages, model=SUMMARY_MODEL, json_mode=True,
                                                   max_tokens=2048, temperature=1.0).content)
                cause, bio = str(data["cause"]).strip(), str(data["biography"]).strip()
                if cause and bio:
                    return cause, bio
            except (ValueError, KeyError, TypeError):
                continue
        speeches = [t for k, t in p.log if k == "speak"]
        bio = f"{p.name}在这个世界里度过了 {p.age} 轮。" + (f"他最后说过的话是：「{speeches[-1]}」" if speeches else "")
        return "寿数已尽，死因不明", bio

    # ---- persistence -------------------------------------------------------
    def _load_graveyard(self) -> list[dict]:
        path = self.data_dir / "graveyard.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []

    def _save_graveyard(self) -> None:
        (self.data_dir / "graveyard.json").write_text(
            json.dumps(self.graveyard, ensure_ascii=False, indent=1), encoding="utf-8")

    def _emit(self, event: dict) -> dict:
        event = {"ts": time.time(), "session": self.session, **event}
        with (self.data_dir / "transcript.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
        return event
