"""Builds site/data/hub.json: what each lab forecast, what happened, and how the Hub graded it.

One panel per lab, never a single leaderboard. Forecasts are summarised for reading (a ranking's top
and bottom picks, a variance as a typical daily move), never converted into another forecast type.
"""
from __future__ import annotations

import math
from datetime import timedelta

import numpy as np
import pandas as pd

from .score import OPS
from .core import ROOT, iso, now, read_json, read_jsonl, write_json

PICKS = 10
METRIC_OF = {"rank-score": "ic", "event-probability": "brier", "variance": "qlike"}


def running_band(x: list[float], alpha: float = 0.05, t_opt: int = 52, prior_sd: float = 0.1, prior_n: int = 5) -> dict:
    """Asymptotic confidence sequence for a running mean (Waudby-Smith et al.), with variance shrinkage.
    The same method each lab is asked to use, so bands are comparable in kind."""
    x = np.asarray([v for v in x if v is not None and np.isfinite(v)], float)
    n = len(x)
    if n == 0:
        return {"n": 0}
    la = math.log(1 / alpha)
    rho2 = (2 * la + math.log(2 * la + 1)) / t_opt
    t = np.arange(1, n + 1)
    mean = np.cumsum(x) / t
    ss = np.array([np.sum((x[:i] - x[:i].mean()) ** 2) for i in t])
    var = (prior_n * prior_sd**2 + ss) / (prior_n + t - 1)
    r = np.sqrt(var) * np.sqrt(2 * (t * rho2 + 1) / (t**2 * rho2) * np.log(np.sqrt(t * rho2 + 1) / alpha))
    return {"n": n, "mean": mean.round(5).tolist(), "lower": (mean - r).round(5).tolist(), "upper": (mean + r).round(5).tolist()}


def _num(v, nd=5):
    return None if v is None or not np.isfinite(v) else round(float(v), nd)


def _kind(doc: dict) -> str:
    t = doc["task"]
    if t["forecastType"] == "rank-score":
        return "rank"
    if t["forecastType"] == "variance":
        return "swing"
    if t["forecastType"] == "event-probability" and t["target"]["quantity"] == "drawdown":
        return "fall"
    return "other"


def _lead(model_ids: list[str], models: list[dict]) -> str:
    """The model the lab put in charge, else its first listed model."""
    return next((m["id"] for m in models if m.get("role") == "champion"), model_ids[0] if model_ids else "")


def summarise(doc: dict, outcome: dict | None) -> tuple[dict, dict | None]:
    """What the forecast says, and (once checked) what actually happened, in display-ready form."""
    kind = _kind(doc)
    assets = doc["forecasts"]["assets"]
    values = doc["forecasts"]["values"]
    ids = list(values)
    roles = {m["id"]: m.get("role") for m in doc.get("models", [])}
    real = pd.Series((outcome or {}).get("realized", {}), dtype=float).reindex(assets) if outcome else None

    if kind == "rank":
        lead = _lead(ids, doc.get("models", []))
        s = pd.Series(values[lead], index=assets, dtype=float).dropna().sort_values(ascending=False)
        top, bottom = s.index[:PICKS].tolist(), s.index[-PICKS:][::-1].tolist()
        content = {"model": lead, "role": roles.get(lead), "count": int(s.size), "top": top, "bottom": bottom}
        if real is None:
            return content, None
        tenth = max(1, s.size // 10)
        avg = lambda names: _num(real.reindex(names).mean())
        return content, {
            "top": [_num(real.get(a)) for a in top], "bottom": [_num(real.get(a)) for a in bottom],
            "topAvg": avg(top), "bottomAvg": avg(bottom), "allAvg": avg(s.index),
            "topTenthAvg": avg(s.index[:tenth]), "bottomTenthAvg": avg(s.index[-tenth:]), "tenth": tenth,
            "best": [[a, _num(v)] for a, v in real.reindex(s.index).dropna().sort_values(ascending=False).head(3).items()],
        }

    if kind == "swing":
        # a variance forecast shown as its square root: the typical daily move, in percent
        content = {"assets": assets, "models": [{"id": m, "role": roles.get(m)} for m in ids],
                   "values": {m: [_num(math.sqrt(v) * 100, 3) if v is not None and v >= 0 else None for v in values[m]] for m in ids}}
        if real is None:
            return content, None
        return content, {"actual": [_num(math.sqrt(v) * 100, 3) if v == v and v >= 0 else None for v in real]}

    if kind == "fall":
        ev = doc["task"].get("event") or {}
        content = {"assets": assets, "threshold": ev.get("threshold"), "models": [{"id": m, "role": roles.get(m)} for m in ids],
                   "values": {m: [_num(v, 4) for v in values[m]] for m in ids}}
        if real is None:
            return content, None
        op, thr = OPS.get(ev.get("operator", ">"), np.greater), ev.get("threshold", 0)
        return content, {"actual": [_num(v, 4) for v in real], "hit": [None if v != v else bool(op(v, thr)) for v in real]}

    return {"assets": assets}, None


def next_weekday(day: str) -> str:
    d = pd.Timestamp(day) + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.date().isoformat()


def build() -> dict:
    labs = read_json(ROOT / "labs.json")["labs"]
    receipts = [r for r in read_jsonl(ROOT / "records" / "receipts.jsonl") if r.get("status") not in ("already-received", "unavailable")]
    outcomes = {o["forecastId"]: o for o in read_jsonl(ROOT / "records" / "outcomes.jsonl")}
    score_rows = read_jsonl(ROOT / "records" / "scores.jsonl")
    scores = pd.DataFrame(score_rows)
    names = {lab["id"]: lab["name"] for lab in labs}

    forecasts = []
    for r in receipts[::-1]:
        doc = read_json(ROOT / r["storedAt"]) if r.get("storedAt") else None
        item = {k: r.get(k) for k in ("forecastId", "lab", "status", "problems", "taskId", "forecastType", "decisionSession",
                                       "entrySession", "exitSession", "issuedAt", "receivedAt", "entryOpen", "sha256", "assets")}
        item["labName"] = names.get(r["lab"], r["lab"])
        if r.get("receivedAt") and r.get("entryOpen"):
            item["leadMinutes"] = int((pd.Timestamp(r["entryOpen"]) - pd.Timestamp(r["receivedAt"])).total_seconds() // 60)
        if doc and "forecasts" in doc:
            item["kind"] = _kind(doc)
            item["content"], item["outcome"] = summarise(doc, outcomes.get(r["forecastId"]))
            item["limitations"] = doc.get("limitations", [])
        grades = [s for s in score_rows if s["forecastId"] == r.get("forecastId")]
        item["grades"] = [{"model": s["model"], "role": s.get("role"), "metric": METRIC_OF.get(s["forecastType"]),
                           "value": _num(s.get(METRIC_OF.get(s["forecastType"]))), "n": s.get("n")} for s in grades]
        if r["status"] == "live" and not item.get("outcome"):
            item["due"] = next_weekday(r["exitSession"])
        forecasts.append(item)

    panels = []
    for lab in labs:
        mine = [f for f in forecasts if f["lab"] == lab["id"]]
        counts = {k: sum(1 for f in mine if f["status"] == k) for k in ("live", "late", "invalid", "conflict")}
        counts["checked"] = sum(1 for f in mine if f.get("outcome"))
        due = sorted(f["due"] for f in mine if f.get("due"))
        panel = {k: lab.get(k) for k in ("id", "name", "site", "question", "status", "note")}
        panel.update({"receipts": counts, "nextResults": due[0] if due else None, "models": []})
        if len(scores):
            sc = scores[scores["lab"] == lab["id"]].sort_values("decisionSession")
            for (task, model), g in sc.groupby(["taskId", "model"]):
                kind = g["forecastType"].iloc[0]
                col = METRIC_OF[kind]
                vals = g[col].dropna() if col in g else pd.Series(dtype=float)
                blocks = vals.iloc[::5].tolist()      # weekly, non-overlapping observations for the band
                panel["models"].append({
                    "task": task, "forecastType": kind, "model": model, "role": g["role"].iloc[-1], "metric": col,
                    "days": int(vals.size), "mean": None if vals.empty else round(float(vals.mean()), 5),
                    "band": running_band(blocks) if col == "ic" else {"n": len(blocks)},
                })
        panels.append(panel)

    out = {"updatedAt": iso(now()), "labs": panels, "forecasts": forecasts,
           "rules": ["On time means the Hub had its copy before the market opened. Anything it first sees after the open is kept but marked late, and never counts.",
                     "Each kind of forecast is graded by the measure that fits it, using prices the Hub downloads itself.",
                     "The labs answer different questions, so they are never ranked against each other.",
                     "The Hub only keeps score. It never chooses which models a lab uses."]}
    write_json(ROOT / "site" / "data" / "hub.json", out)
    return out
