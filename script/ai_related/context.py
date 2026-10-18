"""Conversation context: messages, token estimate, persistence."""
import copy
import json
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

ROLES = ("system", "user", "assistant")
_CJK = re.compile(r"[　-〿一-鿿＀-￯]")


@dataclass
class Message:
    role: str
    content: str
    speaker: str | None = None  # who said it, for messages from other participants
    reasoning: str | None = None  # kept for logs only, never sent to the API
    pinned: bool = False  # pinned messages are never compressed
    kind: str = "chat"  # "chat" | "summary"
    ts: float = field(default_factory=time.time)

    def api_content(self) -> str:
        if self.speaker and self.role != "assistant":
            return f"【{self.speaker}】{self.content}"
        return self.content

    @classmethod
    def from_dict(cls, d: dict) -> "Message":
        return cls(**d)


def estimate_text_tokens(text: str) -> int:
    cjk = len(_CJK.findall(text))
    return int(cjk * 0.7 + (len(text) - cjk) / 3.5) + 4


class Context:
    """Ordered messages. Invariant: pinned messages always form a prefix."""

    def __init__(self, messages: list[Message] | None = None):
        self.messages: list[Message] = list(messages or [])

    def __len__(self) -> int:
        return len(self.messages)

    def pinned_count(self) -> int:
        n = 0
        for m in self.messages:
            if not m.pinned:
                break
            n += 1
        return n

    def insert(self, role: str, content: str, *, speaker: str | None = None,
               reasoning: str | None = None, pinned: bool = False, kind: str = "chat") -> Message:
        if role not in ROLES:
            raise ValueError(f"role must be one of {ROLES}, got {role!r}")
        msg = Message(role, content, speaker=speaker, reasoning=reasoning, pinned=pinned, kind=kind)
        if pinned:
            self.messages.insert(self.pinned_count(), msg)
        else:
            self.messages.append(msg)
        return msg

    def rollback(self, n: int = 1) -> list[Message]:
        """Remove and return the last n unpinned messages."""
        removed = []
        while n > 0 and len(self.messages) > self.pinned_count():
            removed.append(self.messages.pop())
            n -= 1
        return removed[::-1]

    def fork(self) -> "Context":
        return Context(copy.deepcopy(self.messages))

    def to_api_messages(self, tail: list[Message] | tuple = ()) -> list[dict]:
        """Messages in API format. reasoning is dropped; a system message after the first
        non-system one becomes a user message; consecutive same-role messages are merged."""
        out: list[dict] = []
        seen_non_system = False
        for m in [*self.messages, *tail]:
            role, content = m.role, m.api_content()
            if role == "system":
                if seen_non_system:
                    role = "user"
                    content = content if m.speaker else f"【系统】{content}"
            else:
                seen_non_system = True
            if out and out[-1]["role"] == role:
                out[-1]["content"] += "\n\n" + content
            else:
                out.append({"role": role, "content": content})
        return out

    def estimate_tokens(self, tail: list[Message] | tuple = ()) -> int:
        return sum(estimate_text_tokens(m["content"]) for m in self.to_api_messages(tail))

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = [asdict(m) for m in self.messages]
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "Context":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls([Message.from_dict(d) for d in data])
