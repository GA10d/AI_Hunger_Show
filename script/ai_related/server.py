"""Web server: runs the game in a background thread, pushes events to the page over SSE,
serves the graveyard, and hosts the static front end in web/.

    python -m ai_related.server                # from script/, then open http://127.0.0.1:8000
"""
import argparse
import asyncio
import json
import mimetypes
import threading
import time
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from .client import DeepSeekClient
from .config import LIFESPAN_MEAN, LIFESPAN_SD
from .game import Game, load_recent_events
from .playlist import MUSIC_DIR, write_playlist

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
BACKLOG = 200  # events replayed to a freshly connected page
mimetypes.add_type("font/woff2", ".woff2")  # Windows' registry often has no entry for it


class Runner:
    """Owns the game thread and an in-memory log of events."""

    def __init__(self, game: Game):
        self.game = game
        self.events: list[dict] = load_recent_events(game.data_dir, 400)
        self.lock = threading.Lock()
        self.thread: threading.Thread | None = None
        self.error: str | None = None

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


def create_app(runner: Runner) -> FastAPI:
    app = FastAPI(title="AI Hunger Show")
    game = runner.game

    @app.get("/api/state")
    def state():
        return {"running": runner.running, "stop_reason": game.stop_reason, "error": runner.error,
                "round": game.round, "players": [p.public() for p in game.players],
                "graveyard_count": len(game.graveyard), "cost_usd": round(game.client.usage.cost_usd, 4)}

    @app.get("/api/graveyard")
    def graveyard():
        return game.graveyard

    @app.get("/api/scripture")
    def scripture():
        """The 圣言 page: every entry of the worldview, with how many times it has been triggered."""
        return game.scripture_view()

    @app.get("/api/graveyard/{player_id}")
    def grave(player_id: int):
        for record in game.graveyard:
            if record["id"] == player_id:
                return record
        raise HTTPException(404, "no such player")

    @app.post("/api/start")
    def start():
        return {"started": runner.start()}

    @app.post("/api/stop")
    def stop():
        runner.stop()
        return {"stopping": True}

    @app.get("/api/events")
    async def events(request: Request):
        last_id = request.headers.get("last-event-id", "")
        total = runner.count()
        fresh = not (last_id.isdigit() and int(last_id) < total)
        index = max(0, total - BACKLOG) if fresh else int(last_id) + 1

        async def stream():
            nonlocal index
            yield "retry: 2000\n\n"
            idle = 0.0
            while not await request.is_disconnected():
                batch = runner.since(index)
                for i, event in enumerate(batch, start=index):
                    if fresh and i < total:
                        event = {**event, "replay": True}  # history: the page renders it instantly
                    yield f"id: {i}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                index += len(batch)
                idle = 0.0 if batch else idle + 0.3
                if idle >= 15:
                    yield ": ping\n\n"
                    idle = 0.0
                await asyncio.sleep(0.3)

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    if MUSIC_DIR.is_dir():  # the page asks for ../music/<file>, which from "/" resolves to /music/<file>
        app.mount("/music", StaticFiles(directory=MUSIC_DIR), name="music")
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")  # keep last
    return app


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--world", default="example", help="world folder under words/ (or a path), e.g. corridor")
    p.add_argument("--data-dir", default="logs/game", help="graveyard + transcript directory")
    p.add_argument("--no-autostart", action="store_true", help="don't start the game; POST /api/start to begin")
    p.add_argument("--delay", type=float, default=2.0, help="seconds to wait between rounds")
    p.add_argument("--budget", type=float, default=1.0, help="stop when estimated cost exceeds this (USD)")
    p.add_argument("--max-players", type=int)
    p.add_argument("--max-rounds", type=int)
    p.add_argument("--seed", type=int)
    p.add_argument("--mean", type=float, default=LIFESPAN_MEAN, help="mean lifespan (rounds), for testing")
    p.add_argument("--sd", type=float, default=LIFESPAN_SD, help="lifespan standard deviation, for testing")
    args = p.parse_args()

    game = Game(DeepSeekClient(), world=args.world, data_dir=args.data_dir, seed=args.seed,
                lifespan_mean=args.mean, lifespan_sd=args.sd, round_delay=args.delay,
                max_players=args.max_players, max_rounds=args.max_rounds, budget_usd=args.budget)
    runner = Runner(game)
    if not args.no_autostart:
        runner.start()
    print(f"world: {game.world.name} (judge: {'on' if game.judge else 'off'}, oracle: {'on' if game.oracle else 'off'})")
    print(f"music: {len(write_playlist())} track(s) in {MUSIC_DIR}")
    print(f"open http://{args.host}:{args.port}  (budget ${args.budget}, data in {Path(args.data_dir).resolve()})")
    uvicorn.run(create_app(runner), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
