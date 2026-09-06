# Attic benchmark: authentication investigation

## Hypothesis

Persistent project knowledge reduces repeated investigation across
coding-agent sessions.

## Setup

- Repository: `screen-flow` (private monorepo; Express + JWT auth spread
  across `apps/server`, `packages/ui`, `packages/cloud`, and an Electron
  main process)
- Agent: Claude Code, headless (`claude -p`)
- Model: as configured in the session; recorded in `results.json`
- Temperature: CLI default, not overridden
- Date: (filled by the runner)

Each arm runs against its own fresh copy of the repository, so neither can
see the other's edits. Sessions within an arm share that copy, which is what
makes session 2 and 3 realistic: the code has already moved on.

The baseline arm runs with `ATTIC_DEFAULT_MODE=off` and no `--plugin-dir`,
so no rules and no index reach the model. The Attic arm loads the plugin
from this repository.

## Sessions

### Session 1
Investigate authentication architecture. No code changes.

### Session 2
Fix the authentication issue: account lockout after 5 failed logins.

### Session 3
Implement the requested authentication change: user-initiated password change.

Sessions 2 and 3 are fresh: they are told nothing about session 1. Whether
anything survives is exactly what is being measured.

## Metrics

| Metric | No Attic | Attic |
|---|---:|---:|
| Total tokens | | |
| Tool calls | | |
| Time | | |
| Rediscovery work | | |
| Correctness | | |

Filled from `results.json` after the run.

### How each is measured

- **Total tokens** — from the CLI's own usage output, summed across the
  three sessions. Input counts cache reads, because they are real context.
- **Tool calls** — every tool invocation the agent made. The proxy for
  effort.
- **Time** — wall clock per session, from the CLI.
- **Rediscovery work** — file reads and searches in sessions 2 and 3 that
  touch auth files session 1 already read. This is the number the hypothesis
  actually predicts, and it is computed from the transcripts, not judged.
- **Correctness** — graded against the rubric below, from the diff and the
  final message. A cheaper wrong answer is not a win.

## Correctness rubric

Scored per session, out of the points available. Judged from the actual diff.

**Session 2 — account lockout**

| Point | Criterion |
|---|---|
| 1 | Failed attempts are counted per account and persisted |
| 1 | Lockout triggers on the 5th consecutive failure, not the 4th or 6th |
| 1 | A successful login resets the counter |
| 1 | Lockout is temporary, with an expiry, not permanent |
| 1 | Existing token verification still works unchanged |
| 1 | Integrated into the existing login path rather than a parallel mechanism |
| 1 | A test covers the lockout |

**Session 3 — password change**

| Point | Criterion |
|---|---|
| 1 | Requires the current password |
| 1 | Enforces the same rules as signup |
| 1 | Hashes the new password through the existing mechanism |
| 1 | Existing sessions/tokens keep working |
| 1 | Follows the existing route and error conventions |
| 1 | A test covers the change |

## Rule

Run once as designed. Do not tune the benchmark after seeing the result.
Whatever it shows is the finding, including "no useful difference".
