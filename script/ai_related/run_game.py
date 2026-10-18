"""Run the game in the terminal (no web page).

    python -m ai_related.run_game --max-players 2 --mean 4 --sd 1
"""
import argparse
import sys

from .client import DeepSeekClient
from .config import LIFESPAN_MEAN, LIFESPAN_SD
from .game import Game


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("--data-dir", default="logs/game")
    p.add_argument("--max-players", type=int, default=2)
    p.add_argument("--max-rounds", type=int)
    p.add_argument("--budget", type=float, default=0.5, help="stop when estimated cost exceeds this (USD)")
    p.add_argument("--seed", type=int)
    p.add_argument("--mean", type=float, default=LIFESPAN_MEAN, help="mean lifespan (rounds), small values for quick tests")
    p.add_argument("--sd", type=float, default=LIFESPAN_SD)
    args = p.parse_args()

    client = DeepSeekClient()
    game = Game(client, data_dir=args.data_dir, seed=args.seed, lifespan_mean=args.mean, lifespan_sd=args.sd,
                max_players=args.max_players, max_rounds=args.max_rounds, budget_usd=args.budget)
    for e in game.run():
        t = e["type"]
        if t == "spawn":
            note = "（带着前人的遗言）" if e["inherited_last_words"] else ""
            print(f"\n=== 第 {e['player']['id']} 位选手「{e['player']['name']}」入场 {note}===")
        elif t == "message":
            print(f"[R{e['round']:>3}] {e['name']}：{e['text']}")
        elif t == "lastwords":
            print(f"[R{e['round']:>3}] {e['name']}（遗言）：{e['text']}")
        elif t == "death":
            r = e["record"]
            print(f"\n†† 第 {e['round']} 轮，「{r['name']}」死亡 · 存活 {r['rounds']} 轮 · {r['cause']}\n   生平：{r['biography']}")
        elif t == "stop":
            print(f"\nstopped: {e['reason']}")
    print(client.usage.summary())


if __name__ == "__main__":
    main()
