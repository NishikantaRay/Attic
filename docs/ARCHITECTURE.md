# Attic architecture

Attic follows the skill architecture in
[AI Skills Are Not Just Prompts](https://dev.to/nishikantaray/ai-skills-are-not-just-prompts-a-practical-architecture-for-building-evaluating-shipping-and-540h):
a skill is a versioned, testable, routable, enforceable component with a
lifecycle, not a Markdown prompt.

## Layers

```
User intent
    │
    ▼
Router ─────────────  skills/*/SKILL.md frontmatter descriptions
    │                 (activation is a classification problem)
    ▼
Skill ──────────────  skills/attic/SKILL.md          the hub: scope, rules, routing
    │                 skills/attic/references/*.md    progressive loading
    │                 skills/attic/templates/*.md     output shapes
    ▼
AI reasoning ───────  what is worth stashing, how to word it
    │
    ▼
Scripts ────────────  skills/attic/scripts/attic.js   deterministic file operations
    │                 skills/attic/scripts/freshness.js  git comparison, read-only
    │
    ▼
Enforcement ────────  hooks/*.js                      session-start injection, level tracking
    │                 scripts/attic-precommit.sh      blocks bad commits
    │                 .github/workflows/attic-guard.yml
    ▼
Evaluation ─────────  skills/attic/evals/activation.json
    │                 skills/attic/evals/behavior.json
    │                 scripts/run-evals.js
    ▼
Result
```

## Division of labour

The governing principle: **use AI for judgement, software for certainty.**

| Decision | Owner | Why |
|---|---|---|
| Is this worth stashing? | Model | Requires reading the situation. |
| What does the item say? | Model | Synthesis and wording. |
| Which slug, which kind? | Model | Semantic naming. |
| Does the file have valid frontmatter? | `attic.js` | Schema, not judgement. |
| Is the index line duplicated? | `attic.js` | Set membership. |
| Does this contain a credential? | `attic.js` | Pattern matching beats a promise. |
| Is the write atomic? | `attic.js` | Correctness under interruption. |
| Did the attic drift? | `attic.js validate` + CI | Regression detection. |
| Have the cited files changed? | `freshness.js` | Comparing SHAs is arithmetic. |
| Is the finding still *true*? | Model, after reading the code | Requires judgement, and the answer is not in git. |

Before this split, the skill instructed the model to "never stash secrets"
and hoped. Now the script exits 2 and writes nothing. The instruction
remains, because instructions still shape intent, but it is no longer the
only thing standing between a credential and disk.

## The browser extension

Optional, and structurally a second front end over the same `.attic/` rather
than a parallel implementation of it.

```
Extension ──────────  extension/library.{html,css,js}  the library UI
    │                 extension/markdown.js            renderer (escape-first)
    │                 extension/api.js                 one client for the companion
    │                 extension/background.js          context menu
    ▼
Companion ──────────  extension/server/server.js       transport and trust ONLY
    │
    ▼
Scripts ────────────  skills/attic/scripts/attic.js    the same functions the CLI calls
```

**The load-bearing rule: the companion owns transport and trust, and nothing
else.** It does not format frontmatter, generate slugs, truncate hooks, or
scan for secrets — it `require()`s `attic.js` and calls `cmdStash`, `cmdEdit`,
`cmdRecall`, `cmdIndex`, `cmdArchive`, `cmdPin` and `cmdValidate` with `cwd`
set to the chosen project. A clip from the browser therefore inherits the
format, the slug rules, the index bookkeeping, the atomic writes, the file
lock and the secret refusal for free. Anything reimplemented in the server is
something that will drift from the CLI.

This is why editing lives in `attic.js` as `cmdEdit` rather than as file
writes in the server, and why it is a genuinely different operation from
stashing: `cmdStash` on an existing slug appends a dated `## Update` section,
which is correct for an agent adding to a finding and wrong for a person
fixing a typo in one.

| Concern | Owner | Why |
|---|---|---|
| Is the caller allowed? | `server.js` | Token, origin, root allowlist. |
| Which project is this? | `server.js` | Maps a request to an allowed `cwd`. |
| How is the item written? | `attic.js` | Format, lock, atomicity — shared with the CLI. |
| Does it contain a credential? | `attic.js` | The same scan, on edit as on stash. |
| What does the item say? | The person | No model is involved on this path. |

### Trust boundary

The companion is the attack surface: a localhost port that writes files,
reachable from any page the browser loads. Four mitigations, none sufficient
alone — bound to `127.0.0.1` and never `0.0.0.0`; a shared token on every
request; an explicit allowlist of project roots, so a request naming a path
outside it is refused; and an origin check restricting callers to the
extension. `--force` is never forwarded, so a secret-scan refusal cannot be
overridden from a browser.

There is deliberately no delete endpoint. `cmdArchive` is a rename into
`.attic/archive/` and restore reverses it, so nothing the browser does is
unrecoverable — which is the argument that makes browser-side writing
defensible at all. Editing and archiving act only on a slug that already
exists inside an allowed root, so they reach nothing `/stash` could not
already reach.

### Rendering untrusted text

Item bodies contain clipped web pages and reach the DOM through `innerHTML`,
so `markdown.js` escapes every string **before** it introduces any structure,
and only `http(s)` URLs survive as links. The renderer is hand-rolled because
MV3's content security policy blocks loading a parser from a CDN; vendoring a
full one to render the handful of constructs an item uses would be a poor
trade. Its tests are mostly adversarial rather than about appearance.

## Trust metadata and freshness

Added in 1.6. The split that makes it work is the same one the rest of the
project uses: `freshness.js` answers a mechanical question, and the model
answers the judgement one.

**Freshness never decides whether a finding is true.** It reports whether the
evidence underneath it moved. `possibly-stale` is a prompt to look, and a
command that both detected staleness and resolved it would be rewriting the
user's memory on a heuristic — which is why `review` is read-only and `verify`
is a separate, explicit act.

Three constraints shaped the schema, all of them compatibility:

1. `parseFrontmatter` is flat and line-based, so provenance is flat keys.
   Nested YAML would not parse.
2. The `INDEX.md` line matches kind as `[a-z]+` and that regex is duplicated in
   `hooks/attic-runtime.js` and the generated `codex/` copy, so `type` is a new
   field rather than new `kind` values. A hyphenated kind would make the line
   unparseable and the item would disappear from the index silently.
3. `renderItem` used to drop keys it did not know, which made any write a
   potential data loss for a newer writer's fields. It now preserves them.

Cost is deliberately confined. Freshness runs on `recall` (one item, two git
calls scoped to its own paths) and on `review` (the whole attic, on demand).
Nothing on the session-start path shells out to git, and the injected index
line is byte-identical to 1.5, so trust metadata adds no per-session context.

## Workflow patterns

Attic combines two of the four shapes:

- **Loop** during a task: work, notice something non-trivial, check the
  index, stash or append, continue.
- **Pipeline** when sweeping: collect, dedupe, write, verify, report.

`references/workflow.md` documents both for the model.

## Progressive context loading

`SKILL.md` is the hub and stays short. Domain knowledge lives in
`references/` and loads only when the model needs it:

| File | Loaded when |
|---|---|
| `references/what-to-stash.md` | The stash/skip call is unclear. |
| `references/item-format.md` | Writing to `.attic/` without the script. |
| `references/workflow.md` | Running a sweep, or resolving a skill collision. |

This keeps the always-on cost low. The rules that must apply to every
response are in `SKILL.md`; everything else is on demand.

## Instruction binding strength

The skill uses three levels deliberately:

| Strength | Used for | Example |
|---|---|---|
| Hard constraint | Things with a failure mode | "Never stash secrets." Backed by the script. |
| Requirement | Core behaviour | "Stash the conclusion and reply with the handle." |
| Preference | Judgement calls | "When in doubt at full, stash; at lite, ask." |

## Evaluation

Two dimensions, measured separately.

**Activation** is a classification problem: does the right skill fire?
`skills/attic/evals/activation.json` holds positive cases, negative cases
(including the homograph "the attic in my house"), and collision cases with
sibling skills. `scripts/run-evals.js` runs each as a real headless session
and reports accuracy, false positive rate, false negative rate and wrong-skill
rate.

**Behaviour** asks whether an active skill does the required things. Cases
that can be decided from the resulting files or the reply text are automated
in `scripts/run-behavior.js`, which runs real sessions against a seeded
attic. Activation proving the right skill fires is not evidence the skill
then works; these two suites answer different questions.


`skills/attic/evals/behavior.json` holds per-level scenarios with required
and forbidden behaviours, graded against the transcript and the resulting
`.attic/` tree. Cases that a script already enforces name that script in
`mechanically_enforced_by`, which is how mechanical coverage stays visible.

```bash
node scripts/run-evals.js --suite activation      # live, costs tokens
node scripts/run-evals.js --suite behavior        # checklist
node scripts/run-evals.js --case act-22           # one case
```

## Versioning

Every skill declares a semver `version` in its frontmatter, and
`.claude-plugin/plugin.json` moves with `skills/attic`. A test enforces that
they stay in step.

- **Patch**: wording, typos, a new reference file.
- **Minor**: new behaviour that does not change existing output.
- **Major**: changed defaults, renamed commands, changed on-disk format.

The on-disk `.attic/` format is a public interface. Changing it is a major
version and needs a migration note.

## Maintenance and drift

Attic's upstream dependencies are the Claude Code hook contract, the skill
frontmatter schema, and the plugin manifest schema. When any of them change:

```
detect → review → update → run evals → check regressions → release
```

CI runs unit tests and manifest validation on every push, and the activation
suite nightly and on demand, so schema drift surfaces as a red build rather
than a silent failure in someone's session.

## Lifecycle state

| Skill | State |
|---|---|
| `attic` | Active |
| `attic-stash`, `attic-recall`, `attic-index`, `attic-sweep` | Active |
| `attic-doctor`, `attic-help` | Active |
| `attic-pin`, `attic-prune` | Active, since 1.1.0 |
| `attic-stats`, `attic-git` | Active, since 1.1.0 |
| `attic-review`, `attic-fail` | Active, since 1.6.0 |

`attic-init-team` was renamed to `attic-git` before release, never shipped
under the old name, so no deprecation window was needed. The lesson is
recorded in the eval results: a skill name should describe the occasion the
user is in, not the setup task it performs.

Nothing is deprecated yet. When something is, it gets a `deprecated: true`
note in its frontmatter and a pointer to the replacement, kept for one minor
version before retirement.
