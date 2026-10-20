"""The audience's thumbs up / down, on every single line a player says -- the living and the dead alike.

Every viewer has one vote per line (up, down, or none, and may change it), so a viewer can like many lines of the same
player and a small audience still adds up to real numbers. A player's score is the sum over all their lines. Voting
stays open after death (the graveyard keeps changing), so the ballots are kept on disk (votes.json in the data folder)
and survive a restart.
A viewer is the random id the page keeps in localStorage; one address may only bring a handful of ids, so reloading in
a private window over and over does not stuff the ballot.
"""
import json
import os
import threading
from pathlib import Path

MAX_IDS_PER_ADDRESS = 6
CHANGE_LOG = 5000  # how many recent changes are kept for "what changed since" (older readers get everything)


def _count(ballots: dict[str, int]) -> dict:
    return {"up": sum(v > 0 for v in ballots.values()), "down": sum(v < 0 for v in ballots.values())}


class VoteBox:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path else None
        self._lock = threading.Lock()
        self._ballots: dict[int, dict[str, dict[str, int]]] = {}  # player id -> line id -> viewer -> +1 / -1
        self._ids: dict[str, set[str]] = {}  # address -> viewer ids that voted from it
        self._log: list[tuple[int, int, str]] = []  # (version, player id, line id) of every recent change
        # votes a grave got before ballots were kept (only its copy at death survives): counted on top of the ballots
        self._base: dict[int, dict] = {}  # player id -> {"total": {up, down}, "lines": {line id: {up, down}}}
        self.version = 0  # bumped on every change, so the event stream knows when to push
        if self.path and self.path.exists():
            data = json.loads(self.path.read_text(encoding="utf-8"))
            self._ballots = {int(p): lines for p, lines in data.get("ballots", {}).items()}
            self._base = {int(p): b for p, b in data.get("base", {}).items()}

    def _save(self) -> None:
        if not self.path:
            return
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"ballots": self._ballots, "base": self._base}, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.path)

    def _total(self, pid: int) -> dict:
        base = self._base.get(pid, {}).get("total") or {}
        up, down = base.get("up", 0), base.get("down", 0)
        for ballots in self._ballots.get(pid, {}).values():
            c = _count(ballots)
            up, down = up + c["up"], down + c["down"]
        return {"up": up, "down": down}

    def _line(self, pid: int, mid: str) -> dict:
        c = _count(self._ballots.get(pid, {}).get(mid, {}))
        base = self._base.get(pid, {}).get("lines", {}).get(mid) or {}
        return {"up": c["up"] + base.get("up", 0), "down": c["down"] + base.get("down", 0)}

    def _lines(self, pid: int) -> dict[str, dict]:
        mids = set(self._ballots.get(pid, {})) | set(self._base.get(pid, {}).get("lines", {}))
        return {mid: c for mid in mids if (c := self._line(pid, mid))["up"] or c["down"]}

    def seed(self, pid: int, total: dict, lines: dict) -> None:
        """A grave from before the ballots were kept: start it from the counts copied at its death (once)."""
        with self._lock:
            if pid in self._ballots or pid in self._base or not (total.get("up") or total.get("down")):
                return
            self._base[pid] = {"total": dict(total), "lines": dict(lines)}
            self._save()

    def has(self, pid: int) -> bool:
        """Whether anyone has voted on this player (on a record from before votes were kept, the grave's copy counts)."""
        with self._lock:
            return pid in self._ballots or pid in self._base

    def total(self, pid: int) -> dict:
        with self._lock:
            return self._total(pid)

    def snapshot(self, pid: int) -> tuple[dict, dict]:
        """(totals, {line id: counts} for the lines that got any) -- what goes into the grave record at death."""
        with self._lock:
            return self._total(pid), self._lines(pid)

    def cast(self, pid: int, mid: str, viewer: str, vote: int, address: str = "") -> dict | None:
        """vote: 1 up, -1 down, 0 take the vote back, on line `mid` of player `pid` (alive or dead). Returns
        {"player": totals, "message": this line's counts}, or None when this address has used up its viewer ids."""
        with self._lock:
            ids = self._ids.setdefault(address, set())
            if viewer not in ids:
                if len(ids) >= MAX_IDS_PER_ADDRESS:
                    return None
                ids.add(viewer)
            ballots = self._ballots.setdefault(pid, {}).setdefault(mid, {})
            if ballots.get(viewer, 0) != vote:
                if vote:
                    ballots[viewer] = vote
                else:
                    ballots.pop(viewer, None)
                self.version += 1
                self._log.append((self.version, pid, mid))
                del self._log[:-CHANGE_LOG]
                self._save()
            return {"player": self._total(pid), "message": self._line(pid, mid)}

    def tallies(self, pids=()) -> dict:
        """{"players": {player id: totals}, "messages": {line id: counts}} for everyone who has votes, plus `pids`
        (ids as strings, they go into json; lines without any vote are left out)."""
        with self._lock:
            everyone = set(self._ballots) | set(self._base) | set(pids)
            players = {str(p): self._total(p) for p in everyone}
            messages = {mid: c for p in everyone for mid, c in self._lines(p).items()}
            return {"players": players, "messages": messages}

    def changes(self, since: int) -> tuple[int, dict]:
        """(version now, the tallies of what changed after version `since`). A reader too far behind gets everything."""
        with self._lock:
            version = self.version
            if since >= version:
                return version, {"players": {}, "messages": {}}
            if not self._log or since < self._log[0][0] - 1:
                full = True
            else:
                full = False
                changed = [(p, m) for v, p, m in self._log if v > since]
        if full:
            return version, self.tallies()
        with self._lock:
            players = {str(p): self._total(p) for p in {p for p, _ in changed}}
            messages = {m: self._line(p, m) for p, m in changed}
        return version, {"players": players, "messages": messages}

    def mine(self, viewer: str) -> dict[str, int]:
        """{line id: 1 | -1}: everything this viewer gave, to the living and the dead."""
        with self._lock:
            return {mid: v for lines in self._ballots.values() for mid, b in lines.items() if (v := b.get(viewer))}
