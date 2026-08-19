# Origin Replacement One-Week Sprint

**Plan author:** ChatGPT-Sol (not Claude)  
**Created:** 2026-08-17  
**Sprint window:** 2026-08-17 through 2026-08-24  
**Repository:** `C:\Users\patri\git\quantized`  
**Sources of truth:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`,
`plans/LIBRARY_WORKBOOK_UX_PLAN.md`, and their linked active plans  
**Status:** Adopted 2026-08-17 — owner confirmed; Claude orchestrator adjustments folded in (see below)

> The former OneDrive checkout must not be used. Every lane uses a dedicated
> worktree rooted from the current `origin/main`; no two lanes may own the same
> files at the same time.

## Sprint outcome

Produce a release candidate that can replace OriginPro for the owner's common
load → organize → plot → edit → save → reopen workflows, while traversing the
primary P1.1–P1.7 queue and the Library H–N queue. The sprint does **not** earn
completion by hiding unfinished work: every unchecked item in linked plans must
end the week as implemented and verified, superseded/duplicate with a pointer,
or explicitly deferred with a reason and release target.

The week is successful if:

- G5 persistence/reopen proof is merged and a baseline preview build exists.
- P1.1–P1.7 and H–N each have a merged, tested usable slice or a written
  owner-approved defer
  caused by a demonstrated contract/platform blocker.
- Daily-driver workflows receive end-to-end tests and a final human smoke pass.
- All active plan documents are reconciled; no stale “pending” claims remain.
- The final build is labeled a release candidate, not a production promise.

## Non-negotiable operating rules

- Freeze new feature requests for seven days. Bugs that block a sprint workflow
  are in scope; enhancements go to the post-sprint inbox.
- Prefer Claude Sonnet and cheaper agents for settled implementation and tests.
  Use Claude Opus only for I/I2, K/M/N contracts and destructive/cross-process
  review. ChatGPT-Sol spends scarce tokens on GUI decisions and acceptance.
- One owning orchestrator per lane; delegated agents never merge their own work.
- Use independent worktrees and small PRs. Stack only within one lane. Cross-lane
  PRs target `main` and rebase after prerequisites merge.
- No direct merges. A different agent reviews every PR; CI must be green.
- Red-first tests are required for persistence, dependency, deletion, locking,
  clipboard/package, and sidecar failure paths.
- Twice-daily integration windows prevent a week of divergent branches.
- Stop feature work after Day 5. Days 6–7 are integration and release work.

## Orchestrator adjustments (adopted 2026-08-17)

The owner adopted this plan together with four adjustments from Claude's
orchestrator review. These are binding, not optional gloss on the schedule
above.

1. **Tiered review depth.** The review pipeline, not the worktree count, is
   the throughput constraint. Contract PRs (the Day-0/1 output of lanes
   B/C/D/F/G) get full adversarial, adjudicated review. Settled-implementation
   PRs get an independent Sonnet review with an orchestrator spot-check of the
   verdict. Test-only/fixture QA PRs get review-by-diff. Merges land in
   batches at the two daily integration windows rather than trickling in, so
   rebase churn stays bounded.
2. **Shared-pinned-file protocol.** Architecture ratchets sum across
   branches — the #152/#153 collision proved it. Day 0 pre-banks slack in the
   pinned chokepoints (the `useApp.ts` extraction, in progress). Store-slice
   registrations and other pinned-file edits land only at integration windows,
   through a single integrator. Every lane brief lists the pinned files that
   lane must not touch.
3. **Owner-dependency schedule.** Beyond the two daily decision windows,
   P1.1/P1.2 platform verification (native dialogs, file associations,
   packaged builds) and the Day-6 Windows/macOS smoke passes are
   owner-machine-only. If an owner window slips, the affected lane takes the
   documented preview-label fallback rather than stalling.
4. **B/F/G success calibration.** For the platform-risk lanes, a "bounded
   contract merged + safe core behind a preview label + honest defer of the
   remainder" outcome on Day 5 is a **success**, not a shortfall — recorded
   now, in advance, to prevent Day-5 scope-panic merges.

## Scope reconciliation and critical precedence

The Library H–N queue is not the whole daily-driver roadmap. The Primary audit
still books P1.1 native desktop file bridging, P1.2 atomic named projects, P1.7
portability/relinking, P1.4 categorical/metadata channels, P1.6 import roles,
P1.5 live grouping, and P1.3 recipes. These take precedence over speculative
advanced work. H implements the reusable-template portion of P1.3; K/M/J must
share the P1.4 dependency contract; L consumes first-class metadata rather than
inventing a second representation. N ships only if existing large-data evidence
justifies it; otherwise its evidence-backed defer is the correct closure.

## Parallel ownership lanes

| Lane | Scope | Primary owner/model | Review | Dependency |
|---|---|---|---|---|
| A | Finish G5; H/P1.3 template persistence/scopes | Claude Sonnet | ChatGPT-Sol UX; Claude reliability | G5 first; templates before I |
| B | P1.1 native bridge; P1.2 atomic project lifecycle; P1.7 relink/portability | Claude Opus contract/review, Sonnet implementation | independent desktop/storage review | strict P1.1 → P1.2 → P1.7 |
| C | P1.4 categorical/metadata contract; P1.6 import roles; P1.5 live grouping | Claude Opus contract, Sonnet implementation; cheaper UI/tests | ChatGPT-Sol workflow review | strict P1.4 before P1.5/P1.6 |
| D | K dependency foundation; M transactional reimport/delete | Claude Opus contract, Sonnet implementation | independent Opus/Sonnet adversarial review | P1.4/K before M and J split edges |
| E | J combine/split; L metadata/Collections | Claude Sonnet, cheaper agents for UI/tests | ChatGPT-Sol workflow review | consume P1.4/K contracts |
| F | I cross-instance transfer; I2 project locking | Claude Opus contract/review, Sonnet implementation | second Opus/Sonnet review | templates plus shared P1.1/P1.2 platform boundary |
| G | N managed large-data sidecars, evidence-gated | Claude Opus contract/review, Sonnet implementation | independent failure-path review | coordinate project schema with P1.2/M/I |
| QA | Fixtures, Playwright, plan reconciliation, CI monitoring | cheaper models | lane owners adjudicate | continuous |

Lanes B, C, F, and G are the schedule risks. They must begin with bounded contract PRs,
not large implementations based on assumptions.

## Merge sequence and daily gates

### Day 0 — baseline and dispatch (2026-08-17)

- [ ] Merge G5 only after Claude's save/close/reopen/project-reload proof passes.
- [ ] Tag or record the baseline preview build and run the owner’s 20-minute
  Quick Figure smoke workflow.
- [ ] Owner starts the real switch-trigger project/friction log and confirms
  Windows/macOS Office copy/paste; agents cannot manufacture this evidence.
- [ ] Create worktrees and publish pickup briefs for lanes A–G.
- [ ] Opus freezes native project (P1.1/P1.2/P1.7), categorical/grouping
  (P1.4/P1.5/P1.6), dependencies (K/M/J), transfer/locking (I/I2), and
  project/sidecar references (N).
- [ ] Record exact file ownership so concurrent lanes do not collide.

### Day 1 — foundations

- [ ] Lane A implements H storage, scopes, compatibility and corrupt-template
  behavior as independently reviewable slices.
- [ ] Lane B lands P1.1's native bridge contract and first Open/Save path.
- [ ] Lane C lands P1.4's lossless categorical/metadata representation and
  import round-trip tests.
- [ ] Lane D lands K's acyclic dependency model and deterministic evaluation
  tests before derived-workbook UI.
- [ ] Lane E builds L metadata selection/edit primitives without waiting for
  Collections polish.
- [ ] Lanes F/G finish contract tests and schemas; implementation begins only
  after adversarial review.
- **Gate:** no unresolved schema ambiguity enters Day 2 silently.

### Day 2 — first user-visible integrations

- [ ] Merge H after Quick Plot With / mismatch / no-auto-overwrite browser proof.
- [ ] Complete P1.2 named atomic save/recovery on the P1.1 bridge; begin P1.7.
- [ ] Complete P1.6 import role assignment and begin P1.5 grouping on P1.4.
- [ ] Complete K derived worksheet + Freeze Copy happy path.
- [ ] Complete L batch metadata + basic project-local Collections.
- [ ] Begin J combine/split against the frozen dependency contract.
- [ ] I package round-trip and I2 lock-state machine pass pure tests.
- **Gate:** nightly integrated build and owner 30-minute smoke test.

### Day 3 — structural and destructive workflows

- [ ] Merge K and L if green; rebase J and M immediately.
- [ ] Merge P1.4/P1.6 and P1.1/P1.2 foundations; rebase all consumers.
- [ ] Complete J collision-safe combine/split and multi-source provenance.
- [ ] Complete M impact preview and atomic reimport/delete transaction core.
- [ ] Complete I small-package cross-instance round trip with fresh-ID rewrite.
- [ ] N atomic sidecar write/read/checksum and unavailable-vs-deleted states pass.
- **Gate:** failure injection is mandatory; happy-path-only PRs do not merge.

### Day 4 — platform and recovery

- [ ] Finish I bounded large transfer cleanup and incompatible/expired handling.
- [ ] Finish I2 read-only second open, Open as Copy, and guarded Take Over.
- [ ] Finish M stale/frozen/dependent recovery and one-session Undo behavior.
- [ ] Finish N Relink Data, cleanup limits, and portable Pack Project.
- [ ] Finish P1.7 Relink/portability and P1.5 live grouping/facet behavior.
- [ ] ChatGPT-Sol reviews wording, menus, previews and recovery affordances.
- **Gate:** Windows and macOS paths are required; Ubuntu is best-effort.

### Day 5 — feature freeze

- [ ] Merge remaining feature PRs in dependency order: P1.1 → P1.2 → P1.7;
  P1.4 → P1.6/P1.5; G5 → H/P1.3; K → J/L → M; then N → I/I2.
- [ ] Run full frontend/backend/unit/E2E suites plus architecture and bundle pins.
- [ ] Reconcile H–N plan entries and every linked unchecked item.
- [ ] Create one release-blocker list; everything else moves to post-sprint.
- **Gate:** no new features after this point.

### Day 6 — stabilization

- [ ] Fix release blockers only, using one PR per root cause where practical.
- [ ] Run Windows and macOS packaged smoke tests: import, browse, quick plot,
  configure, edit, template, combine, derive, copy/paste, save/reopen, reimport,
  delete/restore, offline/sidecar recovery.
- [ ] Owner performs a 60–90 minute real-data session and records friction.
- [ ] Verify installer/logo/desktop/taskbar behavior in the release artifact.

### Day 7 — release candidate and audit closure

- [ ] Re-run the release matrix on the exact candidate commit.
- [ ] Publish release notes with known limitations and recovery instructions.
- [ ] Cut the release candidate and retain the prior stable build for rollback.
- [ ] Re-audit all plan documents: completed, superseded, deferred, or blocked;
  none may remain ambiguously “in progress.”
- [ ] Schedule post-sprint triage after the owner has used the build.

## Definition of done for every slice

A checkbox is complete only when the behavior is reachable through the shipped
UI, uses canonical project state, survives its required persistence boundary,
has failure-path tests proportional to risk, has no raw-data mutation unless
explicitly authorized, passes CI, and has been reviewed by someone other than
its implementer. A prototype, disabled button, unreviewed branch, or happy-path
unit test is not completion.

## Decision and escalation budget

- The owner reserves two short decision windows daily. Unanswered noncritical
  choices take the documented recommended default; destructive or schema choices
  pause only their lane.
- Any PR open more than 12 hours receives a second reviewer or is split smaller.
- Any lane failing the same gate twice escalates model/reviewer before adding code.
- If I/I2, M, or N lacks a reviewed contract by the end of Day 1, its safe core
  may ship behind an explicit preview label, but the parent item stays deferred.
- If the integrated suite is not green by the end of Day 5, scope is reduced;
  stabilization days are never consumed by new feature implementation.

## Expected staffing and realistic confidence

This plan assumes one active Claude orchestrator, Claude worktrees for lanes
A–G (or fewer worktrees running two short sequential slices), cheap
implementation/test agents beneath them, ChatGPT-Sol for bounded GUI
acceptance, and prompt owner decisions. Worktree count is not the binding
constraint; concurrent review capacity is (see orchestrator adjustment 1
above). It can produce a broad release candidate in seven days. It cannot
guarantee that every advanced workflow is production-mature before real use;
the release-candidate label and explicit defer mechanism are essential
safeguards, not loopholes.

## Sprint log

- **2026-08-17 — ChatGPT-Sol:** Created the sprint plan after the owner asked
  what it would take to traverse the entire roadmap in one week. Reframed
  “entire list” as the authoritative H–N queue plus explicit reconciliation of
  linked checkboxes; preserved review, CI, failure-path, and release gates.
- **2026-08-17 — ChatGPT-Sol:** Reconciled the cheaper-model inventory and
  expanded scope beyond Library H–N to the Primary audit's more consequential
  P1.1–P1.7 queue. Made N evidence-gated and added the owner-only switch-trigger
  and Office acceptance gates.
- **2026-08-17 — Claude (orchestrator):** Owner adopted the sprint. Folded the
  four review adjustments in; Day 0 dispatch begun (contract scouts for
  P1.1/P1.4/K, useApp.ts slack pre-bank, lane briefs).
- **2026-08-19 — Claude (QA lane), Day-5 retrospective:** see the dedicated
  `## Day-5 retrospective` section below for the full record — what the
  adversarial-review process caught this week, and the two process lessons
  worth keeping into the next frontend-heavy wave.

## Day-5 retrospective (QA lane, 2026-08-19)

This is the sprint's Day-5 "reconcile and take stock" checkpoint, not a
sprint-close: Days 6-7 (stabilization, release candidate) are still ahead,
and three lanes (I/I2, J slice 2 + L slice 2 UI, J2 recode + P1.6b) are
in flight past this point. Full plan-by-plan corrections are in each plan's
own Day-5 change-log entry (`LIBRARY_WORKBOOK_UX_PLAN.md`,
`PRIMARY_SOFTWARE_AUDIT_PLAN.md`, `JMP_GAP_PLAN.md`) and the release-blocker
list is `plans/RELEASE_BLOCKERS.md`. This section is what the *process*
itself is worth recording, separate from the feature status.

### What the adversarial-review pipeline actually caught

The sprint's "tiered review depth" rule (contract PRs get full adversarial
review) earned its cost this week. Six real defects were caught before they
reached a released state — four in review rounds, two only by CI (never
locally, since this sandbox cannot run Playwright — see below):

- **A chain-composition bug that silently used pristine instead of
  corrected data** (PR K review round, commit `866277b`).
  `store/derivedWorksheets.ts` read `source.raw ?? source.data` when
  deriving a new worksheet from an existing one — correct for
  re-correcting a dataset in place, wrong for deriving FROM another
  dataset, whose `.raw` means "that dataset's own pristine cache," not
  "the corrected table the user is looking at." A two-hop derived chain
  (C from B, B from A) silently skipped B's entire correction pipeline and
  derived from A's raw values instead, at both creation time and every
  recalc. Caught by review, not by the original test suite — the original
  tests never exercised a chain more than one hop deep.
- **A stale-index split-brain across two hierarchies** (PR J review round,
  commit `8b0b294`). `combineWorkbooks`/`commitSeparateWorksheets`
  reassigned `Dataset.workbookId` on move but left `folderId` untouched,
  breaking the documented invariant that folder placement is owned by the
  workbook (`lib/workbooks.ts:52-54`) — a worksheet moved by Combine or
  Separate would vanish from Folder view while still showing correctly in
  the workbook tree, two hierarchies disagreeing about where the same
  dataset lived.
- **An arbitrary-local-file-read consent hole** (PR P1.7 review round,
  commit `47e6b89`). The first version of the new `grant_source_paths`
  bridge method was a bare passthrough trusting the frontend's own argument
  list as authority — any JS running in the window could self-grant read
  consent for an arbitrary path (a user's SSH key, cited as the concrete
  example) with no dialog and no project even open, then read it through
  the existing import route. Fixed by making the declared-source set
  backend-tracked, populated only as a side effect of a real native
  open-project dialog parsing that project's own declared source paths.
- **A dirty-flag blind spot that made edits crash-lossy** (PR P1.2 review
  round, commit `f2f5b01`). `AutosaveState`/`shouldAutosave` were missing
  `collections` and `quickPlotTemplates` from their tracked-fields list —
  both persist in `.dwk` but had no autosave/dirty trigger, so renaming a
  Collection or saving a Quick Plot template left the project looking
  "clean" right up until a crash lost the edit. A completeness sweep during
  the same review round caught two more fields in the same class
  (`toolWindowLayout`, `originFidelity`) before they shipped with the same
  gap.
- **CI-only catch — a Windows null-path never-raises violation** (commit
  `c756291`). `desktop_source_probe.py`'s `probe_source_path` promises
  "never raises into JS," but only caught `OSError`; a malformed path
  (embedded null byte) makes `os.path.realpath` succeed silently on
  Windows with no OS-level validation, deferring the real failure to
  `os.stat`/`open()`, which raise `ValueError` — a different exception
  class the guard didn't catch. Invisible on Linux/macOS, where `realpath`
  itself degrades the same input through `OSError`. Found only because
  Windows CI actually ran the test; reproduced deterministically on Linux
  afterward by monkeypatching the exact Windows error class.
- **CI-only catch — four blind-authored E2E interaction artifacts**
  (commits `3f4859a`, `ac62a63`, `5f9e493`, `f71a782`). A Graph Builder
  overlay left open intercepted a positional Stage click; a legend-label
  selector picked up the reorder buttons' own glyphs as if they were series
  labels; a Graph Builder close needed to happen once, structurally, not
  per-collision; and a UI label change (P1.2's "Save workspace (.dwk)…")
  broke an E2E assertion pinned to the old exact text. None were caught
  locally — they surfaced only when GitHub Actions ran the real browser.

### Two process lessons worth keeping

1. **`git stash` is repo-wide and cross-contaminates concurrent worktrees —
   use plain commits instead.** With multiple lanes running in parallel
   worktrees against the same repository, a `git stash` in one worktree is
   visible (and poppable) from any other, since the stash ref is shared
   git state, not worktree-local. A plain WIP commit in the lane's own
   branch has no such cross-talk and costs nothing extra to clean up later.
   This sprint's own operating rules already banned it for exactly this
   reason; recorded here so the NEXT multi-worktree sprint states it as a
   rule from Day 0 rather than rediscovering it.
2. **Playwright cannot run in this sandbox, so every E2E journey is
   authored blind and costs a ~15-minute CI round to find out if it's
   right.** Every spec in this sprint was written against the real
   component tree and DOM contract but never executed locally before its
   first CI run — confirmed directly this week (P1.5's own change-log entry
   states the Playwright download is blocked by this session's egress
   policy, verified via the agent-proxy diagnostic, not assumed). The four
   E2E artifacts above are the direct cost of that: real defects, but ones
   a two-second local run would have caught in seconds instead of a CI
   round-trip. Recommendation before the next frontend-heavy wave: give at
   least one lane (or the integrator) a local machine with real Playwright
   installed, and route E2E-touching diffs through it before pushing —
   the marginal cost of one CI round is small, but it compounds linearly
   with the number of E2E specs a sprint adds, and this sprint added a lot
   of them.
