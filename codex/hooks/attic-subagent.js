#!/usr/bin/env node
'use strict';
// SubagentStart: hand a five-line version of the rules to subagents so they
// stash instead of dumping into their report.
const rt = require('./attic-runtime');

(async () => {
  try {
    await rt.readStdin();
    const text = rt.subagentRulesFor(rt.readMode());
    if (text) rt.writeHookOutput('SubagentStart', text);
  } catch (e) {
    // Silent.
  }
  process.exit(0);
})();
