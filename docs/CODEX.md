# Attic on Codex CLI

Attic works on Codex. The skills, the script and the hooks are the same code;
only the packaging differs.

## Install

### Full install, with hooks (recommended)

```sh
git clone https://github.com/NishikantaRay/Attic
sh Attic/codex/install.sh          # user-wide, into $CODEX_HOME (default ~/.codex)
sh Attic/codex/install.sh --repo   # this repository only
```

The installer copies the skills, registers the three hooks in
`$CODEX_HOME/hooks.json` (merging with anything already there and backing it
up first), sets `[features] hooks = true` if your config does not already,
and installs the `attic` launcher. Re-running it does not duplicate entries.

One step it cannot do for you: putting `~/.local/bin` on your PATH. The
installer tells you whether that is already the case.

Verify:

```sh
attic --where      # prints the resolved attic.js path
attic validate     # exits 0 on a healthy or absent attic
```

### Skills only, no hooks

If you use the standard agent-skills installer:

```sh
npx skills add NishikantaRay/Attic --skill 'attic*' -a codex
```

This installs the skills to `.agents/skills/` and works, but **without the
hooks you lose automatic activation**: nothing injects the index at session
start, so you invoke the skill yourself (`$attic`) and the model reads
`.attic/INDEX.md` when it needs it. The launcher finds the script at this
path too. Use the full install if you want the attic to load on its own.

## What differs from the Claude Code build

| | Claude Code | Codex |
|---|---|---|
| Packaging | plugin marketplace, `plugin.json` | `install.sh`, no manifest |
| Skill invocation | `/attic-stash` | `$attic-stash`, or the model picks it from the description |
| Script path | `${CLAUDE_SKILL_DIR}` | `attic` on PATH |
| State directory | plugin data dir | `$CODEX_HOME/attic` |
| Frontmatter | `allowed-tools`, `argument-hint`, `disable-model-invocation` | stripped, Codex reads `name` and `description` |

Everything else, the rules, the tiered index, pin, prune, stats, the merge
driver and the credential scan, is identical.

## Hooks

Codex and Claude Code share a hook contract close enough that the scripts run
unmodified: one JSON object on stdin, and
`hookSpecificOutput.additionalContext` on stdout. Attic registers three:

| Event | Effect |
|---|---|
| `SessionStart` (`startup\|resume\|clear\|compact`) | injects the rules and `.attic/INDEX.md` |
| `UserPromptSubmit` | tracks `/attic <level>` |
| `SubagentStart` | briefs subagents so they stash rather than dump |

### Known Codex issues affecting Attic

These are Codex bugs, not Attic bugs, but they change what you should expect.

| Issue | Effect on Attic | Mitigation |
|---|---|---|
| Hooks in a repo-local `.codex/config.toml` may not fire interactively | no index injected | the installer configures at user level, which works |
| A bare `codex` that soft-restores the previous thread emits none of the documented `SessionStart` sources, so no matcher fires | the index is missing on that path | the skill tells the model to read `.attic/INDEX.md` itself when no index appears and a `.attic/` exists |
| `additionalContext` renders as a visible developer message in the transcript | the index is visible rather than silent | cosmetic; the tiered index is capped at ~6 KB so it stays small |

The middle row is why Attic does not depend solely on the hook. The index is
a file in your project: if injection fails, reading it is one command.

## Measured on Codex

Three runs per arm on `codex-cli 0.153.2`, counting real input tokens from
the CLI's own usage output:

| Case | No attic | Attic | Delta |
|---|---|---|---|
| The answer is stashed | 43,357 | 14,569 | -66.4% |
| Nothing relevant is stashed | 28,654 | 29,363 | +2.5% |

Both arms answered correctly in all six runs. On the first case the attic arm
ran no shell commands at all, against two for the arm that had to search the
repository.

```sh
node benchmarks/run.js --host codex --runs 3
```

Full method and the reasons not to over-read a single figure:
[../benchmarks/README.md](../benchmarks/README.md).

## Repository layout

There is one source of truth. The Codex build is generated from it.

| Path | What it is |
|---|---|
| `skills/`, `hooks/` | the actual skills and hooks, shared by both hosts |
| `scripts/codex/` | the only hand-written Codex-specific files: the `attic` launcher and `install.sh` |
| `codex/` | **generated output.** Committed so you can clone and install without building |

`codex/` is produced by `scripts/build-codex.js`. Never edit it by hand.

The build ships only what the skills use at runtime. `evals/` is excluded:
those are test fixtures and recorded results measured against a specific
host, so copying them into a user's skills directory would be noise at best
and misleading at worst.

```sh
npm run build:codex
```

A test fails if the committed `codex/` drifts from the source, and others
assert that no Claude-only variable or frontmatter field leaks into it. That
is what stops the two builds diverging silently.

There is no marketplace or plugin manifest in the Codex build. Those are
Claude Code concepts; Codex installs from the filesystem.

## Uninstall

```sh
sh Attic/codex/install.sh --uninstall
```

Your `.attic/` folders are left alone. The hook entries in `hooks.json` must
be removed by hand.
