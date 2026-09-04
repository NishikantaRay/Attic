# Changelog

All notable changes to Attic. Versions follow semver: the on-disk `.attic/`
format is a public interface, so changing it is a major version.

## [Unreleased]

### Added

- A promotional poster. `scripts/make-poster.js` emits a 1200x1600 portrait
  and a 1200x630 social card, both reading their figures from
  `benchmarks/results/` and the eval results, so the poster cannot outlive
  the data it cites. It shows the counter-case too: with nothing relevant
  stashed the attic costs more, and the poster says so rather than hiding it.
- A logo. `scripts/make-logo.js` generates four variants from one source: a
  square mark for avatars and favicons, and a wordmark for the README, each
  in a light and a dark form. The README picks per theme with `<picture>`.
  The mark is a gable roof and wall posts around three stacked bars, the
  bottom one highlighted, because "the newest item always survives the trim"
  is the behaviour that matters most.

- `scripts/try-attic.sh` — a side-by-side demo. Builds a throwaway 26-file
  project with one real bug, asks the same question with and without the
  finding stashed, and prints both answers and both token counts. Works on
  both hosts. The Codex arm disables the installed plugin per-invocation so
  the baseline is not contaminated by its own skill listing.
- `docs/QUICKSTART.md` — how to tell whether the plugin is active, how to see
  the difference, and how to watch a finding survive `/compact`.
- `docs/COMMANDS.md` — every command, level, script flag and exit code, plus
  which phrases make each skill fire on its own.
- A test that fails if a skill exists but is undocumented, so the reference
  cannot drift from the plugin.

## [1.2.0] - 2026-09-04

Codex CLI support, a benchmark that runs on both hosts, and the fixes from a
full review that installed the plugin for real on each.

### Added (native Codex plugin)

- `codex/` is now a native Codex plugin: `.codex-plugin/plugin.json` plus a
  plugin-root `hooks.json` with relative commands, and the repository root is
  a Codex marketplace via `.agents/plugins/marketplace.json`. Install with
  `codex plugin marketplace add NishikantaRay/Attic` and
  `codex plugin add attic@attic`. Verified on `codex-cli 0.153.2`: all eleven
  skills load and `$attic-stash` writes through the script.
- Ported skills now locate their own script with a one-line resolver that
  covers the plugin cache, user skills and `.agents/skills`. Codex shows the
  model no absolute skill path, so a PATH launcher alone was not enough.
- `install.sh --hooks-only` registers user-level hooks for plugin users.
- Documented Codex's hook trust model honestly: hooks need a one-time
  interactive `/hooks` review, and plugin-bundled hooks were not observed
  firing in non-interactive `codex exec`.

### Added (Codex support)

- Attic now runs on Codex CLI. `codex/` is generated from the same skills and
  hooks by `scripts/build-codex.js`, so the two builds cannot drift: a test
  fails if the committed output is stale, and others assert no Claude-only
  variable or frontmatter field leaks in.
- `codex/install.sh` (user-wide or `--repo`) and a `attic` launcher that
  finds the script wherever Codex installed it, since Codex runs commands
  from the project root.
- Hook scripts and the CLI are now host-agnostic: state resolves through
  `ATTIC_STATE_DIR`, `CLAUDE_PLUGIN_DATA`, `CODEX_HOME`, then a plain dotdir.
- `docs/CODEX.md`, including the Codex bugs that affect Attic and what each
  one means in practice.

### Changed (Codex install hardening)

- The Codex installer now registers the hooks and sets `[features] hooks =
  true` itself, instead of printing JSON for the user to merge by hand. It
  merges into an existing `hooks.json` rather than replacing it, backs up
  what it touches, and is idempotent.
- The main skill now tells the model to read `.attic/INDEX.md` itself when no
  index appears in context. Codex can soft-restore a thread without emitting
  any documented `SessionStart` source, so no matcher fires and nothing is
  injected. The attic is a file, so recovery is one read.
- Documented the skills-only install path (`npx skills add`) and stated
  plainly that it loses automatic activation.

### Added (Codex benchmark)

- The benchmark runs on Codex CLI: `node benchmarks/run.js --host codex`.
  Hosts are table-driven adapters, each knowing how to launch its CLI
  headlessly, enable the attic, and read real usage numbers.
- Measured on `codex-cli 0.153.2`: **-66.4%** input tokens when the answer is
  stashed (43,357 to 14,569, zero shell commands against two), and **+2.5%**
  when nothing relevant is stashed. Correct in 6 of 6 runs.
- Codex proved far more reproducible than Claude Code: 14 tokens of spread
  across three runs, against a 30-point swing between Claude Code runs. The
  README chart now uses the Codex data for that reason.

### Added (benchmark + visuals)

- `benchmarks/run.js` — a two-arm benchmark measuring input tokens to answer
  a question about known code, with and without the attic, graded for
  correctness. Includes a deliberate counter-case where the attic loses.
- `benchmarks/README.md` with both runs recorded, including the run-to-run
  spread that makes a single headline percentage untrustworthy.
- `scripts/make-assets.js` and `scripts/make-gif.sh` — README visuals
  generated from the recorded benchmark data, so a stale chart cannot
  outlive the numbers it claims.

### Fixed (full review, 2026-09-04)

- **Secret scan refused legitimate security findings.** "api_key =
  process.env.API_KEY" and "password = getPassword(user)" were rejected as
  credentials, which made the plugin useless for exactly the findings most
  worth keeping. Only quoted literals and digit-bearing bare tokens are
  flagged now; 13 cases pinned by tests.
- **`/attic:attic <level>` did nothing.** The mode hook only matched the
  short form; installed Claude Code plugins are namespaced. Verified live
  through the installed plugin.
- **`archive` read the index outside its lock**, so a concurrent stash could
  be lost. Same class as the earlier stash race; now under the lock.
- **`withLock` released a lock it never acquired** on the timeout path.
- **`install.sh` could write a duplicate `[features]` table**, which TOML
  rejects, breaking Codex's config for anyone who already had that section.

### Fixed (found by a real plugin install)

- **The plugin failed to load when installed.** `plugin.json` declared
  `"hooks": "./hooks/hooks.json"`, but that file is discovered
  automatically, so Claude Code rejected it as a duplicate. Every
  `plugin validate --strict` run passed; only a real
  `claude plugin install` surfaced it.
- **`allowed-tools` grants never matched.** `Bash(node:*attic.js*)` does not
  match a real invocation with a quoted absolute path, so skills prompted for
  permission and, in a non-interactive session, fell back to hand-writing
  files, silently bypassing the credential scan. Grants now use the
  documented `Bash(node "${CLAUDE_SKILL_DIR}/..." *)` form.
- Three tests cover both, since neither is caught by manifest validation.

### Fixed (Codex build payload)

- The Codex build no longer ships `evals/`. Test fixtures and recorded
  results were being copied into users' skills directories by `install.sh`,
  where nothing reads them and the host-specific numbers could mislead. The
  build is 188K to 152K, and a test fails if they reappear.

### Changed (layout)

- The hand-written Codex files moved from a top-level `codex-src/` into
  `scripts/codex/`. Two sibling directories named `codex/` and `codex-src/`
  were needlessly confusing; there is now one `codex/`, and it is generated
  output.

## [1.1.0] - 2026-09-04

Index tiering, pin/prune/archive, local stats, the team merge driver, and the
automated behaviour suite.

### Fixed

- **The session index dropped your newest findings.** `loadIndex()` kept the
  oldest entries and trimmed from the end, so at 70 items the most recent
  item was invisible while month-old ones survived. Trimming now drops the
  oldest unpinned entries instead.
- **Concurrent stashes lost index lines.** Two agents stashing at once each
  read the same index, and the second write dropped the first one's line.
  Reproduced at 8 concurrent writes losing 1-2 every run. Index and decision
  writes are now serialised with a lock.
- **`validate` printed "error: undefined"** instead of the problems it found,
  exactly when a user needed them. The human renderer now prints the list.

### Added

- `/attic-pin` — protect an item from trimming. Pinned items are always
  injected.
- `/attic-prune` — archive stale items. Dry run by default; never deletes.
- `/attic-stats` — what the attic costs and holds, measured from local
  transcripts. No network, no telemetry.
- `/attic-git` — fix `.attic/` merge conflicts and set up a shared team
  attic, via a union merge driver.
- `attic.js rebuild` — regenerate `INDEX.md` from the item files. Items are
  the source of truth, so a corrupted index is always recoverable.
- Tiered index injection: pinned, then recent, then a summary line naming
  what was collapsed so older knowledge stays discoverable.
- `.attic/archive/` for pruned items: no longer injected, still recallable.
- `docs/HONEST-NUMBERS.md`, `docs/TEAM.md`.

### Changed

- The eval runner reports coverage alongside accuracy, retries once, and
  accepts `--delay`. It previously reported 100% while 4 of 22 cases had
  errored out.
- Index injection budget raised to 6 KB with header overhead accounted for.

### Added (audit follow-up)

- `scripts/run-behavior.js` — automated behaviour evaluation. Seeds an attic,
  runs a real headless session, and asserts on the files written and the
  reply text. Behaviour coverage went from 2 of 10 cases checked
  mechanically to 6 of 10. It verifies the plugin's core promise: that a
  session answers from the attic without re-reading files, and that `off`
  leaks nothing.

## [1.0.0] - 2026-09-04

Initial release: the `attic` skill and its commands, session hooks that
survive `/compact`, a deterministic script layer with credential detection,
activation and behaviour eval suites, and CI.
