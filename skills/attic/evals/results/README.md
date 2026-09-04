# Eval results

Committed scorecards, newest wins. Each file is the raw output of

```bash
node scripts/run-evals.js --suite activation --out skills/attic/evals/results/<date>-activation.json
```

## Baseline

| Date | Suite | Version | Accuracy | Coverage | FP rate | FN rate | Wrong skill |
|---|---|---|---|---|---|---|---|
| 2026-09-04 | activation | 1.1.0 | 100% (22/22) | 100% | 0% | 0% | 0% |
| 2026-09-04 | activation | 1.0.0 | 100% (16/16) | not tracked | 0% | 0% | 0% |

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


## v1.1 run

Six cases were added for the new skills, including two negatives that keep
pruning and pinning away from ordinary code cleanup.

Three things surfaced:

- **`act-12` misrouted twice.** A user reporting "merge conflicts in
  INDEX.md" got `attic-doctor`, because "doctor" attracts anything that
  sounds broken. Sharpening both descriptions did not fix it. The real causes
  were the name and a flag: `attic-init-team` reads as setup-only, and
  `disable-model-invocation: true` stopped it activating on its own. Renamed
  to `attic-git` and made model-invocable. That is a skill design lesson: a
  name that describes the occasion beats a name that describes the setup.
- **The runner reported 100% while four cases never ran.** Running 22
  sessions back to back trips a transient limit. The runner now retries once,
  accepts `--delay`, prints a coverage percentage, and warns loudly when any
  case fails to run. An accuracy figure that hides its denominator is worse
  than no figure.
- **A wrong verification command.** `echo "exit=$?"` after a pipe reports the
  exit of the last pipe stage, not the runner. The runner had been correct
  all along.
