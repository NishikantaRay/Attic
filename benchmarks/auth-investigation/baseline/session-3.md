Implementation complete. I could not execute anything to verify — every `Bash` call in this session (Playwright, `node --check`) was denied by the permission layer, so **the new and existing tests have not been run**. The changes are verified by reading only.

## Files modified

**Server (`apps/server`)**
- `lib/passwordPolicy.js` — **new.** Pure, dependency-free password rules, mirroring `lib/loginLockout.js`.
- `routes/auth.js` — added `requireAuth` middleware + `POST /api/auth/password`; `/signup` and `/me` refactored onto the shared pieces.
- `models/User.js` — schema `minlength` now reads `passwordPolicy.MIN_PASSWORD_LENGTH` instead of a literal `6`.

**Client**
- `packages/ui/auth.js` — added `changePassword(token, current, next)` and an exported `MIN_PASSWORD_LENGTH`.
- `apps/desktop/src/components/SettingsPanel.jsx` — new **Account** section with a change-password form.
- `apps/desktop/src/components/AuthView.jsx` — `minLength={6}` → the shared constant.

**Tests / docs**
- `tests/specs/shared/password-policy.spec.js` — **new.**
- `tests/specs/desktop/app.spec.js` — extended the Settings Panel describe block.
- `README.md`, `docs/ARCHITECTURE.md`.

## How the existing flow works

Stateless JWT over Mongo. `POST /signup` checks `password.length < 6` inline, then `User.create`; a `pre('save')` hook bcrypt-hashes at cost 12 (schema validation runs before that hook, so `minlength` applies to the plaintext). `POST /login` looks the user up, checks `user.isLocked` **before** the bcrypt compare, and on a bad password calls `registerFailedLogin()` — an atomic `updateOne` that avoids re-running the hashing hook. Five consecutive failures set `lockUntil`, and `/login` answers `423` + `Retry-After`. Success clears the counter and signs a 7-day HS256 token. `GET /me` verified the token inline; `routes/recordings.js` has its own `requireAuth` middleware. Clients keep the token in `localStorage` under `screenflow-token` and re-validate against `/me` on boot.

The decision-making for lockout lives in `lib/loginLockout.js` as pure functions specifically so it can be unit tested without Mongo — that split is the convention I followed.

## Where the change was integrated, and why

- **The signup rule became `lib/passwordPolicy.js`.** "Same rules as signup" is only enforceable if there's one rule. Signup, the new endpoint, and the schema `minlength` now all read it, and it's testable the same way the lockout policy is. Signup's error string is byte-identical to before.
- **`POST /api/auth/password`**, not a new router — it's auth, and it needs `signToken` and `sendLocked`.
- **`requireAuth` was hoisted into `auth.js`**, copying the shape already in `recordings.js`; `/me` now uses it. Same status codes and messages as before.
- **The lockout gate applies to the new endpoint too.** It verifies a password, so leaving it open would let a stolen token brute-force the current password without ever touching `/login`. Locked check before the compare, failures feed the same counter, success resets it.
- **Sessions are untouched.** JWTs are stateless and there's no revocation list, so tokens minted before the change keep working — which is what the "existing sessions must continue to work" requirement asks for. The response returns a fresh token so the calling client can rotate; the desktop form stores it.

## Tests

`tests/specs/shared/password-policy.spec.js` (the `shared` project, pure units, no server): minimum is 6 and the message says so; exactly-6 accepted; every length 1–5 rejected; empty/`undefined`/`null` rejected; non-string input (`1234567`, `['abcdefg']`, `{length: 99}`) rejected rather than length-measured or thrown — a JSON body can carry anything; and no trimming, which pins existing signup behaviour.

`tests/specs/desktop/app.spec.js`: `Account` added to the sections list, plus two tests — all three fields are `type="password"`, and a mismatched confirmation shows the error with `page.route` asserting no request reached the server.

## Assumptions

1. **Rejecting a new password identical to the current one** is an extra rule beyond signup's. It's conventional and I judged it expected, but it is an addition — say the word and I'll drop it.
2. **No session revocation on change.** There's no token-version or denylist field on `User`, and adding one would break the "existing sessions keep working" requirement. Documented as an explicit non-goal in `ARCHITECTURE.md`.
3. **`POST /api/auth/password`** for the path — the README already documents `/api/auth/me`.
4. **No route-level integration test.** The repo has no server test harness (no supertest, no in-memory Mongo); the `shared` project only imports pure modules. So the policy is unit-tested and the route logic is not — that's the pre-existing gap the lockout feature also lives with.
5. **Desktop only** for UI. The Chrome and VS Code apps have no account UI to extend; all three reach the same endpoint through `packages/ui/auth.js`.
6. `MIN_PASSWORD_LENGTH` is duplicated once on the client (`packages/ui/auth.js`) because the renderer can't import the server's CommonJS module. It drives hints only; the server is authoritative, and the comment says so.