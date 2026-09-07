# Attic for Chrome

Clip a page into your project's `.attic/`, and browse what's already there.

![Attic](icons/128.png)

## Why there is a companion process

A Chrome extension cannot write to your filesystem. `chrome.fileSystem` is
ChromeOS-only, and the File System Access API needs a folder re-picked per
profile with permission that does not survive reliably. So the extension talks
to a small Node server on `127.0.0.1` that you start yourself.

That server does **not** reimplement Attic. It `require()`s
`skills/attic/scripts/attic.js` and calls the same functions the CLI does, so
clips get the same frontmatter, the same slug rules, the same INDEX and
DECISIONS bookkeeping, the same atomic writes — and the same secret scan.

## Install

**1. Start the companion:**

```sh
npm run attic:serve -- --root /path/to/your/project
```

Pass `--root` once per project you want to clip into, and `--port` if 8787 is
taken.

**2. Load the extension:** open `chrome://extensions`, turn on Developer mode,
click **Load unpacked**, and select this `extension/` folder.

**3. Click the toolbar icon and press Connect.** There is no token to copy:
the library finds the companion on the usual ports and pairs with it. See
[Pairing](#pairing) for what that costs.

## Using it

Clicking the toolbar icon opens the **library** in a full tab.

**Browse** — items on the left, reading pane on the right. Filter by kind with
the chips, search across titles, hooks and bodies (bodies load in the
background the first time you focus the search box).

**Switch projects** — start the companion with several `--root` flags and a
project dropdown appears next to the search box.

**Clip** — **+ Clip tab** pulls the title, URL and text from the last real page
you were on (your selection if you made one, else the article text). Edit the
title and the handle updates live; pick a kind, add tags, stash. The source URL
is prepended to the body.

**Right-click** — select text on any page and choose *Stash selection to
attic*. No UI at all; a notification confirms the handle.

## Pairing

Copying 48 hex characters was the worst part of setup, so `/ping?pair=1` hands
the token to the extension. That endpoint is unauthenticated, so the window
around it is what keeps this honest:

- it is open for **5 minutes** from companion start,
- a plain status ping does **not** claim the token; only `?pair=1` does,
- it is **not** single-use: a token already issued stays valid, so closing on
  the first read would protect nothing and would strand the real client behind
  any other reader (a reload, a health check, a stray `curl`),
- **reopen it any time with `npm run attic:pair`**, or by pressing Enter in the
  companion's terminal — both prove control of the account, and neither
  requires restarting a running companion,
- `--no-pair` turns it off entirely, and you paste the token by hand under
  *Advanced*.

`npm run attic:pair` writes `~/.attic-pair-request`; the companion picks it up
within a second, honours it only if it is under a minute old, and deletes it.
Set `ATTIC_PAIR_REQUEST_FILE` to give a second companion its own path —
otherwise whichever one polls first consumes every request.

The exposure is other local processes during those few minutes. That is
already the trust boundary — a local process could read
`~/.attic-extension-token`, or the project files, regardless. Web pages stay
blocked by the origin check.

## What it refuses to do

- **Credentials.** The inherited secret scan refuses a clip containing an API
  key, token, private key or connection string, and writes nothing. The
  server never forwards `--force`, so a refusal cannot be overridden from the
  browser — edit the clip instead.
- **Unknown project roots.** Only paths you passed as `--root` are writable.
- **Other origins.** Requests must come from a `chrome-extension://` origin;
  a web page cannot drive the writer.
- **Remote connections.** The server binds `127.0.0.1` only, never `0.0.0.0`.

The token is a shared secret in a local file. Anyone who can read your home
directory and reach the port can write to the roots you allowed — which is the
same trust boundary as your shell.

## Endpoints

| Method | Path      | Notes                                     |
| ------ | --------- | ----------------------------------------- |
| GET    | `/ping`   | No token, so the UI can distinguish "down" from "wrong token". `?pair=1` claims the token while the pairing window is open |
| GET    | `/index`  | The index for a root                      |
| GET    | `/recall` | `?q=<slug or words>`                      |
| POST   | `/stash`  | 200 written · 422 refused · 400 failed    |

## Tests

```sh
node --test tests/extension-server.test.js
```

Covers the write path, both refusal paths, token and origin rejection, root
allowlisting, the body size cap, and every pairing transition (claimed once,
not burned by a status ping, disabled by `--no-pair`, expired by time).
