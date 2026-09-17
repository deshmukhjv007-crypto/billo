"""Profile Picture Exposure Watchdog.

A defensive, single-user tool: it checks which public Instagram mirror /
"anonymous viewer" services are re-hosting YOUR profile picture, flags copies
that are stale or higher-resolution than what Instagram itself displays, and
generates the legal notices needed to get them taken down.

It deliberately does NOT try to identify who has looked at anything. That data
does not exist on any API (see README.md, "What this tool cannot do").
"""

__version__ = "1.0.0"
TOOL_NAME = "pp-watchdog"
