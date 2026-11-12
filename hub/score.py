"""Rescore matured live forecasts from the Hub's own price download.

Each forecast type is scored only with its own metric:
  rank-score        -> Spearman rank correlation with the realized target (one number per forecast day)
  event-probability -> Brier score and log loss
  variance          -> QLIKE
Results are appended once per (forecastId, model) to records/scores.jsonl with the price vintage used.
What actually happened to each asset (the realized target) is appended once per forecastId to
records/outcomes.jsonl, so the public site can show forecasts next to outcomes.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .core import ROOT, append_jsonl, iso, now, read_json, read_jsonl, sessions, sha256

OPS = {">": np.greater, ">=": np.greater_equal, "<": np.less, "<=": np.less_equal}


def download_prices(tickers: list[str], start: str) -> pd.DataFrame:
    import yfinance as yf
    frames = []
    for i in range(0, len(tickers), 100):
        chunk = tickers[i:i + 100]
        raw = yf.download(chunk, start=start, interval="1d", auto_adjust=True, actions=False,
                          group_by="ticker", threads=True, progress=False, timeout=30)
        if raw is None or raw.empty:
            continue
        for t in chunk:
            try:
                sub = raw[t] if isinstance(raw.columns, pd.MultiIndex) else raw
            except KeyError:
                continue
            sub = sub.dropna(how="all")
            if sub.empty:
                continue
            idx = pd.DatetimeIndex(sub.index)
            idx = idx.tz_localize(None) if idx.tz is not None else idx
            frames.append(pd.DataFrame({"date": idx.normalize(), "ticker": t, "open": sub["Open"].to_numpy(),
                                        "close": sub["Close"].to_numpy()}))
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["date", "ticker", "open", "close"])


def realized(doc: dict, px: pd.DataFrame) -> pd.Series:
    """Target per asset from the Hub's prices; NaN where data are missing (the asset is skipped)."""
    t = doc["task"]["target"]
    ent, ex = pd.Timestamp(doc["entry"]["session"]), pd.Timestamp(doc["exit"]["session"])
    o = px.pivot(index="date", columns="ticker", values="open")
    c = px.pivot(index="date", columns="ticker", values="close")
    get = {"open": o, "close": c}
    if ent not in o.index or ex not in o.index:
        return pd.Series(dtype=float)
    p0, p1 = get[t["entryPrice"]].loc[ent], get[t["exitPrice"]].loc[ex]
    if t["quantity"] == "total-return":
        r = p1 / p0 - 1
        if t["relativeTo"] not in ("none", "", None):
            bench = t["relativeTo"]
            r = r - (r.get(bench, np.nan) if bench in r.index else np.nan)
        return r
    if t["quantity"] == "realized-variance":
        # mean squared log return over the holding window's legs: an open-to-close first leg when entry
        # is at the open, then close-to-close legs through the exit close
        window = c.loc[ent:ex]
        legs = np.log(window / window.shift(1)).iloc[1:]
        sq, count = legs.pow(2).sum(min_count=1), legs.notna().sum()
        if t["entryPrice"] == "open":
            first = np.log(c.loc[ent] / o.loc[ent])
            sq, count = sq + first.pow(2), count + first.notna()
        return sq / count.replace(0, np.nan)
    if t["quantity"] == "drawdown":
        # largest peak-to-trough fall, as a fraction of the peak, along the entry price and then every
        # daily close of the holding window through the exit close
        path = pd.concat([get[t["entryPrice"]].loc[[ent]], c.loc[ent:ex]], ignore_index=True)
        dd = (1 - path / path.cummax()).max()
        return dd.where(path.notna().all())
    return pd.Series(dtype=float)


def metric(doc: dict, values: pd.Series, outcome: pd.Series) -> dict:
    ok = values.notna() & outcome.notna()
    v, y = values[ok].astype(float), outcome[ok].astype(float)
    kind = doc["task"]["forecastType"]
    if ok.sum() < (30 if kind == "rank-score" else 3):
        return {"n": int(ok.sum()), "status": "too-few-assets"}
    if kind == "rank-score":
        return {"n": int(ok.sum()), "ic": float(v.rank().corr(y.rank()))}
    if kind == "event-probability":
        ev = doc["task"].get("event") or {"operator": ">", "threshold": 0}
        hit = OPS[ev["operator"]](y, ev["threshold"]).astype(float)
        p = v.clip(1e-6, 1 - 1e-6)
        return {"n": int(ok.sum()), "brier": float(((p - hit) ** 2).mean()),
                "logLoss": float(-(hit * np.log(p) + (1 - hit) * np.log(1 - p)).mean())}
    if kind == "variance":
        ratio = y.clip(lower=1e-10) / v.clip(lower=1e-10)
        return {"n": int(ok.sum()), "qlike": float((ratio - np.log(ratio) - 1).mean())}
    return {"status": "unknown-type"}


def score(download=download_prices) -> int:
    receipts = [r for r in read_jsonl(ROOT / "records" / "receipts.jsonl") if r.get("status") == "live"]
    done = {(s["forecastId"], s["model"]) for s in read_jsonl(ROOT / "records" / "scores.jsonl")}
    seen = {o["forecastId"] for o in read_jsonl(ROOT / "records" / "outcomes.jsonl")}
    today = pd.Timestamp(now().date())
    mature = [r for r in receipts if pd.Timestamp(r["exitSession"]) < today
              and (r["forecastId"] not in seen or any((r["forecastId"], m) not in done for m in r.get("models", [])))]
    if not mature:
        return 0
    docs = [(r, read_json(ROOT / r["storedAt"])) for r in mature]
    tickers = sorted({a for _, d in docs for a in d["forecasts"]["assets"]} |
                     {d["task"]["target"]["relativeTo"] for _, d in docs if d["task"]["target"]["relativeTo"] not in ("none", "")})
    start = (min(pd.Timestamp(d["entry"]["session"]) for _, d in docs) - pd.Timedelta(days=10)).date().isoformat()
    px = download(tickers, start)
    vintage = sha256(px.sort_values(["ticker", "date"]).to_csv(index=False, float_format="%.6g").encode())[:16]
    n = 0
    for r, d in docs:
        y = realized(d, px)
        if y.empty:
            continue
        if r["forecastId"] not in seen:
            ys = y.reindex(d["forecasts"]["assets"])
            append_jsonl(ROOT / "records" / "outcomes.jsonl", {
                "forecastId": r["forecastId"], "lab": r["lab"], "taskId": d["task"]["id"],
                "quantity": d["task"]["target"]["quantity"], "entrySession": d["entry"]["session"],
                "exitSession": d["exit"]["session"],
                "realized": {a: (None if v != v else float(f"{v:.6g}")) for a, v in ys.items()},
                "scoredAt": iso(now()), "priceVintage": vintage})
            seen.add(r["forecastId"])
        for mid, vals in d["forecasts"]["values"].items():
            if (r["forecastId"], mid) in done:
                continue
            role = next((m["role"] for m in d["models"] if m["id"] == mid), None)
            res = metric(d, pd.Series(vals, index=d["forecasts"]["assets"], dtype=float), y.reindex(d["forecasts"]["assets"]))
            append_jsonl(ROOT / "records" / "scores.jsonl", {
                "forecastId": r["forecastId"], "lab": r["lab"], "taskId": d["task"]["id"], "model": mid, "role": role,
                "decisionSession": d["decisionSession"], "entrySession": d["entry"]["session"], "exitSession": d["exit"]["session"],
                "forecastType": d["task"]["forecastType"], **res, "scoredAt": iso(now()), "priceVintage": vintage})
            n += 1
    return n
