"""Game: one persistent world ("环境") and a changing cast of mortal players (at most two at a time).

Mechanics (the *content* of the world lives in words/<world>/, see world.py):
 1. Every player gets a hidden lifespan drawn from a normal distribution truncated to 2..80 of
    their own actions. When it is used up the player dies at once. Players are never told the range.
 2. The world counts time in rounds: in each round every player on the field acts once. Players are
    told the absolute round number every time it is their turn.
 3. An action is one of:
      speak       - the environment answers, the other player hears it
      last_words  - takes the whole action; never reaches the environment or the other player on the
                    field; inherited only by the player(s) born next. May be left again: the new one replaces the old
      end_life    - the player ends their own life              (worlds with a judge)
      guess       - the player declares the whole truth of the world; the oracle rules on it at once:
                    wrong -> death, right -> the players win and the game is over   (worlds with an oracle)
 4. Every player picks their own name when they spawn.
 5. The game starts with one player. When players die: if one is left on the field there is a 25%
    chance a new one is born; if nobody is left, 90% one is born and 10% two are born.
 6. Each death is written to the graveyard: avatar, name, cause, and a biography generated at death.
 7. If the world has a judge.md, an LLM judge applies the secret rules after every action and at the end
    of every round. No rule is hard-coded here. If it has an oracle.md, an LLM oracle grades declarations.
 8. Rare births: with a small chance the newcomer is instead the dead player the audience liked most, revived
    with the memory of their last life (rebuilt from transcript.jsonl). Otherwise a newcomer may be born with a rare
    identity (config.SPECIAL_CHANCES, each with its own prompt in prompts/player/<name>.md):
      catgirl, bard, believer   - only a way of speaking and acting
      gambler                   - bets their own lifespan at birth: won = 1.5x, lost = 0.5x
      medium                    - sees the outline (strokes, structure, radical) of every word rubbed out on the echo wall
      chronicler (史官)         - reads the last words of the last CHRONICLE_READ dead at birth; their own last words reach
                                  the first CHRONICLE_PASS players born after their death, not just the next one
      earthbound                - does not leave at death: haunts the field as a ghost that now and then whispers one line
                                  to the living (judged like anything else: a forbidden word disperses it)
    Two players born at the same moment may be lovers (LOVERS_CHANCE): when one dies, the other gets one last action
    and then dies of a broken heart.
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
from .config import (DEFAULT_MODEL, LIFESPAN_MAX, LIFESPAN_MEAN, LIFESPAN_MIN, LIFESPAN_SD, LOVERS_CHANCE,
                     REVIVE_CHANCE, SPAWN_IF_TWO, SPAWN_TWO_IF_ONE, SPECIAL_CHANCES, SUMMARY_MODEL)
from .judge import Judge, Oracle, Verdict, _ask_json
from .prompts import Prompts, fill
from .votes import VoteBox
from .world import load_world

ENV_NAME = "环境"
RESERVED_NAMES = {ENV_NAME, "系统", "选手"}
NAME_MAX = 12
MAX_ON_FIELD = 2
ECHO_MAX = 5  # how many dead players' last lines the echo wall shows
AVATARS = [f"p{i}" for i in range(8)]  # must match the avatars in web/js/sprites.js
# rare identities with a face of their own (also in sprites.js), never drawn for anyone else
SPECIAL_AVATARS = {"catgirl": "cat", "bard": "bard", "gambler": "gambler", "medium": "medium", "believer": "believer",
                   "earthbound": "earthbound", "chronicler": "chronicler"}
CHRONICLE_READ = 10  # a chronicler reads the last words of this many of the most recent dead...
CHRONICLE_PASS = 10  # ...and their own last words reach this many of those born after them
GHOST_EVERY = 3  # an earthbound ghost whispers every this many rounds...
GHOST_MAX = 4  # ...this many times at most...
GHOST_ROUNDS = 12  # ...and fades away after this many rounds
GHOST_CHARS = 30
PAST_LINES = 60  # how much of their last life a revived player remembers (lines, newest kept)
PAST_CHARS = 6000

def player_rules(prompts: Prompts, actions: list[str]) -> str:
    listed = "\n".join(f"  {i}. {prompts.strings('player')['rule_actions'][a]}" for i, a in enumerate(actions, 1))
    fmt = " 或 ".join(f'"{a}"' for a in actions)
    return "\n\n" + fill(prompts.text("player/rules"), options=listed, actions=fmt)


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
    personality: dict | None = None  # {"virtue": {name, tip, desc}, "flaw": {...}}, drawn at birth
    special: str | None = None  # "revived" | "lover" | one of SPECIAL_CHANCES ("catgirl", "bard", ...) | None
    life: int = 1  # which life this is (a revived player is on their second, third...)
    revived_from: int | None = None  # the grave record of the life before
    lover: "Player | None" = field(default=None, repr=False, compare=False)
    heartbroken: bool = False  # the lover died: one last action, then this one dies too

    def tags(self) -> dict:
        """What the page needs to draw a special player differently (sent with every event about them)."""
        if not self.special:
            return {}
        out = {"special": self.special}
        if self.special == "revived":
            out.update(life=self.life, revived_from=self.revived_from)
        if self.lover:
            out["lover"] = self.lover.name
        return out

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "avatar": self.avatar, "age": self.age, "personality": shown(self.personality),
                "born_round": self.born_round, **self.tags()}


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


def shown(pers: dict | None) -> dict | None:
    """What the audience gets to see of a personality (the long description stays in the player's own prompt)."""
    return {k: {"name": v["name"], "tip": v.get("tip", "")} for k, v in pers.items()} if pers else None


def pick_personality(rng: random.Random, pool: dict, avoid: set[str] = frozenset()) -> dict:
    """One virtue and one flaw. Contradictory pairs (a brave coward) are never drawn, and names already on the field
    (or just dead) are avoided when the pool is big enough, so two players do not read alike."""
    virtues = [v for v in pool["virtues"] if v["name"] not in avoid] or pool["virtues"]
    virtue = rng.choice(virtues)
    flaws = [f for f in pool["flaws"] if virtue["name"] not in f.get("not_with", [])] or pool["flaws"]
    fresh = [f for f in flaws if f["name"] not in avoid]
    return {"virtue": virtue, "flaw": rng.choice(fresh or flaws)}


def personality_prompt(prompts: Prompts, pers: dict) -> str:
    v, f = pers["virtue"], pers["flaw"]
    return fill(prompts.text("player/personality"), virtue=v["name"], virtue_desc=v["desc"], flaw=f["name"], flaw_desc=f["desc"])


def _valid_turn(d, actions: list[str]) -> bool:
    return (isinstance(d, dict) and d.get("action") in actions
            and isinstance(d.get("content"), str) and bool(d["content"].strip())
            and isinstance(d.get("thought", ""), str) and isinstance(d.get("to") or "", str))


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
                 budget_usd: float | None = None, revive_chance: float = REVIVE_CHANCE,
                 special_chances: dict[str, float] | None = None, lovers_chance: float = LOVERS_CHANCE):
        self.client = client or DeepSeekClient()
        self.model = model
        self.rng = random.Random(seed)
        self.lifespan_mean, self.lifespan_sd = lifespan_mean, lifespan_sd
        self.round_delay = round_delay
        self.revive_chance, self.lovers_chance = revive_chance, lovers_chance
        self.special_chances = {**SPECIAL_CHANCES, **(special_chances or {})}
        unknown = set(self.special_chances) - set(SPECIAL_AVATARS)
        if unknown:
            raise ValueError(f"unknown special identities: {sorted(unknown)}")
        self.ghost: dict | None = None  # the earthbound ghost haunting the field: {"p", "since", "next", "whispers", "record"}
        self._outlines: dict[str, str] = {}  # what a medium sees of a rubbed-out word, asked once per word
        self.max_players, self.max_rounds, self.budget_usd = max_players, max_rounds, budget_usd
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.graveyard: list[dict] = self._load_graveyard()

        self.world = load_world(world)
        # Every text sent to a model lives under prompts/, and the world may override any of it in its own prompts/
        # folder (see prompts/README.md). NOTE: the lifespan range (2~80) must never appear in anything the players read.
        self.prompts = Prompts(self.world.root)
        self.P = self.prompts.strings("player")  # what the players are told
        self.E = self.prompts.strings("env")  # what the environment is told
        self.J = self.prompts.strings("judge")  # the state and action log shown to the judge, and the oracle's fallbacks
        self.H = self.prompts.strings("historian")  # the obituary
        self.judge = Judge(self.client, self.world.judge, judge_model, self.prompts) if self.world.judge else None
        self.oracle = Oracle(self.client, self.world.oracle, judge_model, self.prompts) if self.world.oracle else None
        self.actions = ["speak", "last_words"] + (["end_life"] if self.judge else []) + (["guess"] if self.oracle else [])
        self.player_prompt = (player_prompt or self.world.player) + player_rules(self.prompts, self.actions)
        self.env = Agent(ENV_NAME, (env_prompt or self.world.env) + "\n\n" + self.prompts.text("env/rules"),
                         client=self.client, model=model, temperature=1.2, prompts=self.prompts)

        self.scripture: list[dict] = self.world.scripture
        self.scripture_counts: dict[str, int] = self._load_scripture()  # how often each entry has been triggered
        self._triggered: list[str] = []  # entries the last judge decision applied; announced by the next _kill

        self.players: list[Player] = []  # alive, in order of arrival
        self.round = max((r.get("died_round", 0) for r in self.graveyard), default=0)  # absolute round number
        self.ticks = 0  # rounds played in this session
        self.cohab_rounds = 0  # complete rounds in which both players on the field have acted
        self.action_log: list[dict] = []  # actions since the current pair met (shown to the judge)
        self.echoes: list[tuple[str, str]] = []  # the echo wall, newest first: (line, the word rubbed out of it)
        self._echo_new = 0  # lines carved since the environment last spoke
        self._echo_all = False  # the environment was just shown the whole wall (a newcomer arrived)
        self.spawned = 0
        self.next_id = max((r["id"] for r in self.graveyard), default=0) + 1
        self.won = False
        self.votes = VoteBox()  # the audience's thumbs up / down, frozen into the grave record at death
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
                if self._alive(p) and p.heartbroken:  # that was the last thing they did without their lover
                    yield from self._kill([(p, "heartbreak", self.H["heartbreak_reason"], "")])
                elif self._alive(p) and p.age >= p.lifespan:
                    yield from self._kill([(p, "natural", "", "")])
            if self.stop_reason or self.won:
                break
            yield from self._round_end()
            yield from self._ghost_turn()
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
        lovers = n == 2 and self.rng.random() < self.lovers_chance  # born at the same moment, and for each other
        newcomers = []
        for _ in range(n):
            newcomers.append((yield from self._spawn_one(pred, lover=lovers)))
        if lovers:
            a, b = newcomers
            a.lover, b.lover = b, a
            for q in newcomers:
                q.agent.insert_context("system", fill(self.prompts.text("player/lover"), name=q.lover.name), pinned=True)
            yield self._emit({"type": "lovers", "players": [{"id": q.id, "name": q.name, "avatar": q.avatar} for q in newcomers],
                              "round": self.round})
        # Tell everyone who is new, then let the environment set the scene.
        names = "、".join(f"「{p.name}」" for p in newcomers)
        back = "".join(fill(self.P["partner_revived"], name=p.name) for p in newcomers if p.special == "revived")
        for q in self.players:
            others = [o for o in self.players if o is not q]
            who = "、".join(f"「{o.name}」" for o in others)
            tail = self.P["partner_tail"]
            if any(q is n for n in newcomers):
                if others:
                    old = [o for o in others if not any(o is n for n in newcomers)]
                    since = fill(self.P["joined_partner_since"], age=old[0].age) if old and old[0].age else ""
                    q.agent.insert_context(
                        "user", fill(self.P["joined_partner"], who=who, since=since, count=len(self.players), tail=tail),
                        speaker="系统")
            else:
                q.agent.insert_context(
                    "user", fill(self.P["partner_arrived"], names=names, count=len(self.players), who=who, tail=tail) + back,
                    speaker="系统")
        everyone = "、".join(f"「{p.name}」" for p in self.players)
        note = fill(self.E["newcomers"], names=names, count=len(self.players), everyone=everyone)
        note += "".join(fill(self.E["revived"], name=p.name) for p in newcomers if p.special == "revived")
        note += "".join(fill(self.E["believer"], name=p.name) for p in newcomers if p.special == "believer")
        if self.world.echo_wall:
            note += self._echo_text()
            self._echo_all = True
        self.env.insert_context("user", note, speaker="系统")
        yield from self._env_say()

    def _echo_text(self) -> str:
        if not self.echoes:
            return self.E["echo_empty"]
        wall = fill(self.E["echo_wall"], lines="".join(f"「{line}」" for line, _ in self.echoes))
        return wall + self._erased_memo([(i, w) for i, (_, w) in enumerate(self.echoes, 1) if w])

    def _erased_memo(self, erased: list[tuple[int, str]]) -> str:
        """Only for a host who knows the answer: what each "□" used to be (never to be told to the players)."""
        if not (self.world.env_knows_truth and erased):
            return ""
        items = "；".join(fill(self.E["erased_item"], i=i, word=w) for i, w in erased)
        return fill(self.E["erased_memo"], items=items)

    def _roll_special(self) -> str | None:
        """At most one rare identity per newcomer."""
        roll, acc = self.rng.random(), 0.0
        for name, chance in self.special_chances.items():
            acc += chance
            if roll < acc:
                return name
        return None

    def _spawn_one(self, pred: dict | None, lover: bool = False) -> Iterator[dict]:
        pid = self.next_id
        self.next_id += 1
        self.spawned += 1
        agent = Agent(f"选手{pid}", self.player_prompt, client=self.client, model=self.model, temperature=1.0,
                      prompts=self.prompts)
        # a rare birth: the audience's favourite comes back from the dead, or someone with a rare identity is born
        past = None if lover or self.rng.random() >= self.revive_chance else self._revival_candidate()
        special = "lover" if lover else "revived" if past else self._roll_special()
        pers = self._restore_personality(past) if past else None
        if self.world.personalities and not pers:
            avoid = {x["name"] for q in self.players if q.personality for x in q.personality.values()}
            avoid |= {x["name"] for x in ((pred or {}).get("personality") or {}).values()}
            pers = pick_personality(self.rng, self.world.personalities, avoid)
        if pers:
            agent.insert_context("system", personality_prompt(self.prompts, pers), pinned=True)
        if special in SPECIAL_AVATARS:
            agent.insert_context("system", self.prompts.text(f"player/{special}"), pinned=True)
        if past:
            agent.insert_context("system", self._revival_prompt(past), pinned=True)
        if special == "chronicler":
            agent.insert_context("system", self._chronicle(), pinned=True)
        inherited = bool(pred and pred.get("last_words")) and not (past and pred["id"] == past["id"])
        if inherited:  # only the player who died right before this birth hands anything down
            agent.insert_context("system", fill(self.P["inherited_last_words"], name=pred["name"], text=pred["last_words"]),
                                 pinned=True)
        legacies = [r for r in self._legacies() if not (inherited and r["id"] == pred["id"])]
        for r in legacies:  # a chronicler's last words reach more than the next newcomer
            agent.insert_context("system", fill(self.P["chronicler_legacy"], name=r["name"], text=r["last_words"],
                                                count=CHRONICLE_PASS), pinned=True)
        if past:  # the same name and face as before: nothing new to pick
            name, avatar = past["name"], past["avatar"]
            intro = self._intro(agent, self.P["revived_intro"])
        else:
            name, intro = self._choose_name(agent, pid, bool(pers))
            taken = {q.avatar for q in self.players} | ({pred["avatar"]} if pred else set())
            avatar = SPECIAL_AVATARS.get(special) or self.rng.choice([a for a in AVATARS if a not in taken] or AVATARS)
        agent.name = name
        lifespan = sample_lifespan(self.rng, self.lifespan_mean, self.lifespan_sd)
        gamble = None
        if special == "gambler":  # bets the lifespan at birth (never told how long it is, only that it grew or shrank)
            gamble = "won" if self.rng.random() < 0.5 else "lost"
            lifespan = min(LIFESPAN_MAX, round(lifespan * 1.5)) if gamble == "won" else max(LIFESPAN_MIN, round(lifespan * 0.5))
            agent.insert_context("system", self.P[f"gambler_{gamble}"], pinned=True)
        player = Player(pid, agent, name, avatar, lifespan, born_round=self.round + 1, personality=pers, special=special)
        if past:
            player.life, player.revived_from = past.get("life", 1) + 1, past["id"]
            past["revived_as"] = pid  # one grave, one return
            self._save_graveyard()
        self.players.append(player)
        event = {"type": "spawn", "player": player.public(), "inherited_last_words": inherited,
                 "personality": shown(pers), "intro": intro, "round": self.round}
        if past:
            event["revived"] = {"from": past["id"], "life": player.life, "died_round": past.get("died_round"),
                                "kind": past.get("kind")}
        if gamble:
            event["gamble"] = gamble
        if legacies:
            event["legacies"] = [r["name"] for r in legacies]
        yield self._emit(event)
        if special == "medium":  # opens their eyes on the wall as it is now
            yield from self._medium_vision(player, [(line, w) for line, w in self.echoes if w])
        return player

    # ---- the chronicler (史官) ------------------------------------------------
    def _chronicle(self) -> str:
        """What a chronicler reads at birth: the last words of the most recent dead, newest first."""
        P = self.P
        recs = [r for r in reversed(self.graveyard) if r.get("last_words")][:CHRONICLE_READ]
        items = "\n".join(fill(P["chronicler_item"], name=r["name"], round=r.get("died_round", "?"), text=r["last_words"])
                          for r in recs)
        return fill(self.prompts.text("player/chronicler_archive"), count=len(recs), items=items or P["chronicler_none"])

    def _legacies(self) -> list[dict]:
        """Chroniclers' last words still on their way: each reaches the first CHRONICLE_PASS players born after its
        writer died. Counted from the graveyard and the field, so it survives a restart."""
        born = [r.get("born_round") or 0 for r in self.graveyard] + [q.born_round for q in self.players]
        return [r for r in self.graveyard
                if r.get("special") == "chronicler" and r.get("last_words")
                and sum(b > (r.get("died_round") or 0) for b in born) < CHRONICLE_PASS]

    # ---- the medium: the outline of a rubbed-out word ------------------------
    def _outline(self, word: str) -> str:
        """Strokes, structure and radical of a word, without the word itself (asked once per word)."""
        if word not in self._outlines:
            S = self.prompts.strings("medium")
            data = _ask_json(self.client, self.prompts.text("medium/system"), fill(self.prompts.text("medium/request"), word=word),
                             SUMMARY_MODEL, "medium") or {}
            outline = str(data.get("outline") or "").strip()
            if not outline or word in outline:  # it must never spell the word out
                outline = S["unclear"]
            self._outlines[word] = outline
        return self._outlines[word]

    def _medium_vision(self, p: Player, erased: list[tuple[str, str]]) -> Iterator[dict]:
        """Tell a medium what they see in the blanks of these wall lines; the audience sees it too (never the word)."""
        S = self.prompts.strings("medium")
        items = [{"line": line, "outline": self._outline(word)} for line, word in erased]
        text = "\n".join(fill(S["item"], line=i["line"], outline=i["outline"]) for i in items) or S["nothing"]
        p.agent.insert_context("user", fill(S["vision"], items=text), speaker="系统")
        yield self._emit({"type": "vision", "player_id": p.id, "name": p.name, "avatar": p.avatar, "items": items,
                          "round": self.round, **p.tags()})

    # ---- the earthbound: a ghost that stays ----------------------------------
    def _haunt(self, p: Player, record: dict) -> Iterator[dict]:
        self.ghost = {"p": p, "since": self.round, "next": self.round + 1, "whispers": 0, "record": record}
        record["ghost"] = {"whispers": 0}
        self._save_graveyard()
        p.agent.insert_context("user", fill(self.P["ghost_awaken"], max=GHOST_CHARS), speaker="系统")
        yield self._emit({"type": "haunt", "player_id": p.id, "name": p.name, "avatar": p.avatar, "round": self.round,
                          **p.tags()})

    def _ghost_turn(self) -> Iterator[dict]:
        """Every few rounds the ghost whispers one line to someone alive. It is judged like a living player's words."""
        g = self.ghost
        if not g or not self.players:
            return
        p = g["p"]
        if self.round - g["since"] >= GHOST_ROUNDS or g["whispers"] >= GHOST_MAX:
            yield from self._ghost_gone("faded")
            return
        if self.round < g["next"]:
            return
        g["next"] = self.round + GHOST_EVERY
        names = "、".join(f"「{q.name}」" for q in self.players)
        try:
            d = p.agent.get_json_reply(
                fill(self.P["ghost_turn"], names=names, max=GHOST_CHARS), example=self.P["ghost_example"],
                validator=lambda d: isinstance(d, dict) and isinstance(d.get("content"), str) and bool(d["content"].strip()),
                commit=False, max_tokens=512)
        except JSONReplyError:
            return
        text = d["content"].strip()[:GHOST_CHARS]
        target = next((q for q in self.players if q.name in str(d.get("to") or "")), self.players[0])
        p.agent.insert_context("assistant", json.dumps({"to": target.name, "content": text}, ensure_ascii=False))
        g["whispers"] += 1
        g["record"]["ghost"]["whispers"] = g["whispers"]
        self._save_graveyard()
        yield self._emit({"type": "message", "who": "ghost", "name": p.name, "avatar": p.avatar, "player_id": p.id,
                          "to": target.name, "text": text, "round": self.round, **p.tags()})
        target.agent.insert_context("user", fill(self.P["ghost_whisper_heard"], name=p.name, content=text))
        target.log.append(("other", fill(self.H["story_ghost"], name=p.name, content=text)))
        if not self.judge:
            return
        verdicts = self.judge.check_action(state=self._state_text(), player=p.name, content=text,
                                           action_text=self.J["action_text"]["ghost_whisper"], names={p.name})
        if verdicts:  # a ghost can die a second time: it is torn apart
            ids = list(dict.fromkeys(i for v in verdicts for i in self._match_scripture(v.rule)))
            by_id = {e["id"]: e for e in self.scripture}
            for sid in ids:
                self.scripture_counts[sid] = self.scripture_counts.get(sid, 0) + 1
                yield self._emit({"type": "scripture", "id": sid, "title": by_id[sid]["title"],
                                  "count": self.scripture_counts[sid], "round": self.round})
            if ids:
                self._save_scripture()
            yield from self._ghost_gone("dispersed", verdicts[0].observation)

    def _ghost_gone(self, reason: str, observation: str = "") -> Iterator[dict]:
        """reason: "dispersed" (said something it must not), "faded" (its time ran out), "freed" (the loop was closed)."""
        g, self.ghost = self.ghost, None
        p = g["p"]
        g["record"]["ghost"] = {"whispers": g["whispers"], "end": reason}
        self._save_graveyard()
        note = self.P.get(f"ghost_{reason}")
        for q in self.players:
            if note:
                q.agent.insert_context("user", fill(note, name=p.name), speaker="系统")
        yield self._emit({"type": "ghost_gone", "player_id": p.id, "name": p.name, "avatar": p.avatar, "reason": reason,
                          "observation": observation, "round": self.round})

    # ---- coming back from the dead -------------------------------------------
    def _revival_candidate(self) -> dict | None:
        """The dead player with the most 👍 (at least one) who has not come back already. A winner is free and stays
        gone; somebody whose face or name is on the field right now has to wait."""
        taken = {q.avatar for q in self.players} | set(SPECIAL_AVATARS.values())  # a rare face comes back only as itself
        names = {q.name for q in self.players}
        best, most = None, 0
        for r in self.graveyard:  # oldest first, so on a tie the one who died more recently wins
            up = (r.get("votes") or {}).get("up", 0)
            if (up > 0 and up >= most and r.get("kind") != "victory" and not r.get("revived_as")
                    and r.get("avatar") not in taken and r.get("name") not in names):
                best, most = r, up
        return best

    def _restore_personality(self, past: dict) -> dict | None:
        """The same virtue and flaw as before (the grave only keeps the names; the descriptions come from the pool)."""
        pool, old = self.world.personalities, past.get("personality")
        if not (pool and old):
            return None
        found = {k: next((e for e in pool[f"{k}s"] if e["name"] == (old.get(k) or {}).get("name")), None)
                 for k in ("virtue", "flaw")}
        return found if all(found.values()) else None

    def _past_life(self, past: dict) -> tuple[list[str], str]:
        """What a revived player remembers: the lines they said and heard in their last life, rebuilt from transcript.jsonl
        (the newest are kept), and the last thing they did before they died."""
        P, pid, name = self.P, past["id"], past["name"]
        path = self.data_dir / "transcript.jsonl"
        if not path.exists():
            return [], ""
        lines: list[str] = []
        last, alive = "", False
        with path.open(encoding="utf-8") as f:
            for raw in f:
                try:
                    e = json.loads(raw)
                except ValueError:
                    continue
                t = e.get("type")
                if t == "spawn" and (e.get("player") or {}).get("id") == pid:
                    lines, last, alive = [], "", True  # an id can be handed out again after a restart: the last birth counts
                    continue
                if not alive:
                    continue
                if t == "death" and (e.get("record") or {}).get("id") == pid:
                    break
                text = str(e.get("text") or "").strip()
                if t not in ("message", "lastwords", "guess") or not text:
                    continue
                if e.get("player_id") == pid:
                    last = text
                    key = {"lastwords": "past_last_words", "guess": "past_guess"}.get(t) or (
                        "past_whisper_out" if e.get("to") else "past_self")
                    lines.append(fill(P[key], text=text, name=e.get("to") or ""))
                elif e.get("who") == "env":
                    lines.append(fill(P["past_env"], text=text))
                elif t == "message" and e.get("to") in (None, "", name):  # the partner out loud, or whispering to them
                    lines.append(fill(P["past_whisper_in" if e.get("to") else "past_other"], name=e.get("name") or "", text=text))
        lines = lines[-PAST_LINES:]
        while len(lines) > 1 and sum(map(len, lines)) > PAST_CHARS:
            lines.pop(0)
        return lines, last

    def _revival_prompt(self, past: dict) -> str:
        """You came back: who you were, how you died (the very line, if a line killed you), and what you remember."""
        P = self.P
        lines, last = self._past_life(past)
        kind = past.get("kind") or "natural"
        line = past.get("fatal_line", last if kind in ("execution", "wrong_guess") else "")
        key = kind if kind in P["revived_death"] else "natural"
        if kind == "execution" and not line:
            key = "execution_silent"
        death = fill(P["revived_death"][key], line=line)
        if past.get("observation"):
            death += fill(P["revived_scene"], observation=past["observation"])
        return fill(self.prompts.text("player/revived"), name=past["name"], life=past.get("life", 1) + 1,
                    born=past.get("born_round", "?"), died=past.get("died_round", "?"), death=death,
                    memory="\n".join(lines) or P["revived_no_memory"])

    def _choose_name(self, agent: Agent, pid: int, with_intro: bool = False) -> tuple[str, str]:
        """The player names themselves and, when they have a personality, says in one private thought what kind of person they are."""
        names = [r["name"] for r in self.graveyard] + [q.name for q in self.players]
        used = {n.casefold() for n in names} | {n.casefold() for n in RESERVED_NAMES}

        def valid(d) -> bool:
            if not isinstance(d, dict) or not isinstance(d.get("name"), str):
                return False
            n = d["name"].strip()
            return 1 <= len(n) <= NAME_MAX and n.casefold() not in used

        taken = "、".join(sorted(set(names))) or self.P["choose_name_none_taken"]
        try:
            d = agent.get_json_reply(fill(self.P["choose_name"], max=NAME_MAX, taken=taken),
                                     example=self.P["choose_name_example"], validator=valid, max_tokens=256)
            name = d["name"].strip()
        except JSONReplyError:
            name = f"无名氏{pid}"
        return name, (self._intro(agent, self.P["intro"]) if with_intro else "")

    def _intro(self, agent: Agent, instruction: str) -> str:
        """One private thought for the entrance card. A separate call that is NOT written into the player's memory: the
        monologue is full of first-person sentences, and a player that has just "said" a few of them would copy the habit
        into what it says out loud."""
        try:
            d = agent.get_json_reply(
                instruction, example=self.P["intro_example"],
                validator=lambda d: isinstance(d, dict) and isinstance(d.get("intro"), str) and bool(d["intro"].strip()),
                commit=False, max_tokens=256)
            return d["intro"].strip()
        except JSONReplyError:
            return ""

    # ---- one action --------------------------------------------------------
    def _act(self, p: Player) -> Iterator[dict]:
        data = p.agent.get_json_reply(self._turn_instruction(p), example=self.P["turn_example"],
                                      validator=lambda d: _valid_turn(d, self.actions), commit=False,
                                      max_tokens=2048 if "guess" in self.actions else 1024)
        action, content = data["action"], data["content"].strip()
        partner = next((q for q in self.players if q is not p), None)
        to = str(data.get("to") or "").strip()
        # a whisper: only for speech, only with a partner on the field, and only if "to" names them
        whisper = bool(partner) and action == "speak" and bool(to) and (partner.name in to or to in ("同伴", "对方"))
        p.fatal_text = content
        thought = data.get("thought", "").strip()  # private: only the audience sees it, never the env, the other player or a judge
        reply = {"thought": thought, "action": action, "content": content}
        if whisper:
            reply["to"] = partner.name
        p.agent.insert_context("assistant", json.dumps(reply, ensure_ascii=False))
        if thought:
            p.log.append(("thought", thought))
        p.age += 1
        self.action_log.append({"round": self.round, "player": p.name, "action": action})
        base = {"name": p.name, "avatar": p.avatar, "age": p.age, "player_id": p.id, "round": self.round, **p.tags()}
        if thought:
            base["thought"] = thought

        if action == "last_words":
            # Takes the whole action. The environment and the other player never see it. A new one replaces the old.
            revised = p.last_words is not None
            p.last_words = content
            p.log.append(("last_words", content))
            yield self._emit({"type": "lastwords", "text": content, **base, **({"revised": True} if revised else {})})
        elif action == "guess":
            # A declaration to the world's truth: nobody on the field hears it.
            p.log.append(("guess", content))
            yield self._emit({"type": "guess", "text": content, **base})
        elif whisper:  # to the partner only: the environment neither hears it nor answers
            p.log.append(("whisper", fill(self.H["story_whisper"], name=partner.name, content=content)))
            yield self._emit({"type": "message", "who": "player", "text": content, "to": partner.name, **base})
            partner.agent.insert_context("user", fill(self.P["whisper_heard"], content=content), speaker=p.name)
            partner.log.append(("other", fill(self.H["story_heard_whisper"], name=p.name, content=content)))
        else:  # speak / end_life: said out loud, so everyone hears it
            p.last_line = content
            p.log.append(("speak", content))
            yield self._emit({"type": "message", "who": "player", "text": content, **base})
            self.env.insert_context("user", content, speaker=p.name)
            for q in self.players:
                if q is not p:
                    q.agent.insert_context("user", content, speaker=p.name)
                    q.log.append(("other", fill(self.H["story_heard"], name=p.name, content=content)))

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
            yield from self._kill([(p, "suicide", self.H["suicide_reason"], "")])
            return
        if whisper:
            return
        yield from self._env_say()

    def _field_text(self, p: Player) -> str:
        """Who is on the field right now, told to a player at the start of every one of their turns (a one-off notice would
        be lost to context compression, and they would forget they are not alone)."""
        others = [q for q in self.players if q is not p]
        if not others:
            return self.P["field_alone"]
        names = "、".join(f"「{q.name}」" for q in others)
        return fill(self.P["field_partner"], count=len(self.players), names=names)

    def _turn_instruction(self, p: Player) -> str:
        options = "\n".join(f"{i}. {self.P['turn_actions'][a]}" for i, a in enumerate(self.actions, 1))
        options += "\n" + (fill(self.P["turn_last_words_current"], text=p.last_words) if p.last_words
                           else self.P["turn_remind_last_words"])
        return fill(self.prompts.text("player/turn"), round=self.round, field=self._field_text(p), options=options)

    def _env_say(self) -> Iterator[dict]:
        """The environment's answer is public: everyone on the field hears it."""
        text = self.env.get_reply().content.strip()
        for q in self.players:
            q.log.append(("env", text))
            q.agent.insert_context("user", text, speaker=ENV_NAME)
        event = {"type": "message", "who": "env", "name": ENV_NAME, "avatar": None, "text": text, "round": self.round}
        # the lines the environment was just given to read out, so the page can show the wall itself
        # (only the line with its "□", never the word that was rubbed out)
        lines = [line for line, _ in self.echoes]
        shown = lines if self._echo_all else lines[:self._echo_new]
        if shown:
            event["echo"] = {"lines": shown, "new": min(self._echo_new, len(shown))}
        self._echo_new, self._echo_all = 0, False
        yield self._emit(event)

    # ---- referees ----------------------------------------------------------
    def _state_text(self, completed: bool = False) -> str:
        who = "、".join(fill(self.J["state_player"], name=q.name, born=q.born_round, age=q.age)
                       for q in self.players) or self.J["state_no_players"]
        if len(self.players) == 2:
            when = self.J["state_pair_completed"] if completed else self.J["state_pair_ongoing"]
            pair = fill(self.J["state_pair"], rounds=self.cohab_rounds, when=when)
        else:
            pair = self.J["state_single"]
        return fill(self.J["state"], round=self.round, players=who, pair=pair)

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

    def specials_view(self) -> dict[str, dict]:
        """The 特殊角色 page: which rare identities have appeared so far (in the graveyard or on the field), how many
        times, and who was the first. An identity nobody has had yet stays locked on the page."""
        out: dict[str, dict] = {}
        for r in [*self.graveyard, *(p.public() for p in self.players)]:
            special = r.get("special")
            if not special:
                continue
            e = out.setdefault(special, {"count": 0, "first": None})
            e["count"] += 1
            born = r.get("born_round") or 0
            if e["first"] is None or born < e["first"]["round"]:
                e["first"] = {"name": r["name"], "avatar": r["avatar"], "round": born}
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
            state=self._state_text(), player=p.name, action_text=self.J["action_text"][action], content=content,
            names={q.name for q in self.players}))

    def _round_end(self) -> Iterator[dict]:
        """Called after everyone has acted: tracks how long the pair has been together and asks the judge
        whether anything that depends on time has come due."""
        acted = [q for q in self.players if q.born_round <= self.round]
        self.cohab_rounds = self.cohab_rounds + 1 if len(acted) == 2 else 0
        if not self.cohab_rounds:
            self.action_log.clear()  # the pair is broken: start a fresh window
        else:
            self.env.insert_context("user", fill(self.E["cohab"], rounds=self.cohab_rounds), speaker="系统")
        if not (self.judge and self.players):
            return
        named = self.J["action_text"]
        log = "\n".join(fill(self.J["round_log_line"], round=e["round"], player=e["player"], action=named[e["action"]])
                        for e in self.action_log)
        victims = self._victims(self.judge.check_round(state=self._state_text(completed=True), log=log,
                                                       names={q.name for q in self.players}))
        for p, *_ in victims:
            p.fatal_text = ""  # killed by time, not by anything they said
        if victims:
            yield from self._kill(victims)

    def _resolve_guess(self, p: Player, text: str) -> Iterator[dict]:
        result = self.oracle.evaluate(text)
        yield self._emit({"type": "verdict", "correct": result.correct, "line": result.line, "name": p.name,
                          "avatar": p.avatar, "player_id": p.id, "round": self.round})
        if result.correct:
            yield from self._victory(p)
            return
        scene = result.scene or self.J["wrong_guess_scene"]
        points = "、".join(result.missing + result.contradicted) or self.J["wrong_guess_unknown"]
        yield from self._kill([(p, "wrong_guess", fill(self.J["wrong_guess_reason"], points=points), scene)])

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
            record["votes"] = self.votes.close(p.id)
            record.update(p.tags())
            if kind in ("execution", "wrong_guess") and p.fatal_text:
                record["fatal_line"] = p.fatal_text  # told to them if they ever come back
            if observation:
                record["observation"] = observation
            if p.personality:
                record["personality"] = shown(p.personality)
            if rest and rest[0]:
                record["scripture"] = rest[0]  # which entries of the worldview killed this player
            self.graveyard.append(record)
            self._save_graveyard()
            echo = (p.dying_echo or _clip(p.last_line)) if self.world.echo_wall else None
            erased = p.dying_erased if p.dying_echo else ""
            if echo:
                self.echoes.insert(0, (echo, erased))
                del self.echoes[ECHO_MAX:]
                self._echo_new += 1
            note = fill(self.E["death"], name=p.name) + (fill(self.E["death_scene"], observation=observation) if observation
                                                     else fill(self.E["death_cause"], cause=cause))
            if echo:
                note += fill(self.E["death_echo"], echo=echo) + self._erased_memo([(1, erased)] if erased else [])
            self.env.insert_context("user", note, speaker="系统")
            for q in self.players:  # a death is public; the last words are not
                alone = self.P["death_alone"] if len(self.players) == 1 else ""
                scene = fill(self.P["death_scene"], observation=observation) if observation else ""
                q.agent.insert_context("user", fill(self.P["death"], name=p.name) + scene + alone, speaker="系统")
            if p.lover and self._alive(p.lover):  # the one left behind has a single action left
                p.lover.heartbroken = True
                p.lover.agent.insert_context("user", fill(self.P["lover_died"], name=p.name), speaker="系统")
            yield self._emit({"type": "death", "record": record, "round": self.round})
            if p.special == "earthbound" and self.ghost is None:
                yield from self._haunt(p, record)
            if erased:
                for m in [q for q in self.players if q.special == "medium"]:
                    yield from self._medium_vision(m, [(echo, erased)])
        count = self._spawn_count(len(self.players) + 1)
        if count:
            yield from self._spawn_players(count)
        elif self.players:
            yield from self._env_say()  # the survivor sees the scene

    def _victory(self, p: Player) -> Iterator[dict]:
        """The truth was declared: the loop is closed for everyone who is still on the field."""
        freed = [q.name for q in self.players if q is not p]
        self.players = []
        if self.ghost:  # the loop is closed: even the ghost may go
            yield from self._ghost_gone("freed")
        _, biography = self._obituary(p, "victory", "")
        record = {"id": p.id, "name": p.name, "avatar": p.avatar, "rounds": p.age, "cause": self.H["victory_cause"],
                  "biography": biography, "last_words": p.last_words, "kind": "victory",
                  "born_round": p.born_round, "died_round": self.round,
                  "died_at": datetime.now().astimezone().isoformat(timespec="seconds"), "votes": self.votes.close(p.id),
                  **p.tags()}
        if p.personality:
            record["personality"] = shown(p.personality)
        self.graveyard.append(record)
        self._save_graveyard()
        self.won = True
        yield self._emit({"type": "victory", "record": record, "freed": freed, "round": self.round})

    def _obituary(self, p: Player, kind: str, reason: str) -> tuple[str, str]:
        """Ask the LLM for a cause of death and a biography, written at the moment it happens."""
        H = self.H
        who = {k: fill(label, name=p.name, env=ENV_NAME) for k, label in H["story_labels"].items()}
        story = "\n".join(f"{who[k]}{t}" for k, t in p.log)
        victory = kind == "victory"
        example = H["example_victory"] if victory else H["example_death"]
        pers = p.personality
        request = fill(
            self.prompts.text("historian/request"), name=p.name, age=p.age, ending=H["kind_text"][kind], story=story,
            personality=fill(H["personality"], virtue=pers["virtue"]["name"], flaw=pers["flaw"]["name"]) if pers else "",
            special=fill(H["special"][p.special], life=p.life, lover=p.lover.name if p.lover else "") if p.special else "",
            detail=fill(H["detail"], reason=reason) if reason else "",
            last_words=fill(H["last_words_yes"], text=p.last_words) if p.last_words else H["last_words_no"])
        messages = [
            {"role": "system", "content": fill(self.prompts.text("historian/system"),
                                               event=H["event_victory"] if victory else H["event_death"],
                                               example=json.dumps(example, ensure_ascii=False, indent=2))},
            {"role": "user", "content": request},
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
        bio = fill(self.H["fallback_biography"], name=p.name, age=p.age) + (
            fill(self.H["fallback_biography_last_line"], line=speeches[-1]) if speeches else "")
        return (self.H["fallback_cause_natural"] if kind == "natural" else self.H["kind_text"][kind]), bio

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
