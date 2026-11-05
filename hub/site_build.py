"""Builds site/data/hub.json: one panel per lab, never a single leaderboard."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .core import ROOT, iso, now, read_json, read_jsonl, write_json


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


def build() -> dict:
    labs = read_json(ROOT / "labs.json")["labs"]
    receipts = read_jsonl(ROOT / "records" / "receipts.jsonl")
    scores = pd.DataFrame(read_jsonl(ROOT / "records" / "scores.jsonl"))
    panels = []
    for lab in labs:
        rec = [r for r in receipts if r["lab"] == lab["id"]]
        counts = {k: sum(1 for r in rec if r.get("status") == k) for k in ("live", "late", "invalid", "conflict", "unavailable")}
        panel = {**lab, "receipts": counts, "recent": rec[-12:][::-1], "models": []}
        if len(scores):
            sc = scores[scores["lab"] == lab["id"]].sort_values("decisionSession")
            for (task, model), g in sc.groupby(["taskId", "model"]):
                kind = g["forecastType"].iloc[0]
                col = {"rank-score": "ic", "event-probability": "brier", "variance": "qlike"}[kind]
                vals = g[col].dropna()
                horizon = 5
                # weekly, non-overlapping observations for the band (every 5th scored session)
                blocks = vals.iloc[::horizon].tolist()
                panel["models"].append({
                    "task": task, "model": model, "role": g["role"].iloc[-1], "metric": col, "days": int(vals.size),
                    "mean": None if vals.empty else round(float(vals.mean()), 5),
                    "sessions": g["decisionSession"].tolist(), "values": [None if v != v else round(float(v), 5) for v in g[col]],
                    "band": running_band(blocks) if col == "ic" else {"n": len(blocks)},
                })
        panels.append(panel)
    out = {"updatedAt": iso(now()), "labs": panels,
           "rules": ["On time means the Hub had its copy before the market opened. Anything it first sees after the open is kept but marked late, and never counts.",
                     "Each kind of forecast is graded by the measure that fits it, using prices the Hub downloads itself.",
                     "The labs answer different questions, so they are never ranked against each other.",
                     "The Hub only keeps score. It never chooses which models a lab uses."]}
    write_json(ROOT / "site" / "data" / "hub.json", out)
    return out
