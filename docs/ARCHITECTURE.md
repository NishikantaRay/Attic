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

Before this split, the skill instructed the model to "never stash secrets"
and hoped. Now the script exits 2 and writes nothing. The instruction
remains, because instructions still shape intent, but it is no longer the
only thing standing between a credential and disk.

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
| `attic-pin`, `attic-prune` | Active (1.1.0) |
| `attic-stats`, `attic-git` | Active (1.1.0) |

`attic-init-team` was renamed to `attic-git` before release, never shipped
under the old name, so no deprecation window was needed. The lesson is
recorded in the eval results: a skill name should describe the occasion the
user is in, not the setup task it performs.

Nothing is deprecated yet. When something is, it gets a `deprecated: true`
note in its frontmatter and a pointer to the replacement, kept for one minor
version before retirement.
