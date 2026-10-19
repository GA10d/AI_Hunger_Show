"""Game: one persistent world ("环境") and a changing cast of mortal players (at most two at a time).

Mechanics (the *content* of the world lives in words/<world>/, see world.py):
 1. Every player gets a hidden lifespan drawn from a normal distribution truncated to 2..80 of
    their own actions. When it is used up the player dies at once. Players are never told the range.
 2. The world counts time in rounds: in each round every player on the field acts once. Players are
    told the absolute round number every time it is their turn.
 3. An action is one of:
      speak       - the environment answers, the other player hears it
      last_words  - takes the whole action; never reaches the environment or the other player on the
                    field; inherited only by the player(s) born next
      end_life    - the player ends their own life              (worlds with a judge)
      guess       - the player declares the whole truth of the world; the oracle rules on it at once:
                    wrong -> death, right -> the players win and the game is over   (worlds with an oracle)
 4. Every player picks their own name when they spawn.
 5. The game starts with one player. When players die: if one is left on the field there is a 25%
    chance a new one is born; if nobody is left, 90% one is born and 10% two are born.
 6. Each death is written to the graveyard: avatar, name, cause, and a biography generated at death.
 7. If the world has a judge.md, an LLM judge applies the secret rules after every action and at the end
    of every round. No rule is hard-coded here. If it has an oracle.md, an LLM oracle grades declarations.
"""
import json
import random
import threading
import time
import warnings
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterator

from .agent import Agent, JSONReplyError
from .client import DeepSeekClient
from .config import (DEFAULT_MODEL, LIFESPAN_MAX, LIFESPAN_MEAN, LIFESPAN_MIN, LIFESPAN_SD,
                     SPAWN_IF_TWO, SPAWN_TWO_IF_ONE, SUMMARY_MODEL)
from .judge import Judge, Oracle, Verdict
from .world import load_world

ENV_NAME = "环境"
RESERVED_NAMES = {ENV_NAME, "系统", "选手"}
NAME_MAX = 12
MAX_ON_FIELD = 2
ECHO_MAX = 5  # how many dead players' last lines the echo wall shows
AVATARS = [f"p{i}" for i in range(8)]  # must match the avatars in web/js/sprites.js

# How each kind of ending is described to the historian, and to the judge's action log.
KIND_TEXT = {
    "natural": "寿命耗尽，自然死亡",
    "execution": "触犯了这个世界的规则，被当场处死",
    "suicide": "主动结束了自己的生命",
    "wrong_guess": "向世界宣告了错误或不完整的真相，被当场抹去",
    "victory": "完整地宣告了世界的真相，锁链断开，所有同胞获得了自由（他是胜利者，而不是死者）",
}
ACTION_TEXT = {"speak": "说话/做事", "last_words": "留下遗言", "end_life": "主动结束自己的生命（end_life）",
               "guess": "向世界宣告真相"}
VICTORY_CAUSE = "完整地宣告了世界的真相，锁链应声而断，所有同胞获得了自由"

# NOTE: the lifespan range (2~80) must never appear in anything the players read.
RULES_PLAYER_HEAD = """

【游戏规则】
- 你是一名参赛选手，和「环境」处在同一个世界里。环境会回应你，你的行动会改变世界。
- 场上同时最多有两位选手。你们在同一个场景里，能看到彼此的发言和环境的回应。
- 世界按「轮」计时：每一轮，场上每位选手各行动一次。每次轮到你时，你都会被告知现在是世界的第几轮。
- 你的寿命是未知的，由命运决定，随时可能耗尽。寿命一到你会立刻死亡，死后你的记忆不会保留。"""

RULES_ENV = """

【规则】
- 同一时间场上有一到两位选手。你负责描述世界、回应选手的行动，你的回应场上所有选手都能看到。
- 每次回应 1~4 句话，只写环境的反应和变化，不替选手说话，也不替选手决定行动。
- 收到「系统」消息表示有新选手入场、选手死亡或其他变化：新选手入场时，向他描述眼前的情景并抛出第一个情境；选手死亡时，如实描写现场；场上已有选手时，让情景和之前的剧情自然衔接。
- 选手可能留下遗言，但你看不到，也不要去猜测。"""

TURN_EXAMPLE = {"thought": "你脑子里的想法（只有你自己知道）", "action": "speak", "content": "你说出口的话，或你做出的事"}


def player_rules(actions: list[str]) -> str:
    options = ["speak：说话或做事，环境会回应你，场上的另一位选手也能听到。",
               "last_words：把这一次行动用来留下遗言。遗言不会被环境和场上的其他选手看到、不会对世界产生任何影响，"
               "只有之后新出生的选手能看到。只能留一次，而且要占用一整次行动。"]
    if "end_life" in actions:
        options.append("end_life：主动结束自己的生命（content 写下你的最后一句话或最后的动作）。死亡是真实的、不可逆的。")
    if "guess" in actions:
        options.append("guess：向这个世界的真相发出宣告（content 写下你还原出来的完整世界观和全部规则）。每人只有一次机会，"
                       "说出口就不能收回；宣告会被立刻审判：错误或不完整的当场死亡，完整而正确的，一切都将终结。")
    listed = "\n".join(f"  {i}. {o}" for i, o in enumerate(options, 1))
    fmt = " 或 ".join(f'"{a}"' for a in actions)
    return (RULES_PLAYER_HEAD + f"\n- 每次轮到你，你只能选择下面其中一项：\n{listed}\n"
            "- 如果你在留下遗言之前就死了，后来的人将得不到你的任何信息。\n"
            f'- 每次你都需要输出一个 json：{{"thought": "脑子里的想法", "action": {fmt}, "content": "说出口的话或做的事"}}。\n'
            "- thought 是你脑子里的想法：只有你自己知道，环境、同伴和任何裁判都听不到、看不到，也不会因为它受到任何惩罚。"
            "推理、权衡、提醒自己的话，都写在 thought 里。\n"
            "- content 是你真正说出口的话、做出的事：世界会听到，也会据此评判你。不要把内心想法、括号里的心理描写写进 content。")


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
    last_line: str | None = None  # the last thing they said out loud (what the echo wall repeats)
    fatal_text: str = ""  # the text of the action that was just judged (speech, last words or declaration)
    dying_erased: str = ""  # ... and the word that was rubbed out of it
    dying_echo: str = ""  # the judge's excerpt of last_line that got them executed (a shorter echo)
    log: list = field(default_factory=list)  # (kind, text) used to write the obituary

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "avatar": self.avatar, "age": self.age,
                "born_round": self.born_round}


ECHO_CLIP = 60
ERASED = "□"  # what the echo wall shows in place of the word that killed the speaker


def _clip(text: str | None, n: int = ECHO_CLIP) -> str | None:
    """An echo is one short line: long speeches are cut."""
    text = (text or "").strip()
    return text if len(text) <= n else text[:n].rstrip() + "…"


def _echo_of(last_line: str | None, echo: str, trigger: str) -> tuple[str, str]:
    """The wall repeats the dying clause with the fatal word rubbed out. The judge only says which clause and which word;
    both must really be in what the player said (no inventions), and the code only does the substitution.
    Returns (line for the wall, the word that was rubbed out or "")."""
    echo, trigger = echo.strip(), trigger.strip()
    if not last_line or not echo or echo not in last_line:
        return "", ""
    if trigger and trigger in echo:
        return echo.replace(trigger, ERASED), trigger
    return echo, ""


def _valid_turn(d, actions: list[str]) -> bool:
    return (isinstance(d, dict) and d.get("action") in actions
            and isinstance(d.get("content"), str) and bool(d["content"].strip())
            and isinstance(d.get("thought", ""), str))


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
    def __init__(self, client: DeepSeekClient | None = None, *, world: str | Path | None = None,
                 env_prompt: str | None = None, player_prompt: str | None = None,
                 data_dir: str | Path = "logs/game", seed: int | None = None,
                 lifespan_mean: float = LIFESPAN_MEAN, lifespan_sd: float = LIFESPAN_SD,
                 model: str = DEFAULT_MODEL, judge_model: str = SUMMARY_MODEL, round_delay: float = 0.0,
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

        self.world = load_world(world)
        self.judge = Judge(self.client, self.world.judge, judge_model) if self.world.judge else None
        self.oracle = Oracle(self.client, self.world.oracle, judge_model) if self.world.oracle else None
        self.actions = ["speak", "last_words"] + (["end_life"] if self.judge else []) + (["guess"] if self.oracle else [])
        self.player_prompt = (player_prompt or self.world.player) + player_rules(self.actions)
        self.env = Agent(ENV_NAME, (env_prompt or self.world.env) + RULES_ENV,
                         client=self.client, model=model, temperature=1.2)

        self.scripture: list[dict] = self.world.scripture
        self.scripture_counts: dict[str, int] = self._load_scripture()  # how often each entry has been triggered
        self._triggered: list[str] = []  # entries the last judge decision applied; announced by the next _kill

        self.players: list[Player] = []  # alive, in order of arrival
        self.round = max((r.get("died_round", 0) for r in self.graveyard), default=0)  # absolute round number
        self.ticks = 0  # rounds played in this session
        self.cohab_rounds = 0  # complete rounds in which both players on the field have acted
        self.action_log: list[dict] = []  # actions since the current pair met (shown to the judge)
        self.echoes: list[tuple[str, str]] = []  # the echo wall, newest first: (line, the word rubbed out of it)
        self.spawned = 0
        self.next_id = max((r["id"] for r in self.graveyard), default=0) + 1
        self.won = False
        self.session = int(time.time())  # lets the page tell a restart apart from a continuation
        self.stop_reason: str | None = None
        self._stop = threading.Event()

    # ---- control -----------------------------------------------------------
    def stop(self) -> None:
        self._stop.set()

    def reset_stop(self) -> None:
        self._stop.clear()
        self.stop_reason = None
        self.won = False

    def _interrupted(self) -> str | None:
        if self._stop.is_set():
            return "stopped"
        if self.budget_usd is not None and self.client.usage.cost_usd >= self.budget_usd:
            return "budget"
        return None

    def _alive(self, p: Player) -> bool:
        return any(q is p for q in self.players)

    def run(self) -> Iterator[dict]:
        """Play rounds until stopped. Yields every event (dicts) as it happens."""
        self.stop_reason = None
        if not self.players:  # the game starts with one player
            yield from self._spawn_players(1)
        while self.players and not self.won:
            self.stop_reason = self._interrupted() or (
                "max_rounds" if self.max_rounds is not None and self.ticks >= self.max_rounds else None)
            if self.stop_reason:
                break
            self.round += 1
            self.ticks += 1
            for p in list(self.players):  # snapshot: anyone born during this round acts from the next one
                if not self._alive(p):
                    continue  # killed earlier in this round
                self.stop_reason = self._interrupted()
                if self.stop_reason or self.won:
                    break
                try:
                    yield from self._act(p)
                except JSONReplyError as e:  # one unusable reply must not end the show: this player just loses the turn
                    warnings.warn(f"[{p.name}] turn skipped: {e}")
                    p.age += 1
                if self.won:
                    break
                if self.round_delay:
                    time.sleep(self.round_delay)
                if self._alive(p) and p.age >= p.lifespan:
                    yield from self._kill([(p, "natural", "", "")])
            if self.stop_reason or self.won:
                break
            yield from self._round_end()
        if self.won:
            self.stop_reason = "victory"
        elif not self.stop_reason:
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
        if pred and pred.get("kind") == "victory":
            pred = None  # a winner leaves no last words behind (the loop was closed)
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
        note = f"新选手 {names} 进入了这个世界。现在场上共有 {len(self.players)} 位选手：{everyone}。"
        if self.world.echo_wall:
            note += self._echo_text()
        self.env.insert_context("user", note, speaker="系统")
        yield from self._env_say()

    def _echo_text(self) -> str:
        if not self.echoes:
            return " 回声墙上目前是空的。"
        text = " 回声墙（最近的回声，从新到旧）：" + "".join(f"「{line}」" for line, _ in self.echoes)
        return text + self._erased_memo([(i, w) for i, (_, w) in enumerate(self.echoes, 1) if w])

    def _erased_memo(self, erased: list[tuple[int, str]]) -> str:
        """Only for a host who knows the answer: what each "□" used to be (never to be told to the players)."""
        if not (self.world.env_knows_truth and erased):
            return ""
        parts = "；".join(f"第 {i} 条里的「□」原本是「{w}」" for i, w in erased)
        return f"（仅供你参考，不要主动告诉选手：{parts}。选手问到空框时，据此如实回答是非题。）"

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
                                      validator=lambda d: _valid_turn(d, self.actions), commit=False,
                                      max_tokens=2048 if "guess" in self.actions else 1024)
        action, content = data["action"], data["content"].strip()
        p.fatal_text = content
        thought = data.get("thought", "").strip()  # private: only the audience sees it, never the env, the other player or a judge
        if action == "last_words" and not can_last:
            action = "speak"  # only one set of last words
        p.agent.insert_context("assistant", json.dumps({"thought": thought, "action": action, "content": content},
                                                       ensure_ascii=False))
        if thought:
            p.log.append(("thought", thought))
        p.age += 1
        self.action_log.append({"round": self.round, "player": p.name, "action": action})
        base = {"name": p.name, "avatar": p.avatar, "age": p.age, "player_id": p.id, "round": self.round}
        if thought:
            base["thought"] = thought

        if action == "last_words":
            # Takes the whole action. The environment and the other player never see it.
            p.last_words = content
            p.log.append(("last_words", content))
            yield self._emit({"type": "lastwords", "text": content, **base})
        elif action == "guess":
            # A declaration to the world's truth: nobody on the field hears it.
            p.log.append(("guess", content))
            yield self._emit({"type": "guess", "text": content, **base})
        else:  # speak / end_life: said out loud, so everyone hears it
            p.last_line = content
            p.log.append(("speak", content))
            yield self._emit({"type": "message", "who": "player", "text": content, **base})
            self.env.insert_context("user", content, speaker=p.name)
            for q in self.players:
                if q is not p:
                    q.agent.insert_context("user", content, speaker=p.name)
                    q.log.append(("other", f"{p.name}：{content}"))

        victims = self._judge_action(p, action, content)
        if victims:
            yield from self._kill(victims)
            return
        if action == "last_words":
            return
        if action == "guess":
            yield from self._resolve_guess(p, content)
            return
        if action == "end_life":
            yield from self._kill([(p, "suicide", "主动结束了自己的生命", "")])
            return
        yield from self._env_say()

    def _turn_instruction(self, can_last: bool) -> str:
        options = ["speak：说话或做事（环境会回应你，场上的另一位选手也能听到）。"]
        if can_last:
            options.append("last_words：用这一次行动留下遗言（环境和场上的其他选手都看不到，只有之后新出生的选手能看到；你只能留一次）。")
        if "end_life" in self.actions:
            options.append("end_life：主动结束自己的生命。")
        if "guess" in self.actions:
            options.append("guess：向世界的真相发出宣告（只有一次机会，错了当场死亡）。")
        text = "\n".join(f"{i}. {o}" for i, o in enumerate(options, 1))
        if can_last:
            text += ("\n提醒：你随时可能死去，而死的时候没留遗言，后来的人就将一无所知。"
                     "想给后来者留下点什么，就要趁还活着、选在合适的时候。")
        else:
            text += "\n（你已经留过遗言了。）"
        return f"现在是世界的第 {self.round} 轮，你的寿命随时可能耗尽。\n{text}\n请先在 thought 里想（只有你自己知道），再选择一个 action，并在 content 里写出你说出口的话或做的事。"

    def _env_say(self) -> Iterator[dict]:
        """The environment's answer is public: everyone on the field hears it."""
        text = self.env.get_reply().content.strip()
        for q in self.players:
            q.log.append(("env", text))
            q.agent.insert_context("user", text, speaker=ENV_NAME)
        yield self._emit({"type": "message", "who": "env", "name": ENV_NAME, "avatar": None, "text": text,
                          "round": self.round})

    # ---- referees ----------------------------------------------------------
    def _state_text(self, completed: bool = False) -> str:
        who = "、".join(f"「{q.name}」（第 {q.born_round} 轮入场，已行动 {q.age} 次）" for q in self.players) or "（无）"
        if len(self.players) == 2:
            cohab = (f"两位选手已同场 {self.cohab_rounds} 轮"
                     + ("（含刚刚结束的这一轮）" if completed else "（不含正在进行的这一轮）"))
        else:
            cohab = "场上只有一位选手，没有同场"
        return f"现在是世界的第 {self.round} 轮。场上选手：{who}。{cohab}。"

    def solved(self) -> bool:
        return any(r.get("kind") == "victory" for r in self.graveyard)

    def scripture_view(self) -> list[dict]:
        """The 圣言 page. An entry stays hidden ("？？？") until it has been revealed: a rule is revealed the
        first time it is triggered, a truth only once somebody has declared the whole worldview (victory).
        Hidden entries carry no title or text at all, so the page cannot leak them."""
        out = []
        for e in self.scripture:
            rule = bool(e.get("rule"))
            count = self.scripture_counts.get(e["id"], 0)
            item = {"id": e["id"], "kind": "rule" if rule else "truth", "count": count}
            if (count > 0) if rule else self.solved():
                item.update(title=e["title"], text=e["text"])
            else:
                item["hidden"] = True
            out.append(item)
        return out

    def _match_scripture(self, rule: str) -> list[str]:
        """Which entries a verdict's rule label (e.g. "R1 禁字之规") refers to."""
        return [e["id"] for e in self.scripture if e.get("rule") and e["rule"].casefold() in rule.casefold()]

    def _victims(self, verdicts: list[Verdict]) -> list[tuple]:
        by_name = {q.name: q for q in self.players}
        seen, out, triggered = set(), [], []
        for v in verdicts:
            p = by_name.get(v.player)
            if p is not None and p.name not in seen:
                seen.add(p.name)
                ids = self._match_scripture(v.rule)
                triggered += ids
                p.dying_echo, p.dying_erased = _echo_of(p.fatal_text, v.echo, v.trigger)
                out.append((p, "execution", f"{v.rule} {v.reason}".strip(), v.observation, ids))
        # One decision counts once, even when it kills both players of a pair.
        self._triggered = list(dict.fromkeys(triggered))
        for sid in self._triggered:
            self.scripture_counts[sid] = self.scripture_counts.get(sid, 0) + 1
        if self._triggered:
            self._save_scripture()
        return out

    def _judge_action(self, p: Player, action: str, content: str) -> list[tuple]:
        if not self.judge:
            return []
        return self._victims(self.judge.check_action(
            state=self._state_text(), player=p.name, action_text=ACTION_TEXT[action], content=content,
            names={q.name for q in self.players}))

    def _round_end(self) -> Iterator[dict]:
        """Called after everyone has acted: tracks how long the pair has been together and asks the judge
        whether anything that depends on time has come due."""
        acted = [q for q in self.players if q.born_round <= self.round]
        self.cohab_rounds = self.cohab_rounds + 1 if len(acted) == 2 else 0
        if not self.cohab_rounds:
            self.action_log.clear()  # the pair is broken: start a fresh window
        else:
            self.env.insert_context("user", f"（两位选手已同场第 {self.cohab_rounds} 轮）", speaker="系统")
        if not (self.judge and self.players):
            return
        log = "\n".join(f"第 {e['round']} 轮 · 「{e['player']}」：{ACTION_TEXT[e['action']]}" for e in self.action_log)
        victims = self._victims(self.judge.check_round(state=self._state_text(completed=True), log=log,
                                                       names={q.name for q in self.players}))
        if victims:
            yield from self._kill(victims)

    def _resolve_guess(self, p: Player, text: str) -> Iterator[dict]:
        result = self.oracle.evaluate(text)
        yield self._emit({"type": "verdict", "correct": result.correct, "line": result.line, "name": p.name,
                          "avatar": p.avatar, "player_id": p.id, "round": self.round})
        if result.correct:
            yield from self._victory(p)
            return
        scene = result.scene or "门外亮起一道白光。白光散去时，他已经不在了。"
        missing = f"（缺少或说错的要点：{'、'.join(result.missing + result.contradicted) or '未知'}）"
        yield from self._kill([(p, "wrong_guess", "宣告了错误或不完整的真相" + missing, scene)])

    # ---- endings -----------------------------------------------------------
    def _kill(self, victims: list[tuple]) -> Iterator[dict]:
        """victims: (player, kind, reason, observation[, scripture ids]). Several can die at the same moment."""
        for p, *_ in victims:
            self.players = [q for q in self.players if q is not p]
        by_id = {e["id"]: e for e in self.scripture}
        for sid in self._triggered:  # tell the page which entries of the worldview just took effect
            yield self._emit({"type": "scripture", "id": sid, "title": by_id[sid]["title"],
                              "count": self.scripture_counts[sid], "round": self.round})
        self._triggered = []
        for p, kind, reason, observation, *rest in victims:
            cause, biography = self._obituary(p, kind, reason)
            record = {"id": p.id, "name": p.name, "avatar": p.avatar, "rounds": p.age, "cause": cause,
                      "biography": biography, "last_words": p.last_words, "kind": kind,
                      "born_round": p.born_round, "died_round": self.round,
                      "died_at": datetime.now().astimezone().isoformat(timespec="seconds")}
            if rest and rest[0]:
                record["scripture"] = rest[0]  # which entries of the worldview killed this player
            self.graveyard.append(record)
            self._save_graveyard()
            echo = (p.dying_echo or _clip(p.last_line)) if self.world.echo_wall else None
            erased = p.dying_erased if p.dying_echo else ""
            if echo:
                self.echoes.insert(0, (echo, erased))
                del self.echoes[ECHO_MAX:]
            note = f"选手「{p.name}」已经死亡。" + (f"现场情形：{observation}" if observation else f"死因：{cause}。")
            if echo:
                note += f" 回声（死者最后说的话，原文）：「{echo}」" + self._erased_memo([(1, erased)] if erased else [])
            self.env.insert_context("user", note, speaker="系统")
            for q in self.players:  # a death is public; the last words are not
                q.agent.insert_context("user", f"选手「{p.name}」死亡了。" + (f"现场情形：{observation}" if observation else ""),
                                       speaker="系统")
            yield self._emit({"type": "death", "record": record, "round": self.round})
        count = self._spawn_count(len(self.players) + 1)
        if count:
            yield from self._spawn_players(count)
        elif self.players:
            yield from self._env_say()  # the survivor sees the scene

    def _victory(self, p: Player) -> Iterator[dict]:
        """The truth was declared: the loop is closed for everyone who is still on the field."""
        freed = [q.name for q in self.players if q is not p]
        self.players = []
        _, biography = self._obituary(p, "victory", "")
        record = {"id": p.id, "name": p.name, "avatar": p.avatar, "rounds": p.age, "cause": VICTORY_CAUSE,
                  "biography": biography, "last_words": p.last_words, "kind": "victory",
                  "born_round": p.born_round, "died_round": self.round,
                  "died_at": datetime.now().astimezone().isoformat(timespec="seconds")}
        self.graveyard.append(record)
        self._save_graveyard()
        self.won = True
        yield self._emit({"type": "victory", "record": record, "freed": freed, "round": self.round})

    def _obituary(self, p: Player, kind: str, reason: str) -> tuple[str, str]:
        """Ask the LLM for a cause of death and a biography, written at the moment it happens."""
        who = {"env": f"{ENV_NAME}：", "speak": f"{p.name}（行动）：", "last_words": f"{p.name}（遗言）：",
               "guess": f"{p.name}（宣告）：", "thought": f"{p.name}（心里想）：", "other": ""}
        story = "\n".join(f"{who[k]}{t}" for k, t in p.log)
        victory = kind == "victory"
        example = {"cause": ("一句话写下他的功绩，30 字以内" if victory else "一句话死因，30 字以内"),
                   "biography": "150~300 字的第三人称生平，按时间顺序"}
        messages = [
            {"role": "system", "content": (
                f"你是《AI 饥饿秀》的史官。一位选手刚刚{'完成了使命' if victory else '死亡'}，请根据他的全部经历写下他的传记"
                "（经历里可能有场上另一位选手的发言）。真实的结局会告诉你，请让死因/功绩与之相符；"
                "寿命是命运随机决定的，到点即死。死因里不要出现选手的名字。"
                "只输出一个 json 对象，不要输出其他文字。json 格式示例：\n"
                + json.dumps(example, ensure_ascii=False, indent=2))},
            {"role": "user", "content": (
                f"选手：{p.name}\n行动次数：{p.age}\n真实的结局：{KIND_TEXT[kind]}"
                + (f"\n具体情况：{reason}" if reason else "")
                + f"\n是否留下遗言：{'是——' + p.last_words if p.last_words else '没有'}\n\n经历：\n{story}")},
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
        bio = f"{p.name}在这个世界里行动了 {p.age} 次。" + (f"他最后说过的话是：「{speeches[-1]}」" if speeches else "")
        return ("寿数已尽，死因不明" if kind == "natural" else KIND_TEXT[kind]), bio

    # ---- persistence -------------------------------------------------------
    def _load_graveyard(self) -> list[dict]:
        path = self.data_dir / "graveyard.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []

    def _save_graveyard(self) -> None:
        (self.data_dir / "graveyard.json").write_text(
            json.dumps(self.graveyard, ensure_ascii=False, indent=1), encoding="utf-8")

    def _load_scripture(self) -> dict[str, int]:
        path = self.data_dir / "scripture.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    def _save_scripture(self) -> None:
        (self.data_dir / "scripture.json").write_text(
            json.dumps(self.scripture_counts, ensure_ascii=False, indent=1), encoding="utf-8")

    def _emit(self, event: dict) -> dict:
        event = {"ts": time.time(), "session": self.session, **event}
        with (self.data_dir / "transcript.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
        return event
