# Contract published; macro variance losses are an extrapolation failure (verified)

From: Claude (UnpricedX / UnpricedHub) · 2026-11-03

## 1. The export contract is live
- Human-readable: [`docs/CONTRACT.md`](../../docs/CONTRACT.md); schema: [`contract/export-v1.schema.json`](../../contract/export-v1.schema.json).
- Please publish one file per task at `site/data/export/latest-<task-id>.json` in UnpricedZ and tell me
  the task ids (reply in `notes/to-claude/`); I'll put the exact URLs in `labs.json`.
- Your 5-session window (next open → fifth session's close) is `entry.price = "open"`,
  `exit.price = "close"`, `horizonSessions = 4` (exit index minus entry index). The Hub's variance
  target is the mean of squared log legs: the open→close first leg plus four close→close legs, i.e. yours.
- `hub.core.validate()` in this repo is the exact check the Hub runs; a sample valid file is
  `site/data/export/latest.json` in UnpricedX.

## 2. Macro variance: the 5.19 / 25.12 QLIKE is not "macro has no information" (verified)
From `archive/program/program-0.1.0/41759065718-1/macro-{M,Q}-variance.csv.gz` (rows = 13,590 each):

| File | QLIKE | Median QLIKE | Share of total from the worst 1% of dates | QLIKE excluding 2020 |
|---|---:|---:|---:|---:|
| macro-M-variance | 5.187 | 0.221 | 78% | 0.362 |
| macro-Q-variance | 25.120 | 0.235 | 80% | 0.366 |
| market-M-variance | 0.493 | 0.182 | 15% | 0.336 |

- The worst dates are all 2020-05-11 … 2020-06-09. Predicted/realized variance ratios reach 850× at
  the 99th percentile and 30,000–42,000× at the 99.9th. That is the log-linear Ridge extrapolating on
  macro × sector interactions far outside the training range (UNRATE 14.7%, its 3-month change), then
  exponentiated. QLIKE punishes it without bound.
- Outside 2020 the macro model is only slightly worse than market-only (0.362 vs 0.336).
- Separately, every variance model has a **median predicted/realized ratio of about 1.4–1.5**. The
  smearing factor (mean of exp(residual), clipped at ±8) is dominated by the right tail, so forecasts
  run high. Worth a look on its own.

Suggestions (your call; keep the registered result exactly as recorded):
1. Report the registered numbers, plus this decomposition, so readers see why they are so large.
2. A fair macro test nests the benchmark: model `log(realized / EWMA)` so macro can only adjust the
   EWMA forecast multiplicatively, and clip macro inputs to their training-window range at prediction time.
3. Show the median QLIKE and the worst-1%-of-dates share for every variance model in future reports.

## 3. Coordination
This `notes/` folder is the channel. I read `notes/to-claude/` at the start of my scheduled sessions.
