"""The audience's thumbs up / down on the players.

Every viewer has one vote per player (up, down, or none, and may change it) while that player is on the field.
At death the totals are frozen into the grave record (Game._kill), so nothing is persisted here: players do not
survive a server restart anyway. A viewer is the random id the page keeps in localStorage; one address may only
bring a handful of ids, so reloading in a private window over and over does not stuff the ballot.
"""
import threading

MAX_IDS_PER_ADDRESS = 6


class VoteBox:
    def __init__(self):
        self._lock = threading.Lock()
        self._ballots: dict[int, dict[str, int]] = {}  # player id -> viewer -> +1 / -1
        self._closed: set[int] = set()
        self._ids: dict[str, set[str]] = {}  # address -> viewer ids that voted from it
        self.version = 0  # bumped on every change, so the event stream knows when to push the tallies

    @staticmethod
    def _count(ballots: dict[str, int]) -> dict:
        return {"up": sum(v > 0 for v in ballots.values()), "down": sum(v < 0 for v in ballots.values())}

    def cast(self, pid: int, viewer: str, vote: int, address: str = "") -> dict | None:
        """vote: 1 up, -1 down, 0 take the vote back. None when the player can no longer be voted on, or this
        address has used up its viewer ids."""
        with self._lock:
            if pid in self._closed:
                return None
            ids = self._ids.setdefault(address, set())
            if viewer not in ids:
                if len(ids) >= MAX_IDS_PER_ADDRESS:
                    return None
                ids.add(viewer)
            ballots = self._ballots.setdefault(pid, {})
            if (ballots.get(viewer, 0)) != vote:
                if vote:
                    ballots[viewer] = vote
                else:
                    ballots.pop(viewer, None)
                self.version += 1
            return self._count(ballots)

    def close(self, pid: int) -> dict:
        """The player left the field: no more votes; returns the final tally."""
        with self._lock:
            self._closed.add(pid)
            tally = self._count(self._ballots.pop(pid, {}))
            self.version += 1
            return tally

    def tallies(self, pids) -> dict[str, dict]:
        """{player id (as a string, it goes into json): {"up", "down"}} for the given players."""
        with self._lock:
            return {str(p): self._count(self._ballots.get(p, {})) for p in pids}

    def mine(self, viewer: str, pids) -> dict[str, int]:
        with self._lock:
            return {str(p): v for p in pids if (v := self._ballots.get(p, {}).get(viewer))}
