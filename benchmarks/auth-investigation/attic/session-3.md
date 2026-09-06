Done — full record in `attic:password-change`; rationale in `.attic/DECISIONS.md`.

**Files modified**

| File | Change |
|---|---|
| `apps/server/models/User.js` | `MIN_PASSWORD_LENGTH` const (feeds schema `minlength`), `User.validatePassword()` static, `setPassword()` method |
| `apps/server/routes/auth.js` | `readBearerToken()` helper; signup uses `validatePassword`; new `POST /change-password`; `/me` uses the helper (identical responses) |
| `packages/ui/auth.js` | `changePassword(token, currentPassword, newPassword)` |
| `apps/desktop/src/components/SettingsPanel.jsx`, `apps/chrome-extension/src/components/SettingsView.jsx` | "Account" section with a change-password form |
| `README.md:253`, `tests/specs/shared/auth-password-change.spec.js` | endpoint row; 13 new tests |

**How auth works** — stateless JWT bearer, no sessions or refresh tokens: signup/login issue `jwt.sign({id,email}, …, '7d')`, clients keep it in `localStorage['screenflow-token']`, and `requireAuth` (`routes/recordings.js:17`) just verifies it — `req.user` is the decoded payload, never a DB document. Full map in `attic:auth-investigation`.

**Where it integrated and why** — the endpoint sits in `routes/auth.js` beside signup/login and verifies the bearer inline the way `/me` already does, because it needs the user loaded *with* the password hash (`/me` selects it away) and `requireAuth` lives in the recordings router as express middleware. The rule and the mutation went onto the User model, where `comparePassword` and the lockout methods already live — that also collapses the duplicated ≥6 check so signup and change-password can't drift. Existing sessions keep working because the JWT carries no password state and nothing on the verify path reads the hash.

**Tests** — new `shared`-project spec loading the real model with `save()` stubbed (same pattern as the lockout spec): policy parity with signup including the exact error string, schema/constant agreement, `setPassword` storing + leaving the field modified so the re-hash hook fires, lockout clearing, legacy documents, and old-vs-new password comparison against real bcrypt hashes.

**Assumptions** — "same rules as signup" means the length rule (all signup enforces); rejecting an unchanged password is a small addition; a wrong `currentPassword` deliberately does *not* count toward lockout (the route already requires a valid JWT, and counting would let a stolen token lock the owner out of `/login`); the error there is specific rather than generic since the caller is already authenticated as that account.

Two things I could not do: **nothing was executed** — the repo has no `node_modules` and `node --check` wasn't approved, so this is verified by reading only; and the **VS Code extension has no form** — its auth is a separate inline webview implementation behind a CSP that pins the API host, so it's a separate job. The endpoint is reachable from it.