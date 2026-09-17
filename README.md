# billo
billo expense tracking app

## pp-watchdog

Separate defensive tool, in `pp-watchdog/`: checks which third-party Instagram
mirror / "anonymous viewer" sites are re-hosting your profile picture (stale
copies, oversized copies, cached bios), scores the exposure, keeps local
history, and generates DMCA / IT Act / GDPR takedown notices.

It deliberately does **not** claim to show who viewed your profile — Instagram
exposes no such data to anyone. See `pp-watchdog/README.md`.

    cd pp-watchdog && ./run.sh selftest
