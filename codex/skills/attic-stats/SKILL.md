---
name: attic-stats
description: >
  Report what the attic costs and what it holds, measured from local session
  transcripts. Use when the user asks "is the attic worth it", "attic stats",
  "how many tokens is this saving", "how big is the attic", or questions the
  plugin's value.
version: 1.1.0
license: MIT
---

# Attic stats

```bash
attic stats
```

Print what it reports. Then follow these rules when discussing it:

1. **Never invent a savings percentage.** The script deliberately does not
   produce one, because token spend depends on the task. Quote what is
   measured: index cost per session, handle citations, attic size.
2. **Say when it is not worth it.** A small attic on a short session is pure
   overhead. If the report says the attic is costing more than it returns,
   lead with that, do not bury it.
3. **The cost is real and recurring.** The index is injected at every session
   start and after every compaction. A large index is a standing tax.
4. If many items are collapsed past the budget, suggest `/attic-pin` for what
   must always be present and `/attic-prune` for what has gone stale.

Nothing leaves the machine: the script makes no network calls and sends no
telemetry. Say so if the user asks.
