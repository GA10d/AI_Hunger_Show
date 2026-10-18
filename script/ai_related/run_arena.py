"""Demo: two contestants talk to each other (optionally with an environment narrator).

Run from the script/ directory:
    python -m ai_related.run_arena --turns 8
"""
import argparse
import sys
from pathlib import Path

from .agent import Agent
from .arena import Arena
from .client import DeepSeekClient

REPO = Path(__file__).resolve().parents[2]
WORDS = REPO / "words" / "example" / "system prompt"
MIN_PROMPT_CHARS = 30  # shorter than this = still a placeholder file

DEFAULT_CONTESTANT = (
    "你是参赛选手「{name}」，正在一档名为《AI 饥饿秀》的节目里和另一位选手对话。"
    "你有自己的性格和目标，想在对话中占上风、让对方露出破绽。"
    "每次只说 1-3 句话，用中文，直接说台词，不要加自己的名字前缀，不要重复自己说过的话。"
)
DEFAULT_ENV = (
    "你是《AI 饥饿秀》的环境旁白。你描述场上发生的变化和突发事件，语言简短，不替选手说话，"
    "每次不超过 3 句话。"
)


def load_prompt(path: Path, fallback: str) -> str:
    text = path.read_text(encoding="utf-8").strip() if path.exists() else ""
    if len(text) < MIN_PROMPT_CHARS:
        print(f"[demo] {path.name} is empty/placeholder, using the built-in prompt", file=sys.stderr)
        return fallback
    return text


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("--turns", type=int, default=8)
    p.add_argument("--model", default="deepseek-flash")
    p.add_argument("--thinking", action="store_true", help="enable thinking and show it in gray")
    p.add_argument("--narrator-every", type=int, default=0, help="narrator speaks every N turns (0 = off)")
    p.add_argument("--budget", type=float, default=0.5, help="stop when estimated cost exceeds this (USD)")
    p.add_argument("--out", default="logs/demo", help="transcript directory")
    p.add_argument("--opening", default="两位选手面对面坐下，节目开始了。")
    args = p.parse_args()

    client = DeepSeekClient()
    contestant = load_prompt(WORDS / "tribute.md", DEFAULT_CONTESTANT)
    env = load_prompt(WORDS / "playground.md", DEFAULT_ENV)

    def make(name: str, prompt: str) -> Agent:
        return Agent(name, prompt.replace("{name}", name) + f"\n\n你的名字是「{name}」。",
                     model=args.model, thinking=args.thinking, client=client)

    a, b = make("选手A", contestant), make("选手B", contestant)
    narrator = make("环境", env) if args.narrator_every else None

    state = {"speaker": None}

    def header(name: str) -> None:
        if state["speaker"] != name:
            print(f"\n【{name}】", end="", flush=True)
            state["speaker"] = name

    def on_token(name: str, tok: str) -> None:
        header(name)
        print(tok, end="", flush=True)

    def on_reasoning(name: str, tok: str) -> None:
        header(name)
        print(f"\033[90m{tok}\033[0m", end="", flush=True)

    arena = Arena([a, b], narrator=narrator, opening=args.opening, max_turns=args.turns,
                  narrator_every=args.narrator_every, budget_usd=args.budget, transcript_dir=args.out,
                  on_token=on_token, on_reasoning=on_reasoning if args.thinking else None)
    for event in arena.run():
        if event.kind in ("inject", "nudge", "error"):
            print(f"\n--- [{event.speaker}] {event.content} ---", flush=True)
            state["speaker"] = None
        else:
            state["speaker"] = None
    print(f"\n\nstopped: {arena.stop_reason} | turns: {arena.turn}")
    print(client.usage.summary())
    print(f"transcript: {Path(args.out).resolve()}")


if __name__ == "__main__":
    main()
