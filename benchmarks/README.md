# Benchmark

## What this measures, and what it does not

You cannot A/B an agent session cleanly. The same prompt takes different tool
calls each run, so any single "Attic saves X%" figure is noise dressed as a
result.

So this measures one narrow, reproducible thing:

> Given knowledge that already exists, how many input tokens does a session
> need to answer a question about it, with and without the attic?

- **Arm A (no attic)**: the model finds the answer by reading a fixture repo.
- **Arm B (attic)**: the answer is already stashed and injected at session start.

Both arms answer the same question against the same fixture. Correctness is
graded, because a cheaper wrong answer is not a win.

```bash
node benchmarks/run.js --runs 3                 # Claude Code (default)
node benchmarks/run.js --host codex --runs 3    # Codex CLI
node benchmarks/run.js --case cold-attic --runs 3
node benchmarks/run.js --runs 5 --json --out results.json
```

Each host has an adapter that knows how to launch it headlessly, how to turn
the attic on and off, and how to read its usage numbers. On Claude Code the
attic arm loads the plugin with `--plugin-dir`. Codex has no equivalent flag,
so the attic arm receives the index exactly as the SessionStart hook would
deliver it, prepended to the prompt. Both isolate the same variable: whether
the knowledge is already in context.

Token counts come from the CLI's own usage output, not an estimate.

## Results, 2026-09-04

Two independent runs of 3 samples per arm, same machine, same day.

### cache-ttl — the answer is stashed

| Run | No attic (median input) | Attic | Delta | Correct |
|---|---|---|---|---|
| 1 | 90,263 | 30,163 | **-66.6%** | 3/3 both arms |
| 2 | 90,272 | 60,687 | **-32.8%** | 3/3 both arms |

### cold-attic — the stashed item is irrelevant

| Run | No attic (median input) | Attic | Delta | Correct |
|---|---|---|---|---|
| 1 | 57,698 | 60,428 | **+4.7%** | 3/3 both arms |
| 2 | 86,946 | 60,430 | -30.5% | 3/3 both arms |

### Codex CLI, 2026-09-04

Three runs per arm, `codex-cli 0.153.2`.

| Case | No attic (median input) | Attic | Delta | Correct |
|---|---|---|---|---|
| cache-ttl (answer stashed) | 43,357 | 14,569 | **-66.4%** | 3/3 both arms |
| cold-attic (nothing relevant) | 28,654 | 29,363 | **+2.5%** | 3/3 both arms |

The attic arm ran **zero** shell commands on `cache-ttl`, against two for the
arm that had to search the repo. That is the mechanism: the answer was
already in context, so there was nothing to look up.

**Codex is far more reproducible than Claude Code here.** Across three runs
the attic arm's input spanned 14 tokens (14,562-14,576) and the no-attic arm
156. Compare the Claude Code table above, where two runs of the same
benchmark differed by more than 30 percentage points. The Codex numbers can
be read at face value in a way the Claude Code ones cannot.

One outlier: `cold-attic` run 3 used 44,262 input tokens against ~29,360 for
the other two, because the model took a second turn. It still answered
correctly. Medians are reported throughout for exactly this reason; the mean
for that cell would have been 34,328 and would have misrepresented the
typical run.

## Reading these honestly

**The variance is larger than the effect in the counter-case.** `cold-attic`
went from a 4.7% loss to a 30.5% win between two runs of the same code. That
is not Attic working; that is the no-attic arm happening to read more files on
one run. Do not quote a single number from this table.

**What the data does support:**

- When the answer is stashed, the attic arm consistently uses fewer input
  tokens and fewer turns. Every run on both hosts agrees on direction, and
  the arm that read files always cost more.
- The effect reproduces across two independent agent CLIs with different
  models, which is stronger evidence than repeated runs on one host.
- Correctness never degraded: 12 of 12 sampled runs answered correctly across
  both arms and both cases.
- The attic arm's cost is stable (~30k-60k) because it does not depend on how
  much the model decides to read. The no-attic arm's cost is not.

**What it does not support:**

- Any headline percentage. The honest statement is "fewer input tokens when
  the answer is already stashed, by an amount that varies with how much
  reading the alternative required."
- Whole-session savings. This measures one question, not a working day.

**Where Attic costs you**, confirmed by `cold-attic` run 1: an index injected
into a session that never uses it is pure overhead. See
[../docs/HONEST-NUMBERS.md](../docs/HONEST-NUMBERS.md).

## Sample size

Three runs per arm is small. It is enough to establish direction and to catch
a correctness regression; it is not enough for a confidence interval. Raw
per-run samples are in `results/`.
