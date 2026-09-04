---
name: attic-sweep
description: >
  Save the state of the current session into the attic before context is
  lost: the current plan, open questions, in-progress work, and any finding
  not yet stashed. Use right before /compact or /clear, at the end of a
  session, or when the user says "save state", "wrap up", "before compact",
  "checkpoint", "context is getting long", "summarise what we've done so
  far", "where are we", or "recap the session". A request to recap session
  progress IS a sweep: give the recap and persist it in the same pass.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" *) Bash(node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js"*)
version: 1.2.0
license: MIT
---

# Sweep the session into the attic

Goal: after this runs, a fresh session that reads only `.attic/INDEX.md`
could continue the work.

Pipeline:

1. **Collect.** Review the conversation for anything not yet stashed:
   findings, decisions and why, the current plan and what is done, open
   questions, and in-progress state (files being edited, failing tests,
   commands to rerun).
2. **Dedupe.** Run the index and drop anything already covered. Append to an
   existing item where there is genuinely new detail.

```bash
node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" index
```

3. **Write.** One stash per finding or decision, following `/attic-stash`.
   Then one session item, using `templates/session.md` as the shape:

```bash
node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" stash \
  --slug session-$(date +%F) --kind plan --title "Session $(date +%F)" \
  --hook "<what this session is doing, one line>" --body-file <tmpfile>
```

4. **Verify.**

```bash
node "${CLAUDE_SKILL_DIR}/../attic/scripts/attic.js" validate
```

   Fix anything it reports before finishing.
5. **Report.** List the handles written, one per line, then a single line:
   "Safe to /compact."

Copy commands, paths and errors verbatim. No secrets.
