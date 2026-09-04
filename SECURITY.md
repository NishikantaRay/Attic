# Security

## What Attic stores

`.attic/` is plain Markdown in your project directory. It holds whatever
Claude stashes: findings, decisions, plans, summarised command output.

## What it never sends

Attic makes **no network calls**. No telemetry, no analytics, no API calls of
its own, no phoning home. Every script reads and writes local files only.
`scripts/attic-stats.js` reads Claude Code's own local transcripts read-only.

## Credential handling

`skills/attic/scripts/attic.js` scans every stash for credentials before
writing, and refuses with exit code 2 if it finds one. It detects API keys,
GitHub and Slack tokens, AWS access keys, private key blocks, JWTs,
connection strings with passwords, and assigned credential literals.

This is pattern matching, not a guarantee. It will miss novel formats.

**If a credential reaches `.attic/` anyway:**

1. **Rotate it.** If the attic is committed, the value is in git history on
   every clone and fork. Deleting the file does not unpublish it.
2. Remove the value from the item, keeping the location and the fact.
3. Run `/attic-doctor`, which scans on-disk items for the same patterns.

Never pass `--force` to bypass the scan.

## Committed attics

Treat a committed `.attic/` like any other committed file: it is visible to
everyone with repository access, and it persists in history. See
[docs/TEAM.md](docs/TEAM.md).

## Hooks

The plugin registers three hooks that run local Node scripts on session
start, prompt submit and subagent start. They read the mode state file and
your `.attic/INDEX.md`, and write JSON to stdout. They fail silently rather
than blocking a session.

## Reporting a vulnerability

Open an issue at https://github.com/NishikantaRay/Attic/issues. For anything
involving credential exposure, please report privately first.
