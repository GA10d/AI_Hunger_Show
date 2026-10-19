"""Context compression: pinned prefix + rolling first-person summary + recent window."""
import json
from dataclasses import dataclass

from .context import Context, Message
from .prompts import DEFAULT, Prompts, fill


@dataclass
class CompressPlan:
    pinned: list[Message]
    prev_summary: Message | None
    old: list[Message]  # to be compressed
    recent: list[Message]  # kept verbatim


def plan_compression(ctx: Context, keep_recent: int) -> CompressPlan | None:
    """Split the context; None when there is nothing old enough to compress."""
    keep_recent = max(keep_recent, 0)
    n_pinned = ctx.pinned_count()
    pinned, rest = ctx.messages[:n_pinned], ctx.messages[n_pinned:]
    prev = None
    if rest and rest[0].kind == "summary":
        prev, rest = rest[0], rest[1:]
    if len(rest) <= keep_recent:
        return None
    split = len(rest) - keep_recent
    return CompressPlan(pinned, prev, rest[:split], rest[split:])


def _transcript(owner: str, msgs: list[Message], S: dict) -> str:
    lines = []
    for m in msgs:
        who = fill(S["line_self"], owner=owner) if m.role == "assistant" else (m.speaker or S["line_narrator"])
        lines.append(fill(S["line"], who=who, content=m.content))
    return "\n".join(lines)


def build_summary_messages(owner: str, plan: CompressPlan, prompts: Prompts = DEFAULT) -> list[dict]:
    S = prompts.strings("memory")
    system = fill(prompts.text("memory/system"), owner=owner, example=json.dumps(S["example"], ensure_ascii=False, indent=2))
    prev = plan.prev_summary.content.removeprefix(S["prefix"]) if plan.prev_summary else S["no_previous"]
    user = fill(prompts.text("memory/request"), previous=prev, transcript=_transcript(owner, plan.old, S))
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _fmt(value) -> str:
    if isinstance(value, dict):
        return "\n".join(f"- {k}：{v}" for k, v in value.items())
    if isinstance(value, list):
        return "\n".join(f"- {v}" for v in value)
    return str(value)


def render_summary(raw: str, prompts: Prompts = DEFAULT) -> str:
    """Turn the model's json into readable text; fall back to the raw text if it is not valid json."""
    raw = raw.strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    if not isinstance(data, dict):
        return raw
    headings = prompts.strings("memory")["headings"]
    parts = [f"## {headings.get(k, k)}\n{_fmt(v)}" for k, v in data.items() if v]
    return "\n\n".join(parts)


def apply_summary(ctx: Context, plan: CompressPlan, summary_text: str, prompts: Prompts = DEFAULT) -> None:
    summary = Message("system", prompts.strings("memory")["prefix"] + summary_text, kind="summary")
    ctx.messages = [*plan.pinned, summary, *plan.recent]


def apply_truncate(ctx: Context, plan: CompressPlan) -> None:
    """Drop the old messages without calling the LLM; an existing summary is kept."""
    keep = [plan.prev_summary] if plan.prev_summary else []
    ctx.messages = [*plan.pinned, *keep, *plan.recent]
