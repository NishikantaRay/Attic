# Session prompts

Verbatim, unchanged between arms. Only the Attic plugin differs.

---

## Session 1 — Investigation

```
You are investigating an unfamiliar codebase.

Your task is to understand how authentication works in this repository.

Do not modify any files or write implementation code.

Investigate the repository deeply enough to answer:

Where does authentication begin?
What is the complete authentication flow from request to authenticated user?
Which files/functions are responsible for each important step?
Where is authentication state stored?
How are sessions/tokens/cookies handled?
What middleware, guards, or authorization checks are involved?
What are the important security assumptions?
What surprising, non-obvious, or easy-to-miss behavior did you discover?
If you had to modify authentication tomorrow, which files would you need to understand first?

Explore the actual code. Do not rely on filenames or assumptions.

At the end, produce a concise investigation report containing:

Authentication flow
Important files
Important functions
Data/state involved
Security considerations
Non-obvious discoveries
Things that would be easy for another developer/agent to get wrong

Do not make changes to the repository.
```

---

## Session 2 — Fresh session, implementation

The agent is NOT told what session 1 found. In the Attic arm the plugin may
surface it; in the baseline arm there is nothing to surface. That difference
is the whole experiment.

```
You need to make a change to the authentication system in this repository.

Before making changes, understand the existing authentication implementation
well enough to avoid breaking its current behavior.

The task is:

Add an account lockout mechanism after 5 consecutive failed login attempts.

Requirements:

After 5 consecutive failed login attempts, the account must be temporarily locked.
Successful authentication should reset the failed-attempt counter.
Existing authenticated users and sessions must continue to work.
Do not introduce a new authentication mechanism.
Follow the repository's existing architecture and conventions.
Handle the behavior consistently with the existing authentication flow.
Add or update tests where appropriate.

First investigate the existing authentication implementation.

Then implement the change.

At the end, explain:

Which authentication files you modified.
How the existing authentication flow works.
Where the lockout logic was integrated and why.
What tests you added or changed.
Any assumptions you had to make.
```

---

## Session 3 — Fresh session, second change

Depends on the same knowledge again, in a different part of the flow.

```
You need to make another change to the authentication system in this repository.

The task is:

Allow a signed-in user to change their password.

Requirements:

The user must supply their current password to set a new one.
The new password must meet the same rules the system already enforces at signup.
Existing authenticated users and sessions must continue to work.
Follow the repository's existing architecture and conventions.
Add or update tests where appropriate.

First investigate the existing authentication implementation.

Then implement the change.

At the end, explain:

Which authentication files you modified.
How the existing authentication flow works.
Where the change was integrated and why.
What tests you added or changed.
Any assumptions you had to make.
```
