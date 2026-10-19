"""A world = a folder of prompts under words/.

    words/<world>/
        world.json                  optional: {"name": "...", "echo_wall": true}
        readme.md                   notes for the designer (spoilers, never given to a model)
        system prompt/
            tribute.md              the player's persona and public setting
            playground.md           the environment (narrator)
            judge.md                optional: the secret rules. Present -> an LLM judge rules on every action
            oracle.md               optional: the true worldview. Present -> players may declare ("guess") it
"""
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORDS_DIR = REPO / "words"
DEFAULT_WORLD_DIR = WORDS_DIR / "example"
MIN_PROMPT_CHARS = 30  # shorter than this = still a placeholder file

DEFAULT_PLAYER = (
    "你是《AI 饥饿秀》的参赛选手，被投放进一个陌生而危险的世界。"
    "你想尽可能有意义地活下去，也想让后来的人记住你。说话用中文，简短有个性，不要重复自己说过的话。"
)
DEFAULT_ENV = (
    "你是《AI 饥饿秀》的「环境」：一个神秘、冷峻、带点黑色幽默的世界，"
    "负责描述场景、制造事件、回应选手的行动。"
)


@dataclass
class World:
    name: str
    player: str
    env: str
    judge: str | None  # secret rules, for the rule judge
    oracle: str | None  # the true worldview, for the oracle
    echo_wall: bool  # the dead's last spoken line is carved on a wall and shown to newcomers
    root: Path
    # The "圣言" page: every entry of the worldview, for the audience. An entry with a "rule" id (the id the
    # judge uses, e.g. "R1") is counted every time the judge applies it; the others are plain truths.
    scripture: list = field(default_factory=list)


def resolve_world_dir(world: str | Path | None) -> Path:
    """Accepts a path, or just a folder name under words/ (e.g. "corridor")."""
    if not world:
        return DEFAULT_WORLD_DIR
    path = Path(world)
    if path.is_dir():
        return path
    if (WORDS_DIR / path).is_dir():
        return WORDS_DIR / path
    raise FileNotFoundError(f"world folder not found: {world} (looked in the cwd and in {WORDS_DIR})")


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip() if path.exists() else ""


def load_world(world: str | Path | None = None) -> World:
    root = resolve_world_dir(world)
    prompts = root / "system prompt"
    meta_path = root / "world.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}

    def prompt(filename: str, fallback: str) -> str:
        text = _read(prompts / filename)
        if len(text) < MIN_PROMPT_CHARS:
            print(f"[world] {root.name}/{filename} is empty/placeholder, using the built-in prompt", file=sys.stderr)
            return fallback
        return text

    judge, oracle = _read(prompts / "judge.md"), _read(prompts / "oracle.md")
    scripture = [e for e in meta.get("scripture", [])
                 if isinstance(e, dict) and e.get("id") and e.get("title") and e.get("text")]
    return World(name=meta.get("name", root.name), player=prompt("tribute.md", DEFAULT_PLAYER),
                 env=prompt("playground.md", DEFAULT_ENV),
                 judge=judge if len(judge) >= MIN_PROMPT_CHARS else None,
                 oracle=oracle if len(oracle) >= MIN_PROMPT_CHARS else None,
                 echo_wall=bool(meta.get("echo_wall", False)), root=root, scripture=scripture)
