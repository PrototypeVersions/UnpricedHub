"""The Hub's schedule must be written in UTC and collect before the 09:30 ET open in EST and EDT.

GitHub ignored the `timezone: 'America/New_York'` keys and ran every cron as UTC, so collections
meant for the evening and the pre-open ran 4-5 hours early (on 2026-11-05 a forecast frozen at
19:16 ET was only received at 03:29 ET).
"""
import re
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "hub.yml"
OFFSETS = {"EST": -5, "EDT": -4}
OPEN = 9 * 60 + 30      # 09:30 ET
CUTOFF = 17 * 60 + 30   # 17:30 ET


def _crons():
    # Plain-text parse (no YAML dependency): every `- cron: '...'` line in the workflow.
    crons = re.findall(r"^\s*-\s*cron:\s*'([^']+)'", WORKFLOW.read_text(), re.M)
    assert crons, "no cron lines found"
    return crons


def _days(field):
    if field == "*":
        return set(range(7))
    out = set()
    for part in field.split(","):
        a, _, b = part.partition("-")
        out.update(range(int(a), int(b or a) + 1))
    return {d % 7 for d in out}


def _runs(cron):
    """(offset name, local weekday 0=Sun, local minutes after midnight) for every run of a cron."""
    minute, hour, dom, month, dow = cron.split()
    assert dom == "*" and month == "*", cron
    for h in hour.split(","):
        for m in minute.split(","):
            for d in _days(dow):
                for name, off in OFFSETS.items():
                    t = int(h) * 60 + int(m) + off * 60
                    yield name, (d + (t // 1440)) % 7, t % 1440


def test_crons_are_utc_without_timezone_key():
    assert not re.search(r"^\s*timezone:", WORKFLOW.read_text(), re.M)


def test_no_collection_between_the_open_and_the_evening_cutoff():
    # A pre-open receipt after 09:30 ET counts as late; an evening run before 17:30 ET is too early.
    bad = [(c, n, d, f"{t // 60:02d}:{t % 60:02d}") for c in _crons() for n, d, t in _runs(c)
           if OPEN <= t < CUTOFF]
    assert not bad, bad


def test_every_weekday_has_a_pre_open_collection_in_est_and_edt():
    for name in OFFSETS:
        for weekday in range(1, 6):
            starts = [t for c in _crons() for n, d, t in _runs(c)
                      if n == name and d == weekday and 6 * 60 <= t < OPEN]
            assert starts, (name, weekday)
            assert max(starts) < OPEN


def test_every_weekday_evening_has_a_collection_after_the_cutoff():
    for name in OFFSETS:
        for weekday in range(1, 6):
            assert any(n == name and d == weekday and t >= CUTOFF
                       for c in _crons() for n, d, t in _runs(c)), (name, weekday)


def test_the_scoring_run_matches_a_scheduled_cron():
    # The Run step picks `all` (collect, score, publish) by the exact schedule string.
    m = re.search(r'github\.event\.schedule \}\}" = "([^"]+)"', WORKFLOW.read_text())
    assert m and m.group(1) in _crons()
