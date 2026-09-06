Implementation complete. Here's the rundown.

## Files modified

| File | Change |
|---|---|
| `apps/server/lib/loginLockout.js` | **New.** Pure, dependency-free lockout policy |
| `apps/server/models/User.js` | Added `failedLoginAttempts` / `lockUntil` fields, `isLocked` virtual, `registerFailedLogin()` / `resetLoginAttempts()` |
| `apps/server/routes/auth.js` | Lock check + counter updates in `POST /login`; `sendLocked()` helper |
| `tests/specs/shared/auth-lockout.spec.js` | **New.** Policy unit spec |
| `docs/ARCHITECTURE.md`, `README.md` | Documented the model fields, the `423` contract, and the env knobs |

No client files changed — see below.

## How the existing flow works

JWT bearer tokens, no server-side session store. `POST /signup` creates a user (bcrypt hash via a `pre('save')` hook) and returns a 7-day HS256 token. `POST /login` looks the user up by normalized email and calls `user.comparePassword()`, returning a generic `401 Invalid email or password` if either the lookup or the compare fails. `GET /api/auth/me` and the `requireAuth` middleware in `routes/recordings.js` each independently `jwt.verify()` the `Authorization: Bearer` header. Clients call these through `packages/ui/auth.js`, whose `login()` throws `data.error` on any non-2xx; `AuthView.jsx` (desktop and Chrome) renders that message.

## Where the lockout went, and why

Entirely inside `POST /api/auth/login` — the single place a password is exchanged for a token. Two ordering decisions matter:

- **The lock is checked before `comparePassword()`**, so a locked account can't be probed for a valid password and continued guessing doesn't extend the window.
- **State is persisted with `updateOne`, not `save()`**, which keeps the write atomic under concurrent attempts and guarantees the bcrypt `pre('save')` hook can never re-run and double-hash a password.

I split the rules into `lib/loginLockout.js` because `models/User.js` pulls in mongoose and bcrypt, which aren't installed in this checkout — the pure module is importable by tests with no DB, no connection, and no native deps. The model delegates to it and owns only persistence; the route owns only the HTTP shape.

Failures return `423 Locked` with `Retry-After` plus `lockedUntil`/`retryAfter` in the body. Because `packages/ui/auth.js` already throws `data.error` for any non-ok response, the lockout message surfaces in both `AuthView`s with no client change.

## Tests

`tests/specs/shared/auth-lockout.spec.js` runs under the existing `shared` Playwright project and imports the real policy module (the existing `utils.spec.js` inlines copies of its logic; importing the actual module tests the shipped code instead). Nine cases against a fixed clock: the limit is 5; a fresh account is unlocked; attempts 1–4 count up without locking; the 5th locks for the full window; the lock holds to the last millisecond and lifts exactly at expiry; `retryAfterSeconds` counts down and rounds up; a success clears the streak so the next 4 failures don't lock; an expired lock restarts the count at 1 and needs 5 fresh failures to re-lock; and a document with neither field is treated as unlocked with 0 attempts.

**I could not execute them.** There is no `node_modules` anywhere in this repo and Bash was gated in this session, so I verified by re-reading rather than running. Run `cd tests && npm install && npx playwright test --project=shared` to confirm.

## Assumptions

- **Lockout gates token issuance only.** Existing JWTs stay valid — `/me` and `requireAuth` are untouched, per the requirement that existing sessions keep working. A locked user therefore stays signed in on devices that already hold a token.
- **15-minute lock**, since the task specified the threshold but not the duration. Both are overridable via `AUTH_MAX_FAILED_ATTEMPTS` / `AUTH_LOCK_DURATION_MINUTES`, matching how the server already reads `PORT` and `JWT_SECRET`.
- **Per-account, not per-IP**, which the "consecutive failed login attempts" wording implies. Worth knowing: this makes an account lockable by a third party who knows the email — the standard tradeoff. A per-IP rate limit would complement it, but that's a new mechanism and out of scope here.
- **`423` discloses that an email is registered**, unlike the generic `401`. Unavoidable if the lock is to be communicated, and consistent with `/signup` already returning `409` for a known email.
- **Waiting out a lock grants a full 5 fresh attempts** rather than leaving the user one failure from re-locking.
- Unknown emails are rejected without any state write, so lockout can't be used to enumerate or create accounts.