"""Web server: runs the game in a background thread, pushes events to the page over SSE (or, where a proxy
buffers SSE -- Cloudflare quick tunnels do -- lets it poll), serves the graveyard, and hosts the front end in web/.

    python -m ai_related.server                # from script/, then open http://127.0.0.1:8000
"""
import argparse
import asyncio
import json
import mimetypes
import os
import secrets
import threading
import time
from pathlib import Path

import uvicorn
from fastapi import Body, Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from .client import DeepSeekClient
from .config import LIFESPAN_MEAN, LIFESPAN_SD, LOVERS_CHANCE, REVIVE_CHANCE, SPECIAL_CHANCES
from .game import Game, load_recent_events
from .playlist import MUSIC_DIR, write_playlist

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
BACKLOG = 200  # events replayed to a freshly connected page
POLL_TTL = 10.0  # a polling page counts as watching for this many seconds after its last poll
mimetypes.add_type("font/woff2", ".woff2")  # Windows' registry often has no entry for it


class Runner:
    """Owns the game thread and an in-memory log of events."""

    def __init__(self, game: Game):
        self.game = game
        self.events: list[dict] = load_recent_events(game.data_dir, 400)
        self.lock = threading.Lock()
        self.thread: threading.Thread | None = None
        self.error: str | None = None
        self.streams = 0  # open event streams
        self.pollers: dict[str, float] = {}  # polling pages: viewer id -> time of its last poll

    @property
    def viewers(self) -> int:
        """People watching right now: open streams plus pages that polled recently."""
        cutoff = time.monotonic() - POLL_TTL
        with self.lock:
            self.pollers = {v: t for v, t in self.pollers.items() if t > cutoff}
            return self.streams + len(self.pollers)

    def polled(self, viewer: str) -> None:
        with self.lock:
            self.pollers[viewer] = time.monotonic()

    @property
    def running(self) -> bool:
        return self.thread is not None and self.thread.is_alive()

    def start(self) -> bool:
        if self.running:
            return False
        self.game.reset_stop()
        self.error = None
        self.thread = threading.Thread(target=self._run, daemon=True, name="game")
        self.thread.start()
        return True

    def stop(self) -> None:
        self.game.stop()

    def since(self, index: int) -> list[dict]:
        with self.lock:
            return self.events[index:]

    def count(self) -> int:
        with self.lock:
            return len(self.events)

    def _push(self, event: dict) -> None:
        with self.lock:
            self.events.append(event)

    def _run(self) -> None:
        try:
            for event in self.game.run():
                self._push(event)
        except Exception as e:  # keep the server alive; surface the failure to the page
            self.error = f"{type(e).__name__}: {e}"
            self._push({"type": "error", "message": self.error, "ts": time.time()})


PROXY_HEADERS = ("x-forwarded-for", "forwarded", "x-real-ip", "cf-connecting-ip", "cf-ray")


def create_app(runner: Runner, admin_token: str | None = None, max_viewers: int = 100) -> FastAPI:
    """Anyone who can reach the server may WATCH (every GET). Only the owner may start / stop the game:
    with an admin token, the request must carry it (X-Admin-Token); without one, only a direct request from this
    machine is accepted. A tunnel (Cloudflare, ngrok...) connects from localhost too, so its forwarding headers
    count as "not direct" -- sharing the page through a tunnel can never hand the controls to the audience."""
    app = FastAPI(title="AI Hunger Show")
    game = runner.game

    def owner_only(request: Request) -> None:
        if admin_token:
            if not secrets.compare_digest(request.headers.get("x-admin-token", ""), admin_token):
                raise HTTPException(403, "admin token required")
            return
        direct = request.client is not None and request.client.host in ("127.0.0.1", "::1", "localhost")
        if not direct or any(h in request.headers for h in PROXY_HEADERS):
            raise HTTPException(403, "only the owner of this machine can start or stop the show")

    @app.get("/api/state")
    def state():
        return {"running": runner.running, "stop_reason": game.stop_reason, "error": runner.error,
                "round": game.round, "players": [p.public() for p in game.players],
                "graveyard_count": len(game.graveyard), "cost_usd": round(game.client.usage.cost_usd, 4),
                "viewers": runner.viewers, "delay": game.round_delay}

    @app.get("/api/graveyard")
    def graveyard():
        return game.graveyard

    @app.get("/api/scripture")
    def scripture():
        """The 圣言 page: every entry of the worldview, with how many times it has been triggered."""
        return game.scripture_view()

    @app.get("/api/specials")
    def specials():
        """The 特殊角色 page. seen: {identity: {count, first: {name, avatar, round}}} for every identity that has appeared;
        chances: how rare each one is (shown even while it is still locked)."""
        return {"seen": game.specials_view(),
                "chances": {"revived": game.revive_chance, **game.special_chances, "lover": game.lovers_chance}}

    @app.get("/api/graveyard/{player_id}")
    def grave(player_id: int):
        for record in game.graveyard:
            if record["id"] == player_id:
                return record
        raise HTTPException(404, "no such player")

    def address(request: Request) -> str:
        """Who is voting, as far as an address tells: behind a Cloudflare tunnel every request comes from localhost,
        so the visitor's own address is in cf-connecting-ip (only trusted when the request really came through it)."""
        host = request.client.host if request.client else ""
        if host in ("127.0.0.1", "::1"):
            return request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for", "").split(",")[0].strip() or host
        return host

    def tallies() -> dict:
        return game.votes.tallies(p.id for p in game.players)

    @app.get("/api/votes")
    def votes(viewer: str = ""):
        """The thumbs on the players on the field, and which ones this viewer gave."""
        pids = [p.id for p in game.players]
        return {"tallies": game.votes.tallies(pids), "mine": game.votes.mine(viewer[:64], pids) if viewer else {}}

    @app.post("/api/vote")
    def vote(request: Request, player_id: int = Body(...), vote: int = Body(...), viewer: str = Body(...)):
        """Anyone watching may vote (1 up, -1 down, 0 take it back), once per player, while that player is on the field."""
        viewer = viewer.strip()[:64]
        if vote not in (-1, 0, 1) or not viewer:
            raise HTTPException(400, "vote must be 1, -1 or 0, with a viewer id")
        if not any(p.id == player_id for p in game.players):
            raise HTTPException(409, "this player is no longer on the field")
        tally = game.votes.cast(player_id, viewer, vote, address(request))
        if tally is None:
            raise HTTPException(429, "too many voters from this address")
        return {"player_id": player_id, "vote": vote, **tally}

    @app.post("/api/start", dependencies=[Depends(owner_only)])
    def start():
        return {"started": runner.start()}

    @app.post("/api/speed", dependencies=[Depends(owner_only)])
    def speed(delay: float = Body(..., embed=True)):
        """Change the pause after every action while the show runs: {"delay": seconds}. Takes effect at once."""
        if not 0 <= delay <= 3600:
            raise HTTPException(400, "delay must be between 0 and 3600 seconds")
        game.round_delay = delay
        return {"delay": delay}

    @app.post("/api/stop", dependencies=[Depends(owner_only)])
    def stop():
        runner.stop()
        return {"stopping": True}

    def resume(last_seen: int) -> tuple[int, int, bool]:
        """Where to continue for a page that last saw event `last_seen` (-1: none yet).
        A new page, or one that saw more events than exist (the server restarted), gets the recent backlog."""
        total = runner.count()
        fresh = not (0 <= last_seen < total)
        return (max(0, total - BACKLOG) if fresh else last_seen + 1), total, fresh

    def mark_replay(event: dict, i: int, total: int, fresh: bool) -> dict:
        return {**event, "replay": True} if fresh and i < total else event  # history: the page renders it instantly

    @app.get("/api/events")
    async def events(request: Request):
        if runner.viewers >= max_viewers:
            raise HTTPException(503, "too many viewers right now")
        last_id = request.headers.get("last-event-id", "")
        index, total, fresh = resume(int(last_id) if last_id.isdigit() else -1)

        async def stream():
            nonlocal index
            runner.streams += 1
            try:
                yield "retry: 2000\n\n"
                # proves the stream really flows; behind a proxy that buffers SSE it never arrives and the page polls
                yield "event: hello\ndata: {}\n\n"
                idle = 0.0
                seen_votes = -1
                while not await request.is_disconnected():
                    if game.votes.version != seen_votes:  # the thumbs: a named event, never part of the history
                        seen_votes = game.votes.version
                        yield f"event: votes\ndata: {json.dumps(tallies())}\n\n"
                    batch = runner.since(index)
                    for i, event in enumerate(batch, start=index):
                        event = mark_replay(event, i, total, fresh)
                        yield f"id: {i}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                    index += len(batch)
                    idle = 0.0 if batch else idle + 0.3
                    if idle >= 15:
                        yield ": ping\n\n"
                        idle = 0.0
                    await asyncio.sleep(0.3)
            finally:
                runner.streams -= 1

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.get("/api/poll")
    def poll(after: int = -1, viewer: str = ""):
        """The same events as /api/events, for pages whose stream a proxy holds back.
        `after` is the index of the last event the page has; send the reply's `last` next time."""
        viewer = viewer[:64]
        if viewer not in runner.pollers and runner.viewers >= max_viewers:
            raise HTTPException(503, "too many viewers right now")
        if viewer:
            runner.polled(viewer)
        index, total, fresh = resume(after)
        batch = runner.since(index)
        return {"events": [mark_replay(e, i, total, fresh) for i, e in enumerate(batch, start=index)],
                "last": index + len(batch) - 1, "votes": tallies()}

    if MUSIC_DIR.is_dir():  # the page asks for ../music/<file>, which from "/" resolves to /music/<file>
        app.mount("/music", StaticFiles(directory=MUSIC_DIR), name="music")
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")  # keep last
    return app


def parse_specials(parser: argparse.ArgumentParser, items: list[str]) -> dict[str, float]:
    out = {}
    for item in items:
        name, _, chance = item.partition("=")
        try:
            out[name.strip()] = float(chance)
        except ValueError:
            parser.error(f"--special wants NAME=CHANCE, got {item!r}")
        if name.strip() not in SPECIAL_CHANCES:
            parser.error(f"unknown identity {name!r}; known: {', '.join(SPECIAL_CHANCES)}")
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--world", default="example", help="world folder under words/ (or a path), e.g. corridor")
    p.add_argument("--data-dir", default="logs/game", help="graveyard + transcript directory")
    p.add_argument("--admin-token", default=os.environ.get("HUNGER_ADMIN_TOKEN", ""),
                   help="required (header X-Admin-Token) to start / stop the game; without it only direct local requests may")
    p.add_argument("--max-viewers", type=int, default=100, help="cap on simultaneous watchers")
    p.add_argument("--no-autostart", action="store_true", help="don't start the game; POST /api/start to begin")
    p.add_argument("--delay", type=float, default=2.0,
                   help="seconds to wait after every action (can be changed while running: POST /api/speed)")
    p.add_argument("--budget", type=float, default=1.0, help="stop when estimated cost exceeds this (USD)")
    p.add_argument("--max-players", type=int)
    p.add_argument("--max-rounds", type=int)
    p.add_argument("--seed", type=int)
    p.add_argument("--mean", type=float, default=LIFESPAN_MEAN, help="mean lifespan (rounds), for testing")
    p.add_argument("--sd", type=float, default=LIFESPAN_SD, help="lifespan standard deviation, for testing")
    p.add_argument("--revive-chance", type=float, default=REVIVE_CHANCE, help="chance that a newcomer is the most liked dead player, revived")
    p.add_argument("--special", action="append", default=[], metavar="NAME=CHANCE",
                   help=f"override the chance of a rare identity ({', '.join(SPECIAL_CHANCES)}), e.g. --special medium=1")
    p.add_argument("--lovers-chance", type=float, default=LOVERS_CHANCE, help="chance that two players born together are lovers")
    args = p.parse_args()

    game = Game(DeepSeekClient(), world=args.world, data_dir=args.data_dir, seed=args.seed,
                lifespan_mean=args.mean, lifespan_sd=args.sd, round_delay=args.delay,
                max_players=args.max_players, max_rounds=args.max_rounds, budget_usd=args.budget,
                revive_chance=args.revive_chance, special_chances=parse_specials(p, args.special),
                lovers_chance=args.lovers_chance)
    runner = Runner(game)
    if not args.no_autostart:
        runner.start()
    print(f"world: {game.world.name} (judge: {'on' if game.judge else 'off'}, oracle: {'on' if game.oracle else 'off'})")
    print(f"music: {len(write_playlist())} track(s) in {MUSIC_DIR}")
    print(f"open http://{args.host}:{args.port}  (budget ${args.budget}, data in {Path(args.data_dir).resolve()})")
    uvicorn.run(create_app(runner, args.admin_token or None, args.max_viewers), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
