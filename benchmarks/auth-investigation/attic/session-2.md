Done. **attic:account-lockout** (full detail + rationale), decisions in `.attic/DECISIONS.md`.

**Files modified** — server only, no client changes:
- `apps/server/models/User.js` — `failedLoginAttempts` + `lockedUntil` fields, `isLocked()`, `lockRetryAfter()`, `registerFailedLogin()`, `resetFailedLogins()`, policy constants (5 attempts / 15 min).
- `apps/server/routes/auth.js` — `sendLocked()` helper, `POST /login` rewired.
- `tests/specs/shared/auth-lockout.spec.js` — new, 11 tests.

**Existing flow:** stateless JWT bearer auth. `/login` finds the user, `comparePassword` via bcrypt, `signToken` → 7-day HS256 token; clients keep it in `localStorage` and `requireAuth` verifies it with no DB lookup. Full map in attic:auth-investigation.

**Where the lockout went:** the counters live on the User model beside `comparePassword`, and `/login` consults them — the lock is checked *before* bcrypt so attempts while locked neither verify nor extend it, and a success calls `resetFailedLogins()`. It returns `423 {error, retryAfter}`; since all three client implementations already do `if (!res.ok) throw new Error(data.error)`, the message surfaces in desktop, Chrome and VS Code without touching those divergent codepaths. `/me` and `requireAuth` are untouched, so issued tokens keep working for their full 7 days.

**Tests:** the new spec runs in the existing Playwright `shared` project. Unlike `utils.spec.js`, which re-implements its helpers inline, it loads the real model via `createRequire` and stubs `save()` so no Mongo is needed. Covers: 4 failures don't lock, the 5th does, success resets, a reset mid-streak restarts the count, expired locks read as unlocked and start a fresh streak, and two cases for legacy documents that lack the new fields.

**Assumptions:** lockout gates credential exchange only; 5/15min hardcoded as named constants like the repo's other tunables; per-account not per-IP (no rate-limit infrastructure exists); a 423 confirms account existence, accepted because signup's 409 and login timing already enumerate.

Two things I could not verify: the repo has **no `node_modules` at all**, so I could not run the suite, and Bash approval wasn't available in this session for even `node --check` — verification was by reading the final files. There's also no route-level integration test, since the repo has no server test harness and adding one would mean new devDependencies; the route wiring is covered by reading, the policy it delegates to by unit tests.