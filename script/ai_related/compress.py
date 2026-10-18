"""Context compression: pinned prefix + rolling first-person summary + recent window."""
import json
from dataclasses import dataclass

from .context import Context, Message

_SUMMARY_EXAMPLE = {
    "events": ["发生过的关键事件，按时间顺序"],
    "relationships": {"对方名字": "我现在怎么看他/她，关系如何"},
    "promises": ["我做过或收到的承诺、约定、赌注"],
    "open_threads": ["还没聊完的话题、悬而未决的冲突"],
    "self_state": "我当前的情绪、立场和目标",
}
_HEADINGS = {
    "events": "经过",
    "relationships": "我对其他人的看法",
    "promises": "承诺与约定",
    "open_threads": "未了结的话题",
    "self_state": "我当前的状态与目标",
}
SUMMARY_PREFIX = "【我的记忆摘要：此前的对话已被压缩，以下是我记得的内容】\n"


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


def _transcript(owner: str, msgs: list[Message]) -> str:
    lines = []
    for m in msgs:
        who = f"{owner}（我）" if m.role == "assistant" else (m.speaker or "旁白")
        lines.append(f"{who}：{m.content}")
    return "\n".join(lines)


def build_summary_messages(owner: str, plan: CompressPlan) -> list[dict]:
    system = (
        f"你是「{owner}」的记忆整理器。请以 {owner} 的第一人称（“我”）视角，把旧摘要和新增的旧对话"
        "合并压缩成一份新的记忆摘要：保留之后对话还用得上的事实、立场、承诺、情绪和细节，"
        "丢掉寒暄和重复。只输出一个 json 对象，不要输出其他文字。json 格式示例：\n"
        + json.dumps(_SUMMARY_EXAMPLE, ensure_ascii=False, indent=2)
    )
    prev = plan.prev_summary.content.removeprefix(SUMMARY_PREFIX) if plan.prev_summary else "（无）"
    user = f"已有的旧摘要：\n{prev}\n\n需要并入摘要的对话：\n{_transcript(owner, plan.old)}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _fmt(value) -> str:
    if isinstance(value, dict):
        return "\n".join(f"- {k}：{v}" for k, v in value.items())
    if isinstance(value, list):
        return "\n".join(f"- {v}" for v in value)
    return str(value)


def render_summary(raw: str) -> str:
    """Turn the model's json into readable text; fall back to the raw text if it is not valid json."""
    raw = raw.strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    if not isinstance(data, dict):
        return raw
    parts = [f"## {_HEADINGS.get(k, k)}\n{_fmt(v)}" for k, v in data.items() if v]
    return "\n\n".join(parts)


def apply_summary(ctx: Context, plan: CompressPlan, summary_text: str) -> None:
    summary = Message("system", SUMMARY_PREFIX + summary_text, kind="summary")
    ctx.messages = [*plan.pinned, summary, *plan.recent]


def apply_truncate(ctx: Context, plan: CompressPlan) -> None:
    """Drop the old messages without calling the LLM; an existing summary is kept."""
    keep = [plan.prev_summary] if plan.prev_summary else []
    ctx.messages = [*plan.pinned, *keep, *plan.recent]
