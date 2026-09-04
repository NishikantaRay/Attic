# What to stash, what to skip

Loaded when the judgement call is unclear. The rule of thumb: stash what a
competent colleague joining tomorrow would need, skip what they could
re-derive in under a minute.

## Stash

| Signal | Kind | Example hook |
|---|---|---|
| Root cause found after tracing | `finding` | `5s fixture timeout in tests/conftest.py:41, SMTP call is real` |
| How a subsystem actually works, contradicting the obvious reading | `finding` | `auth middleware runs twice: once in router, once in the ASGI wrapper` |
| A choice with a live alternative | `decision` | `lru_cache over a cache class, one line beats a bug farm` |
| Where something lives, after a search that took effort | `note` | `all retry logic is in lib/net/backoff.ts, not in the clients` |
| A noisy command's distilled result | `output` | `pytest -k auth: 3 fail, all on the SMTP fixture` |
| The plan and what is left, before context is lost | `plan` | `migration: steps 1-3 done, step 4 blocked on schema review` |
| A dead end, so nobody walks it twice | `finding` | `tried pinning urllib3<2, breaks boto3, abandoned` |

Dead ends are the most under-stashed item. A negative result stops a repeat.

## Skip

- Anything answerable in one line without reading a file.
- Restating what the code plainly says. An item that just says "the function validates input" is noise.
- Content that duplicates an existing item. Append to that item instead.
- Transient state: what you are about to run, which terminal is open.
- Anything the user asked you to keep out of files.

## Never

Credentials of any kind. `scripts/attic.js` refuses these mechanically and
exits 2. When a finding is *about* a leaked credential, record the location
and the fact, never the value:

```
Bad:  AWS key AKIA... found in config/prod.yaml line 12
Good: a live AWS access key is committed at config/prod.yaml:12, rotate and remove
```

## Sizing

An item is one screen. If it runs longer, it is two items, or it is a
reference document that belongs in the repo rather than the attic. The hook
in `INDEX.md` is one line under 100 characters, because the index is what
gets injected into every session.

## Slugs

Specific and durable: `auth-token-refresh-bug`, not `bug` or `issue-2`.
The slug outlives the ticket number. Reuse an existing slug to append rather
than inventing `-v2`.
