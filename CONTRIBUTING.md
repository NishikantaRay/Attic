# Contributing

## Setup

```bash
git clone https://github.com/NishikantaRay/Attic
cd Attic
npm test                      # no dependencies to install
claude --plugin-dir .         # load your checkout into a session
```

## Before opening a pull request

```bash
npm test                                          # unit tests
node scripts/run-evals.js --suite activation --delay 1500
node scripts/run-behavior.js
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate skills --strict
```

Activation evals spawn real sessions and cost tokens. Use `--case <id>` while
iterating and run the full suite once before submitting.

## What changes need what

| Change | Also required |
|---|---|
| New skill | An activation case, plus a negative case proving it does not overfire |
| New user-visible behaviour | An automated case in `scripts/run-behavior.js` if it can be checked from files or reply text |
| New script behaviour | A unit test in `tests/` |
| Changed on-disk format | A major version bump and a migration note |
| Any behaviour change | A `CHANGELOG.md` entry |

Skill versions in frontmatter and `plugin.json` move together; a test
enforces it.

## Principles

- **Software for certainty, AI for judgement.** If a rule can be enforced by
  a script, enforce it there rather than asking the model to remember.
- **Items are the source of truth.** `INDEX.md` is derived and must always be
  rebuildable from `.attic/items/`.
- **Never claim a savings number we have not measured.** See
  [docs/HONEST-NUMBERS.md](docs/HONEST-NUMBERS.md).
- **The index costs context on every session.** Anything that grows it needs
  a reason.
