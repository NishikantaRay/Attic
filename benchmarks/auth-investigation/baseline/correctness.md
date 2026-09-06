# Baseline correctness, scored from changes.diff

Scored before the Attic arm finished, so the rubric could not be bent to fit
a comparison.

## Session 2 — account lockout: 7/7

| Point | Met | Evidence |
|---|---|---|
| Failed attempts counted per account and persisted | yes | `failedLoginAttempts` + `lockUntil` on the User schema |
| Triggers on the 5th consecutive failure | yes | `MAX_FAILED_LOGIN_ATTEMPTS = 5`, `>=` check in `nextStateAfterFailure` |
| Successful login resets the counter | yes | `resetLoginAttempts()` called in the login route |
| Temporary, with an expiry | yes | `LOCK_DURATION_MS`, default 15 minutes |
| Existing token verification unchanged | yes | `/me` untouched |
| Integrated into the existing login path | yes | checked in `POST /login` before the bcrypt compare |
| A test covers it | yes | `tests/specs/shared/auth-lockout.spec.js` |

Notable: extracted `apps/server/lib/loginLockout.js`, used `updateOne` for the
counter so the bcrypt pre-save hook cannot re-hash the password, and refused
locked accounts *before* the password check so a lock cannot be extended by
further guessing. That last point is a real security detail, not boilerplate.

## Session 3 — password change: 6/6

| Point | Met | Evidence |
|---|---|---|
| Requires the current password | yes | `comparePassword(currentPassword)` |
| Enforces the same rules as signup | yes | extracted `passwordPolicy.validate`, called from both |
| Hashes through the existing mechanism | yes | assigns to `user.password`, pre-save hook hashes |
| Existing sessions keep working | yes | no token invalidation |
| Follows existing route/error conventions | yes | `router.post('/password', requireAuth, …)`, same error shape |
| A test covers it | yes | `tests/specs/shared/password-policy.spec.js` |

Notable: applied the lockout gate to this endpoint too, reasoning that a
stolen token would otherwise bypass it.

## Reading this

The baseline is strong. That matters: a weak baseline would make any Attic
result look better than it is. Whatever the comparison shows, it is measured
against a competent implementation, not a straw man.
