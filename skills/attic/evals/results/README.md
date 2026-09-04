# Eval results

Committed scorecards, newest wins. Each file is the raw output of

```bash
node scripts/run-evals.js --suite activation --out skills/attic/evals/results/<date>-activation.json
```

## Baseline

| Date | Suite | Version | Accuracy | FP rate | FN rate | Wrong skill |
|---|---|---|---|---|---|---|
| 2026-09-04 | activation | 1.0.0 | 100% (16/16) | 0% | 0% | 0% |

### How it got there

The first run scored 87.5%. Two failures, both real:

- **act-04** "what's in the attic?" routed to `attic-recall` instead of
  `attic-index`. Both descriptions claimed the phrase. Fixed by splitting
  them on topic: a question naming a topic is recall, a question about
  contents as a whole is index.
- **amb-03** "summarise what we've done so far" activated nothing. It is the
  sweep trigger. Fixed by naming session-recap phrasings in the sweep
  description.

A third case, **act-08**, then failed and the model was right: a multi-file
investigation is governed by the always-on rules injected at session start,
not by invoking a skill. The expectation was wrong, so the case was corrected
and now records `governed_by` instead. Behaviour there is covered by
`behavior.json` case `beh-01`.

Regression rate is measured against this table. A drop needs a fix or a
documented reason before release.
