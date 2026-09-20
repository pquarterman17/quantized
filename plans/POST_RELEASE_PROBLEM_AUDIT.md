# Post-release independent problem audit

**Author:** ChatGPT-Sol (independent review, not Claude)  
**Started:** 2026-09-20  
**Baseline:** `v0.26.1`, tag/merge commit
`4a9f733b8fcce1e433cbbd97eb4d846e0467bbb5`  
**Status:** Active, additive, and intended to be checked off  
**Purpose:** Find evidence-backed problems that still make Quantized harder or
less trustworthy than OriginPro/JMP, and leave enough context that another
agent can implement a fix without repeating the investigation.

## How to use this document

- [ ] Keep findings evidence-backed. A possible feature gap is not a bug until
  the current behavior and intended behavior are both stated.
- [ ] For every fix, add the PR/commit, focused regression test, full gate, and
  agent verification before checking the finding complete.
- [ ] Keep owner-only visual judgements open even when automated coverage is
  green.
- [ ] Reconcile completed findings into `BUGS_AND_ISSUES.md` and the relevant
  feature plan; do not leave two contradictory sources of truth.

## Audit map

### Release and installed-build integrity

- [x] Confirm the corrected tag matches all package declarations.
- [x] Confirm PyPI publishes and an isolated install imports version `0.26.1`.
- [x] Confirm Windows, macOS, and Linux artifacts, updater manifest, signature,
  and checksums exist on the stable GitHub release.
- [x] Confirm release workflows now reject a tag/package mismatch.
- [x] Probe the installed CLI's conventional version-reporting path.
- [ ] Install the Windows artifact and verify upgrade-in-place, icon identity,
  launch, backend startup, and uninstall entry. **Owner/real desktop required.**
- [ ] Install the macOS artifact and verify Gatekeeper/right-click-open,
  launch, and Dock identity. **Owner/real Mac required.**

### Primary Origin-replacement journeys

- [x] Reconcile the current Origin Library findings with UX-001 and UX-004;
  code changes are present, but both still honestly require the owner's eye on
  the reported dense Origin project.
- [x] Reconcile NCNR `.refl` uncertainty behavior with BUG-001; parser and
  role-binding code is covered, while current-release visual/manual-role and
  second-file checks remain open.
- [x] Audit Quick Plot refusal and configuration guidance in the current code.
- [ ] Run import -> Library -> worksheet -> editable figure against the owner's
  dense Origin project and record screenshots plus exact confusing nodes.
- [ ] Run `.refl` -> Error Columns -> editable figure on Windows and record
  whether uncertainty/resolution become whiskers rather than plotted curves.
- [ ] Time unfamiliar-file-to-acceptable-figure and figure-to-PowerPoint copy.
  Targets remain 20 minutes and seconds respectively.

### Persistence and scientific integrity

- [x] Recheck ordinary dataset NaN/±Infinity/-0 persistence (BUG-017): the
  shared codec covers `.dwk`, autosave, Pack Project, and workbook transfer.
- [x] Inspect the distinct frozen-figure snapshot boundary; BUG-023 now routes
  it through the same codec at the JSON boundary.
- [x] Audit PageDocument frozen panels: a page stores only FigureDocument ids
  and inherits each figure's live/frozen ownership, so BUG-023's
  FigureDocument-boundary fix covers pages without a second snapshot codec.
- [x] Audit saved plot/template/recipe numeric payloads for independent raw
  `JSON.stringify` boundaries. Static `kind:"snapshot"` plot windows carry a
  second affected data payload and are included in BUG-023; PageDocuments,
  Quick Plot templates, and saved recipes hold references/configuration rather
  than an independent copy of the plotted numeric arrays.

### Figure screen/export/reopen parity

- [x] Reconcile existing matrix findings: axis breaks, waterfall offsets,
  legend renames, hidden-series colors, and grouped styles have landed.
- [ ] Exercise the acceptance matrix in `FIGURE_AUTHORING_WORKFLOW_PLAN.md`
  against the packaged build: errors, y2, hidden/reordered series, grouping,
  facets, 2x2 pages, PNG clipboard, SVG, and PDF.
- [ ] Compare at least one saved/reopened frozen figure containing gaps with
  its live source and export.

## Confirmed problems to solve

### BUG-023 — frozen figures and static snapshot windows lose non-finite identity

**Priority:** P2. **Fixed 2026-09-20.** The common NaN-gap shape remained a gap, but `+Infinity` and
`-Infinity` both silently reopen as NaN and `-0` silently reopens as `+0`.
That is a scientific-data identity loss inside an artifact explicitly meant to
be self-contained and durable.

**Evidence:**

- `frontend/src/lib/figureDocument.ts`'s `serializeFigureDocument` directly
  calls `JSON.stringify(document)`.
- The same module's `normalizeFrozenDataStruct` documents the loss and maps
  both JSON `null` and any non-finite numeric value to `Number.NaN`.
- `workspaceSerialize.ts` applies `encodeDataStruct` only to library datasets;
  `editableFigures` are copied verbatim into the workspace document. Therefore
  saving the whole workspace does not close this separate boundary.
- `plotsnapshot.ts` deep-copies the composed plot payload into a
  `FrozenPlotBundle`, and `workspaceSerialize.ts` copies `plotWindows`
  verbatim. Its sanitizer accepts only finite numbers or `null`; after JSON
  serialization it therefore cannot distinguish an original gap, NaN,
  +Infinity, or -Infinity, and signed zero has already become ordinary zero.
- The existing snapshot-window round-trip test covers only finite numbers and
  `null`, so it cannot detect this loss.
- BUG-017 already provides the correct codec and established sentinel contract;
  this finding should reuse it rather than inventing another representation.

**Reproduction to turn into a regression test:**

1. Create a frozen `FigureDocument` whose snapshot includes NaN, +Infinity,
   -Infinity, and -0.
2. Round-trip through `serializeFigureDocument` / `deserializeFigureDocument`.
3. Observe that the infinities return as NaN and `Object.is(value, -0)` fails.
4. Repeat through `serializeWorkspace` / `parseWorkspace` with the document in
   `editableFigures`, since that is the real project-save route.
5. Repeat with the values in a `kind:"snapshot"` plot window's payload,
   error-bar column, and colour-by `z` column.

**Implementation checklist:**

- [x] Route frozen snapshots through the shared BUG-017 sentinel encoder on serialization and
  the matching decoder on parse.
- [x] Cover both data-bearing boundaries: FigureDocument snapshots and static
  plot-window bundles (`payload.data`, `errorBars`, and colour-by `z`). Prefer
  one shared numeric-array codec rather than two subtly different sentinels.
- [x] Preserve byte-for-byte output for finite-only documents if feasible; if
  the wire type must widen, make that explicit and keep older documents valid.
- [x] Cover direct FigureDocument serialization and full workspace round-trip.
- [x] Check PageDocument frozen panels: `pageDocument.ts` deliberately carries
  no snapshot; panels resolve the referenced FigureDocument, so there is no
  independent persistence boundary to patch.
- [x] Confirm live documents and ordinary finite frozen documents are unchanged.
- [x] Run forced TypeScript build, lint, focused/full tests, repository gates,
  and production bundle check.
- [x] Record PR/commit and verification here and in `BUGS_AND_ISSUES.md`.

**Completion (2026-09-20):** `nonFiniteCells.ts` now exposes one numeric JSON
boundary replacer backed by BUG-017's exact four sentinels. Workspace saves,
standalone FigureDocument JSON, and workbook-transfer JSON all use that same
boundary without mutating live datasets. Frozen-document normalization and
snapshot-window sanitization decode the sentinels while retaining legacy
finite/`null` behavior. Direct and full-workspace regressions cover NaN,
±Infinity, and -0 in FigureDocument `time`/`values` and snapshot-window
`payload.data`, `errorBars`, and colour-by `z`; ordinary finite output is
byte-identical. The exact restored arrays are the inputs used by reopened
display/export, so the comparison is pinned below the renderer as a strict
identity contract. Verification: focused/architecture 271 tests; full frontend
694 files / 11,755 passed / 2 expected failures; forced TypeScript, ESLint,
production build and bundle gate; repository integrity 13/13. Eager JS is
877,160 B, 1,022 B under the unchanged 878,182 B ceiling and 743 B smaller than
the `origin/main` baseline. Implementation commit: `84679e60`; PR:
https://github.com/pquarterman17/quantized/pull/381.

**Suggested owner/model:** Claude Sonnet-class model for persistence-contract
reliability; ChatGPT-Sol for the final UI/reopen acceptance check.

---

### UX-005 — Quick Plot's refusal message says an already-shipped feature is future work

**Priority:** P1. This message appears exactly when Quick Plot cannot infer a
safe figure and the user most needs a clear next action. It currently makes the
app look unfinished and fails to direct the user to the adjacent working
command.

**Evidence:**

- `frontend/src/lib/quickPlot.ts` exports both refusal messages with the text
  “Configure Quick Plot arrives with the Quick Figure Builder (PR G)”.
- `datasetQuickPlotActions` already places **Configure Quick Plot…** directly
  after **Quick Plot**, and `QuickFigureBuilderWorkspace` is fully implemented.
- Multiple tests assert the stale sentence verbatim, so this is not merely an
  old comment; it is pinned current user-visible behavior in v0.26.1.

**Desired behavior:** State why automatic plotting is unavailable, then give a
present-tense action: “Choose Configure Quick Plot… to assign columns and
preview an editable figure.” Do not expose internal PR labels to users.

**Implementation checklist:**

- [x] Replace both refusal constants with concise present-tense guidance.
- [x] Keep the map-specific refusal focused on opening Map view; offer
  configuration only where a 1-D mapping is meaningful.
- [x] Update every pinned menu/palette/workbook test.
- [x] Search all rendered copy for `PR G`, `arrives with`, and similar internal
  roadmap language.
- [x] Verify disabled menu tooltips are one short sentence and name the exact
  adjacent action.
- [x] Run focused Quick Plot/Library tests, forced typecheck, lint, and build.

**Status:** Complete (2026-09-20). Generic and unsupported-technique refusal
copy now names the adjacent **Configure Quick Plot…** action and explains that
it assigns columns and previews an editable figure. The 2-D map refusal still
directs users to Map view because Quick Plot creates line figures and is not a
scientifically valid map renderer. Focused tests pass (4 files, 81 tests), as
do forced TypeScript, lint, clean build/bundle (857.4 kB eager, under the
857.6 kB budget), and repository-integrity tests (13 passed). Implementation
commit: [`4997396a`](https://github.com/pquarterman17/quantized/commit/4997396aa39b7f68fed3a07b1565c34bd7bd5958).

**Suggested owner/model:** ChatGPT/Codex inexpensive implementation model; this
is bounded frontend wording plus tests and does not need an expensive model.

---

### UX-006 — the installed CLI cannot report its own version

**Priority:** P3. This does not block plotting, but it adds needless ambiguity
to release troubleshooting and support.

**Evidence:** The published `quantized-lab==0.26.1` wheel installs successfully,
but `qz --version` exits with “unrecognized arguments: --version”. `cli.py`'s
argument parser has no version action. The version can only be checked by
importing `quantized.__version__` through Python.

**Implementation checklist:**

- [x] Add the conventional `--version` argument using the canonical
  `quantized.__version__` value.
- [x] Test both `qz --version` and the `quantized` alias without starting the
  server or opening a browser.
- [x] Add this check to the wheel smoke test so published metadata and runtime
  identity remain aligned.
- [x] Run backend lint, typecheck, CLI tests, and package build/smoke test.

**Completion evidence (2026-09-20):** `quantized.cli._serve` now registers
argparse's version action from the canonical `quantized.__version__`; both
console-script aliases therefore print the version and exit before browser or
server startup. Focused tests assert the zero exit and no startup calls, and
the PyPI workflow smoke test invokes both installed aliases. Implementation
implementation commit: `26e5272e` (PR opened from `codex/ux-006-version`).

**Suggested owner/model:** Claude Haiku-class or inexpensive Codex model; small
backend/packaging task with straightforward tests.

---

### UX-007 — workbook Properties is a disabled roadmap placeholder, not a command

**Priority:** P2. The Library is the user's main way to understand a dense
Origin import. A visible but permanently disabled **Properties…** command is a
dead end in exactly that workflow, and its tooltip exposes the obsolete
developer phrase “arrives with Details/Properties (PR D)”. PR D shipped the
Details renderer, but did not provide a unified workbook properties surface.

**Evidence:**

- `frontend/src/lib/workbookContextActions.ts` registers
  `workbook.properties` with `enabled: () => false` and an empty `run`.
- Its disabled reason is “arrives with Details/Properties (PR D)”.
- `workbookContextActions.test.ts` asserts that sentence verbatim.
- `LIBRARY_WORKBOOK_UX_PLAN.md` marks PR D complete while separately documenting
  that unified Properties was deferred. The current copy therefore misstates
  both current capability and next action.

**Desired behavior:** Prefer making **Properties…** open a lightweight,
read-only workbook inspector using information already present in Details:
name, project folder, source/provenance and availability, member/artifact
counts, import/modified time, and tags. Editing can remain in the established
Rename/Move/Add tag commands. If that surface is deliberately deferred, remove
the dead item rather than advertising an internal PR milestone.

**Implementation checklist:**

- [ ] Decide between a small read-only inspector and temporary menu removal;
  do not retain a permanently disabled roadmap placeholder.
- [ ] Reuse the canonical workbook projection/source status rather than
  computing a second interpretation of imported Origin structure.
- [ ] If implemented, make it reachable consistently from Tree, Details, and
  Tiles and return focus to its invoking row/tile on close.
- [ ] Keep the first version bounded: no raw-metadata editor or destructive
  action belongs in this dialog.
- [ ] Replace the pinned stale-copy test with behavior/accessibility coverage.
- [ ] Run focused Library tests, forced typecheck, lint, build, and the Library
  Playwright journeys.

**Suggested owner/model:** ChatGPT/Codex mid-tier frontend model for the
interaction design and implementation; Claude Sonnet-class review for data
projection consistency. A menu-removal-only interim fix needs only an
inexpensive model.

## Existing open problems confirmed as still relevant

- [ ] **BUG-001 / P0:** owner visual verification and a second Reductus variant
  remain required before uncertainty-role handling can honestly close.
- [ ] **UX-001 + UX-004 / P1:** compact rows and unique marks landed, but the
  dense reported Origin project still needs a real readability verdict.
- [ ] **BUG-002 / P2:** hard-linked source aliases can bypass raw-source write
  protection; strict expected-failure test remains open.
- [ ] **BUG-003 / P2:** a hidden stale Data Filter predicate remains a contract
  problem pending the product decision recorded in the living tracker.
- [ ] **BUG-005 / P2:** Corrections/Resample can numerically transform
  categorical codes and silently discard their meaning.
- [ ] **BUG-009 / P2:** pending-dataset handling remains several guards rather
  than a resolve-then-apply contract.
- [ ] **FEATURE-001 / P3:** faceted per-series styling remains deliberately
  unresolved; do not reapply the reverted one-style-list patch without first
  deciding whether styles are grid-wide or panel-specific.

## Recommended execution order

1. [ ] Fix UX-005 first: tiny, immediately visible, and removes misleading
   guidance from a primary workflow.
2. [ ] Resolve UX-007 next: remove the dead-end wording immediately, then use a
   small read-only inspector if it fits the current Library projection cleanly.
3. [x] Fix BUG-023 next: reuse an existing codec across both affected frozen
   payloads, with direct and workspace round-trip tests.
4. [x] Add UX-006 alongside other packaging work or as a tiny independent PR.
5. [ ] Perform the owner acceptance pass for BUG-001 and UX-001/UX-004 on the
   actual files; convert every observed failure into a numbered entry here.
6. [ ] Then take BUG-005 before lower-value polish because silently corrupting
   categorical meaning is more important than adding another plotting option.

## Change log

| Date | Author | Change | Evidence |
|---|---|---|---|
| 2026-09-20 | Codex | Fixed BUG-023 with the shared BUG-017 sentinel codec across frozen FigureDocuments, snapshot-window numeric arrays, workspace saves, and workbook transfer | Direct/full round trips; focused 271; full frontend 11,755; typecheck/lint/build/bundle; integrity 13 |
| 2026-09-20 | ChatGPT-Sol | Extended BUG-023 to the independent static snapshot-window payload; filed UX-007 for the dead workbook Properties placeholder; completed the saved numeric-payload boundary pass | Serializer/sanitizer tracing, persistence tests, action-registry and plan reconciliation |
| 2026-09-20 | ChatGPT-Sol | Created independent v0.26.1 audit; filed BUG-023, UX-005, and UX-006; reconciled the highest-priority existing open items | Static call-path inspection, published-wheel probe, release artifact/API verification |
