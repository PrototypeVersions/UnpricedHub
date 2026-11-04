"""python -m hub collect | score | site | all"""
from __future__ import annotations

import json
import sys

from .collect import collect
from .score import score
from .site_build import build


def main(argv=None) -> None:
    cmd = (argv or sys.argv[1:] or ["all"])[0]
    if cmd in ("collect", "all"):
        rows = collect()
        print(json.dumps([{k: r.get(k) for k in ("lab", "status", "forecastId", "receivedAt", "entryOpen")} for r in rows], indent=1))
    if cmd in ("score", "all"):
        print(f"scored {score()} model-forecasts")
    if cmd in ("site", "collect", "score", "all"):
        build()


if __name__ == "__main__":
    main()
