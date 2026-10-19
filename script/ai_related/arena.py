"""Arena: orchestrates several agents talking to each other."""
import difflib
import json
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Iterator

from .agent import Agent, EmptyReplyError
from .client import Usage
from .prompts import strings

S = strings("arena")
NARRATE_PROMPT = S["narrate"]
NUDGE_PROMPT = S["nudge"]
CANNED_NUDGE = S["canned_nudge"]
DIRECTOR = S["director"]  # who the canned nudge comes from when there is no narrator
MAX_CONSECUTIVE_ERRORS = 3


@dataclass
class Event:
    turn: int
    speaker: str
    content: str
    kind: str = "speech"  # speech | narration | inject | nudge | error
    reasoning: str | None = None
    usage: Usage | None = None
    ts: float = field(default_factory=time.time)


def _safe_name(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name)


def _strip_self_label(name: str, text: str) -> str:
    """Models tend to imitate the 【name】 prefix they see on other people's lines."""
    return re.sub(rf"^\s*(?:【{re.escape(name)}】|{re.escape(name)}\s*[:：])\s*", "", text).strip()


class Arena:
    def __init__(self, agents: list[Agent], *, narrator: Agent | None = None, opening: str | None = None,
                 max_turns: int = 30, stop_words: tuple[str, ...] | list[str] = (),
                 budget_usd: float | None = None, narrator_every: int = 0,
                 similarity_threshold: float = 0.85,
                 next_speaker: Callable[["Arena"], Agent] | None = None,
                 transcript_dir: str | Path | None = None,
                 on_token: Callable[[str, str], None] | None = None,
                 on_reasoning: Callable[[str, str], None] | None = None):
        if len(agents) < 2:
            raise ValueError("an arena needs at least 2 agents")
        self.agents = list(agents)
        self.narrator = narrator
        names = [a.name for a in self.participants]
        if len(set(names)) != len(names):
            raise ValueError(f"agent names must be unique: {names}")
        self.opening = opening
        self.max_turns = max_turns
        self.stop_words = tuple(stop_words)
        self.budget_usd = budget_usd
        self.narrator_every = narrator_every
        self.similarity_threshold = similarity_threshold
        self.next_speaker = next_speaker
        self.on_token = on_token
        self.on_reasoning = on_reasoning
        self.transcript_dir = Path(transcript_dir) if transcript_dir else None
        if self.transcript_dir:
            self.transcript_dir.mkdir(parents=True, exist_ok=True)
        self.events: list[Event] = []
        self.turn = 0  # number of agent speeches so far
        self.stop_reason: str | None = None
        self._cursor = 0
        self._last: dict[str, str] = {}

    @property
    def participants(self) -> list[Agent]:
        return self.agents + ([self.narrator] if self.narrator else [])

    def total_cost(self) -> float:
        clients = {id(a.client): a.client for a in self.participants}
        return sum(c.usage.cost_usd for c in clients.values())

    # ---- public API --------------------------------------------------------
    def inject(self, content: str, speaker: str = "系统", kind: str = "inject") -> Event:
        """Say something to everyone (e.g. the environment or a human). Returns the recorded event."""
        self._deliver(speaker, content)
        event = self._record(Event(self.turn, speaker, content, kind))
        self.save_state()
        return event

    def run(self) -> Iterator[Event]:
        """Run until max_turns / stop word / budget. Yields every event as it happens."""
        if self.opening and not self.events and self.turn == 0:
            yield self.inject(self.opening, speaker=self.narrator.name if self.narrator else "系统")
        errors = 0
        while self.turn < self.max_turns and not self.stop_reason:
            try:
                events = self._step()
            except EmptyReplyError as e:
                errors += 1
                yield self._record(Event(self.turn, "系统", str(e), "error"))
                if errors >= MAX_CONSECUTIVE_ERRORS:
                    self.stop_reason = "too many empty replies"
                continue
            errors = 0
            yield from events
            self.save_state()
        if not self.stop_reason:
            self.stop_reason = "max_turns"
        self.save_state()

    @classmethod
    def resume(cls, agents: list[Agent], transcript_dir: str | Path, **kwargs) -> "Arena":
        """Rebuild an arena from files written by a previous run (contexts + state)."""
        from .context import Context
        arena = cls(agents, transcript_dir=transcript_dir, **kwargs)
        root = Path(transcript_dir)
        for a in arena.participants:
            path = root / "contexts" / f"{_safe_name(a.name)}.json"
            if path.exists():
                a.context = Context.load(path)
        state_path = root / "arena_state.json"
        if state_path.exists():
            state = json.loads(state_path.read_text(encoding="utf-8"))
            arena.turn = state.get("turn", 0)
            arena._cursor = state.get("cursor", 0)
            arena._last = state.get("last", {})
        return arena

    def save_state(self) -> None:
        if not self.transcript_dir:
            return
        for a in self.participants:
            a.context.save(self.transcript_dir / "contexts" / f"{_safe_name(a.name)}.json")
        state = {"turn": self.turn, "cursor": self._cursor, "last": self._last, "stop_reason": self.stop_reason}
        (self.transcript_dir / "arena_state.json").write_text(
            json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")

    # ---- internals ---------------------------------------------------------
    def _pick(self) -> Agent:
        if self.next_speaker:
            return self.next_speaker(self)
        agent = self.agents[self._cursor % len(self.agents)]
        self._cursor += 1
        return agent

    def _deliver(self, speaker: str, content: str, skip_self: bool = False) -> None:
        """Put a line into everyone's context. The speaker's own copy is an assistant message."""
        for a in self.participants:
            if a.name == speaker:
                if not skip_self:
                    a.insert_context("assistant", content)
            else:
                a.insert_context("user", content, speaker=speaker)

    def _callbacks(self, agent: Agent) -> dict:
        kw = {}
        if self.on_token:
            kw["on_token"] = lambda t: self.on_token(agent.name, t)
        if self.on_reasoning:
            kw["on_reasoning"] = lambda t: self.on_reasoning(agent.name, t)
        return kw

    def _say(self, agent: Agent, kind: str, extra: str | None = None) -> Event:
        reply = agent.get_reply(extra, ephemeral=True, **self._callbacks(agent))
        text = _strip_self_label(agent.name, reply.content)
        if text != reply.content and agent.context.messages:
            agent.context.messages[-1].content = text  # keep own context consistent with what others see
        self._deliver(agent.name, text, skip_self=True)
        return self._record(Event(self.turn, agent.name, text, kind, reply.reasoning, reply.usage))

    def _step(self) -> list[Event]:
        agent = self._pick()
        event = self._say(agent, "speech")
        self.turn += 1
        events = [event]

        if any(w in event.content for w in self.stop_words):
            self.stop_reason = "stop word"
            return events
        if self.budget_usd is not None and self.total_cost() >= self.budget_usd:
            self.stop_reason = "budget"
            return events

        prev = self._last.get(agent.name)
        self._last[agent.name] = event.content
        if prev and difflib.SequenceMatcher(None, prev, event.content).ratio() >= self.similarity_threshold:
            self._last[agent.name] = ""
            events.append(self._nudge())
        elif self.narrator and self.narrator_every and self.turn % self.narrator_every == 0:
            events.append(self._say(self.narrator, "narration", NARRATE_PROMPT))
        return events

    def _nudge(self) -> Event:
        if self.narrator:
            return self._say(self.narrator, "nudge", NUDGE_PROMPT)
        self._deliver(DIRECTOR, CANNED_NUDGE)
        return self._record(Event(self.turn, DIRECTOR, CANNED_NUDGE, "nudge"))

    def _record(self, event: Event) -> Event:
        self.events.append(event)
        if self.transcript_dir:
            row = asdict(event)
            with (self.transcript_dir / "transcript.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        return event
