'use strict';
import { api, slugify } from './api.js';

// The toolbar icon opens the library rather than a popup: the popup was too
// small to read an item in, which was the whole complaint. Clipping still has
// a no-popup path via the context menu below.
chrome.action.onClicked.addListener(() => {
  const url = chrome.runtime.getURL('library.html');
  // Reuse an open library tab instead of stacking duplicates.
  chrome.tabs.query({ url }, (tabs) => {
    if (tabs.length) chrome.tabs.update(tabs[0].id, { active: true });
    else chrome.tabs.create({ url });
  });
});

// Right-click a selection and stash it without opening the popup. The popup is
// for when you want to name things; this is for when you just want it kept.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'attic-stash-selection',
    title: 'Stash selection to attic',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'attic-open-library',
    title: 'Open the attic library',
    contexts: ['action'],
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
  if (info.menuItemId === 'attic-open-library') {
    chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
    return;
  }
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
