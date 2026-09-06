<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-wide.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo-wide-light.svg">
    <img src="assets/logo-wide-light.svg" alt="Attic — offload context. Keep the chat lean." width="480">
  </picture>
</p>

<p align="center">
  <a href="CHANGELOG.md"><img alt="version 1.2.0" src="https://img.shields.io/badge/version-1.2.0-2ea44f"></a>
  <a href="#install"><img alt="Claude Code plugin" src="https://img.shields.io/badge/Claude%20Code-plugin-7c3aed"></a>
  <a href="docs/CODEX.md"><img alt="Codex CLI plugin" src="https://img.shields.io/badge/Codex%20CLI-plugin-10a37f"></a>
  <a href="skills/attic/evals/results/"><img alt="activation evals 22/22" src="https://img.shields.io/badge/activation%20evals-22%2F22-2ea44f"></a>
  <a href="SECURITY.md"><img alt="no telemetry" src="https://img.shields.io/badge/telemetry-none-lightgrey"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-lightgrey"></a>
</p>

**Your coding agent forgets what it just figured out.** Attic writes it down,
so tomorrow it already knows.

A plugin for [Claude Code](https://claude.com/claude-code) and
[Codex CLI](https://developers.openai.com/codex).

![Attic in action: a finding is stashed, the context is compacted, the agent still knows, and the same attic works on Codex](assets/demo.gif)

## What it does

You ask your agent to investigate something. It reads ten files, traces the
flow, works out the answer. Then the context fills up, `/compact` runs, and
that understanding is gone. Tomorrow it reads the same ten files again.

Attic writes what the agent learns to a `.attic/` folder in your project, and
keeps a one-line index in the conversation:

```
you:    why are users logged out at random?
claude: attic:redis-eviction-bug · maxmemory-policy is allkeys-lru,
        so session keys get evicted. Fix is volatile-lru.
```

The detail lives in `.attic/items/redis-eviction-bug.md`. The chat holds a
handle. After a compaction, a new session, or a week away, the finding is
still there.

![How Attic works](assets/how-it-works.svg)

## Install

**Claude Code**

```
claude plugin marketplace add NishikantaRay/Attic
claude plugin install attic@attic
```

**Codex CLI**

```sh
codex plugin marketplace add NishikantaRay/Attic
codex plugin add attic@attic
```

On Codex, run `/hooks` once in an interactive session and trust the attic
hooks — Codex will not run a hook it has not reviewed. Skills work without
this; only the automatic loading needs it. [More on
Codex](docs/CODEX.md).

## Try it

Check it is on:

```
/attic-help
```

If a reference card prints, you are set. Then just work normally. After the
agent investigates something, look for a handle like `attic:some-finding` in
its reply, and run `ls .attic/items/` to see what it kept.

To see the difference for yourself:

```sh
sh scripts/try-attic.sh
```

That builds a throwaway project with one real bug, asks the same question
twice — once with the finding stashed, once without — and prints both
answers with their token counts. Nothing outside a temp folder is touched.

## The commands you will actually use

| Command | What it does |
|---|---|
| `/attic-stash` | Keep this finding |
| `/attic-recall <topic>` | What did we learn about X? |
| `/attic-index` | Show everything kept in this project |
| `/attic-sweep` | Save the session before `/compact` |

Four more exist for pinning, pruning, health checks and git setup. Full list
with every flag: [docs/COMMANDS.md](docs/COMMANDS.md).

## How much it keeps

`/attic off` turns it off. `/attic` turns it back on.

| Level | Behaviour |
|---|---|
| `lite` | Only keeps things when you ask |
| `full` | Keeps findings after each investigation. **Default** |
| `ultra` | Keeps everything non-trivial, replies get very short |
| `off` | Dormant |

Start with `full`. If it feels chatty, drop to `lite`.

## What ends up in your project

```
.attic/
  INDEX.md          one line per finding
  DECISIONS.md      what was decided, and why
  items/*.md        the findings themselves
```

Plain Markdown you can read and edit. Commit it and your team shares the
knowledge; add it to `.gitignore` and it stays personal.

If you commit it, run `/attic-git` once. `INDEX.md` is append-only, so two
branches both adding a finding will conflict every time; that command installs
a merge driver that keeps both sides. [Team setup](docs/TEAM.md).

The index is injected into every session, so it cannot grow forever. Pinned
items always survive, newest fill the remaining room, and older ones collapse
to a single line you can still search. Your newest finding is never the one
that disappears.

## Does it actually help?

Sometimes. Here is the evidence, including where it does not.

**The real test**: three sessions on a private monorepo with auth spread
across a server, three clients and an Electron process. Investigate the auth
flow; then, in a **fresh session told nothing about the first**, add account
lockout; then, in another fresh session, add password change.

| | No Attic | Attic | |
|---|---:|---:|---:|
| Input tokens | 5,935,224 | 3,938,927 | **−34%** |
| Cost | $6.35 | $5.02 | −21% |
| Correctness | 13/13 | 13/13 | tie |

The shape matters more than the total. Session 1 is a wash (−6%), session 2
saves 36%, session 3 saves 43%. The benefit compounds as sessions accumulate.

**Both arms were correct**, so this did not make the agent smarter. It made
the same quality cheaper.

**Where it costs you.** On a short session, or a question you never ask
twice, the index is overhead you pay for nothing — measured at +2.5% on one
benchmark case. That is why `off` exists. No headline percentage is quoted
because agent sessions are not reproducible enough to support one:
[the full accounting](docs/HONEST-NUMBERS.md).

Method, prompts and raw results:
[benchmarks/auth-investigation/](benchmarks/auth-investigation/).

## Privacy

No network calls. No telemetry. No API keys. Everything stays in your project
folder and on your machine. The script refuses to write anything that looks
like a credential. [Security notes](SECURITY.md).

## More

[Quickstart](docs/QUICKSTART.md) ·
[All commands](docs/COMMANDS.md) ·
[Codex setup](docs/CODEX.md) ·
[Team setup](docs/TEAM.md) ·
[How it is built](docs/ARCHITECTURE.md) ·
[Contributing](CONTRIBUTING.md) ·
[Changelog](CHANGELOG.md)

## Uninstall

```
claude plugin uninstall attic@attic     # Claude Code
codex plugin remove attic               # Codex CLI
```

Your `.attic/` folders stay where they are. Delete them if you want.

## License

MIT
