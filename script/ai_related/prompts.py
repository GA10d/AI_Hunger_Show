"""Engine prompts: every text the engine itself sends to a model lives under prompts/ at the repo root
(the world's own prompts live under words/<world>/). See prompts/README.md.

    pr = Prompts(world_root)    -> the engine prompts as that world sees them
    pr.text("player/rules")     -> words/<world>/prompts/player/rules.md if the world has one, else prompts/player/rules.md
    pr.strings("player")        -> prompts/player/strings.json, with words/<world>/prompts/player/strings.json merged over it
    text(...), strings(...)     -> the same without a world (DEFAULT = Prompts())
    fill(template, round=3)     -> the template with every {round} replaced

Files are read once per process: restart the server after editing them.
"""
import json
import re
from functools import cache
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"
_SLOT = re.compile(r"\{([a-z_]+)\}")


@cache
def _read(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"prompt file missing: {path}")
    return path.read_text(encoding="utf-8-sig")  # -sig: files saved by Notepad start with a BOM


def _merge(base: dict, over: dict) -> dict:
    """over's keys win; a dict inside both is merged the same way, so a world can replace one entry of kind_text alone."""
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


class Prompts:
    """prompts/, with a world's own words/<world>/prompts/ laid over it (same paths)."""

    def __init__(self, world_root: str | Path | None = None):
        self.override_dir = Path(world_root) / "prompts" if world_root else None
        self._strings: dict[str, dict] = {}

    def _override(self, rel: str) -> Path | None:
        path = self.override_dir / rel if self.override_dir else None
        return path if path and path.exists() else None

    def text(self, name: str) -> str:
        rel = f"{name}.md"
        return _read(self._override(rel) or PROMPTS_DIR / rel).strip()

    def strings(self, group: str) -> dict:
        if group not in self._strings:
            rel = f"{group}/strings.json"
            data = json.loads(_read(PROMPTS_DIR / rel))
            if over := self._override(rel):
                data = _merge(data, json.loads(_read(over)))
            self._strings[group] = data
        return self._strings[group]


DEFAULT = Prompts()


def text(name: str) -> str:
    return DEFAULT.text(name)


def strings(group: str) -> dict:
    return DEFAULT.strings(group)


def fill(template: str, **values) -> str:
    """Put each value into the {slot} named after it, in one pass (so a value that itself contains "{x}" is left
    alone). Braces that are not a known slot, like the ones in a json example, stay as they are."""
    return _SLOT.sub(lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), template)
