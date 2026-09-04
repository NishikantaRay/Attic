# Changelog

All notable changes to Attic. Versions follow semver: the on-disk `.attic/`
format is a public interface, so changing it is a major version.

## [1.1.0] - 2026-09-04

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

### Added (audit follow-up)

- `scripts/run-behavior.js` — automated behaviour evaluation. Seeds an attic,
  runs a real headless session, and asserts on the files written and the
  reply text. Behaviour coverage went from 2 of 10 cases checked
  mechanically to 6 of 10. It verifies the plugin's core promise: that a
  session answers from the attic without re-reading files, and that `off`
  leaks nothing.

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

## [1.0.0] - 2026-09-04

Initial release: the `attic` skill and its commands, session hooks that
survive `/compact`, a deterministic script layer with credential detection,
activation and behaviour eval suites, and CI.
