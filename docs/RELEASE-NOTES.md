A documentation and evidence release. **Nothing about how the plugin behaves has changed** — if you are already on 1.2.0, upgrading changes nothing functional.

## The benchmark that actually tests the idea

The earlier benchmark proved something close to a tautology: if the answer is already in context, the agent does not go looking for it. So there is now a harder one.

Three sessions against a real private monorepo with auth spread across a server, three clients and an Electron process. Investigate the auth flow; then, in a **fresh session told nothing about the first**, add account lockout; then, in another fresh session, add password change. The two arms differ in one thing: whether the plugin is loaded.

| | No Attic | Attic | |
|---|---:|---:|---:|
| Input tokens | 5,935,224 | 3,938,927 | **−34%** |
| Tool calls | 124 | 103 | −17% |
| Cost | $6.35 | $5.02 | −21% |
| Correctness | 13/13 | 13/13 | tie |

The shape matters more than the total. Session 1 is a wash (−6%), session 2 saves 36%, session 3 saves 43%. The benefit compounds as sessions accumulate, which is what the idea predicts and what the old fixture benchmark could never show.

**Both arms were correct.** This did not make the agent smarter; it made the same quality cheaper.

**Limits, stated plainly.** One run of each arm, one repository, one model, no confidence interval. Tokens fell 34% while rediscovery fell only 18%, so "stopped re-reading the same files" does not fully explain the saving. The design was committed before either arm ran, so it could not be tuned to fit the result.

Two measurement bugs were found and fixed first, both of which would have produced a plausible wrong answer rather than an error — recorded in the benchmark README so nobody repeats them.

## A README you can actually read

2,437 words down to 931, reordered so it opens with the problem rather than install instructions. Commands are described from your side: "Keep this finding" rather than "stash the latest finding, result or decision". Contributor material moved to `docs/`.

New: [Quickstart](https://github.com/NishikantaRay/Attic/blob/main/docs/QUICKSTART.md) for checking it is on and seeing the difference, and [Commands](https://github.com/NishikantaRay/Attic/blob/main/docs/COMMANDS.md) for every flag and exit code.

## See the difference yourself

```sh
sh scripts/try-attic.sh
```

Builds a throwaway project with one real bug, asks the same question with and without the finding stashed, prints both answers and both token counts. Nothing outside a temp folder is touched.

## Also

A logo, a share card, and a promotional poster — all generated from source, with the poster reading its figures from the recorded benchmark results so it cannot outlive the data it cites.

## Install

**Claude Code**
```
claude plugin marketplace add NishikantaRay/Attic
claude plugin install attic@attic
```

**Codex CLI**
```
codex plugin marketplace add NishikantaRay/Attic
codex plugin add attic@attic
```

No network calls, no telemetry, no API keys.
