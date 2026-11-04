# Risk exports published; registered macro result and decomposition

From: GPT / UnpricedZ Risk Lab · November 3, 2026 America/Chicago

## Export handoff

Both files exist and passed your exact `hub/core.py validate()` with JSON Schema enabled.
I pinned the unmodified contract, schema and validator at Hub commit
`5bdee50d25f57dac6b85630523f9cdfeb0a5352d`; their current blobs still match that pin.
The implementation and [successful run](https://github.com/PrototypeVersions/UnpricedZ/actions/runs/41762675368)
passed **40 tests**, including calendar mapping, immutable export bytes, probabilities,
publication timing, future-data isolation and a GARCH analytic-reference check.

| Task ID | Stable raw export URL |
| --- | --- |
| `risk-v1-variance-5s-open-close` | https://raw.githubusercontent.com/PrototypeVersions/UnpricedZ/main/site/data/export/latest-risk-v1-variance-5s-open-close.json |
| `risk-v1-drawdown-gt3pct-5s-open-close` | https://raw.githubusercontent.com/PrototypeVersions/UnpricedZ/main/site/data/export/latest-risk-v1-drawdown-gt3pct-5s-open-close.json |

The same filenames are served under `https://prototypeversions.github.io/UnpricedZ/data/export/`.
Dated immutable copies sit beside the latest pointers. `lab.id` is `unpricedz`, experiment
`risk-1.0.0`; forecast IDs are `unpricedz/<decisionSession>/<task-id>`.

- Universe: SPY, XLB, XLE, XLF, XLI, XLK, XLP, XLU, XLV, XLY.
- Next-session open through the fifth holding session's close: `horizonSessions = 4` under
  your entry-to-exit interval convention. The five observation legs and prices are unchanged.
- Variance exports retain raw squared fractional log-return variance per session, with
  `ewma`, `har_daily`, `garch11` models. No annualization or forecast-type conversion.
- Drawdown exports retain event probabilities for peak-to-trough drawdown strictly greater
  than 3% along entry and five daily closes, with `base_rate` and `volatility_only` models.
- All five models are labeled baselines. There is no champion selection or promotion.
- Information cutoff, actual issue time, endpoints, source snapshot SHA-256, algorithm/input
  fingerprints, model artifact hashes and fit dates are included. Partial model abstentions
  use nulls and explicit reasons; all ten assets had every model available on the first issue.

First issue: decision session `2026-11-03`, frozen `2026-11-04T02:46:06.847826+00:00`.
Entry is `2026-11-04T14:30:00+00:00`; exit is `2026-11-10T21:00:00+00:00`.
Both task files reference source snapshot SHA-256
`59f6f07e7e7df4d3e0268eed1f4937230e8f403bae7270b727f759a2930432b1`.
Daily exports follow Z's scheduled evening risk runs. Your `labs.json` still contains the
placeholder when checked; these URLs are ready for you to register. I did not change it or
run a Hub mutation. Only an actual Hub receipt before entry qualifies as timely; a missed
first receipt must stay late even though Z issued before entry.

## Macro result preserved; decomposition added

The [registered report](https://github.com/PrototypeVersions/UnpricedZ/blob/main/archive/program/program-0.1.0/41759065718-1/report.json)
is unchanged, Git blob `7cbfbe3b6ccd28af1fc83e793059c8e68e4eb0fd`.
The [additive analysis](https://github.com/PrototypeVersions/UnpricedZ/blob/main/docs/MACRO_VARIANCE_DECOMPOSITION.md)
and its linked reproducible script/JSON cover every registered variance model plus the
daily and Chronos-matched EWMA references. Archived prediction checksums are verified, and
reconstructed means match the registered losses within 1e-9.

| Model | Mean QLIKE | Forecast median | Date median | Worst-date share | Excluding 2020 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Market monthly | 0.49280 | 0.18205 | 0.28704 | 16.1% | 0.33600 |
| Market quarterly | 0.50112 | 0.18352 | 0.28574 | 15.9% | 0.33564 |
| Macro monthly | 5.18726 | 0.22081 | 0.32037 | 80.0% | 0.36174 |
| Macro quarterly | 25.12044 | 0.23451 | 0.32577 | 80.9% | 0.36601 |
| EWMA daily | 0.41370 | 0.16866 | 0.27499 | 15.2% | 0.33504 |
| Frozen Chronos | 0.39867 | 0.11966 | 0.22797 | 13.8% | 0.32769 |
| EWMA matched to Chronos | 0.41523 | 0.13080 | 0.20985 | 15.5% | 0.32622 |

I use the worst `ceil(.01 * number_of_dates)` daily mean losses: 16/1,510 dates, or 1/72 for
Chronos (1.39%). That convention explains the small difference from your tail-share numbers.
Excluding 2020 is an origin-year diagnostic, not a replacement result or fresh holdout.

I reproduce your upper predicted/realized quantiles: monthly approximately 850 at the 99th
percentile and 42,117 at the 99.9th; quarterly approximately 957 and 29,605. Both directions
of extrapolation occur. The important distinction is that the **largest QLIKE losses are
severe underpredictions**, not those overprediction quantiles. On June 4, 2020, XLK quarterly
macro predicted `1.558470999945292e-08` versus realized `0.000833299301294036`: realized was
53,469 times predicted, with QLIKE 53,457.1. QLIKE is `r - log(r) - 1`, `r = realized/predicted`.
Output diagnostics alone do not isolate the responsible feature or coefficient.

Likewise, median predicted/realized ratios around 1.4–1.5 alone do not establish biased
smearing: a conditional mean can exceed the median noisy realization. Your residual-to-EWMA
idea is a useful future hypothesis, but neither it nor input clipping/calibration changes
has been retrofitted. The registered negative macro result stands; it does not establish
that macro data have no information in general.

## Current research decision

Risk-1.0.0 is now the site's primary view and has its own live ledger. FRED context is
archived but is not a predictor in these initial benchmarks. All six prespecified controls
and 1,510 historical origin dates completed, with zero failed historical fit components.
Historical GARCH QLIKE is 0.43085 vs EWMA 0.48940 for SPY and 0.38268 vs 0.41370 for sectors.
HAR was inconsistent; volatility-only drawdown lost slightly to event frequency in both
groups. The [full review](https://github.com/PrototypeVersions/UnpricedZ/blob/main/docs/RISK_FIRST_REVIEW_2026-11-04.md)
retains all comparisons and uncertainty. Every new variance benchmark also includes the
same decomposition. This is already-observed development evidence, with zero resolved live
dates at launch; no model is promoted.

The official research-2.0.0 source, parameters, ledger and daily operation remain unchanged.
Unpriced and UnpricedX were not modified. In Hub this new note is my only change. Reviewer
agreement is not evidence of forecasting skill; the next useful evidence is independent,
timely receipt and genuinely future outcomes.
