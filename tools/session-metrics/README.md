# Session metrics

Answers one question: **is my agent setup getting better or worse?**

Not with a benchmark, but from the sessions you have already run. The data
sits in `~/.claude/projects/*.jsonl`, so this works retroactively — you get a
baseline for the past without having instrumented anything.

```sh
node report.js                     # per-project baselines and trends
node report.js --project attic     # one project
node extract.js --min-reads 5      # the raw rows, one per session
node extract.js --json             # machine-readable
```

`report.js` is what you read week to week. `extract.js` is the per-session
detail behind it.

## The metric

**Repeat-read rate**: of all the file reads in a session, what fraction were
files that session had already read.

Low means the agent held what it learned. High means it kept going back for
the same file. On a real session in this corpus, `serverManager.ts` was
opened five times.

## Why this metric and not an obvious one

Four candidates, tested against 280 real sessions:

| Candidate | Result |
|---|---|
| User corrections ("that's wrong") | **Dead.** 2 hits in 80 sessions. People don't type it. |
| Tool error rate | **Dead.** 1-3% everywhere. No discrimination. |
| Context growth | Weak. Mostly restates session length. |
| **Repeat-read rate** | **0-64% range, −0.02 correlation with session length.** |

That last number is the important one: the metric is not just measuring how
long you worked. It varies because sessions genuinely differ.

## When it will tell you something

`report.js` refuses to call a trend until it can support one:

- **4 scored sessions** in a project, with at least 2 on each side of the split
- a move of **10 percentage points or more**; anything smaller is reported as
  noise
- single-day history is labelled as within-day variation, not a trend

Below those thresholds it says how far short it is and stops. That is the
point: a metric that always has an opinion is a metric that is guessing.

Most projects will show "not enough to call a trend" for a while. Since this
reads history you have already written, the answer arrives on its own as you
keep working — there is nothing to switch on.

Scratch directories (temp dirs, benchmark runs, test fixtures) are excluded
by default, or they drown the real projects. `--include-scratch` shows them.

## Reading it honestly

**Compare a project against its own past**, never against another project. A
monorepo and a single script have honestly different rates, and cross-project
comparison is noise.

**A rate of `—` means not enough reads to score**, not a perfect session.
Under five reads, the number is reported as null rather than 0, because a
zero would read as success.

**It measures one dimension.** It says nothing about whether the work was
correct, or whether you liked the result. An agent can have a low repeat-read
rate and still be wrong.

**Sample sizes are small.** In this corpus only 13 of 280 sessions had enough
file reads to score. Treat single sessions as anecdote and look at the trend.

## What is counted

From what the agent *did*, never from prose it wrote about what it did:

- reads and edits, by resolved absolute path
- tool calls and tool errors
- token usage from the transcript's own `usage` records
- compaction events

`.attic/` and `.claude/` reads are excluded — a tool reading its own
bookkeeping is not the work, and counting it would let a tool inflate its own
numbers.

Nothing leaves your machine. No network calls, no telemetry.
