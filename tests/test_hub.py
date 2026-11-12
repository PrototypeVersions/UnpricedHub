import json
import os
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))


@pytest.fixture()
def hub_root(tmp_path, monkeypatch):
    shutil.copytree(REPO / "contract", tmp_path / "contract")
    (tmp_path / "labs.json").write_text(json.dumps({"labs": [
        {"id": "stock-lab", "name": "Stock", "repo": "x", "site": "", "question": "q", "exports": ["https://example/x.json"], "status": "active"}]}))
    monkeypatch.setenv("HUB_ROOT", str(tmp_path))
    import importlib
    import hub.core, hub.collect, hub.score, hub.site_build
    for m in (hub.core, hub.collect, hub.score, hub.site_build):
        importlib.reload(m)
    return tmp_path


def export(**over):
    doc = {
        "schema": "unpriced-export/1",
        "lab": {"id": "stock-lab", "name": "Stock", "repo": "x", "experiment": "v2", "codeCommit": None},
        "forecastId": "stock-lab/2026-11-03/rank5", "decisionSession": "2026-11-03",
        "informationCutoff": "2026-11-03T16:00:00-05:00", "issuedAt": "2026-11-04T06:10:00-05:00",
        "entry": {"session": "2026-11-04", "price": "open"}, "exit": {"session": "2026-11-11", "price": "open"},
        "task": {"id": "rank5", "description": "d", "forecastType": "rank-score", "event": None,
                 "target": {"quantity": "total-return", "entryPrice": "open", "exitPrice": "open", "horizonSessions": 5, "relativeTo": "none"}},
        "universe": {"definition": "u", "size": 40},
        "models": [{"id": "m1", "role": "champion", "artifactSha256": None, "trainedThrough": None}],
        "forecasts": {"assets": [f"T{i}" for i in range(40)], "values": {"m1": [float(i) for i in range(40)]}},
        "abstained": [], "provenance": {"snapshotPath": "p", "snapshotSha256": "h"}, "limitations": [],
    }
    doc.update(over)
    return doc


class Resp:
    def __init__(self, doc):
        self.status_code = 200
        self.content = json.dumps(doc).encode()


def test_valid_export_passes_and_bad_one_fails(hub_root):
    from hub.core import validate
    assert validate(export()) == []
    bad = export(exit={"session": "2026-11-10", "price": "open"})
    assert any("sessions after entry" in p for p in validate(bad))
    bad2 = export(informationCutoff="2026-11-04T07:00:00-05:00")
    assert any("after issuedAt" in p for p in validate(bad2))


def test_receipt_after_open_is_late_and_conflicts_never_replace(hub_root, monkeypatch):
    from hub.collect import collect
    monkeypatch.setenv("HUB_NOW", "2026-11-04T09:45:00-05:00")
    rows = collect(fetch=lambda url: Resp(export()))
    assert rows[0]["status"] == "late"
    changed = export()
    changed["forecasts"]["values"]["m1"][0] = 99.0
    rows = collect(fetch=lambda url: Resp(changed))
    assert rows[0]["status"] == "conflict"


def test_receipt_before_open_is_live(hub_root, monkeypatch):
    from hub.collect import collect
    monkeypatch.setenv("HUB_NOW", "2026-11-04T08:45:00-05:00")
    assert collect(fetch=lambda url: Resp(export()))[0]["status"] == "live"
    assert collect(fetch=lambda url: Resp(export()))[0]["status"] == "already-received"


def test_scoring_rank_ic_from_hub_prices(hub_root, monkeypatch):
    from hub.collect import collect
    from hub.score import score
    from hub.core import read_jsonl
    monkeypatch.setenv("HUB_NOW", "2026-11-04T08:45:00-05:00")
    collect(fetch=lambda url: Resp(export()))
    dates = pd.bdate_range("2026-10-20", "2026-11-13")
    def fake_download(tickers, start):
        rows = []
        for t in tickers:
            i = int(t[1:])
            for k, d in enumerate(dates):
                px = 100 * (1 + 0.001 * i) ** k     # higher-numbered tickers rise faster: perfect ranking
                rows.append({"date": d, "ticker": t, "open": px, "close": px})
        return pd.DataFrame(rows)
    monkeypatch.setenv("HUB_NOW", "2026-11-13T20:40:00-05:00")
    assert score(download=fake_download) == 1
    s = read_jsonl(hub_root / "records" / "scores.jsonl")[0]
    assert s["ic"] > 0.99 and s["n"] == 40
    o = read_jsonl(hub_root / "records" / "outcomes.jsonl")
    assert len(o) == 1 and o[0]["forecastId"] == s["forecastId"] and len(o[0]["realized"]) == 40
    assert o[0]["realized"]["T39"] > o[0]["realized"]["T0"]
    assert score(download=fake_download) == 0 and len(read_jsonl(hub_root / "records" / "outcomes.jsonl")) == 1


def test_variance_target_counts_every_leg(hub_root):
    from hub.score import realized
    doc = export(task={"id": "v", "description": "d", "forecastType": "variance", "event": None,
                       "target": {"quantity": "realized-variance", "entryPrice": "open", "exitPrice": "close",
                                  "horizonSessions": 4, "relativeTo": "none"}},
                 exit={"session": "2026-11-10", "price": "close"}, forecasts={"assets": ["A"], "values": {"m1": [0.0001]}})
    dates = pd.bdate_range("2026-11-03", "2026-11-12")
    px = pd.DataFrame({"date": dates, "ticker": "A", "open": 100.0, "close": [100.0 * (1.01 ** k) for k in range(len(dates))]})
    v = realized(doc, px)["A"]
    # legs: open->close on 11-04 (log 1.01^1 ... from open 100), then four close-to-close legs of log(1.01)
    first = np.log(100 * 1.01 ** 1 / 100.0)
    expected = (first**2 + 4 * np.log(1.01) ** 2) / 5
    assert np.isclose(v, expected)


def test_drawdown_target_follows_entry_then_daily_closes(hub_root):
    from hub.score import realized
    doc = export(task={"id": "d", "description": "d", "forecastType": "event-probability",
                       "event": {"operator": ">", "threshold": 0.03},
                       "target": {"quantity": "drawdown", "entryPrice": "open", "exitPrice": "close",
                                  "horizonSessions": 4, "relativeTo": "none"}},
                 exit={"session": "2026-11-10", "price": "close"}, forecasts={"assets": ["A", "B"], "values": {"m1": [0.5, 0.5]}})
    dates = pd.bdate_range("2026-11-03", "2026-11-12")      # entry 11-04 ... exit 11-10
    closes_a = {"2026-11-04": 103.0, "2026-11-05": 104.0, "2026-11-06": 99.0, "2026-11-09": 101.0, "2026-11-10": 102.0}
    rows = []
    for d in dates:
        k = d.date().isoformat()
        rows.append({"date": d, "ticker": "A", "open": 100.0, "close": closes_a.get(k, 100.0)})
        rows.append({"date": d, "ticker": "B", "open": 100.0, "close": 100.0 - (d.day % 2)})   # never falls 3%
    v = realized(doc, pd.DataFrame(rows))
    assert np.isclose(v["A"], 1 - 99.0 / 104.0) and v["B"] < 0.03
    # a fall from the entry open to the first close counts too
    rows = [{"date": d, "ticker": "A", "open": 100.0, "close": 96.0} for d in dates]
    assert np.isclose(realized(doc, pd.DataFrame(rows))["A"], 0.04)


def test_receipt_time_is_when_the_download_finished(hub_root, monkeypatch):
    from hub.collect import collect
    monkeypatch.setenv("HUB_NOW", "2026-11-04T09:29:50-05:00")

    def slow_fetch(url):  # request starts before the open, bytes arrive after it
        monkeypatch.setenv("HUB_NOW", "2026-11-04T09:30:05-05:00")
        return Resp(export())
    row = collect(fetch=slow_fetch)[0]
    assert row["requestedAt"].startswith("2026-11-04T09:29:50")
    assert row["receivedAt"].startswith("2026-11-04T09:30:05")
    assert row["status"] == "late"
