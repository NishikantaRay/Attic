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

**1. Start the companion** in the repo:

```sh
npm run attic:serve -- --root /path/to/your/project
```

Pass `--root` once per project you want to clip into, and `--port` if 8787 is
taken. It prints a token on first run and saves it to
`~/.attic-extension-token`.

**2. Load the extension:** open `chrome://extensions`, turn on Developer mode,
click **Load unpacked**, and select this `extension/` folder.

**3. Configure it:** open the extension's options and paste the port, the
token, and the project root (it must match a `--root` you passed).
**Save & test** confirms the connection and shows how many items are already
in that attic.

## Using it

**Clip** — click the toolbar icon. The popup pre-fills the title from the page
and the body from your selection, or from the page's main text if nothing is
selected. Adjust the title (the handle updates live), pick a kind, add tags,
and stash. The source URL is prepended to the body.

**Right-click** — select text on any page and choose *Stash selection to
attic*. No popup; a notification confirms the handle.

**Browse** — the second tab lists the index and filters as you type. Click an
entry to pull its full body through `recall`.

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
| GET    | `/ping`   | No token, so the popup can distinguish "down" from "wrong token" |
| GET    | `/index`  | The index for a root                      |
| GET    | `/recall` | `?q=<slug or words>`                      |
| POST   | `/stash`  | 200 written · 422 refused · 400 failed    |

## Tests

```sh
node --test tests/extension-server.test.js
```

Covers the write path, both refusal paths, token and origin rejection, root
allowlisting, and the body size cap.
