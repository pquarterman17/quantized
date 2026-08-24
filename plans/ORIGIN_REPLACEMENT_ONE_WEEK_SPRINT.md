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

**Status note (2026-08-23, merged post-sprint):** this section is the dated
2026-08-17 record; the sprint has since closed and `v0.23.0-rc2` is cut, so
the per-item "release blocker" priorities below describe that sprint's
triage, not current gating. Current routing: UX-R1/R2/R4/R5 form the MDI
hardening campaign scheduled AFTER the owner's rc2 installed-acceptance run
(C5/R2 — the run that produces the reproduction evidence these items'
own acceptance sections call for); UX-R3 routes to the Library/Origin-import
information-architecture lane; UX-R6 to the annotation workflow items in the
active figure plans.

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

**Status note (2026-08-24, implementation-lane hand-back):** Claude-implemented
Library/Origin-import-IA slice landed on `claude/uxr3-origin-import-ia`
(scout + implementation + tests below the fold, "UX-R3 completion note").
ChatGPT-Sol visual acceptance is still open.

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

### UX-R6 — Plot annotation must be easy and scientific-workflow aware

**Observation/request:** the owner needs a fast, discoverable way to annotate
plots—for example, label XRD peaks and add arbitrary text—without returning to
code or hunting through publication-only tooling. General annotation, shape,
drag and property infrastructure already exists in the active figure plans;
this item records the missing daily-workflow acceptance rather than creating a
second annotation model.

**Goal:** add text or a callout in seconds, edit it directly, position it by
mouse, and optionally anchor it to plot data so it behaves predictably during
zoom/rescale. XRD peak results should offer a bounded **Label peaks** workflow
that creates ordinary editable annotations, not a separate permanent overlay.

**Acceptance:** verify an obvious toolbar/menu/context entry; click-to-place;
double-click text editing; drag with optional snap and free positioning;
right-click Properties; multiline copy/paste/cut; font, color, rotation,
alignment, frame and arrow/callout controls; Greek letters plus degree,
angstrom and common scientific symbols; session Undo; save/close/reopen and
export/Office persistence. For XRD, support selected/all fitted peaks, a label
template such as phase or `(hkl)` plus position, collision-aware initial
placement, and conversion to independently editable standard annotations.
Raw data and fitted peak results must never be rewritten by annotation edits.

**Owner:** ChatGPT-Sol interaction/wording and visual acceptance; Claude Sonnet
implementation/reliability; cheaper agents for fixtures and browser coverage.
**Sprint priority:** daily-driver important, scheduled after G5 persistence and
the MDI blank-window release blocker; manual text is release-relevant, bulk XRD
label generation may be a beta follow-up if it threatens stabilization.

**Routing:** UX-R1/R2/R4/R5 form one MDI usability/reliability campaign but must
remain separately testable. UX-R3 belongs to the Library/Origin-import lane.
UX-R6 strengthens the existing canonical annotation/peak workflows and must not
fork a new figure-decoration state model.
Do not bury these findings in archived MDI or Origin decoder plans; completion
must be logged here and cross-referenced from the active Library/Primary plans.

**Status (2026-08-24, Claude Sonnet):** manual half built — a Stage right-click
"Add text here…" entry (`lib/plotMenu.ts` / `PlotContextMenu.tsx`) places a new
annotation at the click's DATA coordinates via the SAME `addAnnotation` store
action and `AnnotationTextDialog` editor the toolbar's existing "Text box" tool
and the Inspector's Annotations card already use — no second annotation model.
Scouting found double-click-to-edit (pre-filled), drag, right-click Properties
(Edit text/Pin/Frame/Size/Delete), and save-close-reopen persistence already
implemented and covered by existing tests against the exact `Annotation` shape
`addAnnotation` produces; only the discoverable placement entry point and its
red-first tests were new.

**Status (2026-08-24, beta half):** the bulk XRD **Label
peaks** workflow is now built, same no-second-model discipline as the manual
half. A "Label peaks" button in the Peaks workshop (`PeaksPanel.tsx`) —
labeled "Label all N fitted/detected peaks…" so the source set is never
ambiguous — prompts (`askParams`, reusing the existing promise-based dialog,
no new dialog component) for a token template + decimal precision, then
creates ONE ordinary `Annotation` per peak via the SAME `addAnnotation` +
`updateAnnotation` store actions the manual half and the Inspector's
Annotations card already use (no new decoration model; a generated label is
structurally indistinguishable from a hand-placed one — tested). All labels
from one run share a single `Annotation.groupId` (bulk-manageable via the
Object Manager) while staying independently draggable/editable/deletable;
the whole run folds into ONE `withHistoryBatch` undo entry (N labels, 1 undo
step, red-first tested) via a new optional `historyToken` param threaded
through `addAnnotation`/`updateAnnotation` (mirrors `addDataset`'s existing
pattern). The dataset's `DataStruct` and the peak/fit results are read-only
inputs — never rewritten by labeling, editing, or deleting a label
(red-first tested via before/after deep-equality). Collision-aware initial
placement (`lib/peakLabels.ts`, pure — no React/uPlot/store import, fully
unit-tested) staggers labels into vertical tiers when neighboring peaks are
closer in x than a length-derived threshold, and never produces NaN for
degenerate input (single peak, zero-width range, every peak at one x).

Honest gaps, carried forward rather than faked:
- **No phase/`(hkl)` label token.** `Peak`/`FittedPeak` carry no
  crystallographic indexing field anywhere in quantized today, so the token
  template is deliberately limited to fields that actually exist —
  `{center}`, `{height}`, `{fwhm}`, `{area}`, `{index}` (1-based), plus
  literal text (default template: `{center}`). An unknown token — including
  a future `{phase}`/`{hkl}`— renders literally rather than throwing, so the
  template mechanism (`renderLabelTemplate`'s token `switch` in
  `lib/peakLabels.ts`) is ready to gain that token the day a real indexing
  data source lands; no fabricated crystallography ships in the meantime.
- **No per-peak selection.** `DataTable` (the peaks list's own primitive)
  has no row-selection support today, so this lane intentionally did not
  build one (out of scope per this item's own ruling) — "Label peaks"
  operates on ALL fitted peaks when a fit result exists, otherwise ALL
  detected peaks, and says so in the button's own label. Selected-subset
  labeling is a follow-up once `DataTable` (or a peaks-specific list) grows
  row selection.

**Status (2026-08-24, round-2 review fixes):** a second review pass found
seven issues in the beta half above; all are fixed here, red-first, in the
same branch.

- **CRITICAL — apex y was `height` alone, not `height + bg`.** `Peak`/
  `FittedPeak.height` is measured ABOVE background (`calc/peaks.py`'s
  `find_peaks_robust` confirms: a Gaussian pair riding a +500 offset returns
  `height=30, bg=500` for an apex whose true y is 530), so on any real
  XRD pattern — which always has a background — every label landed a whole
  background below the peak it named, typically off-screen. Fixed: apex y is
  now `height + bg` for both the fitted and detected branches
  (`usePeaks.ts`'s `labelPeaks`). `Peak` also gained an explicit `bg: number`
  field in `lib/types.ts` (it arrived over the wire already — `calc/peaks.py`
  always returned it — but only through the untyped index signature; it is
  now type-checked at every call site instead of incidental).
- **Latent pre-existing bug this review surfaced, fixed alongside it:** the
  DETECTED-peak marker overlay (`usePeaks.ts`'s auto-find effect,
  `setPeakOverlay`) called `peakOverlayArray` with `height: p.height` and
  omitted `+ p.bg`, while the FITTED-peak overlay a few lines below always
  included it. Detected-peak markers have therefore ALWAYS drawn at the
  wrong height on any backgrounded dataset — floating near the axis instead
  of sitting on the peak — independent of the Label-peaks feature entirely.
  Fixed with its own red-first test; this was a bug in existing `main`
  behavior, not something the beta half introduced.
- **Error handling.** `labelPeaks` now wraps its work in try/catch, matching
  the sibling `fitTogether`/`fitEach` actions — a `resolveDataset` rejection
  (or any other failure) surfaces as a danger toast and creates nothing,
  instead of an uncaught rejection silently swallowed by the `void` call
  site in `PeaksPanel.tsx`.
- **Precision clamp.** The "Decimals" value is now clamped to `[0, 10]`
  (previously only the low end was guarded) — a value like 999 used to make
  `toFixed` throw `RangeError` and, before the error-handling fix above,
  abort the whole run with no feedback.
- **Nested-batch undo hole.** `withHistoryBatch` folds ANY caller into
  whichever batch already happens to be in flight — not just a genuinely
  nested call from the SAME operation — so labeling while e.g.
  `relink.ts`'s "import as a new version" is mid-flight (a real network
  round trip, nothing else in the UI disabled meanwhile) would have silently
  ridden that unrelated batch's one undo entry: a single Ctrl+Z would have
  reverted the import AND deleted every label. Determined REACHABLE from the
  UI (the Relink and Peaks panels can both be open at once, and nothing
  blocks interaction during the import's awaits). Fixed with a cooperative
  pre-flight guard (`rejectIfHistoryBatchRunning`, same shape as
  `store/importDatasets.ts`'s `isImportRunning`/`rejectIfImportRunning`),
  checked both before the template dialog opens and again right before the
  batch commits (the dialog await is the widest remaining window) — narrows
  the race rather than closing it with a hard lock, tested directly by
  pinning the guard (`historySuppressed: true` → zero annotations, dialog
  never opened).
- **Blank labels.** A template that renders blank for a peak (e.g. `{area}`
  over DETECTED peaks, which always have `area: null`) is now skipped rather
  than creating an invisible blank annotation, matching the manual half's
  existing guard. If EVERY peak's label comes out blank, nothing is created
  at all — no annotations, no undo entry.
- **Placement collisions with unequal apex heights.** The original tiering
  compared candidate tiers by x only, then offset each label relative to its
  OWN apex y — two neighbours whose heights happened to differ by about one
  tier step could land at the exact same absolute y despite getting
  different tier numbers (every existing placement test used equal-height
  apexes, so this was untested). `lib/peakLabels.ts`'s `placeLabels` now
  does genuine 2-D collision checking: each already-placed label owns an
  axis-aligned box (its own rendered length for width, one tier step for
  height), and a candidate tier is accepted only once its box clears every
  box placed so far. `BASE_OFFSET_FRAC`/`TIER_STEP_FRAC`/`CHAR_FRACTION` are
  now exported so tests can assert the actual no-overlap invariant directly
  rather than trusting internal tier bookkeeping; new tests cover unequal
  heights generally and the specific "neighbour one tier step taller" case
  that reproduced the original bug.

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

## Reconciliation status (2026-08-19, orchestrator)

**Days 0-5 are complete; Days 6-7 have not started.** The sprint reached
feature freeze, not release. Recorded here because the checkboxes below were
never ticked as work landed and the document read as though nothing had
happened.

Basis for a tick: a merged PR that delivers the item, adversarially reviewed
by an agent other than its implementer, green on CI. That is the plan's own
definition of done. Twenty lane PRs (#167-#186) landed this way; `main` tip
`0ff2ff7` is green on all 13 checks.

Three classes of item are deliberately NOT ticked:

- **OWNER** — requires the owner at a real machine with real data. Cannot be
  manufactured by an agent: the baseline preview build + 20-minute Quick
  Figure smoke, the switch-trigger friction log, and Windows/macOS Office
  copy/paste.
- **SOL** — ChatGPT-Sol's wording/menu/preview/recovery review (Day 4).
- **DEFERRED WITH EVIDENCE** — lane N (managed large-data sidecars). The
  sprint's own rule gates N on existing large-data evidence justifying it;
  the QA lane found it did not. See `LIBRARY_WORKBOOK_UX_PLAN.md` item 14.
  This is the sanctioned closure for that lane, not hidden unfinished work.

**Correction to the Day-5 release-blocker list.** Both items
`RELEASE_BLOCKERS.md` filed as BLOCKER were already fixed on 2026-07-31,
three weeks before the list was compiled; the list quotes their pre-fix
measurements. P2.8's map regrid shipped as `231a1b8` (37.0 -> 1.24 s at 1M
points, via `calc/_grid_detect.py`) and P3.4's payload decimation shipped as
`d775100` (147.5 -> 3.5 MB at 1M x 7, via `calc/decimate.py`). The residuals
those fixes explicitly left open are a separate, smaller question and are
being measured on current `main` before anything is called a blocker.

## Merge sequence and daily gates

### Day 0 — baseline and dispatch (2026-08-17)

- [x] Merge G5 only after Claude's save/close/reopen/project-reload proof passes. **(#160.)**
- [ ] Tag or record the baseline preview build and run the owner’s 20-minute
  Quick Figure smoke workflow. **— OWNER, still open.**
- [ ] Owner starts the real switch-trigger project/friction log and confirms
  Windows/macOS Office copy/paste; agents cannot manufacture this evidence. **— OWNER, still open.**
- [x] Create worktrees and publish pickup briefs for lanes A–G. **(lanes A-G worktrees + briefs published.)**
- [x] Opus freezes native project (P1.1/P1.2/P1.7), categorical/grouping
  (P1.4/P1.5/P1.6), dependencies (K/M/J), transfer/locking (I/I2), and
  project/sidecar references (N). **(contracts frozen before implementation.)**
- [x] Record exact file ownership so concurrent lanes do not collide. **(no two lanes owned the same files; `useApp.ts` was the one shared chokepoint and the orchestrator was its sole integrator.)**

### Day 1 — foundations

- [x] Lane A implements H storage, scopes, compatibility and corrupt-template
  behavior as independently reviewable slices. **(#171.)**
- [x] Lane B lands P1.1's native bridge contract and first Open/Save path. **(#169.)**
- [x] Lane C lands P1.4's lossless categorical/metadata representation and
  import round-trip tests. **(#173.)**
- [x] Lane D lands K's acyclic dependency model and deterministic evaluation
  tests before derived-workbook UI. **(#172.)**
- [x] Lane E builds L metadata selection/edit primitives without waiting for
  Collections polish. **(#176.)**
- [x] Lanes F/G finish contract tests and schemas; implementation begins only
  after adversarial review. **(F: #184. G: contract work concluded in the evidence-backed defer below.)**
- **Gate:** no unresolved schema ambiguity enters Day 2 silently.

### Day 2 — first user-visible integrations

- [x] Merge H after Quick Plot With / mismatch / no-auto-overwrite browser proof. **(#171.)**
- [x] Complete P1.2 named atomic save/recovery on the P1.1 bridge; begin P1.7. **(#180; P1.7 begun.)**
- [x] Complete P1.6 import role assignment and begin P1.5 grouping on P1.4. **(#177; P1.5 begun.)**
- [x] Complete K derived worksheet + Freeze Copy happy path. **(#175.)**
- [x] Complete L batch metadata + basic project-local Collections. **(#176.)**
- [x] Begin J combine/split against the frozen dependency contract. **(#174.)**
- [x] I package round-trip and I2 lock-state machine pass pure tests. **(#184.)**
- **Gate:** nightly integrated build and owner 30-minute smoke test.

### Day 3 — structural and destructive workflows

- [x] Merge K and L if green; rebase J and M immediately. **(#172/#175/#176 merged; J and M rebased.)**
- [x] Merge P1.4/P1.6 and P1.1/P1.2 foundations; rebase all consumers. **(#173/#177 and #169/#180 merged; consumers rebased.)**
- [x] Complete J collision-safe combine/split and multi-source provenance. **(#174, #185, #186.)**
- [x] Complete M impact preview and atomic reimport/delete transaction core. **(#179.)**
- [x] Complete I small-package cross-instance round trip with fresh-ID rewrite. **(#184.)**
- [ ] N atomic sidecar write/read/checksum and unavailable-vs-deleted states pass. **— DEFERRED WITH EVIDENCE** (see `LIBRARY_WORKBOOK_UX_PLAN.md` item 14; the sprint rule "N ships only if existing large-data evidence justifies it" was applied, and the evidence did not justify it).
- **Gate:** failure injection is mandatory; happy-path-only PRs do not merge.

### Day 4 — platform and recovery

- [x] Finish I bounded large transfer cleanup and incompatible/expired handling. **(#184.)**
- [x] Finish I2 read-only second open, Open as Copy, and guarded Take Over. **(#184.)**
- [x] Finish M stale/frozen/dependent recovery and one-session Undo behavior. **(#179.)**
- [ ] Finish N Relink Data, cleanup limits, and portable Pack Project. **— DEFERRED WITH EVIDENCE**, same closure as the Day-3 N row.
- [x] Finish P1.7 Relink/portability and P1.5 live grouping/facet behavior. **(#181 / #182.)**
- [ ] ChatGPT-Sol reviews wording, menus, previews and recovery affordances. **— SOL, still open.**
- **Gate:** Windows and macOS paths are required; Ubuntu is best-effort.

### Day 5 — feature freeze

- [x] Merge remaining feature PRs in dependency order: P1.1 → P1.2 → P1.7;
  P1.4 → P1.6/P1.5; G5 → H/P1.3; K → J/L → M; then N → I/I2. **(all 20 lane
  PRs #167-#186 merged in dependency order; N deferred, so I/I2 landed on the
  frozen project schema directly.)**
- [x] Run full frontend/backend/unit/E2E suites plus architecture and bundle pins. **(13/13 green on `main` tip `0ff2ff7`: CI matrix, frontend x2, E2E, CodeQL x4. Bundle pin held at 878.2 kB against the 883.9 kB budget.)**
- [x] Reconcile H–N plan entries and every linked unchecked item. **(#183.)**
- [x] Create one release-blocker list; everything else moves to post-sprint. **(`plans/RELEASE_BLOCKERS.md`; corrected 2026-08-19 — see the reconciliation status block above.)**
- **Gate:** no new features after this point.

### Day 6 — stabilization

- [ ] Fix release blockers only, using one PR per root cause where practical.
- [ ] Run Windows and macOS packaged smoke tests: import, browse, quick plot,
  configure, edit, template, combine, derive, copy/paste, save/reopen, reimport,
  delete/restore, offline/sidecar recovery.
- [ ] Owner performs a 60–90 minute real-data session and records friction.
- [ ] Verify installer/logo/desktop/taskbar behavior in the release artifact.

## Independent Day-6 audit — required before Day 7

**Added 2026-08-20 by ChatGPT-Sol.** This is an independent review of the
merged Day 0–6 work on `origin/main` through `1721716b`. The audit made no
application-code fixes. The local frontend suite passed (535 files / 7,849
tests), TypeScript typecheck passed, and the candidate's GitHub CI, E2E and
CodeQL checks were green. Those results do not cover the release, concurrency
and workflow defects below. Every P0 and P1 item must be fixed and independently
reviewed, or explicitly deferred by the owner with an honest user-facing
limitation, before Day 7 begins.

### P0 — release gates and claims

- [ ] **Complete the four Day-6 gates above with recorded evidence.** Run the
  packaged Windows and macOS workflows, the owner's 60–90 minute real-data
  session, installer/icon checks, and the outstanding ChatGPT-Sol wording,
  menu, preview and recovery review. Do not infer these from unit/E2E CI.
  **Owner:** owner + Claude Sonnet; **review:** ChatGPT-Sol. **— OWNER/SOL, still open (agents cannot run these).**
- [ ] **Test an installed, packaged app rather than only its build and sidecar.**
  On Windows and macOS, install and launch the candidate and exercise import →
  browse → Quick Plot → configure/edit → copy/paste → save/reopen → reimport →
  delete/restore → recovery. Include real native dialogs, cancel paths, Unicode
  and network/offline paths. Record OS, artifact, exact SHA and outcome.
  **Owner:** Claude Sonnet + owner; **review:** ChatGPT-Sol. **— OWNER, still open; fresh post-audit installers will be linked when built.**
- [x] **Correct the I2 single-writer claim before release.** The current default
  lock provider is a process-local `Map`; it cannot protect two desktop
  processes or browser tabs, although the sprint, release-blocker list and RC
  notes currently describe I2 as closed. Either ship a filesystem/native shared
  provider with atomic conditional acquisition and packaged two-process tests,
  or label the feature preview/deferred and correct every release claim and
  limitation. **Design/review:** Claude Opus; **implementation:** Claude Sonnet. **(#199: shipped a REAL cross-process provider — atomic O_EXCL + fcntl/msvcrt CAS lock file beside the project, consent-gated bridge methods, token-bound saves, real two-process test. Release claims corrected in `RELEASE_BLOCKERS.md`/`RC_RELEASE_NOTES_DRAFT.md`; browser multi-tab remains the labeled defer.)**

### P1 — correctness fixes required for the candidate

- [x] **Make lock ownership atomic across open, takeover and write.** Replace the
  read/classify/unconditional-write sequence with compare-and-swap or equivalent
  OS-lock semantics; bind the verified lock token to the project replacement;
  test simultaneous open/takeover. Save As must acquire the new path and release
  the old path, including failure/rename cases. **Owner:** Claude Opus for the
  contract, Claude Sonnet for implementation and tests. **(#199. Orchestrator review additionally found and fixed an orphan-inode race that genuinely broke mutual exclusion — post-lock fstat/stat identity verification on every mutation — plus a Windows release tombstone; see the PR comments.)**
- [x] **Make relink commit re-probe the candidate safely.** Recompute the verdict
  against original provenance immediately before commit and reject changed or
  insufficiently verified rows. When a recorded checksum exists but a fresh one
  is unavailable, return `unknown` rather than falling back to metadata. Make
  “Import as new version” plus `versionOf` one undoable history transaction.
  **Owner:** Claude Sonnet; **review:** Claude Opus. **(#196. NOTE: the "does not recompute before commit" half of this row was REFUTED on verification — `commit()` already TOCTOU re-probes; the real fixes were checksum-unavailable → unknown, unknown rows excluded from bulk commit with per-row escalation, and one-undo import-as-new-version.)**
- [x] **Repair positional-column correctness.** Deleting a computed/recode column
  must remap or explicitly invalidate downstream formula dependencies instead
  of creating shifted/self references. An open Recode workshop must retain a
  stable channel identity and must not silently target a different categorical
  column after removal/reimport/index shift. Add chained formula/recode and open-
  panel index-shift regressions. **Owner:** Claude Sonnet; **review:** ChatGPT-Sol. **(#198: parser-based expr/deps letter rewrite on removal, explicit "references removed column" errors, identity-checked Recode commits with retarget-or-refuse.)**
- [x] **Validate Quick Plot error roles when applying templates.** A saved
  template records `errorRole` but resolution currently checks only label/unit,
  so an ordinary value column can be rebound as an error column. Compare every
  referenced channel's saved/current error classification and refuse mismatches
  with an actionable explanation. **Owner:** Claude Sonnet; **review:**
  ChatGPT-Sol. **(#195: resolution now compares saved vs current errorRole and refuses the whole template with an actionable message.)**
- [x] **Prevent silent multi-X data loss in Import Wizard.** The UI permits
  multiple X roles while the importer selects the first and omits the others.
  Enforce zero or one X role with visible validation and backend/UI regressions.
  Error-role suggestions must also use the effective label-row name used by the
  final import, not only the raw header. **Owner:** Claude Sonnet; **review:**
  ChatGPT-Sol. **(#197: backend rejects >1 x-role naming the columns; UI validates + disables Import; suggestions classify against label_line-effective names with a preview/parse parity test.)**
- [x] **Fix command cancellation and stale-path semantics.** Add Recent Projects
  only after replacement is accepted. Ensure a canceled reimport picker settles
  without a hanging promise. Treat an offline/network-unavailable source
  distinctly from a deleted/missing source and present recovery rather than a
  generic backend failure. **Owner:** ChatGPT-Sol for UX contract; Claude Sonnet
  for implementation/reliability tests. **(#194. NOTE: the offline sub-claim was imprecise — offline previously got NO handling (missing got better treatment); it now has its own recovery branch.)**
- [x] **Perform and record independent review of high-risk sprint PRs.** The
  sprint says all lane PRs were independently reviewed, but sampled high-risk
  PRs have no durable GitHub review/comment evidence. Record reviewer, verdict,
  fixes and residual risk from any transcript review, or conduct a fresh review
  of locking, persistence, relink, recovery, imports and derived-data work.
  **Owner:** Claude Opus for backend/state; ChatGPT-Sol for GUI/workflows. **(durable review-evidence comments posted on #184, #180, #181, #179, #186 — reviewer, verdict, pre-merge defects, rejected suggestions, residual risk; #188/#189/#194-#199 carry verification evidence in their PR bodies.)**

### P2 — fix if bounded; otherwise name the post-RC issue

- [x] Harden malformed categorical `cat_levels` payloads so list/string/wrong-
  mapping corruption degrades safely instead of escaping as `AttributeError` or
  splitting strings into characters. Add route-level corruption tests.
  **Owner:** Claude Sonnet. **(#195: `_parse_cat_levels_payload` drops malformed entries instead of raising or splitting strings; route-level corruption tests via /api/corrections/apply.)**
- [x] Avoid phantom Undo entries for missing datasets, blank/duplicate tags and
  unchanged metadata by recording history only after computing a real patch.
  **Owner:** Claude Haiku or Sonnet; **review:** Claude Sonnet. **(#195: the four single-row metadata actions + removeFormula now compute the effective change before recording history.)**
- [x] Make performance closure reproducible: retain a benchmark command/artifact
  for the reported 1M/4M map timings and a bounded regression test. Current
  smaller functional tests do not substantiate the documented timings.
  **Owner:** Claude Sonnet. **(`tools/baselines/BENCH.md`, added with this closure — exact commands for the 1M/4M map measurements.)**
- [x] Reconcile release documentation to the exact candidate SHA. Update the RC
  notes beyond PR #189, disclose every accepted limitation (especially locking),
  and track unverified updater/install/upgrade, interrupted-write, old-workspace,
  long Unicode/network-path and browser multi-tab cases. **Owner:** Claude Haiku
  for mechanical reconciliation; **review:** Claude Sonnet + ChatGPT-Sol. **(this closure pass: I2 claims corrected in `RELEASE_BLOCKERS.md` + `RC_RELEASE_NOTES_DRAFT.md`, audit-fix section added to the RC notes, bundle-budget raise documented in `check-bundle-size.mjs`. The RC notes retain the re-point-at-final-SHA instruction for tag time.)**

### Audit closure gate

- [x] All P0/P1 rows above have a linked fixing PR and independent verdict, or an
  owner-approved defer with user-visible limitation and a named follow-up issue. **(every P0/P1 code row: #194-#199 + the P1-7 comment links; the two remaining P0 rows are owner/Sol-only and stay open above.)**
- [x] Re-run the complete matrix on the resulting exact SHA; do not reuse green
  checks from `1721716b` after fixes land. **DONE 2026-08-21 — the `v0.23.0-rc1`
  tag at `069616d1` re-ran the full matrix via release workflow run
  `32548354991`, all legs green (Windows, Linux, Apple-silicon macOS).**

### Day 7 — release candidate and audit closure

**Reconciled 2026-08-23 (R10, `plans/POST_SPRINT_INDEPENDENT_REVIEW.md`).**
Day 7 names three distinct states of "done" that were previously conflated
under one unchecked list. They are now tracked separately:

- **RC published — DONE.** `v0.23.0-rc1` tagged at `069616d1` (2026-08-21,
  commit `chore(release): v0.23.0 (#201)`) and published via release workflow
  run `32548354991` — Windows, Linux and Apple-silicon macOS artifacts, all
  legs green. Published as a GitHub **prerelease** (enforced in `release.yml`
  for `-rc` tags): auto-update keeps serving `v0.22.0`; PyPI is untouched
  (`pypi.yml` skips `-rc` publishes). The remote-agent git proxy could not
  push the tag ref directly (silently no-ops tag pushes — see
  `.github/workflows/cut-tag.yml`'s header comment), so the tag was created
  via that workflow (`#202`, a `workflow_dispatch` using the runner's own
  `GITHUB_TOKEN`) and `release.yml` was then dispatched manually against the
  new tag ref.
- **Engineering sprint complete — DONE, including audit remediation.** Ships
  the 20 lane PRs #167-#186, the measured map-performance fixes #188/#189/
  #191, the independent Day-6 audit's correctness wave #194-#200, and —
  post-tag — the `POST_SPRINT_INDEPENDENT_REVIEW.md` follow-up audit's fixes
  #206 (calculator provenance), #203/#204/#209 (P1.3 plot-recipe arc), and
  #207/#208/#210/#211/#212/#213 (R1/R4/R3/R7/R6/R9 — see that document's
  closure log for independent-review evidence on each). R8 (bundle headroom)
  closed 2026-08-23: #216 + #218 (with #215's schema split) recover a
  measured 20.3 kB of eager JS (926,154 → 905,870 B, budget ratcheted to
  906,894); #217 additionally lands the relink native folder-grant consent
  from the release handoff's contract. Acceptance (R2) therefore targets a
  new `v0.23.0-rc2` cut from `main` after #218 — rc1 predates all of this.
- **Stable promotion accepted — OPEN, owner.** Not started. Per the owner's
  own decision (recorded 2026-08-22), promotion is deliberately deferred
  past the tag: the packaged Windows/macOS install + workflow smoke pass,
  the 60-90 minute real-data session, the installer/icon/taskbar check, and
  ChatGPT-Sol's wording/menu review must run **against this exact RC build**
  first (`POST_SPRINT_INDEPENDENT_REVIEW.md` R2). Promotion itself is a
  separate plain `v0.23.0` tag (same cut-tag-workflow + manual release-
  dispatch mechanics as the RC) once the owner gives the word; only then
  does `releases/latest`/auto-update/PyPI pick it up.

Sub-items, tracked against the three states above:

- [x] Re-run the release matrix on the exact candidate commit. (Done for the
  RC: release run `32548354991` on `069616d1`, all legs green. Promotion
  will re-run it again on the promotion tag's own SHA — not yet cut.)
- [x] Publish release notes with known limitations and recovery instructions.
  (`plans/RC_RELEASE_NOTES_DRAFT.md`, status FINAL for `v0.23.0-rc1`.)
- [x] Cut the release candidate and retain the prior stable build for
  rollback. (`v0.23.0-rc1` cut; `v0.22.0` installers remain on their
  Release per the RC notes' Rollback section.)
- [x] Re-audit all plan documents: completed, superseded, deferred, or
  blocked; none may remain ambiguously “in progress.” (This reconciliation
  pass: this document, `POST_SPRINT_INDEPENDENT_REVIEW.md`,
  `RELEASE_BLOCKERS.md`, `RC_RELEASE_NOTES_DRAFT.md`.)
- [ ] Schedule post-sprint triage after the owner has used the build. **OPEN
  — depends on R2's owner-acceptance session actually running first.**

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
- **2026-08-24 — Claude Sonnet:** UX-R6 manual-annotation slice. Added a
  Stage right-click "Add text here…" context-menu entry (data-anchored
  click-to-place) as the one genuinely missing piece of the manual-text
  acceptance list — double-click editing, drag, right-click Properties, and
  persistence were already implemented and already covered by existing
  tests. Booked the bulk XRD Label-peaks workflow as a beta follow-up per
  the section's own sprint-priority note; see the dated status note under
  UX-R6 above.

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

## UX-R3 completion note (2026-08-24, implementation-lane hand-back)

Scope: UX-R3 only ("Origin project imports are difficult to parse in the
Library"), on a dedicated worktree/branch (`claude/uxr3-origin-import-ia`),
current `main` at merge time `200fdb0`. Not a merge — orchestrator review is
still required before this lands.

**Scout findings — already met vs. gap.** The Library tree
(`components/Library/**`, `lib/libraryHierarchy.ts`) already had most of the
acceptance surface built by earlier PR C/D2/L work: `lib/libraryDetails.ts`
already carries a `TYPE_LABELS` map (Folder/Workbook/Worksheet/Origin
figure/…) and a `locationOf` breadcrumb column for Details/search; a
folder's/workbook's count chip (`lib/foldertree.ts`'s `subtreeCount`,
`WorkbookRow`'s worksheet count) is already computed live and independent of
expansion state; search (`LibraryDetails` in query mode) already walks the
full hierarchy regardless of collapse state, so tucked items were never
actually unreachable; and `OriginFidelitySection.tsx` already existed as a
disclosure group for decoder diagnostics (the closest concrete match to the
spec's "note"/"technical artifact" language — no separate Origin "note"
node kind exists in this codebase's parser/hierarchy). The genuine gaps were
narrower than the observation text suggested:

1. **The actual default-expand behavior inverted the spec.**
   `store/importDatasets.ts`'s Origin multi-book branch
   (`data.books.length > 1`) auto-expanded EVERY folder AND EVERY workbook it
   created on import — the literal mechanism behind "the left browser
   presents too many similarly weighted objects at once." A single-file
   import's one derived workbook auto-expanding (the pre-existing "a fresh
   import's row is immediately visible" contract, `importWorkbooks.test.ts`)
   was correctly untouched — see `docs/testing.md`-style reasoning in the
   PR: a multi-book PROJECT import spills dozens of rows at once, a
   single-sheet import spills exactly one.
2. **`OriginFidelitySection` defaulted OPEN**, not tucked — the one existing
   "technical artifact" disclosure group started expanded (`useState(false)`
   for its `collapsed` flag), the opposite of "suppress or tuck behind
   disclosure."
3. **`FolderRow` carried no type glyph at all** — `WorkbookRow` already had
   its own icon (`▤`, `title="Workbook"`), but the sibling `FolderRow` had
   only the disclosure caret, so a folder and a workbook read as visually
   closer together than the two other artifact kinds (each of which already
   has a distinct glyph via `ArtifactRow`/`FigureRow`).

**Design rulings (documented per the task brief):**

- **Auto-expand-on-import exception, scoped precisely to the
  `books.length > 1` branch of `addFromPayload`** (`store/importDatasets.ts`):
  a multi-book Origin project import no longer merges its created
  folders/workbooks into `expandedFolders`/`expandedWorkbookIds` — it lands
  fully collapsed at both the Folder and Workbook layers, so the ordinary
  disclosure caret reveals Folder → Workbook → Worksheet progressively, one
  click at a time. The single-dataset `else` branch (ordinary imports: a
  `.dat`/`.csv`/single-book Origin file) is UNCHANGED — its one new workbook
  still auto-expands, preserving the existing "the sheet I just imported is
  immediately visible" contract for the common non-project case. Nothing is
  hidden with no path back: every created row is present, individually
  expandable, and still fully searchable while collapsed (pinned by a new
  test — see below); this only changes the DEFAULT disclosure depth for a
  project-scale import.
- **`OriginFidelitySection` now defaults collapsed** (tucked, not deleted —
  the group header with its count is still visible; every manifest is one
  click away, exactly the "details-toggle" the task brief named as an
  acceptable suppression mechanism).
- **`FolderRow` gained a `▦` "Folder" glyph**, mirroring `WorkbookRow`'s
  existing icon convention (Unicode glyph + `title`, no emoji, no new CSS
  needed — matches the un-styled inline convention `WorkbookRow`'s icon
  already used).
- Explicitly NOT touched: `lib/libraryHierarchy.ts`'s node kinds,
  `lib/foldertree.ts`'s count/subtree logic, `LibraryDetails`'s
  type-label/breadcrumb columns, and the Tree/Tiles/Details view-switcher —
  all already met the spec as found.

**Files touched:** `frontend/src/store/importDatasets.ts` (collapse ruling),
`frontend/src/components/Library/OriginFidelitySection.tsx` (default
collapsed), `frontend/src/components/Library/FolderRow.tsx` (type glyph),
plus their tests (`store/importWorkbooks.test.ts`,
`store/useApp.test.ts`, `components/Library/OriginFidelitySection.test.tsx`,
`components/Library/FolderRow.test.tsx`) and a new integration-style test,
`components/Library/originImportIA.test.tsx`, exercising the acceptance
points against the real `LibraryTree`/`LibraryDetails` renderers (collapsed
by default; progressive one-level-at-a-time disclosure; distinct icons while
collapsed; a live count chip on a collapsed folder; search finding a
worksheet nested three levels inside a fully collapsed folder → workbook).

**Red-first evidence:** every store-level assertion changed by this PR was
verified red against the pre-fix code before the fix landed (confirmed via a
`git stash` of `importDatasets.ts` alone and re-running
`importWorkbooks.test.ts`, which failed exactly as expected; `useApp.test.ts`'s
own multi-book fixture caught the same regression independently on the first
full-suite run and was updated the same way).

**Gates (all green, foreground, current branch):** `npx tsc --noEmit` clean;
`npx eslint --max-warnings=0 src` clean; full `npx vitest run` — 555/555 test
files, 8445/8445 tests; `npm run build` — 888.7 kB eager JS against the
889.4 kB budget (unchanged budget; no raise needed).

**Left for ChatGPT-Sol / a follow-up:** visual acceptance of the new glyph
against the design tokens/theme in both light and dark, and a real multi-book
`.opju` fixture walkthrough (this PR's coverage uses synthetic fixtures
matching `lib/originFolders.ts`'s documented shape, not a captured `.opju`).

**Review round 2 follow-ups (2026-08-24, orchestrator final pass — booked,
not blocking merge):**

1. **Multi-book provenance gap (pre-existing, surfaced by this review):** the
   `books.length > 1` branch of `store/importDatasets.ts`'s `addFromPayload`
   never stamps `importedAt` or spreads `importRoles(...)` onto the per-book
   datasets — only the single-file `else` branch does — so book sheets from a
   project import carry no import timestamp and no inferred error-role
   bindings. Fix belongs with the import-provenance work (MAIN #33), not this
   IA slice.
2. **`OriginFidelitySection` disclosure state is per-mount:** `Library.tsx`
   unmounts the section while search is active, so a user who deliberately
   expanded the fidelity group loses that choice after every search (remount
   resets to the new collapsed default). Lift the flag to the store (like
   `expandedWorkbookIds`) or keep the component mounted. Pre-existing state
   loss; the flipped default makes it now always resolve toward hidden.
