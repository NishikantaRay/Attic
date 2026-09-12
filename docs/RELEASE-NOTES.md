The browser library becomes something you can read and write in, not just search.

1.4.0 shipped a Chrome extension that could clip a page and list what was already stashed. The listing part was thin: items were shown as raw monospace text, and everything else — editing, organising, following a thread between two findings — still meant opening the files. This release closes that.

## Items read like documents

Bodies render as markdown: headings, tables, task lists, fenced code with its language. Long items get an outline. The renderer is hand-rolled, because MV3's content security policy blocks loading a parser from a CDN, and it escapes every string before adding any structure — item bodies contain clipped web pages, so a body carrying `<img onerror=...>` is not hypothetical. A `javascript:` link is dropped rather than rendered.

## Items link to each other

Write `[[another-slug]]` in a body and it becomes a link; `attic:some-slug` handles work too. Each item shows what it links to **and what links back to it**, computed from the bodies rather than stored, so adding a link appears under its target immediately. A link to a slug you have not written yet shows as dangling instead of a dead click.

That is the difference between a folder of notes and something you can actually navigate.

## You can write, not just read

Editing an item in place, pinning it, archiving it. Saving **replaces** the body — which is a genuinely different operation from stashing, because `attic stash` on an existing slug appends a dated `## Update` section. That is right for an agent adding to a finding and wrong for a person fixing a typo in one, so editing got its own path (`attic.js edit`, and `PUT /item` behind it). The secret scan runs on an edit exactly as it runs on a stash; otherwise "edit" would be the way around the check.

There is deliberately **no delete**. Archiving is a rename into `.attic/archive/` and restore reverses it, so nothing you do from a browser is unrecoverable. That is the argument that makes browser-side writing defensible at all.

## Finding things

A command palette on `⌘K`, search across full bodies with the match highlighted in context, filtering by kind or tag, and views for decisions, the link graph, and attic health. Keyboard throughout: `/` search, `j`/`k`/`Enter`, `e` edit, `c` clip, `?` for the rest.

## One fix worth naming

**Clip tab opened a completely blank form.** The code asked for the active tab — but the library is itself a tab, so the active tab *was* the library, and the next line filtered it out for being an extension page. The query and the filter contradicted each other, so nothing was ever found. Clipping now reads the most recently used ordinary page in the window, which is the page you were looking at before you opened the library.

## Upgrading

**Restart the companion.** A Node process does not reload its source, so one left running from 1.4.0 keeps serving the old routes and the library will come up empty:

```
npm run attic:serve -- --root /path/to/project
```

Then reload the extension at `chrome://extensions`.

---

```
claude plugin marketplace add NishikantaRay/Attic
claude plugin install attic@attic
```

```
codex plugin marketplace add NishikantaRay/Attic
codex plugin add attic@attic
```

No network calls, no telemetry, no API keys. The optional browser companion is bound to loopback, token-authenticated, and limited to the project roots you name.
