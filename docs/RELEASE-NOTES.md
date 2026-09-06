Two things, both about the same question: **how would you know whether any of this is helping?**

## /attic-stats now measures the return, not just the cost

It used to report what the index cost and then admit the benefit was "unmeasured" — honest, but no use to someone deciding whether to keep it on. It now reports two numbers that answer the question:

- **Cited in replies** — how often the agent answered from the attic instead of re-reading
- **Repeat file reads** — the share of reads that repeated an earlier session's read, which is the thing the plugin exists to reduce

Against the two arms of the benchmark those numbers discriminate correctly: the Attic arm shows 8 citations and 35.7% repeat reads, the baseline 0 and 41.2%.

**It can now say no.** After enough turns with no citation it prints `NOT EARNING ITS KEEP` and suggests `/attic off`. A tool that cannot report its own failure is asking for trust it has not earned.

### Two bugs behind that

Both produced a flattering or empty answer rather than an error, which is the dangerous kind.

**It was counting its own output as evidence.** Citations were matched anywhere in a transcript, so the script's own `Stashed attic:x` lines echoing back through tool results counted as use. It reported 130 where 2 were real — the tool congratulating itself for running.

**Any project path containing an underscore got no measurement at all.** The transcript lookup slug replaces `_` as well as `/` and `.`, and on macOS a `/var` path resolves to `/private/var`. Both cases reported "no transcripts found", which reads as "nothing to measure" rather than a lookup failure.

## A new tool: session metrics

`tools/session-metrics/` answers a broader question — *is my agent setup getting better?* — from transcripts you have already written. Nothing to instrument, and it works retroactively, so you get a baseline for the past for free.

```sh
node tools/session-metrics/report.js     # per-project baselines and trends
node tools/session-metrics/extract.js    # the raw per-session rows
```

The metric is the **repeat-read rate**: of all file reads in a session, what fraction were files that session had already read. Chosen after testing four candidates against 280 real sessions. User corrections are a dead end (2 hits in 80 sessions — people do not type "that is wrong"). Tool error rates sit at 1-3% everywhere and do not discriminate. Context growth mostly restates session length. Repeat-read rate ranges 0-64% with −0.02 correlation to session length, so it measures the work rather than its duration.

**It refuses to guess.** A trend needs 4 scored sessions, 2 on each side of the split, and a move of at least 10 points. Below that it says how far short it is and stops. On a fresh corpus that means it will mostly say "not enough to call a trend yet" — which is the correct answer, not a disappointing one.

This is a separate tool, not part of the plugin: it measures every project whether or not Attic is installed.

## Upgrading

Nothing about how the plugin behaves during your work has changed. The `.attic/` format is untouched.

```
claude plugin marketplace add NishikantaRay/Attic
claude plugin install attic@attic
```

```
codex plugin marketplace add NishikantaRay/Attic
codex plugin add attic@attic
```

No network calls, no telemetry, no API keys.
