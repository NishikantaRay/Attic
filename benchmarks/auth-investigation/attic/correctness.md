# Attic arm correctness, scored from changes.diff

Same rubric as the baseline, scored after that arm was already recorded.

## Session 2 — account lockout: 7/7

`MAX_FAILED_LOGIN_ATTEMPTS = 5`, `LOCK_DURATION_MS = 15 min`,
`registerFailedLogin()` / `resetFailedLogins()` on the model, checked in
`POST /login` before the bcrypt compare, `423 Locked` with `retryAfter`,
`/me` untouched, covered by `tests/specs/shared/auth-lockout.spec.js`.

Notable: an expired lock restarts the streak at 1 rather than carrying the
stale count forward, which would otherwise re-lock on a single failure.

## Session 3 — password change: 6/6

Requires `currentPassword`, reuses `User.validatePassword` so signup and
change share one rule, hashes through the existing pre-save hook, leaves
existing tokens valid, follows the route and error conventions, covered by
`tests/specs/shared/auth-password-change.spec.js`.

## Verdict

13/13, identical to the baseline. Neither arm made a correctness mistake, so
the difference between them is entirely in cost, not quality.
