# Blog posts

Three posts on the same project, for different readers.

| Post | Audience | Angle |
|---|---|---|
| [why-your-ai-keeps-forgetting.md](why-your-ai-keeps-forgetting.md) | Anyone using an AI coding assistant | Why the forgetting happens and what to do about it. No jargon, no code. |
| [measuring-agent-memory.md](measuring-agent-memory.md) | Engineers building agent tooling | The four measurement bugs, why the first benchmark was worthless, what software should own rather than instructions. |
| [the-answer-was-in-a-tab.md](the-answer-was-in-a-tab.md) | Anyone using an AI coding assistant | Half of what you learn is not in your codebase. The browser extension, and the design calls behind it: reuse the CLI writer rather than reimplementing it, edit is not stash, and why there is no delete. |

All three are drawn from the repository, and every figure is verified against
`benchmarks/` rather than typed from memory. If a number here disagrees with
`benchmarks/results/`, the results are right and the post is stale.

## Claims used, and their source

| Claim | Source |
|---|---|
| −6% / −36% / −43% per session | `benchmarks/auth-investigation/*/results.json` |
| 13/13 correctness both arms | `benchmarks/auth-investigation/*/correctness.md` |
| +2.5% when nothing relevant stored | `benchmarks/results/2026-09-04-codex.json` |
| Index plateaus ~1,500 tokens | `hooks/attic-runtime.js` `loadIndex()` |
| Rules cost 283 tokens/session | `hooks/attic-runtime.js` `rulesFor('full')` |
| The companion reuses the CLI writer | `extension/server/server.js` requires `skills/attic/scripts/attic.js` |
| A clip with a credential is refused | `cmdStash` secret scan; `tests/extension-server.test.js` |
| Editing replaces, stashing appends | `cmdEdit` vs `cmdStash`; `tests/extension-write.test.js` |
| There is no delete endpoint | `tests/extension-write.test.js`, "there is no delete endpoint" |
| Loopback, token, root allowlist, origin | `extension/server/server.js`; `tests/extension-server.test.js` |

## Not claimed

The extension post makes no performance claim at all. It is about a design
problem and the calls made about it; there is no benchmark of clipping, so
there is no number to quote.

Neither benchmark post leads with the 34% total. One run, one repo, one model — a single
headline percentage invites a methodology argument it loses on sample size.
The per-session shape and the correctness tie are more defensible and more
interesting.
