'use strict';
import { api, slugify } from './api.js';

// Right-click a selection and stash it without opening the popup. The popup is
// for when you want to name things; this is for when you just want it kept.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'attic-stash-selection',
    title: 'Stash selection to attic',
    contexts: ['selection'],
  });
});

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/128.png',
    title,
    message,
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'attic-stash-selection' || !info.selectionText) return;
  const title = tab?.title || 'Clipped selection';
  const slug = slugify(title) || 'clip-' + Date.now();
  const r = await api.stash({
    slug,
    title,
    kind: 'note',
    hook: info.selectionText,
    body: `Source: ${info.pageUrl || tab?.url || 'unknown'}\n\n> ${info.selectionText.trim().replace(/\n/g, '\n> ')}`,
  });
  if (r.ok) notify('Stashed', `attic:${r.handle?.replace(/^attic:/, '') || slug}`);
  else if (r.refused) notify('Refused', 'That selection looks like it contains a credential. Nothing was written.');
  else notify('Not stashed', r.error || 'unknown error');
});
