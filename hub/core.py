"""Shared helpers: paths, time, JSON, NYSE calendar, contract validation."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

ROOT = Path(os.environ.get("HUB_ROOT", Path(__file__).resolve().parents[1]))
ET = ZoneInfo("America/New_York")
SCHEMA_ID = "unpriced-export/1"


def now() -> datetime:
    override = os.environ.get("HUB_NOW")
    return datetime.fromisoformat(override) if override else datetime.now(ET)


def iso(dt: datetime) -> str:
    return dt.astimezone(ET).isoformat(timespec="seconds")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1, allow_nan=False) + "\n")
    tmp.replace(path)


def append_jsonl(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as fh:
        fh.write(json.dumps(obj, allow_nan=False) + "\n")


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text().splitlines() if x.strip()] if path.exists() else []


def sessions(start, end) -> pd.DatetimeIndex:
    try:
        import pandas_market_calendars as mcal
        return pd.DatetimeIndex(mcal.get_calendar("NYSE").schedule(start_date=start, end_date=end).index.normalize())
    except ImportError:   # offline tests: weekdays (good enough for unit tests)
        return pd.bdate_range(start, end)


def session_open(day: str) -> datetime:
    try:
        import pandas_market_calendars as mcal
        s = mcal.get_calendar("NYSE").schedule(start_date=day, end_date=day)
        if len(s):
            return s.iloc[0]["market_open"].tz_convert(ET).to_pydatetime()
    except ImportError:
        pass
    return datetime.combine(pd.Timestamp(day).date(), time(9, 30), tzinfo=ET)


def validate(doc: dict) -> list[str]:
    """Contract checks beyond the JSON schema. Returns a list of problems (empty = valid)."""
    problems: list[str] = []
    try:
        import jsonschema
        schema = read_json(ROOT / "contract" / "export-v1.schema.json")
        for err in jsonschema.Draft202012Validator(schema).iter_errors(doc):
            problems.append(f"schema: {'/'.join(map(str, err.path))}: {err.message}"[:300])
    except ImportError:
        if doc.get("schema") != SCHEMA_ID:
            problems.append("schema: unknown schema version")
    if problems:
        return problems
    t = doc["task"]["target"]
    if t["entryPrice"] != doc["entry"]["price"] or t["exitPrice"] != doc["exit"]["price"]:
        problems.append("target prices do not match entry/exit")
    try:
        cutoff = datetime.fromisoformat(doc["informationCutoff"])
        issued = datetime.fromisoformat(doc["issuedAt"])
        if cutoff > issued:
            problems.append("informationCutoff is after issuedAt")
    except ValueError as exc:
        problems.append(f"bad timestamp: {exc}")
    cal = sessions(doc["decisionSession"], pd.Timestamp(doc["exit"]["session"]) + pd.Timedelta(days=3))
    dec, ent, ex = (pd.Timestamp(doc[k]) if k == "decisionSession" else pd.Timestamp(doc[k]["session"])
                    for k in ("decisionSession", "entry", "exit"))
    if not (dec < ent <= ex):
        problems.append("sessions out of order (decision < entry <= exit required)")
    elif ent in cal and ex in cal:
        gap = cal.get_loc(ex) - cal.get_loc(ent)
        if gap != int(t["horizonSessions"]):
            problems.append(f"exit is {gap} sessions after entry, target says {t['horizonSessions']}")
    n = len(doc["forecasts"]["assets"])
    for mid, vals in doc["forecasts"]["values"].items():
        if len(vals) != n:
            problems.append(f"model {mid}: {len(vals)} values for {n} assets")
    if doc["task"]["forecastType"] == "event-probability":
        for mid, vals in doc["forecasts"]["values"].items():
            if any(v is not None and not (0.0 <= v <= 1.0) for v in vals):
                problems.append(f"model {mid}: probability outside [0, 1]")
    return problems
