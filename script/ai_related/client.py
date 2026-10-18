"""Thin wrapper over the OpenAI SDK for DeepSeek: thinking / JSON params, streaming, usage tracking."""
from dataclasses import dataclass, field
from typing import Callable

from openai import AsyncOpenAI, OpenAI

from .config import BASE_URL, DEFAULT_MODEL, get_api_key, price_for

TokenCallback = Callable[[str], None]


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cache_hit_tokens: int = 0
    cache_miss_tokens: int = 0
    reasoning_tokens: int = 0

    def __add__(self, other: "Usage") -> "Usage":
        return Usage(*(a + b for a, b in zip(self._t(), other._t())))

    def _t(self) -> tuple:
        return (self.prompt_tokens, self.completion_tokens, self.cache_hit_tokens,
                self.cache_miss_tokens, self.reasoning_tokens)

    @classmethod
    def from_api(cls, u) -> "Usage":
        if u is None:
            return cls()
        extra = getattr(u, "model_extra", None) or {}
        hit = getattr(u, "prompt_cache_hit_tokens", None) or extra.get("prompt_cache_hit_tokens") or 0
        miss = getattr(u, "prompt_cache_miss_tokens", None) or extra.get("prompt_cache_miss_tokens") or 0
        details = getattr(u, "completion_tokens_details", None)
        reasoning = getattr(details, "reasoning_tokens", 0) or 0
        prompt = u.prompt_tokens or 0
        return cls(prompt, u.completion_tokens or 0, hit, miss or max(prompt - hit, 0), reasoning)

    def cost(self, model: str) -> float:
        hit, miss, out = price_for(model)
        return (self.cache_hit_tokens * hit + self.cache_miss_tokens * miss + self.completion_tokens * out) / 1e6


@dataclass
class Reply:
    content: str
    reasoning: str | None = None
    usage: Usage = field(default_factory=Usage)
    finish_reason: str | None = None
    model: str = ""

    def __str__(self) -> str:
        return self.content


class UsageTracker:
    def __init__(self):
        self.total = Usage()
        self.cost_usd = 0.0
        self.calls = 0

    def add(self, usage: Usage, model: str) -> None:
        self.total = self.total + usage
        self.cost_usd += usage.cost(model)
        self.calls += 1

    @property
    def cache_hit_rate(self) -> float:
        t = self.total.cache_hit_tokens + self.total.cache_miss_tokens
        return self.total.cache_hit_tokens / t if t else 0.0

    def summary(self) -> str:
        t = self.total
        return (f"{self.calls} calls | in {t.prompt_tokens} (cache hit {self.cache_hit_rate:.0%}) "
                f"| out {t.completion_tokens} (reasoning {t.reasoning_tokens}) | ~${self.cost_usd:.4f}")


class _StreamAcc:
    """Accumulates streamed chunks into a Reply."""

    def __init__(self):
        self.content: list[str] = []
        self.reasoning: list[str] = []
        self.usage = None
        self.finish_reason = None

    def feed(self, chunk) -> tuple[str, str]:
        if getattr(chunk, "usage", None):
            self.usage = chunk.usage
        if not chunk.choices:
            return "", ""
        choice = chunk.choices[0]
        if choice.finish_reason:
            self.finish_reason = choice.finish_reason
        delta = choice.delta
        r = getattr(delta, "reasoning_content", None) or ""
        c = delta.content or ""
        if r:
            self.reasoning.append(r)
        if c:
            self.content.append(c)
        return c, r

    def reply(self, model: str) -> Reply:
        return Reply("".join(self.content), "".join(self.reasoning) or None,
                     Usage.from_api(self.usage), self.finish_reason, model)


def _reply_from_response(resp, model: str) -> Reply:
    choice = resp.choices[0]
    return Reply(choice.message.content or "", getattr(choice.message, "reasoning_content", None) or None,
                 Usage.from_api(resp.usage), choice.finish_reason, model)


class DeepSeekClient:
    def __init__(self, api_key: str | None = None, base_url: str = BASE_URL,
                 timeout: float = 120.0, max_retries: int = 3):
        key = api_key or get_api_key()
        self._sync = OpenAI(api_key=key, base_url=base_url, timeout=timeout, max_retries=max_retries)
        self._async = AsyncOpenAI(api_key=key, base_url=base_url, timeout=timeout, max_retries=max_retries)
        self.usage = UsageTracker()

    @staticmethod
    def _kwargs(messages, model, thinking, reasoning_effort, json_mode, max_tokens, temperature, stream) -> dict:
        # Thinking is on by default server-side, so always send the choice explicitly.
        extra: dict = {"thinking": {"type": "enabled" if thinking else "disabled"}}
        kw: dict = {"model": model, "messages": messages, "extra_body": extra}
        if thinking:
            if reasoning_effort:
                extra["reasoning_effort"] = reasoning_effort
        elif temperature is not None:  # ignored by the API in thinking mode
            kw["temperature"] = temperature
        if json_mode:
            kw["response_format"] = {"type": "json_object"}
        if max_tokens:
            kw["max_tokens"] = max_tokens
        if stream:
            kw["stream"] = True
            kw["stream_options"] = {"include_usage": True}
        return kw

    def chat(self, messages: list[dict], *, model: str = DEFAULT_MODEL, thinking: bool = False,
             reasoning_effort: str | None = "high", json_mode: bool = False, max_tokens: int | None = None,
             temperature: float | None = None, on_token: TokenCallback | None = None,
             on_reasoning: TokenCallback | None = None) -> Reply:
        stream = on_token is not None or on_reasoning is not None
        kw = self._kwargs(messages, model, thinking, reasoning_effort, json_mode, max_tokens, temperature, stream)
        if stream:
            acc = _StreamAcc()
            for chunk in self._sync.chat.completions.create(**kw):
                c, r = acc.feed(chunk)
                if r and on_reasoning:
                    on_reasoning(r)
                if c and on_token:
                    on_token(c)
            reply = acc.reply(model)
        else:
            reply = _reply_from_response(self._sync.chat.completions.create(**kw), model)
        self.usage.add(reply.usage, model)
        return reply

    async def achat(self, messages: list[dict], *, model: str = DEFAULT_MODEL, thinking: bool = False,
                    reasoning_effort: str | None = "high", json_mode: bool = False, max_tokens: int | None = None,
                    temperature: float | None = None, on_token: TokenCallback | None = None,
                    on_reasoning: TokenCallback | None = None) -> Reply:
        stream = on_token is not None or on_reasoning is not None
        kw = self._kwargs(messages, model, thinking, reasoning_effort, json_mode, max_tokens, temperature, stream)
        if stream:
            acc = _StreamAcc()
            async for chunk in await self._async.chat.completions.create(**kw):
                c, r = acc.feed(chunk)
                if r and on_reasoning:
                    on_reasoning(r)
                if c and on_token:
                    on_token(c)
            reply = acc.reply(model)
        else:
            reply = _reply_from_response(await self._async.chat.completions.create(**kw), model)
        self.usage.add(reply.usage, model)
        return reply
