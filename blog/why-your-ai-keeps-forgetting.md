# Your AI assistant keeps forgetting. Here's why, and what I did about it

You ask your coding assistant to work out why users keep getting logged out.
It reads through your code, follows the trail, and finds it: a cache setting
is throwing away login sessions before they expire. Good. Thirty minutes well
spent.

An hour later you ask a related question, and it starts reading the same
files again. It has no idea it already solved this.

If you have used Claude Code, Cursor, Codex or anything similar, you have
watched this happen. This is a short explanation of why, and what I built to
fix it.

## Why it forgets

Your assistant has a working memory, and like yours, it is finite. Everything
it has read, everything you have said, every command it ran — all of it sits
in one space, and that space fills up.

When it fills, the assistant does what you would do with a full notebook: it
summarises and moves on. Claude Code calls this compacting. The details go,
a summary stays.

The problem is what a summary keeps. It keeps the shape of the conversation.
It does not keep "line 12 of the cache config uses the wrong eviction policy,
which is why sessions vanish under load." That is exactly the kind of hard-won,
specific detail that gets smoothed away.

So the discovery is gone, and the only place it ever lived was a chat window.

## The obvious fix, and why it does not work

You might think: write it down in a project file. Both Claude Code and Codex
support this, and it works well for what it is designed for — conventions,
setup steps, house style.

But look at the timing. Those files hold what you knew *before* you started.
The cache bug is something the assistant discovered *during* the work. Nobody
writes "the eviction policy is wrong" into a conventions file, because until
that afternoon nobody knew.

There is a gap between "things we knew in advance" and "things we just found
out." The second category has nowhere to live.

## What I built

A small tool called Attic. The name is the idea: an attic is where you keep
things that matter but do not need to be in the room with you.

When your assistant works something out, Attic writes it to a folder in your
project called `.attic/`. In the conversation, only a single line remains:

```
you:    why are users logged out at random?
claude: attic:redis-eviction-bug · the cache is set to evict the oldest
        entries, which throws away live login sessions. Fix: change the
        policy so only expiring entries can be evicted.
```

The full explanation, the files it read, the reasoning — all in
`.attic/items/redis-eviction-bug.md`. The conversation holds a bookmark.

Now when the context fills and gets compacted, the discovery does not go with
it. It is a file. Files survive.

## What is actually in there

Plain text you can open and read:

```
.attic/
  INDEX.md          one line per finding
  DECISIONS.md      what was decided, and why
  items/            the findings themselves
```

No database, no cloud service, no account. Markdown files sitting in your
project. You can read them, edit them, delete them, and commit them so your
teammates get them too.

## "Won't that fill up?"

The folder grows, yes. But what reaches the assistant is capped.

Think of a library. The shelves grow forever. What you hand someone is the
catalogue card, not every book. Attic does the same: recent findings are
listed in full, older ones collapse into one line that says "95 more here,
ask if you need them."

The result is that the assistant's memory stays roughly the same size whether
you have fifty findings or three thousand. Older findings do not vanish —
they are still on disk, still searchable — they just stop being pushed at the
assistant automatically.

You can also mark a finding as pinned, and it stays visible no matter how
much newer work piles up. Useful for the two or three things that must never
be forgotten.

## Does it help?

I ran a test on a real codebase, one with authentication logic scattered
across a server, three separate apps and a desktop program. Complicated
enough to be genuinely hard to understand.

Three sessions. First: work out how login works. Then, in a completely fresh
session that was told nothing about the first, add a security feature. Then a
third change in another fresh session.

I ran the whole thing twice: once with Attic, once without.

| Session | Without Attic | With Attic |
|---|---|---|
| 1 — investigate | — | 6% less work |
| 2 — first change | — | 36% less |
| 3 — second change | — | 43% less |

The pattern matters more than any single number. The first session is
roughly a wash, because that is the session doing the writing. The benefit
shows up later, and grows.

The other result is the one I find most useful: **the quality was identical.**
Both versions solved both problems correctly, scored against the same
checklist. So this does not make your assistant smarter. It stops it doing
the same work twice.

## When it is not worth it

Short sessions. Questions you ask once and never again. Small projects you
already know inside out.

In those cases, Attic costs a little and returns nothing, and I measured that
too: on one test where nothing useful had been saved, it cost about 2.5%
more. That is why there is an off switch, and why the tool can tell you when
it is not pulling its weight.

I would rather you turn it off than keep something that is not helping.

## Trying it

If you use Claude Code:

```
claude plugin marketplace add NishikantaRay/Attic
claude plugin install attic@attic
```

Then work as usual. When your assistant works something out, look for a line
like `attic:something` in its reply, and check `.attic/items/` to see what it
kept.

It works with Codex CLI too. Everything stays on your machine — no accounts,
no network, nothing sent anywhere.

Free and open source: [github.com/NishikantaRay/Attic](https://github.com/NishikantaRay/Attic)
