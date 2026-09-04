# Attic on Codex CLI

Attic works on Codex. The skills, the script and the hooks are the same code;
only the packaging differs.

## Install

Attic is a native Codex plugin. Two commands:

```sh
codex plugin marketplace add NishikantaRay/Attic
codex plugin add attic@attic
```

That installs all eleven skills into the plugin cache. Skills work
immediately: `$attic-stash`, `$attic-recall` and the rest, and the model can
pick them from their descriptions.

### The one-time trust step for hooks

Automatic activation, meaning the index injected at every session start and
after every compaction, runs through hooks. **Codex does not run a hook until
you have reviewed and trusted it.** This applies to plugin-bundled hooks too,
and there is no command-line way to grant it.

Open an interactive session and run:

```
/hooks
```

Review the three attic hooks (`SessionStart`, `UserPromptSubmit`,
`SubagentStart`) and trust them. Trust is recorded against the hook's hash,
so a changed hook asks again after an upgrade.

Until you do this, the attic still works, but the index is not injected on
its own: the skill tells the model to read `.attic/INDEX.md` when none
appears in context, so nothing is lost, just less automatic.

### If plugin hooks do not fire for you

On `codex-cli 0.153.2` I could not observe plugin-bundled hooks executing in
non-interactive `codex exec`, even with trust bypassed, while the same hooks
registered at user level did. If `/hooks` shows the attic hooks as trusted
and the index still does not appear, register them at user level instead:

```sh
sh Attic/codex/install.sh --hooks-only
```

That writes the hooks to `$CODEX_HOME/hooks.json` (merging with anything
already there, backing it up first), enables `[features] hooks = true`, and
leaves the plugin's skills untouched. Run `/hooks` once more to trust them.

### Without the plugin system

```sh
sh Attic/codex/install.sh          # skills + hooks + launcher, user-wide
sh Attic/codex/install.sh --repo   # this repository only
npx skills add NishikantaRay/Attic --skill 'attic*' -a codex   # skills only
```

The first two install skills into `$CODEX_HOME/skills` and register user-level
hooks. The last installs skills only, to `.agents/skills/`, with no
automatic activation.

### What was verified, and how

| Claim | Evidence |
|---|---|
| Plugin installs from the marketplace | `codex plugin add attic@attic` on 0.153.2, cache at `~/.codex/plugins/cache/attic/attic/1.2.0` |
| All 11 skills load from the plugin | the model listed all eleven `attic:*` skills |
| `$attic-stash` writes through the script | item has script-rendered frontmatter; `attic validate` passes |
| User-level hooks deliver the index | with trust bypassed, the model quoted the injected index line verbatim without running a command |
| `off` suppresses injection | same run with `ATTIC_DEFAULT_MODE=off` reported nothing in context |
| Plugin-bundled hooks fire in `codex exec` | **not observed**, see above |
| `/hooks` trust flow | **not verifiable headlessly**; it is interactive by design |

## What differs from the Claude Code build

| | Claude Code | Codex |
|---|---|---|
| Packaging | `.claude-plugin/plugin.json`, Claude marketplace | `.codex-plugin/plugin.json`, Codex marketplace |
| Skill invocation | `/attic-stash` | `$attic-stash`, or the model picks it from the description |
| Script path | `${CLAUDE_SKILL_DIR}` | a resolver line in each skill locates `attic.js` in the plugin cache, user skills, or `.agents/skills` |
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

The Codex build carries its own manifest, `.codex-plugin/plugin.json`, and
the repository root carries `.agents/plugins/marketplace.json` so the repo
itself is a Codex marketplace. Both are generated from the Claude manifest
and a test keeps their versions in step.

## Uninstall

```sh
sh Attic/codex/install.sh --uninstall
```

Your `.attic/` folders are left alone. The hook entries in `hooks.json` must
be removed by hand.
