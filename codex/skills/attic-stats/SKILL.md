---
name: attic-stats
description: >
  Report what the attic costs and what it holds, measured from local session
  transcripts. Use when the user asks "is the attic worth it", "attic stats",
  "how many tokens is this saving", "how big is the attic", or questions the
  plugin's value.
version: 1.6.0
license: MIT
---

# Attic stats

First, in the same shell command as anything below, locate the script:

```bash
ATTIC_JS=$(ls -d "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/attic/attic/*/skills/attic/scripts/attic.js "${CODEX_HOME:-$HOME/.codex}"/skills/attic/scripts/attic.js "$HOME"/.agents/skills/attic/scripts/attic.js .agents/skills/attic/scripts/attic.js 2>/dev/null | sort -V | tail -1)
```

```bash
node "$(dirname "$ATTIC_JS")/../../../scripts/attic-stats.js"
```

Print what it reports. Then follow these rules when discussing it:

1. **Lead with the verdict, not the contents.** The user is asking whether
   this is worth keeping on. The `What this means` block answers that; the
   item counts do not.
2. **If it says NOT EARNING ITS KEEP, say so first and plainly.** Do not
   soften it or bury it under what the attic contains. Suggest `/attic off`,
   or ask what they were expecting to recall that they never did.
3. **Never invent a savings percentage.** The script deliberately produces
   none, because token spend depends on the task. Quote what is measured:
   index cost, citations, repeat file reads.
4. **Two numbers carry the answer.** *Cited in replies* is how often the
   model answered from the attic instead of re-reading. *Repeat file reads*
   is the share of reads that an earlier session had already done — the thing
   the plugin exists to reduce, so lower is better.
5. **Early sessions look bad and that is expected.** The session that writes
   pays; later sessions collect. If there is one session and no citations,
   say it is too early rather than implying failure.
6. If many items are past the injection budget, suggest `/attic-pin` for what
   must always be present and `/attic-prune` for what has gone stale.

Nothing leaves the machine: the script makes no network calls and sends no
telemetry. Say so if the user asks.
