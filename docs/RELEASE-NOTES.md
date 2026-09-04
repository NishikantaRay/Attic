Attic keeps what you learn out of the chat and on disk, so it survives `/compact`, `/clear` and tomorrow.

Claude Code and Codex CLI run the same skills, the same script and the same hooks.

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
Then run `/hooks` once in an interactive session to trust the three attic hooks. Codex does not run a hook it has not reviewed.

## See the difference

```
sh scripts/try-attic.sh              # Claude Code
sh scripts/try-attic.sh --host codex # Codex CLI
```

One question, asked twice against the same 26-file project, with and without the finding stashed. Measured 2026-09-04:

| | Without attic | With attic |
|---|---|---|
| Claude Code | 92,976 input tokens, 3 turns | 30,201 tokens, 1 turn |
| Codex CLI | 85,434 input tokens, 3 shell commands | 15,717 tokens, 0 commands |

Both arms answered correctly. Numbers move run to run; the direction does not. Where the attic **costs** more than it returns is documented in `docs/HONEST-NUMBERS.md` — a small attic on a short session is pure overhead, and the benchmark ships a counter-case that shows it.

## What is in this release

**Codex CLI support.** A native plugin with its own manifest, generated from the same source as the Claude build so the two cannot drift. A test fails if the committed build is stale.

**Index tiering.** Pinned items always survive, newest fill the rest, older ones collapse to one discoverable line. This fixed a real bug: the session hook used to keep the oldest entries and drop your newest work.

**New commands.** `/attic-pin`, `/attic-prune` (dry run by default, never deletes), `/attic-stats`, `/attic-git`, plus `attic.js rebuild` to regenerate a damaged index from the item files.

**Team workflow.** A union merge driver, because `INDEX.md` is append-only and conflicts on every parallel branch.

**Measurement.** Activation evals at 22/22, an automated behaviour suite that runs real sessions and grades the files they write, and a two-host benchmark.

## Fixed

- The session hook dropped your newest findings instead of the oldest.
- Concurrent stashes silently lost index lines.
- `/attic-doctor` printed `error: undefined` instead of the problems it found.
- The plugin failed to load when installed: the manifest redeclared an auto-discovered hooks file. `plugin validate --strict` passed; only a real install caught it.
- Permission grants never matched, so skills silently hand-wrote files and bypassed the credential scan.
- The secret scanner refused legitimate findings *about* credential handling, which made the plugin useless for auth work.

Full list: [CHANGELOG.md](https://github.com/NishikantaRay/Attic/blob/main/CHANGELOG.md)

## Privacy

No network calls, no telemetry, no API keys. `.attic/` is plain Markdown in your project. The script refuses to write a detected credential.
