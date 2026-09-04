# Honest numbers

Attic does not publish a headline savings percentage, and this document
explains why, plus exactly what it does measure.

## Why there is no headline number

A percentage would need a baseline: the same work, same model, same session,
with and without the plugin. Agent sessions are not reproducible at that
level. The same task run twice diverges in tool calls, file reads and turn
count. Any single number derived from that would be marketing, not
measurement.

So `/attic-stats` reports what is actually observable on your machine and
refuses to extrapolate.

## What is measured exactly

From `~/.claude/projects/<project>/*.jsonl`, which Claude Code writes locally:

| Figure | Source | Exact? |
|---|---|---|
| Turns per session | count of assistant messages with usage | exact |
| Output tokens | `usage.output_tokens` | exact |
| Context per turn | `input_tokens + cache_read_input_tokens` | exact |
| Handle citations | occurrences of `attic:<slug>` in the transcript | exact |
| Compactions | summary entries in the transcript | exact |

## What is approximate

| Figure | Method | Error |
|---|---|---|
| Index injection cost in tokens | bytes ÷ 4 | typically within 10-20% |
| Held-on-disk size | byte count | exact bytes, approximate as tokens |

Anything approximate is labelled as such in the output.

## Where Attic costs more than it returns

Stated plainly, because a tool that only reports its wins is not measuring:

- **Short sessions with a small attic.** The index is injected at every
  session start. If the session ends before that knowledge is reused, it was
  pure overhead.
- **An attic that is written but never read.** If no handle is cited across
  your sessions, you are paying the injection cost for nothing. The stats
  command calls this out explicitly.
- **Single-shot tasks.** One question, one answer, no investigation. The
  plugin adds cost and returns nothing. Use `off` for this work.
- **An over-large index.** Every item added raises the standing per-session
  cost. Past the budget, older items stop being injected at all, so the cost
  plateaus but the clutter does not.

## Where it returns

- **After a compaction.** The index is re-injected, so findings survive what
  would otherwise be forgotten. This is the main win and it is structural,
  not statistical.
- **Long investigations.** Not re-reading the same five files to rebuild an
  answer already stashed.
- **New sessions on an existing project.** Starting with the index rather
  than from nothing.
- **Across a team**, when the attic is committed.

## Two hosts

The benchmark runs on Claude Code and Codex CLI. That matters for confidence:
an effect that reproduces across two different CLIs with different models is
better evidence than repeated runs against one.

They also differ in how measurable they are. Codex's input-token counts moved
by 14 tokens across three identical runs; Claude Code's moved by more than 30
percentage points between two. Where a single figure is quoted, it comes from
the Codex data, and the Claude Code numbers are given as a range.

## Reproducing

```bash
node benchmarks/run.js --host codex --runs 3   # the token benchmark
node scripts/attic-stats.js            # this project
node scripts/attic-stats.js --json     # machine-readable
node scripts/attic-stats.js --cwd /path/to/other/project
```

Read-only. No network calls, no telemetry, no API keys. The script reads
local transcript files and your `.attic/` directory, nothing else.
