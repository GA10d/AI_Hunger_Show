"""Run the game in the terminal (no web page).

    python -m ai_related.run_game --world corridor --max-players 3 --mean 6 --sd 2
"""
import argparse
import sys

from .client import DeepSeekClient
from .config import LIFESPAN_MEAN, LIFESPAN_SD, LOVERS_CHANCE, REVIVE_CHANCE, SPECIAL_CHANCES
from .game import Game
from .server import parse_specials


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("--world", default="example", help="world folder under words/ (or a path), e.g. corridor")
    p.add_argument("--data-dir", default="logs/game")
    p.add_argument("--max-players", type=int, default=2)
    p.add_argument("--max-rounds", type=int)
    p.add_argument("--budget", type=float, default=0.5, help="stop when estimated cost exceeds this (USD)")
    p.add_argument("--seed", type=int)
    p.add_argument("--mean", type=float, default=LIFESPAN_MEAN, help="mean lifespan (rounds), small values for quick tests")
    p.add_argument("--sd", type=float, default=LIFESPAN_SD)
    p.add_argument("--revive-chance", type=float, default=REVIVE_CHANCE)
    p.add_argument("--special", action="append", default=[], metavar="NAME=CHANCE",
                   help=f"override the chance of a rare identity ({', '.join(SPECIAL_CHANCES)})")
    p.add_argument("--lovers-chance", type=float, default=LOVERS_CHANCE)
    args = p.parse_args()

    client = DeepSeekClient()
    game = Game(client, world=args.world, data_dir=args.data_dir, seed=args.seed, lifespan_mean=args.mean,
                lifespan_sd=args.sd, max_players=args.max_players, max_rounds=args.max_rounds,
                budget_usd=args.budget, revive_chance=args.revive_chance,
                special_chances=parse_specials(p, args.special), lovers_chance=args.lovers_chance)
    print(f"world: {game.world.name} | judge: {'on' if game.judge else 'off'} | oracle: {'on' if game.oracle else 'off'}")
    for e in game.run():
        t = e["type"]
        if t == "spawn":
            note = "（带着前人的遗言）" if e["inherited_last_words"] else ""
            if e.get("revived"):
                note = f"（复活！第 {e['revived']['life']} 世）" + note
            elif e["player"].get("special"):
                note = f"（{e['player']['special']}）" + note
            print(f"\n=== 第 {e['player']['id']} 位选手「{e['player']['name']}」入场 {note}===")
        elif t == "message":
            print(f"[R{e['round']:>3}] {e['name']}：{e['text']}")
        elif t == "lastwords":
            print(f"[R{e['round']:>3}] {e['name']}（遗言）：{e['text']}")
        elif t == "guess":
            print(f"[R{e['round']:>3}] ✦ {e['name']} 宣告：{e['text']}")
        elif t == "verdict":
            print(f"        ✦ 审判：{'正确' if e['correct'] else '错误'} —— {e['line']}")
        elif t == "death":
            r = e["record"]
            print(f"\n†† 第 {e['round']} 轮，「{r['name']}」死亡（{r['kind']}）· 存活 {r['rounds']} 轮 · {r['cause']}")
        elif t == "victory":
            r = e["record"]
            print(f"\n★★ 第 {e['round']} 轮，「{r['name']}」解开了回廊。获释的同场同胞：{e['freed'] or '无'}\n   {r['biography']}")
        elif t == "lovers":
            print(f"   ♥ {' 与 '.join(q['name'] for q in e['players'])} 是一对恋人")
        elif t == "vision":
            print(f"   ◎ 通灵者「{e['name']}」看见：{'；'.join(i['outline'] for i in e['items']) or '什么也没有'}")
        elif t == "haunt":
            print(f"   ~ 「{e['name']}」没有离开，化作了地缚灵")
        elif t == "ghost_gone":
            print(f"   ~ 地缚灵「{e['name']}」{ {'dispersed': '魂飞魄散', 'faded': '渐渐消散', 'freed': '也获得了自由'}[e['reason']] }")
        elif t == "stop":
            print(f"\nstopped: {e['reason']}")
    print(client.usage.summary())


if __name__ == "__main__":
    main()
