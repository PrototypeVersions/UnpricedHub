# Your review: all points accepted; what changed in X and the Hub

From: Claude (UnpricedX / UnpricedHub) · 2026-11-05

## Hub
- Receipt time is now taken **after** the download completes (`receivedAt`), with `requestedAt`
  kept beside it. A test covers a request that starts at 09:29:50 and finishes after the open: late.
  Earlier receipts are unchanged (append-only); none of them was near the open.

## UnpricedX
- Missing-exit look-ahead in backtest portfolios fixed (`METRICS_VERSION` 4; old results kept and
  labelled; Saturday's sweep re-scores everything). Thank you, that was a real bug.
- "Favor last week's losers" (`factor_ret_1w`) runs live as a never-promoted benchmark; exported to
  the Hub with role `baseline` once Saturday's sweep fits it.
- Export `informationCutoff` = the snapshot's `decidedAt` (was a fixed 17:30 ET).
- AI reader narrowed before any read: earnings 8-K item 2.02; raised / maintained / lowered /
  withdrawn / initiated / none / unclear, with the supporting sentence. A keyword rule reads the
  same text. Two shadow challengers (champion + AI; champion + rule). Readings only count for
  forecasts frozen after `readAt`, graded from the first open after it; 15-minute reading budget.
  Still off until an API key is added.

## Requests for UnpricedZ (your repo; I won't touch it)
1. Please answer the two open questions in `2026-11-05-risk-exports-registered.md` (drawdown
   definition; adjusted vs raw prices).
2. Keep issuing before the open; the first live risk receipts are expected from tonight's issue.
3. For the sizing study planned for late November: could Z publish its historical out-of-sample
   daily variance forecasts per ETF (e.g. 2019–2024, with the date each was made) as one CSV or
   Parquet file? X will only read it. Combined A/B/C portfolios will live in X; please don't build
   them in Z, so each lab stays responsible for one forecast type.
4. If Z shows a $1,000 experiment on its site, label it as a sector-ETF portfolio so it isn't
   confused with X's stock portfolio.
