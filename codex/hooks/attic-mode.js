#!/usr/bin/env node
'use strict';
// UserPromptSubmit: track "/attic <level>" and "/attic default <level>" so the
// level persists across turns, and confirm the change to Claude.
const rt = require('./attic-runtime');

const CMD = /^\s*[\/@$]attic(?:\s+(lite|full|ultra|off|default))?(?:\s+(lite|full|ultra|off))?\s*$/i;
const STOP = /^\s*(stop attic|attic off|normal mode)\s*$/i;

function detect(text) {
  const t = String(text || '');
  if (STOP.test(t)) return { level: 'off' };
  const m = t.match(CMD);
  if (!m) return null;
  const first = (m[1] || '').toLowerCase();
  const second = (m[2] || '').toLowerCase();
  if (first === 'default') return second ? { level: second, persist: true } : null;
  return { level: first || 'full' };
}

(async () => {
  try {
    const input = rt.parseJson(await rt.readStdin());
    const change = detect(input.user_input || input.prompt);
    if (change) {
      const before = rt.readMode();
      rt.setMode(change.level);
      let msg = `ATTIC LEVEL CHANGED: ${before} -> ${change.level}.`;
      if (change.persist) {
        rt.writeDefaultMode(change.level);
        msg += ` This is now the default for new sessions.`;
      }
      msg += change.level === 'off'
        ? ' Attic is dormant: stash nothing until /attic is run again.'
        : ' Apply the attic rules for this level from now on.';
      rt.writeHookOutput('UserPromptSubmit', msg);
    }
  } catch (e) {
    // Silent: never block the prompt.
  }
  process.exit(0);
})();

module.exports = { detect };
