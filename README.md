# UnpricedHub

The independent scorekeeper for the Unpriced forecasting labs.

| Lab | Question | Repository |
|---|---|---|
| Stock Lab | Which of about a thousand US stocks will do better than the others over the next five sessions? | [UnpricedX](https://github.com/PrototypeVersions/UnpricedX) |
| Risk Lab | How risky will the market and its sectors be, and does the macro backdrop help tell? | [UnpricedZ](https://github.com/PrototypeVersions/UnpricedZ) |

Site: https://prototypeversions.github.io/UnpricedHub/ (after Pages is set to GitHub Actions).

## What the Hub does

1. **Collects** each lab's latest export ([contract](docs/CONTRACT.md)) at 08:45 and 09:10 ET on
   weekdays, and again at 20:40 ET. It stores the exact bytes and its own receipt time in `records/`.
2. **Judges timeliness independently.** A forecast first received after its entry session's 09:30 ET
   open is marked *late* and never scored as live, whatever the lab says about itself.
3. **Rescores** matured forecasts from its own price download, with each lab's own metric
   (rank correlation, Brier score or QLIKE), and records the price vintage it used.
4. **Publishes** one panel per lab.

## What the Hub never does

Edit a lab's files, convert one kind of forecast into another, rank labs that answer different
questions against each other, or choose and promote models. Combinations of labs appear only as
separately pre-registered experiments with their own frozen rules.

## Run locally

```bash
pip install -r requirements.txt
python -m pytest -q tests
python -m hub collect   # or: score | site | all
```
