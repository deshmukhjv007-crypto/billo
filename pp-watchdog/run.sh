#!/usr/bin/env bash
# zero-install entry point: python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" is optional
set -euo pipefail
cd "$(dirname "$0")"
export PYTHONPATH="${PWD}:${PYTHONPATH:-}"
exec python3 -m ppwatchdog "$@"
