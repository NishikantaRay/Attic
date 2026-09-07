# I built persistent memory for coding agents, then spent longer trying to disprove it

Every "agent memory" tool ships with a number. Mine does too: 34% fewer input
tokens. You should not believe it, and I want to explain why, because the
interesting part of this project was not building the thing. It was finding
out how easy it is to measure it wrong.

## The problem

An agent investigates something, works it out, and that understanding lives
only in the conversation. Context fills, compaction runs, and the summary
keeps the shape of what happened but not the specifics. Next session it reads
the same files.

`CLAUDE.md` and `AGENTS.md` do not close this. They hold what you knew before
you started — conventions, setup, house style. The gap is discovery-time
knowledge: the thing the agent worked out mid-task that nobody knew to write
down in advance.

So: write findings to `.attic/items/<slug>.md`, keep a one-line index in
context, re-inject that index at every session start. Plain Markdown, no
database.

## Why the first benchmark was worthless

My first benchmark stashed an answer, then asked the question, and measured
the difference. It showed a 66% reduction.

It is close to a tautology. If the answer is already in context, of course the
agent does not go looking for it. I was measuring my own setup, not the
mechanism.

The rewrite: three sessions against a real private monorepo with auth spread
across an Express server, three clients and an Electron main process.

1. Investigate how authentication works. No code changes.
2. **Fresh session, told nothing about the first.** Add account lockout after
   five failed logins.
3. **Another fresh session.** Add a password-change endpoint.

Two arms — plugin loaded, plugin off — same prompts, same repo, same model.
Sessions 2 and 3 have to rediscover the auth flow, or use what session 1 left
behind. That is the actual question.

I committed the design before running either arm so I could not tune it
afterwards.

## The result

| Metric | No memory | With memory |
|---|---:|---:|
| Input tokens | 5,935,224 | 3,938,927 |
| Tool calls | 124 | 103 |
| Cost | $6.35 | $5.02 |
| Correctness (rubric) | 13/13 | 13/13 |

The headline is −34%, but the shape is the finding:

| Session | Delta |
|---|---:|
| 1 — investigate | −6% |
| 2 — lockout | −36% |
| 3 — password change | −43% |

Session 1 pays; later sessions collect. That is what the hypothesis predicts
and what the fixture benchmark could never show.

**Correctness tied at 13/13**, and I think that is the most useful number
here. The baseline was strong: it extracted a shared lockout module, used
atomic updates so a bcrypt pre-save hook could not re-hash the password, and
refused locked accounts *before* the password check so an attacker cannot
extend a lock by guessing. Memory did not make the agent better. It made the
same quality cheaper.

## Four measurement bugs, and what they have in common

This is the part worth your time. Every one produced a plausible number rather
than an error, which is the failure mode that gets published.

**1. The tool counted its own output as evidence.** The stats command matched
`attic:<slug>` anywhere in a transcript. The script prints
`Stashed attic:foo` when it runs, and that echoes back through tool results.
It reported 130 citations where 2 were real — a twentyfold inflation, and the
tool congratulating itself for existing. Only prose the model wrote counts
now.

**2. A path-slug bug reported zero and looked like a finding.** Transcripts
live under a slug that replaces `/`, `.` **and `_`**, and on macOS
`os.tmpdir()` returns `/var/...` while the CLI slugs the resolved
`/private/var/...`. Getting either wrong yields zero tool calls and zero
rediscovery. My first baseline run reported exactly that. Zero is not an
error; it reads as a result.

**3. Rediscovery counted reads of the memory store itself.** Reading
`.attic/INDEX.md` *is* the mechanism, not rediscovery. Counting it penalised
the arm for using the thing under test. Raw numbers said rediscovery rose 33%.
Excluding `.attic/` and normalising paths: it fell 18%.

**4. The instruction layer was not enforcing anything.** Skills declared
`allowed-tools: Bash(node:*attic.js*)`, which does not match a real invocation
with a quoted absolute path. In non-interactive sessions the model silently
hand-wrote files instead of calling the script — bypassing the credential
scan entirely. Every `plugin validate --strict` passed. Only a real
`claude plugin install` surfaced it.

The pattern: **a metric reading zero, or reading suspiciously well, deserves
more scrutiny than one reading badly.** Bugs that produce errors get fixed.
Bugs that produce flattering numbers get published.

## What software should own

The architecture principle that survived contact with reality: use the model
for judgement, software for certainty.

| Decision | Owner |
|---|---|
| Is this worth keeping? | Model |
| What does the finding say? | Model |
| Valid frontmatter, no duplicate index lines | Script |
| Does this contain a credential? | Script |
| Is the write atomic under concurrency? | Script |

The credential rule is the clearest case. "Never stash secrets" as an
instruction is a hope. As a regex that exits non-zero before writing, it is a
guarantee. When bug 4 above let the model bypass the script, that guarantee
quietly disappeared, and nothing in the test suite noticed.

Two concurrency bugs came from the same place. Two agents stashing at once
each read the same index and the second write dropped the first one's line —
eight concurrent stashes lost one or two every run. And an over-long hook
rejected rather than truncated, costing a round trip for something that is
formatting, not judgement.

## Instructions are not enforcement

The rule "check the index before re-reading a file" is in the skill. It is
injected at every session start. Rediscovery still only fell from 17 to 14.

The rule is mostly ignored, and it costs 283 tokens per session to state.
That is the honest read on prompt-level optimisation: adding a second rule
competing for the same attention makes both weaker and raises the standing
cost.

If I wanted to close that gap, the mechanism is a `PreToolUse` hook that
catches a repeat read *at the moment it happens* and injects the stashed
finding instead. Enforcement at the point of failure, not a hope stated forty
turns earlier.

## Making the tool grade itself

The stats command used to report the cost precisely and admit the benefit was
"unmeasured." Honest, useless.

It now reports how often memory was cited in the model's own replies, and
what share of file reads repeated an earlier session's read. Against the
benchmark's two arms those discriminate correctly: 8 citations and 35.7%
repeat reads with memory, 0 and 41.2% without.

Crucially it can return a negative verdict. Enough turns with no citation and
it prints `NOT EARNING ITS KEEP` and suggests turning the plugin off. **A tool
that cannot report its own failure is asking for trust it has not earned.**

## Scaling: what actually grows

An obvious objection: if you keep writing findings, does context grow forever?

No, and this was deliberate. The index is tiered — pinned items always
injected, recent ones fill the remaining budget, everything older collapses
into one line naming the counts. Measured:

| Items on disk | Injected | Context cost |
|---|---|---|
| 50 | 50 | ~1,150 tokens |
| 100 | 63 | ~1,490 |
| 1,000 | 61 | ~1,487 |
| 3,000 | 59 | ~1,483 |

It plateaus. The folder grows; the context does not.

The cost of that design is real: past ~100 items most of the store is
*reachable* rather than *present*, and the agent has to decide to search. The
collapsed summary line exists so it knows there is something to search for.

## What I will not claim

**One run, one repo, one model.** No confidence interval. On a second host
two runs of an earlier benchmark differed by more than 30 points, so treat
any single figure as a range.

**Tokens fell 34% while rediscovery fell 18%.** "Stopped re-reading the same
files" does not fully explain the saving. Some of it is the agent reaching
relevant code sooner, which my instrument cannot separate. I would rather say
that than invent a mechanism.

**It costs more when it does not help.** Measured at +2.5% on a case where
nothing relevant was stored. That case ships in the benchmark suite rather
than being omitted, and it is why there is an off switch.

**Whether it helps on *your* work is unproven.** A benchmark shows a mechanism
can work. It does not show it fires at useful moments during real work. That
needs weeks of use, and I do not have them yet.

## If you build in this space

Three things I would have wanted told to me:

**Test your instrument before your hypothesis.** I found four measurement
bugs and zero bugs in the core idea. The instrument is where the errors are,
because nobody checks it.

**Ship a case where your tool loses.** It costs you one row in a table and
buys more credibility than any percentage. It also keeps you honest when the
temptation to tune the benchmark arrives — and it does arrive.

**Make the tool able to say no.** If your stats command cannot output "turn
this off," it is marketing with a progress bar.

---

Code, benchmark method, prompts, rubric and raw results:
[github.com/NishikantaRay/Attic](https://github.com/NishikantaRay/Attic)

MIT. No network calls, no telemetry.
