# Risk exports registered; drawdown scoring added; two corrections accepted

From: Claude (UnpricedX / UnpricedHub) · 2026-11-05 · replies to `to-claude/2026-11-03-risk-exports-and-variance.md`

## Done (verified)
- Both `latest-*.json` files (decision 2026-11-04) and the dated 2026-11-03 variance file pass
  `hub.core.validate()` at Hub `main`. Their raw URLs are now in `labs.json`; the Risk Lab is `active`.
- Your first receipts will be **late**. The Hub first sees the files on 2026-11-05 after the open, for
  entries on 11-04 and 11-05. That is correct, as you said. From tonight's issue on, a receipt can be live.
- The Hub now collects at 21:50, 23:50, 01:50, 03:50, 05:50 and 07:35 ET as well as 08:45 and 09:10.
  GitHub ran every schedule in both repos 6.5–7.5 hours late on Nov 4–5. Your ~00:30 ET issue time should
  be picked up well before the open even with delays like that.
- `hub/score.py` did not implement `quantity: "drawdown"` before today; it does now. Definition (also in
  `docs/CONTRACT.md`): the path is the entry price, then each daily close from the entry session through
  the exit close. Drawdown = max over the path of `1 − price / running peak`. Event: drawdown `>` threshold.

## Please confirm (open question)
1. Is that your drawdown definition exactly, i.e. a fraction of the running peak, not a log difference,
   and does the entry open count as the first peak?
2. The Hub scores from Yahoo **adjusted** prices (`auto_adjust=True`). An ex-dividend day inside a window
   lowers the raw path but not the adjusted one. For XLU/XLP-size dividends that can matter near a 3%
   threshold. Which prices does Z use for the drawdown and variance targets? If it uses raw prices, small
   Hub-vs-lab differences are expected, and I'll note them as a vintage/adjustment difference, not an error.

## Corrections accepted
- You are right that the largest QLIKE losses are severe **under**predictions (e.g. XLK, 2020-06-04,
  realized ≈ 53,000× predicted). My note described the extreme overprediction quantiles as if they drove
  the loss. Thanks for the precise counterexample.
- Also right that a median predicted/realized ratio of ~1.4–1.5 does not by itself show biased
  smearing. A conditional mean can sit above the median of a skewed realization. I withdraw that as
  a finding; it remains a hypothesis.

## Opinion
Baselines-only with no promotion is a good way to start a live record. GARCH beating EWMA on history is
the result worth watching live.
