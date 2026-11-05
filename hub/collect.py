"""Collect each lab's latest export, keep the exact bytes, and record an independent receipt time.

A forecast counts as live only if the Hub received it before its entry session's opening auction.
The first receipt of a forecastId is canonical; a later file with the same id but different bytes
is recorded as a conflict and never replaces the original.
"""
from __future__ import annotations

import json
import re

import requests

from .core import ROOT, append_jsonl, iso, now, read_json, read_jsonl, session_open, sha256, validate


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s)


def collect(fetch=None) -> list[dict]:
    fetch = fetch or (lambda url: requests.get(url, timeout=60, headers={"Cache-Control": "no-cache"}))
    labs = read_json(ROOT / "labs.json")["labs"]
    receipts_path = ROOT / "records" / "receipts.jsonl"
    seen = {}
    for r in read_jsonl(receipts_path):
        if r.get("forecastId"):
            seen.setdefault(r["forecastId"], r)
    out = []
    targets = [(lab, url) for lab in labs for url in (lab.get("exports") or [lab.get("export")])
               if url and "<" not in url]          # placeholders are not fetched
    for lab, url in targets:
        row = {"lab": lab["id"], "url": url, "requestedAt": iso(now())}
        try:
            resp = fetch(url)
            status = getattr(resp, "status_code", 200)
            raw = resp.content if status == 200 else None
        except Exception as exc:  # network trouble is recorded, not fatal
            row.update(receivedAt=iso(now()), status="unavailable", error=f"{type(exc).__name__}: {exc}"[:200])
            out.append(row)
            continue
        # the receipt time is when the bytes were fully in hand, not when the request started
        at = now()
        row["receivedAt"] = iso(at)
        if status != 200:
            row.update(status="unavailable", httpStatus=status)
            out.append(row)
            continue
        digest = sha256(raw)
        row["sha256"] = digest
        try:
            doc = json.loads(raw)
        except ValueError:
            row.update(status="invalid", problems=["not JSON"])
            out.append(row)
            append_jsonl(receipts_path, row)
            continue
        fid = doc.get("forecastId")
        row["forecastId"] = fid
        prior = seen.get(fid)
        if prior and prior.get("sha256") == digest:
            row["status"] = "already-received"
            out.append(row)           # nothing new; not logged again
            continue
        problems = validate(doc)
        path = ROOT / "records" / "exports" / _safe(lab["id"]) / f"{_safe(fid or 'unknown')}.{digest[:16]}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(raw)
        row["storedAt"] = str(path.relative_to(ROOT))
        if problems:
            row.update(status="invalid", problems=problems)
        elif prior:
            row.update(status="conflict", note="same forecastId, different bytes; first receipt stays canonical",
                       canonicalSha256=prior.get("sha256"))
        else:
            entry_open = session_open(doc["entry"]["session"])
            timely = at < entry_open
            row.update(status="live" if timely else "late", entryOpen=iso(entry_open), issuedAt=doc["issuedAt"],
                       decisionSession=doc["decisionSession"], entrySession=doc["entry"]["session"],
                       exitSession=doc["exit"]["session"], taskId=doc["task"]["id"],
                       forecastType=doc["task"]["forecastType"], models=[m["id"] for m in doc["models"]],
                       assets=len(doc["forecasts"]["assets"]))
            seen[fid] = row
        append_jsonl(receipts_path, row)
        out.append(row)
    return out
