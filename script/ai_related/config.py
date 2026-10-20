"""Configuration: API key, models, thresholds and prices."""
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-flash"
PRO_MODEL = "deepseek-v4-pro"
SUMMARY_MODEL = DEFAULT_MODEL

COMPRESS_THRESHOLD_TOKENS = 60_000
KEEP_RECENT = 12

# Player lifespan: normal distribution truncated to [MIN, MAX] rounds (one round = one player action)
LIFESPAN_MIN = 2
LIFESPAN_MAX = 80
LIFESPAN_MEAN = 41
LIFESPAN_SD = 15

# At most two players are on the field. The game starts with one. When a player dies:
SPAWN_IF_TWO = 0.25      # two were on the field: chance that one new player is born
SPAWN_TWO_IF_ONE = 0.10  # one was on the field: chance that two are born (otherwise exactly one)

# Rare births, rolled for every newcomer
REVIVE_CHANCE = 0.02   # the dead player with the most 👍 comes back instead, with the memory of their last life
# otherwise at most one rare identity (see game.py; each has its prompt in prompts/player/<name>.md)
SPECIAL_CHANCES = {
    "catgirl": 0.02,
    "bard": 0.01,        # speaks only in verse
    "earthbound": 0.01,  # stays as a whispering ghost after death
    "gambler": 0.01,     # bets their lifespan at birth
    "medium": 0.01,      # sees the outline of the words rubbed out on the echo wall
    "believer": 0.01,    # worships the environment
    "chronicler": 0.01,  # 史官: reads the last 10 last words; their own last words reach the next 10 born
}
LOVERS_CHANCE = 0.05   # two players born at the same moment are lovers

# USD per 1M tokens at peak hours: (input cache hit, input cache miss, output).
# Off-peak is half of peak.
_PEAK_PRICES = {
    "deepseek-flash": (0.006, 0.3, 1.2),
    "deepseek-v4-pro": (0.044, 1.32, 3.96),
}


def get_api_key() -> str:
    key = os.getenv("DEEPSEEK") or os.getenv("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("DeepSeek API key not found: set DEEPSEEK in script/ai_related/.env")
    return key


def is_peak(now: datetime | None = None) -> bool:
    """Peak: Mon-Fri 01:00-04:00 and 06:00-10:00 UTC (Chinese holidays ignored)."""
    now = now or datetime.now(timezone.utc)
    return now.weekday() < 5 and (1 <= now.hour < 4 or 6 <= now.hour < 10)


def price_for(model: str) -> tuple[float, float, float]:
    """(cache_hit, cache_miss, output) USD per 1M tokens right now. Unknown/legacy names bill as flash."""
    hit, miss, out = _PEAK_PRICES.get(model, _PEAK_PRICES[DEFAULT_MODEL])
    factor = 1.0 if is_peak() else 0.5
    return hit * factor, miss * factor, out * factor
