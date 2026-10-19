"""Agent: one participant with its own context. Exposes insert_context / compress_context /
get_reply / get_json_reply (plus async variants prefixed with "a")."""
import json
import re
import warnings

from .client import DeepSeekClient, Reply, TokenCallback
from .compress import (CompressPlan, apply_summary, apply_truncate, build_summary_messages,
                       plan_compression, render_summary)
from .config import COMPRESS_THRESHOLD_TOKENS, DEFAULT_MODEL, KEEP_RECENT, SUMMARY_MODEL
from .context import Context, Message
from .prompts import DEFAULT, Prompts, fill
_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.I)


class EmptyReplyError(RuntimeError):
    pass


class JSONReplyError(RuntimeError):
    pass


def _json_instruction(instruction: str, example, S: dict) -> str:
    text = f"{instruction}\n\n{S['json_only']}"
    if example is not None:
        shown = example if isinstance(example, str) else json.dumps(example, ensure_ascii=False, indent=2)
        text += "\n" + fill(S["json_example"], example=shown)
    return text


def _parse_json(content: str, validator):
    text = _FENCE.sub("", content.strip())
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        if not e.msg.startswith("Extra data"):
            raise
        data, _ = json.JSONDecoder().raw_decode(text)  # two objects or trailing prose: keep the first object
    if validator is not None:
        ok = validator(data)
        if ok is False:
            raise ValueError("validator rejected the reply")
    return data


class Agent:
    def __init__(self, name: str, system_prompt: str | None = None, *, model: str = DEFAULT_MODEL,
                 thinking: bool = False, reasoning_effort: str = "high", temperature: float | None = 1.3,
                 max_tokens: int | None = None, client: DeepSeekClient | None = None,
                 context: Context | None = None, auto_compress: bool = True,
                 compress_threshold: int = COMPRESS_THRESHOLD_TOKENS, keep_recent: int = KEEP_RECENT,
                 summary_model: str = SUMMARY_MODEL, empty_retries: int = 2, prompts: Prompts = DEFAULT):
        self.name = name
        self.prompts = prompts  # the engine prompts it uses itself: the json instruction, the nudge, context compression
        self.model = model
        self.thinking = thinking
        self.reasoning_effort = reasoning_effort
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.client = client or DeepSeekClient()
        self.context = context or Context()
        self.auto_compress = auto_compress
        self.compress_threshold = compress_threshold
        self.keep_recent = keep_recent
        self.summary_model = summary_model
        self.empty_retries = empty_retries
        if system_prompt:
            self.insert_context("system", system_prompt, pinned=True)

    # ---- 1. insert_context -------------------------------------------------
    def insert_context(self, role: str, content: str, speaker: str | None = None,
                       pinned: bool = False, kind: str = "chat") -> Message:
        """Add a message. role: system/user/assistant. Another participant's speech is
        role="user" with speaker=<their name>. pinned messages are never compressed."""
        return self.context.insert(role, content, speaker=speaker, pinned=pinned, kind=kind)

    # ---- 2. compress_context -----------------------------------------------
    def compress_context(self, strategy: str = "summarize", keep_recent: int | None = None) -> bool:
        """Compress old messages. "summarize": rolling first-person summary by the LLM;
        "truncate": drop old messages. Returns False if nothing was old enough."""
        plan = self._plan(strategy, keep_recent)
        if plan is None:
            return False
        if strategy == "truncate":
            apply_truncate(self.context, plan)
            return True
        reply = self.client.chat(build_summary_messages(self.name, plan, self.prompts), model=self.summary_model,
                                 json_mode=True, max_tokens=4096)
        self._finish_summary(plan, reply)
        return True

    async def acompress_context(self, strategy: str = "summarize", keep_recent: int | None = None) -> bool:
        plan = self._plan(strategy, keep_recent)
        if plan is None:
            return False
        if strategy == "truncate":
            apply_truncate(self.context, plan)
            return True
        reply = await self.client.achat(build_summary_messages(self.name, plan, self.prompts), model=self.summary_model,
                                        json_mode=True, max_tokens=4096)
        self._finish_summary(plan, reply)
        return True

    def _plan(self, strategy: str, keep_recent: int | None) -> CompressPlan | None:
        if strategy not in ("summarize", "truncate"):
            raise ValueError(f"unknown strategy {strategy!r}")
        return plan_compression(self.context, self.keep_recent if keep_recent is None else keep_recent)

    def _finish_summary(self, plan: CompressPlan, reply: Reply) -> None:
        text = render_summary(reply.content, self.prompts)
        if not text:
            warnings.warn(f"[{self.name}] empty summary from LLM, falling back to truncate")
            apply_truncate(self.context, plan)
        else:
            apply_summary(self.context, plan, text, self.prompts)

    def _needs_compress(self) -> bool:
        return self.auto_compress and self.context.estimate_tokens() > self.compress_threshold

    # ---- 3. get_reply ------------------------------------------------------
    def get_reply(self, extra: str | None = None, *, ephemeral: bool = False, commit: bool = True,
                  on_token: TokenCallback | None = None, on_reasoning: TokenCallback | None = None,
                  max_tokens: int | None = None, thinking: bool | None = None) -> Reply:
        """Get the model's reply to the current context.
        extra: an extra user instruction for this call; ephemeral=True means it is sent but not stored.
        commit: store the reply in the context as an assistant message.
        on_token / on_reasoning: giving either one turns on streaming."""
        if self._needs_compress():
            self.compress_context()
        messages = self._messages(self._take_extra(extra, ephemeral))
        for _ in range(self.empty_retries + 1):
            reply = self.client.chat(messages, **self._chat_kwargs(thinking, max_tokens, on_token, on_reasoning))
            if reply.content.strip() or reply.finish_reason == "length":
                break
        return self._commit(reply, commit)

    async def aget_reply(self, extra: str | None = None, *, ephemeral: bool = False, commit: bool = True,
                         on_token: TokenCallback | None = None, on_reasoning: TokenCallback | None = None,
                         max_tokens: int | None = None, thinking: bool | None = None) -> Reply:
        if self._needs_compress():
            await self.acompress_context()
        messages = self._messages(self._take_extra(extra, ephemeral))
        for _ in range(self.empty_retries + 1):
            reply = await self.client.achat(messages, **self._chat_kwargs(thinking, max_tokens, on_token, on_reasoning))
            if reply.content.strip() or reply.finish_reason == "length":
                break
        return self._commit(reply, commit)

    # ---- 4. get_json_reply -------------------------------------------------
    def get_json_reply(self, instruction: str, example=None, validator=None, *, commit: bool = True,
                       retries: int = 2, max_tokens: int = 4096, thinking: bool = False):
        """Structured reply via JSON mode. Returns the parsed json (usually a dict).
        example: dict or str showing the wanted shape. validator(data) -> bool (or raise) to reject bad shapes.
        commit: store the instruction (user) and the raw json (assistant) in the context.
        Thinking is off by default: DeepSeek does not document JSON mode together with thinking."""
        if self._needs_compress():
            self.compress_context()
        messages = self._messages([Message("user", _json_instruction(instruction, example, self.prompts.strings("agent")))])
        error: Exception | None = None
        for _ in range(retries + 1):
            reply = self.client.chat(messages, **self._chat_kwargs(thinking, max_tokens, None, None, json_mode=True))
            try:
                data = self._parse(reply, validator)
            except (ValueError, EmptyReplyError) as e:
                error = e
                if reply.finish_reason == "length":
                    max_tokens *= 2
                continue
            self._commit_json(instruction, reply, commit)
            return data
        raise JSONReplyError(f"no valid json after {retries + 1} attempts: {error}")

    async def aget_json_reply(self, instruction: str, example=None, validator=None, *, commit: bool = True,
                              retries: int = 2, max_tokens: int = 4096, thinking: bool = False):
        if self._needs_compress():
            await self.acompress_context()
        messages = self._messages([Message("user", _json_instruction(instruction, example, self.prompts.strings("agent")))])
        error: Exception | None = None
        for _ in range(retries + 1):
            reply = await self.client.achat(messages, **self._chat_kwargs(thinking, max_tokens, None, None, json_mode=True))
            try:
                data = self._parse(reply, validator)
            except (ValueError, EmptyReplyError) as e:
                error = e
                if reply.finish_reason == "length":
                    max_tokens *= 2
                continue
            self._commit_json(instruction, reply, commit)
            return data
        raise JSONReplyError(f"no valid json after {retries + 1} attempts: {error}")

    # ---- helpers -----------------------------------------------------------
    def _take_extra(self, extra: str | None, ephemeral: bool) -> list[Message]:
        if not extra:
            return []
        if ephemeral:
            return [Message("user", extra)]
        self.insert_context("user", extra)
        return []

    def _messages(self, tail: list[Message]) -> list[dict]:
        msgs = self.context.to_api_messages(tail)
        if not msgs or msgs[-1]["role"] != "user":  # the API wants the last message to be from the user
            msgs.append({"role": "user", "content": self.prompts.strings("agent")["nudge"]})
        return msgs

    def _chat_kwargs(self, thinking, max_tokens, on_token, on_reasoning, json_mode: bool = False) -> dict:
        return dict(model=self.model, thinking=self.thinking if thinking is None else thinking,
                    reasoning_effort=self.reasoning_effort, json_mode=json_mode,
                    max_tokens=max_tokens or self.max_tokens, temperature=self.temperature,
                    on_token=on_token, on_reasoning=on_reasoning)

    def _commit(self, reply: Reply, commit: bool) -> Reply:
        if not reply.content.strip():
            hint = " (cut off by max_tokens; with thinking on, reasoning counts too)" \
                if reply.finish_reason == "length" else ""
            raise EmptyReplyError(f"[{self.name}] empty reply, finish_reason={reply.finish_reason}{hint}")
        if commit:
            self.context.insert("assistant", reply.content, reasoning=reply.reasoning)
        return reply

    @staticmethod
    def _parse(reply: Reply, validator):
        if not reply.content.strip():
            raise EmptyReplyError("empty content")
        return _parse_json(reply.content, validator)

    def _commit_json(self, instruction: str, reply: Reply, commit: bool) -> None:
        if commit:
            self.context.insert("user", instruction)
            self.context.insert("assistant", reply.content.strip(), reasoning=reply.reasoning)
