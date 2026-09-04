# Quickstart: activate it, then see the difference

## 1. Is it already on?

**Claude Code.** Start a session in any project and type:

```
/attic-help
```

If a reference card prints, the plugin is loaded. To check the level, type
`/attic` — it reports the current one and sets `full` if you pass nothing.

If nothing prints, install it:

```
claude plugin marketplace add NishikantaRay/Attic
claude plugin install attic@attic
claude plugin list          # must say: Status ✔ enabled
```

**Codex CLI.**

```
codex plugin marketplace add NishikantaRay/Attic
codex plugin add attic@attic
codex plugin list           # must say: installed, enabled
```

Then, once, in an interactive session: run `/hooks` and trust the three attic
hooks. Codex refuses to run a hook it has not reviewed. Without this the
skills still work; only the automatic index injection is missing. See
[CODEX.md](CODEX.md).

## 2. How do I know it is active in a session?

Three signs, strongest first.

1. **Ask it.** "What attic level are you on?" A live plugin answers `full`,
   `lite`, `ultra` or `off`.
2. **Look for a handle.** Once anything is stashed, replies carry
   `` `attic:<slug>` `` instead of a paragraph re-explaining the finding.
3. **Check the folder.** `ls .attic/` in the project. If `INDEX.md` exists,
   the attic is being written.

Activation is per session. A new session starts at the default level, which
is `full` unless you changed it with `/attic default <level>` or set
`ATTIC_DEFAULT_MODE`.

## 3. See the difference yourself

```sh
sh scripts/try-attic.sh              # Claude Code
sh scripts/try-attic.sh --host codex # Codex CLI
```

It builds a throwaway 26-file project with one real bug, asks the same
question twice — once with nothing stashed, once with the answer stashed —
and prints both answers and both token counts. Nothing outside a temp
directory is touched.

Measured on 2026-09-04:

| | Without attic | With attic |
|---|---|---|
| Claude Code | 92,976 input tokens, 3 turns | 30,201 tokens, 1 turn |
| Codex CLI | 85,434 input tokens, 3 shell commands | 15,717 tokens, 0 commands |

Both answers were correct in both arms. The numbers move run to run; the
direction does not. See [HONEST-NUMBERS.md](HONEST-NUMBERS.md) for where the
attic *costs* more than it returns.

## 4. See it survive a compaction

This is the part a benchmark cannot show, and the actual reason the plugin
exists.

1. In a real project, ask the agent to investigate something that takes a few
   files. At `full` it stashes and replies with a handle.
2. `ls .attic/items/` — the finding is on disk.
3. Run `/compact`, or start a brand new session.
4. Ask about the same thing. It answers from the index without re-reading.

Without the attic, step 4 means reading those files again.

## 5. Turn it off and compare by hand

```
/attic off      # dormant, nothing is stashed or injected
/attic          # back to full
/attic lite     # only stash when asked
/attic ultra    # stash everything, replies are handle + 3 lines
```

`off` is the honest A/B: run the same task twice in two sessions, one off and
one full, and watch how much re-reading the second one skips.

## What to try first

- Ask a question that needs three or four files read. Watch for the handle.
- Then `/attic-index` to see what it kept.
- Then `/attic-recall <topic>` to pull it back.
- Before you finish for the day, `/attic-sweep`. Tomorrow's session starts
  knowing where you were.
