"""Politeness and consent rules.

Three hard guards, because a defence tool that misbehaves is just a new
problem:

1. robots.txt is obeyed. If a mirror blocks crawling, we record
   ``blocked-by-robots`` and do not send the request. That is a deliberate
   "we will not force our way in" trade-off, and it is why this tool reports
   ``unverified`` instead of inventing numbers.
2. One request per host per ``min_interval`` seconds, hard cap of requests per
   scan, real timeout, no retries against a host that is refusing us.
3. Only the account you configured is scanned. Checking other people's handles
   turns this into a stalking tool, which is the opposite of what it is for.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from urllib import robotparser
from urllib.parse import urlparse

USER_AGENT = (
    "pp-watchdog/1.0 (personal privacy defence tool; checks whether third-party "
    "mirrors cache my own Instagram profile picture; single GET per page; honors "
    "robots.txt)"
)


@dataclass
class Policy:
    """Rate limiting + robots.txt with per-run accounting."""

    min_interval: float = 5.0
    max_requests: int = 60
    timeout: float = 12.0
    respect_robots: bool = True
    user_agent: str = USER_AGENT
    allow_hosts: list[str] = field(default_factory=list)  # e.g. 127.0.0.1 for the demo
    _last_hit: dict[str, float] = field(default_factory=dict, repr=False)
    _robots: dict[str, object] = field(default_factory=dict, repr=False)
    robots_bodies: dict[str, bytes] = field(default_factory=dict, repr=False)
    log: list[dict] = field(default_factory=list, repr=False)

    # -- bookkeeping ------------------------------------------------------- #
    @property
    def requests_used(self) -> int:
        return len(self.log)

    def _record(self, **kw) -> None:
        kw["t"] = round(time.time(), 3)
        self.log.append(kw)

    # -- gates ------------------------------------------------------------- #
    def gate(self, url: str) -> tuple[bool, str]:
        """Can we fetch this URL right now? Returns (allowed, reason)."""
        host = urlparse(url).netloc.lower()
        if self.requests_used >= self.max_requests:
            return False, f"request budget for this scan is exhausted ({self.max_requests})"
        if self.respect_robots:
            ok, why = self._robots_allows(url, host)
            if not ok:
                return False, why
        last = self._last_hit.get(host)
        if last is not None:
            since = time.time() - last
            wait = self.min_interval - since
            if wait > 0:
                return False, (f"rate limit: {host} was already probed {since:.0f}s ago; "
                               f"next probe allowed in {wait:.1f}s")
        return True, ""

    def note(self, url: str, status: object, error: str = "") -> None:
        host = urlparse(url).netloc.lower()
        self._last_hit[host] = time.time()
        self._record(url=url, status=status, error=error)

    # -- robots ------------------------------------------------------------ #
    def _robots_allows(self, url: str, host: str) -> tuple[bool, str]:
        rp = self._robots.get(host)
        if rp is None:
            rp = self._fetch_robots(host)
            self._robots[host] = rp
        if rp is False:  # could not fetch robots.txt at all
            return True, ""
        if rp is True:  # no robots.txt -> everything allowed
            return True, ""
        allowed = rp.can_fetch(self.user_agent, url)  # type: ignore[union-attr]
        return (True, "") if allowed else (False, "robots.txt disallows this path for our user-agent")

    def _fetch_robots(self, host: str):
        """Fetch robots.txt without going through the robots gate itself."""
        url = f"https://{host}/robots.txt"
        if host in self.allow_hosts:
            url = f"http://{host}/robots.txt"
        self._record(url=url, status="preflight", error="")
        try:
            body = _raw_get(url, self.user_agent, min(self.timeout, 8.0))
        except Exception as exc:
            self._robots[host] = False
            return False
        self.robots_bodies[host] = body
        rp = robotparser.RobotFileParser()
        rp.parse(body.decode("utf-8", "replace").splitlines())
        self._robots[host] = rp
        return rp

    # -- consent ----------------------------------------------------------- #
    def check_handle(self, target: str, owner: str, acknowledged: bool) -> tuple[bool, str]:
        if not target:
            return False, "no handle configured. Run `pp-watchdog init` first."
        if target.lower() == (owner or "").lower():
            return True, ""
        if acknowledged:
            return True, ""
        return (
            False,
            f"'{target}' is not the handle this install belongs to ('{owner}').\n"
            "  pp-watchdog exists to protect YOUR picture, not to survey other\n"
            "  people's profiles. If you are acting for this account with its\n"
            "  owner's consent (family safety work, representing a client), add\n"
            "  --acknowledge to the command.",
        )


def _raw_get(url: str, ua: str, timeout: float) -> bytes:
    from .net import fetch  # local import avoids a cycle at module load

    return fetch(url, ua=ua, timeout=timeout, max_bytes=256_000).body
