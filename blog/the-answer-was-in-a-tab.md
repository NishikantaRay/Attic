# The answer was in a browser tab, and your agent never saw it

Half of what you learn while building something is not in your codebase.

You are debugging why users get logged out at random. You read your session
code, you read your Redis config, and neither explains it. Then you find it in
a documentation page: `allkeys-lru` evicts *any* key, including session keys,
because they have no TTL. That is the answer. It took twenty minutes of reading
to find, and it lives in a tab.

Your coding agent will never see that tab. Tomorrow it will read your session
code again and reach the same dead end, because the thing that resolved it was
never written down anywhere it can reach.

I built Attic to stop agents forgetting what *they* work out. This is about the
other half: what *you* find, and where it goes.

## The gap

Attic keeps a `.attic/` folder in your repo. Your agent writes findings into
it, and a one-line index of that folder is injected into every new session, so
the knowledge survives `/compact`, `/clear`, and closing your laptop.

That works well for things the agent discovers. It does nothing for the
documentation page you read at 11pm.

The obvious answers are all bad:

- **Paste it into the chat.** It lives exactly as long as the context does,
  which is the problem you started with.
- **Keep a `notes.md`.** Now you have two systems, and the agent only reads one.
- **Bookmark it.** A bookmark records that a page existed, not what you learned
  from it.

What you want is for the browser to write into the same folder, in the same
format, with the same rules — so there is one place, not two.

## What I built

A browser extension. Select the part of the page that matters, right-click,
**Stash selection to attic**. It writes a normal item into your project's
`.attic/`, with the source URL kept at the top.

No form, no filename, no switching windows. Next session, your agent has it.

There is a second half, which I did not expect to need. Once the browser could
write to the attic, reading it there became the obvious thing to want — so
clicking the toolbar icon opens a library over the folder: items rendered as
markdown, `[[slug]]` links between them showing what references what, search
across full text, and editing in place.

It turns out a folder of markdown files is a perfectly good knowledge base once
something is willing to render it.

## The part that was harder than it looked

A browser extension cannot write to your filesystem. That is not an oversight;
it is the entire security model. `chrome.fileSystem` is ChromeOS-only, and the
File System Access API needs a folder re-picked per profile with permission
that does not survive reliably.

So there is a small companion process you start yourself:

```
npm run attic:serve -- --root /path/to/project
```

Which raises the real question: **what stops a random web page from driving
it?**

The answer is four things, none sufficient alone. It binds to `127.0.0.1` and
never `0.0.0.0`. Every request carries a token. Only project roots you named on
the command line are writable, so a compromised page cannot aim the writer at
`~/.ssh`. And the origin must be the extension, so an arbitrary tab cannot
reach it.

But the decision I am most glad about is a different one.

## The companion does not know how to write an attic

It would have been natural to have the server write the file. Read the clip,
format some frontmatter, append a line to the index, done. Maybe fifty lines.

I did not, and the reason is drift. The CLI already knows how to do all of
that: the frontmatter shape, slug rules, the 100-character cap on index hooks,
the atomic write, the file lock. Two implementations of the same format do not
stay identical. They diverge in the details, quietly, and the divergence shows
up months later as a file one tool can read and the other cannot.

So the server `require()`s the same script the CLI uses and calls the same
functions. It owns transport and trust; everything else is delegated.

The nicest consequence was free. Attic refuses to write anything that looks
like a credential — an API key, a private key, a connection string. Because the
browser path goes through the same function, a clip containing a token is
refused too, with no extra code. If I had reimplemented the writer, that check
would have been on my list of things to remember, and "things to remember" is a
poor security control.

## Editing is not stashing

One thing surprised me during this.

Stashing the same slug twice appends a dated `## Update` section rather than
overwriting. That is right for an agent: it learns more about a thing it
already wrote about, and the history is worth keeping.

It is completely wrong for a person fixing a typo. An editor that appends on
every save turns one item into a pile of near-identical copies.

So editing is a genuinely different operation, with its own path — it replaces
the body. The slug stays fixed, because handles and `[[links]]` point at it and
renaming would quietly break them.

Same file, same format, two verbs, because two different callers want two
different things.

## Delete

There is no delete.

Archiving moves an item into `.attic/archive/` and drops it from the index.
Your agent can still recall it; restore puts it back. It is a rename, so
nothing the browser does is unrecoverable.

That is the argument that makes browser-side writing defensible at all. A
localhost port that can unlink files is a worse trade than a slightly less tidy
folder, and the absence is covered by a test so it stays absent.

## Where this leaves things

Three things now write into one `.attic/`: Claude Code, Codex CLI, and your
browser. Same folder, same format, same refusal to write a credential.

It is still just markdown in your repo. You can read it without any of these
tools, `grep` it, commit it, and review it in a pull request. That was the
point from the start, and the browser did not change it.

The answer that was in a tab is now in the same place as everything else.

---

*Attic is open source (MIT), has no telemetry, and makes no network calls. The
browser extension is optional; its companion is bound to loopback, requires a
token, and is limited to the project roots you name.
[github.com/NishikantaRay/Attic](https://github.com/NishikantaRay/Attic)*
