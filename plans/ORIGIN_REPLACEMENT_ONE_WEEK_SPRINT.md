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

## Owner-observed field issues (2026-08-17; do not start without dispatch)

These findings came from actual use and outrank speculative polish. They are
recorded here for sprint triage; no implementation was started when recorded.

### UX-R1 — MDI dragging feels clunky

**Observation:** dragging plot/worksheet subwindows does not feel direct or
smooth enough for routine arrangement.
**Goal:** pointer movement should track the window predictably without jumps,
lost capture, accidental focus changes, or noticeable lag.
**Acceptance:** test title-bar drag at 100/125/200% scaling, fast and slow
movement, crossing other windows, and release outside the canvas; preserve the
final bounded geometry and make the active drag target visually obvious.
**Owner:** ChatGPT-Sol interaction review; Claude Sonnet implementation and
state/pointer-capture tests. **Sprint priority:** release blocker if readily
reproducible.

### UX-R2 — Background subwindows sometimes go blank

**Observation:** some subwindows lose their visible content while another
window is focused or after arrangement.
**Goal:** every visible window retains an honest live preview or an explicit
recoverable loading/error state; blank unexplained content is never acceptable.
**Acceptance:** reproduce across focus changes, drag, resize, minimize/restore,
Tile/Cascade, dataset rebind and project restore; test lazy hydration, error
boundaries and rich-error figures in focused/background renderers.
**Owner:** Claude Sonnet, escalate to Opus only if canonical window/document
state is implicated. **Sprint priority:** P1 release blocker.

### UX-R3 — Origin project imports are difficult to parse

**Observation:** import succeeds, but the left browser presents too many
similarly weighted objects and does not clearly communicate whether an item is
a folder, workbook, worksheet, plot, note or imported artifact.
**Goal:** imported projects should reveal their hierarchy progressively and use
plain, visually distinct object types with useful summaries; the common path
must not require understanding Origin internals.
**Acceptance:** test a realistic multi-book `.opju`; default to collapsed
Folder → Workbook groups, use distinct icons/type labels, provide counts and
breadcrumbs, suppress or tuck low-value technical artifacts behind disclosure,
and preserve Tree/Tiles/Details switching and search. Do not discard imported
content merely to simplify the view.
**Owner:** ChatGPT-Sol information architecture and visual acceptance; Claude
Sonnet implementation; cheaper models for fixtures/tests. **Sprint priority:**
daily-driver critical and part of the owner switch-trigger trial.

### UX-R4 — Making a plot and worksheet share the workspace is undiscoverable

**Observation/question:** the owner could not tell how to keep a plot and
spreadsheet from each taking the full working area. Existing commands include
**Window → Open Worksheet in Window**, **Tile Windows**, and **Cascade Windows**,
but their discoverability and first-use behavior are inadequate.
**Goal:** arranging a plot beside its worksheet should be obvious without
knowing command names or the MDI model.
**Acceptance:** validate a visible entry point from the worksheet/plot/Library,
clear maximize/restore affordances, and a one-action side-by-side arrangement;
retain manual free positioning after automatic arrangement. Add a concise
first-use tooltip or empty-state hint rather than a persistent tutorial.
**Owner:** ChatGPT-Sol UX decision; Claude Sonnet implementation. **Sprint
priority:** daily-driver critical usability.

### UX-R5 — Window resizing feels clunky

**Observation:** resize acquisition, tracking and feedback are not comfortable
enough for repeated figure/worksheet layout.
**Goal:** generous discoverable edge/corner hit areas, correct cursor feedback,
smooth pointer capture, useful minimum sizes, and stable content during resize.
**Acceptance:** test every edge/corner at 100/125/200%, rapid diagonal resize,
minimum-size clamping, resize across neighboring windows, plot reflow and
worksheet virtualization; no blanking, jump, or lost final geometry.
**Owner:** ChatGPT-Sol interaction acceptance; Claude Sonnet implementation and
Playwright coverage. **Sprint priority:** pair with UX-R1/R2 in one bounded MDI
hardening campaign after reproduction.

**Routing:** UX-R1/R2/R4/R5 form one MDI usability/reliability campaign but must
remain separately testable. UX-R3 belongs to the Library/Origin-import lane.
Do not bury these findings in archived MDI or Origin decoder plans; completion
must be logged here and cross-referenced from the active Library/Primary plans.

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
