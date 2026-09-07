'use strict';
import { api, settings } from './api.js';

const $ = (id) => document.getElementById(id);

(async () => {
  const s = await settings();
  $('o-port').value = s.port;
  $('o-token').value = s.token;
  $('o-root').value = s.root;
})();

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    port: parseInt($('o-port').value, 10) || 8787,
    token: $('o-token').value.trim(),
    root: $('o-root').value.trim(),
  });
  const msg = $('msg');
  msg.hidden = false;

  // Saving without testing would let a wrong token sit silently until the
  // next clip fails, so prove the settings work now.
  const p = await api.ping();
  if (!p.ok) { msg.className = 'msg bad'; msg.textContent = p.error || 'companion not reachable'; return; }
  const i = await api.index();
  if (i.ok) { msg.className = 'msg ok'; msg.textContent = `Connected — ${i.counts.items} item(s) in this attic.`; }
  else { msg.className = 'msg bad'; msg.textContent = i.error || 'connected, but that root has no .attic/ yet'; }
});
