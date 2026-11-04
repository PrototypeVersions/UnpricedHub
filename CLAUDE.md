# Working on UnpricedHub

The Hub is an observer. Its credibility comes from never touching the labs and never rewriting what it received.

- Never edit or delete anything under `records/` except by appending; never rewrite a line of
  `records/receipts.jsonl` or `records/scores.jsonl`.
- Never modify the lab repositories (UnpricedX, UnpricedZ) from here, and never let the Hub choose,
  promote or tune a model.
- Never convert a forecast type (a rank is not a probability) or compare labs on non-identical tasks.
- Contract changes that alter meaning need a new schema version; keep accepting the old one.
- Tests: `python -m pytest -q tests`.
