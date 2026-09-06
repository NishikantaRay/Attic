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
- Date: 2026-09-06

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

| Metric | No Attic | Attic | Δ |
|---|---:|---:|---:|
| Total input tokens | 5,935,224 | 3,938,927 | −33.6% |
| Total output tokens | 65,156 | 60,919 | −6.5% |
| Tool calls | 124 | 103 | −16.9% |
| Time | 854s | 768s | −10.0% |
| Rediscovery work | 17 | 14 | −17.6% |
| Correctness | 13/13 | 13/13 | — |
| Cost | $6.35 | $5.02 | −20.9% |

Per session, input tokens:

| Session | No Attic | Attic | Δ |
|---|---:|---:|---:|
| 1 — investigate | 1,212,300 | 1,135,025 | −6.4% |
| 2 — lockout | 1,616,740 | 1,034,610 | −36.0% |
| 3 — password change | 3,106,184 | 1,769,292 | −43.0% |

Session 1 is close to a wash, as expected: nothing is stashed yet, and the
attic arm pays to write. The gap opens in sessions 2 and 3.

## What this shows, and what it does not

**Shows.** Carrying findings between sessions cut input tokens by a third and
cost by a fifth on this task, with no loss of correctness. The per-session
shape matches the hypothesis: the benefit compounds as sessions accumulate.

**Does not show.** One run of each arm, one repository, one model. No
confidence interval. Rediscovery moved 17.6% while tokens moved 33.6%, so
"stopped re-reading the same files" does not fully explain the saving — some
of it is the attic arm reaching the relevant code sooner, which this
instrument does not separate.

**Correctness was a tie.** Both arms scored 13/13. The baseline was strong:
it extracted a shared lockout module, used atomic updates so the bcrypt
pre-save hook could not re-hash the password, and refused locked accounts
before the password check. Attic did not make the agent better; it made the
same quality cheaper.

## Measurement bugs found while running this

Recorded because both would have produced a plausible-looking wrong answer.

1. **Transcript slug.** Session transcripts live under a slug that replaces
   `/`, `.` **and `_`**, and on macOS `os.tmpdir()` (`/var/…`) differs from the
   realpath (`/private/var/…`). Getting either wrong yields zero tool calls
   and zero rediscovery — which reads as a finding, not a failure. The
   baseline arm hit this; the numbers were recovered from transcripts on
   disk rather than re-run.
2. **Rediscovery counted `.attic/` reads.** Reading the attic is the
   mechanism, not rediscovery, so counting it penalised the arm for using the
   thing under test. Raw numbers said rediscovery rose 33%; excluding
   `.attic/` and normalising paths to repo-relative, it fell 17.6%.

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
