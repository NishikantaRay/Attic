#!/usr/bin/env node
'use strict';
// SessionStart (startup|resume|clear|compact): inject rules for the active
// level plus the project's .attic/INDEX.md so the attic survives compaction.
const rt = require('./attic-runtime');

(async () => {
  try {
    const input = rt.parseJson(await rt.readStdin());
    const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.env.CODEX_PROJECT_DIR || process.cwd();
    if (input.reason === 'startup') rt.clearMode(); // fresh session starts from the default
    const mode = rt.readMode();
    const parts = [rt.rulesFor(mode)];
    if (mode !== 'off') {
      const index = rt.loadIndex(cwd);
      if (index) {
        parts.push(`Current attic index (${index.total} item line(s), .attic/INDEX.md):\n${index.text}`);
      } else {
        parts.push('No .attic/ in this project yet. Create it on the first stash.');
      }
    }
    rt.writeHookOutput('SessionStart', parts.join('\n\n'));
  } catch (e) {
    // Never block a session on a hook failure.
  }
  process.exit(0);
})();
