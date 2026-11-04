# UnpricedHub export contract · version 1

Each lab publishes one small JSON file per forecast session that the Hub can collect, timestamp
and rescore on its own. The Hub never edits a lab, never converts one kind of forecast into another,
and never chooses or promotes a model. Machine-readable schema: [`contract/export-v1.schema.json`](../contract/export-v1.schema.json).

## Where

Each lab serves its latest export for each task at a stable public URL listed under `exports` in
[`labs.json`](../labs.json), e.g. `https://raw.githubusercontent.com/<owner>/<repo>/main/site/data/export/latest-<task-id>.json`.
A lab with several tasks (say, variance and drawdown) publishes one file per task. A lab may also keep
dated copies; the Hub keeps its own copy of every byte it receives.

## Fields

| Field | Meaning |
|---|---|
| `schema` | Always `"unpriced-export/1"` for this version. |
| `lab` | `id` (short, stable), `name`, `repo`, `experiment` (the lab's frozen specification id), `codeCommit` (the lab's git commit that produced it, or `null` if unknown). |
| `forecastId` | Unique and stable: `<lab.id>/<decisionSession>/<task.id>`. A lab never publishes two different files with the same id. |
| `decisionSession` | Last completed NYSE session whose data the forecast used (`YYYY-MM-DD`). |
| `informationCutoff` | Latest moment of information used (ISO 8601 with offset). Usually the decision session's close; later if the lab read after-hours filings. |
| `issuedAt` | When the lab froze the forecast (ISO 8601 with offset). |
| `entry` | `{ "session": "YYYY-MM-DD", "price": "open" }`: when the forecast's position would be entered. |
| `exit` | `{ "session": "YYYY-MM-DD", "price": "open" or "close" }`. |
| `task` | `id`, plain-language `description`, and `target` (below), `forecastType`, `event` (for probabilities). |
| `universe` | `definition` (plain language) and `size` (number of assets the lab intended to forecast). |
| `models` | List of `{ id, role, artifactSha256, trainedThrough }`; role is `champion`, `challenger` or `baseline`. |
| `forecasts` | `assets` (list of tickers) and `values`: `{ <modelId>: [number or null, ...] }`, aligned with `assets`. |
| `abstained` | `[{ asset, reason }]`: assets in the universe without a forecast, with the reason. |
| `provenance` | `snapshotPath`, `snapshotSha256` (the lab's own frozen record), `inputFingerprint` (optional). |
| `limitations` | Plain-language caveats the reader must know (e.g. survivorship bias). |

### `task.target`

```json
{ "quantity": "total-return",          // or "realized-variance", "drawdown"
  "entryPrice": "open", "exitPrice": "open",   // must match entry.price / exit.price
  "horizonSessions": 5,                // exit session index minus entry session index on the NYSE calendar
  "relativeTo": "none" }               // or a benchmark ticker such as "SPY"
```

Examples: entry at the next open and exit at the open five sessions later is `5`
(UnpricedX). Entry at the next open and exit at the close of the fifth session of the holding
window is `4` (UnpricedZ: entry session plus four more). Variance targets average the squared log
returns of the window's legs: an open-to-close first leg when entry is at the open, then
close-to-close legs through the exit close.

### `task.forecastType`

- `rank-score`: larger means the lab expects a higher target than for other assets the same day.
  Only the ordering within one file is meaningful. Hub metric: daily Spearman rank correlation (IC).
- `event-probability`: probability that `target` satisfies `event` (e.g. `{"operator": ">", "threshold": 0}`).
  Hub metrics: Brier score and log loss, against the lab's declared baseline model if provided.
- `variance`: forecast of the target variance. Hub metric: QLIKE.

The Hub scores each type only with its own metric. A rank is never turned into a probability.

## What the Hub checks on every file

1. Schema and types; `forecastId` uniqueness; assets unique; values finite or `null`.
2. `informationCutoff <= issuedAt`, and the NYSE calendar puts `entry.session` after `decisionSession`.
3. **Timeliness:** the Hub's own receipt time must be before the entry session's 09:30 ET open.
   A file first seen after that is recorded as **late** and is never scored as a live forecast,
   whatever `issuedAt` says.
4. **Consistency:** `exit.session` is `horizonSessions` NYSE sessions after `entry.session`, and the
   prices named in `target` match `entry`/`exit`.
5. **Integrity:** the bytes and SHA-256 of every receipt are stored in the Hub repository; a changed file
   with an existing `forecastId` is recorded as a conflict, and the first receipt is the one scored.

## Scoring

The Hub rescores matured forecasts from its own price download (Yahoo, adjusted), recording the
data vintage it used. Its numbers can differ slightly from a lab's own scores (different data
vintages); large differences are flagged for investigation, not silently reconciled.

Results are shown per lab and per task. Labs are compared head to head only when tasks are
identical (same target, endpoints, universe and information cutoff). A combination of labs is
shown only as a separately pre-registered experiment.

## Versioning

Additive optional fields do not change the version. Anything that changes meaning does
(`unpriced-export/2`), and the Hub keeps accepting version 1 from labs that have not moved.
