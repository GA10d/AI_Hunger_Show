"""A world = a folder of prompts under words/.

    words/<world>/
        world.json                  optional: {"name": "...", "echo_wall": true, "env_knows_truth": true, "personality": false,
                                               "env_temperature": 0, "env_thinking": true, "judge_thinking": true}
        personalities.json          optional: this world's own personality pool (default: script/ai_related/personalities.json)
        readme.md                   notes for the designer (spoilers, never given to a model)
        system prompt/
            tribute.md              the player's persona and public setting
            playground.md           the environment (narrator)
            judge.md                optional: the secret rules. Present -> an LLM judge rules on every action
            oracle.md               optional: the true worldview. Present -> players may declare ("guess") it
        prompts/                    optional: this world's versions of files under the repo's prompts/ (same paths)
"""
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .config import JUDGE_THINKING
from .prompts import Prompts

REPO = Path(__file__).resolve().parents[2]
WORDS_DIR = REPO / "words"
DEFAULT_WORLD_DIR = WORDS_DIR / "example"
MIN_PROMPT_CHARS = 30  # shorter than this = still a placeholder file


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
    # a host who knows the answer (a "soup master") is told what each blank on the echo wall used to be, so it can
    # answer questions about it truthfully; a pure narrator is not
    env_knows_truth: bool = False
    # every player is born with one virtue and one flaw drawn from this pool ({"virtues": [...], "flaws": [...]}); None = off
    personalities: dict | None = None
    # how the environment generates: a storyteller wants variety, a host who answers yes/no questions wants the same
    # true answer every time (low temperature) and room to check the question against the truth first (thinking)
    env_temperature: float = 1.2
    env_thinking: bool = False
    # the rule judge reasons before it rules (default config.JUDGE_THINKING): slower, but misses less
    judge_thinking: bool = True


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


DEFAULT_PERSONALITIES = Path(__file__).resolve().parent / "personalities.json"


def load_personalities(root: Path) -> dict | None:
    """The world's own personalities.json if it has one, else the default pool. A pool needs at least one virtue and one flaw."""
    path = root / "personalities.json"
    path = path if path.exists() else DEFAULT_PERSONALITIES
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"[world] cannot read {path}: {e}; personalities are off", file=sys.stderr)
        return None
    pool = {k: [e for e in data.get(k, []) if isinstance(e, dict) and e.get("name") and e.get("desc")]
            for k in ("virtues", "flaws")}
    return pool if pool["virtues"] and pool["flaws"] else None


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
    fallback = Prompts(root)  # used when a world's own file is still a placeholder
    return World(name=meta.get("name", root.name), player=prompt("tribute.md", fallback.text("fallback/tribute")),
                 env=prompt("playground.md", fallback.text("fallback/playground")),
                 judge=judge if len(judge) >= MIN_PROMPT_CHARS else None,
                 oracle=oracle if len(oracle) >= MIN_PROMPT_CHARS else None,
                 echo_wall=bool(meta.get("echo_wall", False)), root=root, scripture=scripture,
                 env_knows_truth=bool(meta.get("env_knows_truth", False)),
                 personalities=load_personalities(root) if meta.get("personality", True) else None,
                 env_temperature=float(meta.get("env_temperature", 1.2)), env_thinking=bool(meta.get("env_thinking", False)),
                 judge_thinking=bool(meta.get("judge_thinking", JUDGE_THINKING)))
