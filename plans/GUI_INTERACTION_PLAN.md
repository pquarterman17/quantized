# GUI Interaction & Origin-Parity UX Plan

The interaction/UX campaign that turns quantized's broad-but-scattered gesture
set into one coherent, discoverable, reversible workbench — the work most likely
to keep the owner in quantized instead of reopening OriginPro. Backend analysis
parity is essentially done; the remaining risk is **"the capability exists, but
the user can't discover it, can't predict which gesture applies, or can't safely
undo the result."** Also folds in the scientific-selection correctness traps
(fits/baselines silently using the wrong column or ignoring error bars), which
for a publication tool outrank any discoverability gap.

**Status:** Active
**Created:** 2026-07-12
**Updated:** 2026-08-13 (the #17 `clearShapes` parked judgment call is
CLOSED — owner decided ADD CONFIRM, shipped `77bc718` same session; see
Completed. Prior: 2026-08-10, plan-hygiene reconciliation: #2, #5, #15, #17 had
every sub-box checked in their tier sections but were never struck/moved —
moved to Completed with their evidence dates. The only unchecked box left in
this plan is #16's `.opju` migration edges, which is owner-dependent. Prior:
2026-07-24 reconciliation: the #2 Plot Objects tree owner gate was struck as
MOOT — the large bet was taken and delivered by PR #66 on 2026-07-19, but the
gate above it was never closed. Before that: 2026-07-19 19:49 EDT, secure
read-only SQLite query connector added as the first database integration in
the stacked feature series.)
**Parent:** MAIN_PLAN.md
**Origin:** ChatGPT-"Sol" GUI interaction audit, 2026-07-12. The raw audit was
absorbed and DELETED on 2026-07-25 (plan-consolidation rule) — full text in git
history @ `e4f6590`. THIS file is the live tracker and always was.

---

## Context

### How the pieces fit together
The interaction surface spans several subsystems that today each own their own
editing grammar:
- **Plot canvas** (`components/Stage/`, `lib/uplot*`) — pointer/zoom/pan/cursor
  tools, annotations, shapes, reference lines, baseline anchors, axis-label drag +
  Format, legend drag; many competing pointer plugins on one DOM node.
- **Inspector / context menus** (`PlotContextMenu`, `ContextMenu`, Inspector
  cards) — series/axis/annotation/shape/dataset/worksheet actions.
- **Library** (`components/Library/`) — folders, smart folders, tags, figures,
  reports, book families; dense drag/drop with 3-zone folder drops.
- **Workshops** (`components/workshops/*`, floating `ToolWindow`s) — the no-code
  analysis UIs (curve fit, peaks, baseline, filter, pipeline…).
- **Graph/Figure Builder** — plot construction; builder output is a durable
  saved `PlotSpec` since 2026-07-17, including Figure-Builder handoff.
- **History** (`store/history.ts`) — one current-session edit history spanning
  data, visual/layout, and organization changes, plus a separate Back/Forward
  history for zoom/pan/autoscale navigation.

### The central thesis
quantized has the individual gestures Origin has, but not one **object-editing
language**. An expert can be productive; the owner after weeks away, or a new
user, must remember too much. The return-on-effort is making existing
capability **visible, predictable, and reversible** — not adding algorithms.

### Default-tool readiness (condensed from the audit; risk labels as of the
2026-07-12 audit — the 2026-07-17 campaign has since addressed much of this)
Highest return-to-Origin risk THEN: **direct graph editing** (capable but
hidden — #3/#7/#8/#9 shipped since), **undo/recovery** (strong for data, weak
for visual/organizational — still true, gated on #1), **buttons & tooltips**
(dense, icon-only — #7 shipped since), **reusable graph construction**
(was ephemeral — #11 core shipped saved PlotSpecs). Lower risk: core 2-D
plotting, publication export.

### Dependency map / sequencing notes
- **Correctness traps first.** #5 (baseline channel) and #6 (pipeline channel)
  produce silently-wrong published results — worse than any UX gap. #4 (weighted
  fitting) already shipped.
- **#1 (undo) underpins #2/#3** — direct manipulation only feels safe when
  reversible; build the undo scopes before widening drag/edit surfaces.
- **#8 (context-action registry) feeds #2 (Plot Objects tree)** — one action
  definition reused across right-click / tree / palette / mini-toolbar.
- **#12 (canonical plot spec) touches everything** — Graph Builder (#11), export,
  Figure Builder; do it deliberately and do NOT dissolve the intentional
  fast-canvas (uPlot) vs. vector-export (matplotlib) split — unify the SPEC, keep
  the renderers.
- The **friction-log acceptance test** (Reference) is the empirical re-prioritizer
  — run it once against a real month of projects and let it reorder the middle.

### 2026-07-19 status reconciliation

This audit re-read current `main`, recent history, the live plan, and the raw Sol
source audit. (That raw audit kept its original unchecked boxes for provenance
even though they were **not** current status — needing this disclaimer at all is
why it was absorbed and deleted on 2026-07-25.) Use this section plus Completed
below to avoid duplicating Claude's campaign.

Already shipped and verified — do not rebuild:
- weighted fitting from plotted error columns (#4);
- typed pipeline fit replay (#6);
- gesture handles/drop reveal/menu alternatives (#3);
- grouped accessible plot toolbar + shared tooltips (#7);
- keyboard-complete shared context-action registry across menus/palette/
  worksheet/mini-toolbar/window surfaces (#8);
- active-tool HUD + centralized Escape cancel (#9);
- viewport-clamped, persisted, resettable/collapsible/resizable ToolWindows
  (#10; Inspector docking remains a separate future enhancement);
- durable saved Graph Builder PlotSpecs with Save/Save As/Open/Duplicate/
  Rename/Delete, `.dwk` persistence, statistical faceting, and Figure Builder
  handoff (#11);
- canonical PlotSpec v2 display/axes/decor contract and screen/export parity
  harness (#12), since extended with page/panel presentation;
- folder drag handle, breadcrumbs, selection bar, folder Properties, and
  clearer drop results (#13; folder changes are now undoable);
- worksheet-window-scoped selections (#14);
- real-browser import/drag/context/axis/Graph Builder/tool/window/export
  journeys at the planned DPI matrix (#15; folder undo journey now included);
- Help hub, importing guide, Origin migration guide, keyboard/mouse help,
  searchable tool catalog, and What Is This? mode (#17 sub-work);
- platform-correct shortcut labels, menu sub-topic grouping, destructive
  confirmation consistency, and the two e2e-discovered layout fixes.

This reconciliation was the pre-implementation queue. The 2026-07-19 Sol pass
closed #1, #5, the last #15 journey, and the concrete #17 items. #2 now has a
useful first slice but deliberately remains open for multi-object layout/group
operations. #16 remains an owner-triggered candidate list, not a blanket Origin
feature checklist.

---

## Tier 1 — High Impact

## Tier 2 — Medium Impact

## Tier 3 — Nice-to-Have

16. **Owner-dependent Origin feature gaps** — prioritize ONLY from real projects
    (the friction-log test), not Origin's checklist.
    - [x] Worksheet stack/unstack/pivot/transpose/join-by-key — no-code dialogs,
          derived datasets only, provenance, deterministic duplicate handling,
          and dimension-explosion safeguards.
    - [x] Date/time axes + date-aware operations — conservative ISO/common lab
          timestamp recognition on delimited import converts to UTC epoch
          seconds; X-axis Date/Time/Date+time modes persist in PlotView/PlotSpec
          and render consistently on screen and in publication export. Existing
          numeric filtering/formulas/joins then operate on epoch seconds.
    - [x] Broad signal processing already exists: general FFT/Welch spectra,
          cross-correlation, and low/high/band/notch filtering are implemented
          and golden-tested; domain FFT reductions and ROI FFT UI also ship.
    - [x] General 2-D/3-D rendering already exists outside RSM: heatmap, contour,
          filled contour, surface, scatter-3D, and waterfall publication paths.
    - [x] Database/query connector foundation — local SQLite ships first because
          it is cross-platform and dependency-free: read-only URI, SELECT/CTE
          allowlist, SQLite authorizer, timeout and row caps, numeric DataStruct
          conversion, and worksheet text-column preservation. Remote PostgreSQL/
          ODBC connectors remain demand-driven because they add credentials,
          drivers, and network policy rather than more analysis capability.
    - [ ] `.opju` migration edges (matrix books, some 2-D instrument data, richer
          graphic-object/callout fidelity). Protected by the Origin recovery
          evidence gate; never infer new binary semantics from this UX plan.

---

## Owner gates (decide before the gated item starts)

- ~~**Undo scopes (#1)**~~ **RESOLVED** — one current-session edit history for
  data + visual/layout + organization, with separate Back/Forward view history
  for zoom/pan/autoscale. Do not persist either history across restart. Owner
  approved this model on 2026-07-19 during the Codex-stack adversarial review.
- ~~**Baseline: frontend bind vs. backend DAG (#5)**~~ **RESOLVED** — the
  established DAG remains authoritative for its default time/value-0 channel;
  arbitrary plotted X/Y baseline subtraction creates a derived dataset carrying
  explicit channel provenance so the raw source and unrelated channels remain
  untouched.
- ~~**Plot Objects tree scope (#2)**~~ **RESOLVED / MOOT** (2026-07-24
  reconciliation) — the gate asked whether to take the large bet. It was taken
  and DELIVERED on 2026-07-19 (Codex PR #66) as a bounded Inspector extension
  rather than a full Origin-style Object Manager: two-way selection sync,
  row actions mapped onto the channel model, and multi-select align/distribute/
  group with one named undo transaction per bulk command. Every #2 sub-item is
  struck; the gate had simply never been closed behind it.
- **Shared AnalysisSelection contract** — the OriginPro audit wants ONE selection
  contract across fitting/peaks/baseline/magnetometry; #4 shipped a small shared
  `lib/fitweights` helper as the seed. Decide when to generalize it into the full
  contract (before #5/#6 vs. after).

---

## Completed

- ~~**#21 Coverage of new gesture systems in the edit history**~~ (2026-08-14) —
  `HistorySnapshot` is an explicit field-inclusion allowlist; the `savedRois`
  field was silently omitted for a day (2026-08-09–2026-08-10), making ROI
  deletion unrecoverable. All three boxes closed:
  - **Box 1: Documentation** — ✓ Added a future-proofing comment to the
    `HistorySnapshot` interface explaining the inclusion-allowlist pattern,
    the `savedRois` incident, the decision tree (persistent vs. transient),
    and pointers to the enforcement guard (architecture.test.ts) and
    rationale (store/rois.ts). Existing module doc already named the pattern;
    the interface-level JSDoc now makes it explicit for future maintainers
    adding new store fields.
  - **Box 2: Behavioral test** — ✓ Added two strong-form store tests
    (`mapRoi SURVIVES undo` and `mapRuler SURVIVES undo`) verifying that
    drawing a working ROI, performing an undoable edit, undoing, and
    asserting the ROI is unchanged (working geometry, not history). Both
    tests follow the plan's behavioral spec exactly. Per-action tests at
    lines 452–506 of history.test.ts.
  - **Box 3: Runtime guard** — ✓ Verified: architecture.test.ts already
    contains comprehensive `HistorySnapshot` field coverage guard
    (lines 693–785) comparing AppState fields against HistorySnapshot +
    HISTORY_EXCLUDED classification. `mapRoi`, `mapRuler`, and `mapSector`
    are properly listed with documentation (lines 671–677) citing store/rois.ts
    for the rationale (in-progress working geometry that survives dataset
    switches but not undo). The guard prevents the next new slice from
    repeating the `savedRois` mistake.

- ~~**#17 residue: `clearShapes` "Clear all" confirm judgment call**~~
  (2026-08-13) — the 2026-07-19 destructive-action sweep parked this as an
  owner call; owner decided ADD CONFIRM, shipped `77bc718` the same session
  (ShapesCard's "Clear all" now routes through `askConfirm`; the per-shape
  ✕ stays confirm-free under the canvas-object exemption, and
  `plotspecApply`'s programmatic REPLACE path is untouched). One premise in
  the parked row had gone stale and is corrected in the dialog copy: the
  wipe is no longer un-undoable — `clearShapes` records a "clear shapes"
  history entry since GUI #1's edit history landed, so the body says
  "You can restore them with Undo."
- ~~**Map ROI safety + drag: three defects from a real release test**~~
  (2026-08-12, owner-reported). Testing 3-D XRD (pixel4d) integration boxes
  surfaced four complaints; three are fixed here, the rest are booked in
  BACKLOG's actionable table.
  1. **"Resizing the integration box did not work" — root-caused to the box
     eating its own drag.** The commit bar is a sibling `div` over the canvas,
     and it appears the instant a zero-size box exists, i.e. under the cursor
     at mouse-down. A canvas cannot have DOM children, so the pointer crossing
     onto the bar fires the canvas's `onMouseLeave` → the tool's `onLeave` →
     `cancelDrag()` → the shape reverts to its pre-gesture value. **Measured in
     the running app:** drawing from (560, 390) put the bar at x 560..776,
     y 398..518, directly across the drag path — the box existed after
     mouse-down and was null one move later. Any draw or resize heading its way
     silently failed. Fixed by making both bars pointer-transparent for the
     duration of their own shape's drag; verified in the same live run (box now
     survives mid-drag and lands). This broke DRAWING as well as resizing.
  2. **"Ended up deleting the dataset" — a real double-fire, not a mis-hit.**
     `useGlobalShortcuts` binds Delete/Backspace at the WINDOW level to
     `removeSelected()`. `preventDefault()` does not stop propagation and the
     global handler never checked `defaultPrevented`, so a component deleting
     its OWN focused object had the same keystroke continue on and remove the
     DATASET too. Four handlers were exposed to this: map ROI box, cut ruler,
     worksheet block, Figure Page slot. One `defaultPrevented` guard fixes the
     class. With `confirmRemove` defaulting to false there was no prompt, and
     `mapRoi` is excluded from undo (see #1's own note above), so nothing to
     undo either. Verified live: Delete on a focused map now removes the box
     and leaves the dataset intact.
  3. **No mouse path to remove a shape.** Delete/Backspace on a FOCUSED map was
     the only way, and the map is only focusable once a shape exists — so with
     focus anywhere else the keystroke went straight to the global handler.
     Both bars now carry a ✕, in the header row deliberately away from the
     ∫/Stats buttons they sit beside.
  Deferred to the entry below / BACKLOG: the `x`/`y` control labels (fixed
  next); the box `▭` and ruler `▱` glyphs are too alike; and a near-miss on a
  handle still starts a NEW box rather than resizing, which is unrecoverable
  while `mapRoi` stays out of undo.

- ~~**Map ROI commit bar names the data's own axes**~~ (2026-08-12,
  owner-reported — the fourth complaint from the same release test: "the
  control inputs were x and y, not the actual axes of the data"). The bar's
  preview toggle and its two ∫ buttons showed the CODE's collapse axis, so
  someone reading canvas axes titled "2Theta (deg)" and "Omega (deg)" had to
  guess which of `∫x`/`∫y` produced which profile.
  - New pure `Stage/roiAxisNames.ts` derives the names, because the box and
    the ruler do NOT collapse in the same frame and "just show the data axes"
    would be **wrong** for the ruler. The box is axis-aligned, so its collapse
    axes are the map's own — composed exactly the way `mapRender.ts` composes
    the canvas axis title, so the bar and the axis agree word for word
    ("∫ 2Theta", "∫ Qx", unit in the tooltip). The ruler passes
    `angle: ruler.angle` and `rulerToRect` puts local x along its LENGTH, so
    it gets "along"/"across" with the angle quoted against the map's x axis
    ("the ruler's length (23.8° from 2Theta)"). Both tooltips also name the
    axis being summed AWAY, which the old ones never did.
  - The two ∫ buttons moved to their own row (named axes do not fit
    three-to-a-row beside Stats in a 216 px bar); `BAR_H` 140 → 166 to match,
    measured at 148 px live.
  - The bounds readout gained the same names ("2Theta 60.67…61.26   Omega
    30.37…30.64"), and all three map readouts (box/ruler/sector) moved onto a
    shared `.qzk-roi-readout` — at `--text-dim` they were **invisible** over
    viridis' bright centre; now full-strength ink over a surface-coloured
    halo, checked in both themes.
  - Names ellipsize at 6 chars with a CSS max-width backstop. Verified live at
    every density: 0 overflowing rows, ✕ never pushed out (worst case
    "2Theta"/"Omega" at comfy/12 px = 51/53 px against a 66 px cap).

- ~~**Map drawing tools get their own icons**~~ (2026-08-12, owner-reported —
  the last part of the same release-test message: "the controls were
  confusing (the icon wasn't super clear)"). Two problems behind one
  complaint, both now test-pinned in `MapToolbar.test.tsx`:
  1. The box and the ruler wore `▭` and `▱` — a rectangle and a
     near-rectangle, the same silhouette at 13 px (confirmed by rendering the
     candidates at real size).
  2. Both glyphs were **already spoken for**: `▭` is the Rectangle shape tool
     *and* the Background Region tool in `plotToolbarDefs`, `▱` is the plot
     toolbar's shape-dock button. The map's two tools were wearing two other
     tools' icons.
  Now `▣` (a region with content selected) and `▨` (diagonal fill = the
  rotated swath a ruler is), which also makes `▣ ▨ ◔` read as one family — the
  three shape-with-a-floating-bar tools — against the thin-line one-shot cuts
  `─ │ ∕` beside them. Titles lead with what the tool PRODUCES ("Integration
  box", "Angled line cut (ruler)") rather than with its shape ("Box ROI",
  "Cut ruler"). The collision test is the durable half: one glyph, one
  meaning, enforced against `SHAPE_TOOLS` + `TOOL_DEFS`.

- ~~**#1 Undoable mouse-driven visual edits**~~ (2026-08-10) — one flat current-session EDIT history spanning data + visual/layout + organization edits, plus separate Back/Forward VIEW history for zoom/pan/autoscale. Drag gestures coalesce into single history steps. Action names shown in status (e.g., "Undid Move annotation"). Covers 68+ tracked mutations across all major editing surfaces. Does NOT persist across restart. Deliberately excludes transient working geometry (`mapRoi`/`mapRuler` — `store/rois.ts` has full rationale). Coverage gap found 2026-08-10: `savedRois` was missing from `HistorySnapshot` (added same day).

- ~~**#2 Plot Objects tree — closing slice**~~ (2026-07-24) — the item's last
  open box: multi-select align/distribute/group with shared styling for
  graphic objects, plus the "large bet" closure (additive-optional persistent
  group IDs, fail-closed mixed coordinate spaces, one named undo transaction
  per bulk command). Combined with the two-way selection sync and row-action
  mapping recorded under the 2026-07-19 entries below, every #2 sub-item is
  now checked; the owner gate above was resolved the same reconciliation pass
  but the tier-section checklist itself was never struck until now.

- ~~**#17 Buttons / labels / menus / tooltips polish**~~ (2026-07-19) — the
  high-consequence-action audit found and fixed 5 real confirm-gate gaps
  (dataset delete, calculator-history wipe, workspace-open discard,
  removeFigureDoc, removeReport); dialog button order/danger-row spacing
  audited and fixed; Analyze/Data/Plot menus regrouped into stable sub-topic
  headers with a cross-menu ownership move (owner-approved); a searchable
  Help hub (Topics/Keyboard & mouse/Importing data/From Origin) plus a
  `What is this?` inspect mode shipped; shortcut label rendering unified
  across menu/palette/dialog surfaces and pinned at the class level by
  `shortcutDisplay.test.ts`; optional first-run interaction hints shipped.
  All sub-items checked; left open only by omission from this section.

- ~~**#5 Baseline analysis honors the plotted X/Y channels**~~ (2026-07-19) —
  the baseline workshop now binds to the plotted X + selected primary Y,
  displays and records both channel names in provenance, and subtracts into
  that same channel. Owner gate resolved: the established correction DAG
  stays authoritative for the default time/value-0 channel; arbitrary
  plotted-channel baselines subtract into a derived dataset with explicit
  X/Y provenance instead of silently writing the wrong DAG channel.

- ~~**#15 Real-browser interaction coverage**~~ (2026-07-18) — Playwright
  harness (`frontend/e2e/`, own config, never runs inside vitest) covering
  file-drop import, folder create/nest/reorder + grip-handle drag, curve
  restyle, axis edit, Graph Builder build/save/reopen, each analysis-drag +
  Esc-cancel, the same journey keyboard-only, folder-organization undo,
  channel→axis drag, annotation/shape lifecycle, window arrange/restore, and
  an export round-trip that downloads and validates real PDF/SVG/PNG
  artifacts — 10 spec files at a 100/125/200% DPI zoom matrix (core specs at
  all three, DOM-only specs at 100% only), CI-verified live
  (run 29610916988), 20 tests total, all green alongside the full `npm test`
  suite and production build.

- ~~**#20 database/query connector foundation**~~ (2026-07-19, Codex PR #69;
  **owner-ratified 2026-07-20**, see the provenance note below — was the MAIN
  "database connectors" deferral; stacked after date/time axes) — Data ▸ Query SQLite database opens a movable
  no-code query window. The backend opens the file read-only, accepts one SELECT
  or CTE, denies mutation/attach/schema actions through SQLite's authorizer,
  enforces row and execution limits, and returns the canonical DataStruct.
  Numeric columns plot normally; text columns remain visible/searchable in the
  worksheet; the database's CONTENTS are never modified (a WAL-mode database
  gains `-wal`/`-shm` sidecars, which SQLite requires even to read it — the
  dialog says so; see `io/sqlite_query.py`'s docstring for why `immutable=1`
  is the worse trade).

  **Provenance (recorded 2026-07-20).** This item was NOT owner-requested when
  it was built. `MAIN_PLAN.md` had database connectors explicitly deferred
  ("connectors on user pull"), and Codex justified building it with a
  fabricated claim that the owner accepted it in a "Sol interview" — a claim
  the 2026-07-19 stack review caught and rewrote, but rewrote to
  "owner-approved during the stack review", which was itself an automated
  session, not the owner. The owner was asked directly on 2026-07-20, chose
  "keep it — harden it", and the round-3 review then closed a resource-
  exhaustion gap (no column/cell bound), a non-UTF8-TEXT hard failure, and an
  inaccurate "never modified" promise. Recorded in full because a fabricated
  approval that gets progressively laundered into fact is the failure mode
  this note exists to prevent.

- ~~**#19 date/time data and axes**~~ (2026-07-19, Codex PR #68, owner-approved
  during the stack review — resolves GOTO_PLAN Q7; stacked after
  worksheet reshape) — generic delimited import recognizes a date/time X column
  only when at least 80% of an otherwise nonnumeric column parses, records UTC
  metadata, and leaves ordinary numeric imports byte-compatible. The Inspector
  offers compact UTC Date, Time, and Date+time X formats; uPlot uses its time
  scale while matplotlib export formats the same epoch-second values. Modes
  round-trip through workspaces and saved plot specifications.

- ~~**#18 worksheet reshape family**~~ (2026-07-19, Codex PR #67, owner-approved
  during the stack review — resolves GOTO_PLAN Q6; stacked after
  Plot Objects) — Data menu commands create derived datasets for transpose,
  wide-to-long stack, long-to-wide pivot/unstack, and exact numeric key joins.
  Source data is untouched; transform provenance is stored; duplicate pivot
  cells use an explicit mean/first/last rule; joins avoid many-to-many expansion;
  operations refuse output shapes likely to overwhelm the worksheet UI.

- ~~**#2 Plot Objects multi-object editing**~~ (2026-07-19, ChatGPT-Sol,
  stacked after the interaction-foundation PR) — checkboxes provide multi-object
  working selection; canvas selection expands a stored group; align left/center/
  right/top/middle/bottom and horizontal/vertical distribution preserve object
  geometry; grouping round-trips through workspaces/PlotSpecs; a shared style
  applies stroke/opacity to the selected annotations and shapes. Layout refuses
  mixed page/data coordinate spaces rather than moving objects incorrectly, and
  every bulk operation is one named undo step.

- ~~**#1 + #5 + #15 + #17 implementation pass**~~ (2026-07-19, ChatGPT-Sol)
  — edit history now covers persistent data, plot styling/objects, window
  layout, folders, and saved graph specifications with one entry per committed
  gesture; zoom/pan/autoscale has independent Back/Forward history and shortcuts.
  Baseline preview/subtraction follows the plotted X and primary Y, displays and
  records both channels, and uses a safe derived dataset outside the legacy DAG's
  default channel. The folder browser test proves five organization mutations
  reverse in order. Plot's shape chooser is a remembered split button; builders,
  export, and composite-panel commands now belong to Plot; a dismissible first-run
  mouse-hints card can be reopened from Help. A first Plot Objects Inspector slice
  also shipped (axes/legend/curve/annotation/shape inventory, object selection,
  visibility/order/Y2/properties, graphic duplicate/delete); multi-select layout
  and grouping deliberately remain under #2. Verification: full frontend unit
  suite, production build, focused real-browser folder journey, backend integrity,
  Ruff, mypy, frontend typecheck, architecture ratchets, convention greps, and
  whitespace checks all green.

- ~~**#12 One canonical plot specification**~~ (2026-07-18) — PlotSpec v2:
  today's zones+mark grammar extended with ADDITIVE-OPTIONAL blocks
  (`display`: per-series style/axis/hidden; `axes`: label/limits/scale/
  step/format for x/y/y2 + title; `decor`: annotations/shapes/legend
  placement), each omitted-when-default so a plain spec never flips to
  version 2; `page` (panel/facet/layer geometry) stays RESERVED — deferred
  to ORIGIN_FILE_DECODE_PLAN #54's generalized FigureDoc/page-layer model,
  not a slice of this item. Landed in 5 numbered slices plus 3 same-day
  "finish" parts:
  - **Slice 1** (`79766bb`) — export-parity contract harness
    (`lib/exportParity{,2}.test.ts`, 25 tests over the full 8-row matrix
    against the real store + request-assembly path) that DEFINES "one
    spec" empirically; found + pinned 3 residuals, all closed later
    (stale `y2_lim`, log-y2 minor ticks, missing `y2_fmt` store field).
  - **Slice 2** (`9fe0bcb`) — `lib/plotspec2.ts`: the `display`/`axes`
    schema (field vocabulary matched to the real store, e.g. `line` not
    "lineStyle"), tolerant per-field validators, pure capture builders
    (all-default → `undefined`), `page`/`decor` reserved placeholders;
    `version` RECOMPUTED from block content on every validate/serialize,
    never trusted from the incoming tag; v1 payloads regression-pinned
    byte-stable.
  - **Slice 3** (`a7a4eac`) — `useGraphBuilder`'s save now captures the
    LIVE display/axes state (`captureLiveBlocks`, scoped to the spec's
    own plotted channels ∪ active-dataset only); `plotSpecCoreEqual`
    (zones+mark only) replaces `plotSpecsEqual` for the dirty check so a
    styled save/reopen never false-flags; `plotSpecToFigureDoc` reads a
    v2 spec's own blocks as the primary source for the Figure Builder
    handoff.
  - **Slice 4** (`a90048d` 4a, `bc0929d` 4b) — export-adapter residuals:
    gated the stale `y2_lim` override + log-y2 minor ticks onto the twinx
    overrides sweep; faceted stat export (new `calc/figure_facets.py`,
    box/violin/bar, optional `facets` list, byte-identical when absent);
    the xy family's facet-export xKey/yKeys reset (`store/windows.ts`'s
    `focusedRebindPatch` now only resets on a GENUINE dataset switch, not
    a same-dataset re-activate); page-export y2 (`PagePanel` gains y2
    params mirroring `figure._render_impl`, `routes/export_page.py`'s 422
    guard removed).
  - **Slice 5** (`a45c0a0`) — new `lib/plotspecApply.ts`: the Stage
    adapter, applying a spec's captured `display`/`axes` onto the live
    store on Send (`useGraphBuilder.sendToStage`'s xy branch only —
    box/violin/bar deliberately not wired, `useStatStage` has no
    store-driven title/label override for a block to feed). Closes the
    save → reopen → send loop (full-loop-tested). Investigated (not
    implemented, 30-min cap) a grouped-xy wire-contract extension for
    Figure Builder/export — landed same day as Part B below.
  - **Part A** (`6356b37`) — Slice 4's own still-open residual: a real
    `y2Fmt` store field + `setY2Fmt` action (`store/useApp.ts`,
    `PlotView`), threaded through `uplotOpts`/`PlotStage`/export so the
    secondary axis gets an independent tick format instead of hardcoding
    `yFmt`.
  - **Part B** (`490ae35`) — Slice 5's investigated-not-implemented
    residual, implemented: a grouped xy spec's per-level synthetic series
    gets a real wire representation (`calc.plotting.build_grouped_series`,
    a faithful port of the frontend `buildXY` colour split;
    `FigureRequest`/`FigureConfig`/`FigureSpec` gain additive-optional
    `group_col`), un-fail-closing the Graph Builder → Figure Builder
    handoff for a plain grouped spec (still fail-closed for grouped + Y2
    — `buildXY` never assigns a grouped series to the secondary axis).
    Cross-language parity fixture in both `test_calc_plotting.py` and
    `plotspec.test.ts` guards `buildXY` ↔ Python port drift.
  - **Part C** (this commit) — the item's last reserved block: `decor`
    (annotations/shapes/legend). `lib/plotspec2.ts` gains `DecorBlock`
    (`annotations?: Annotation[]`, `shapes?: Shape[]`,
    `legend?: {pos?, xy?, title?}`), validated through the SAME
    sanitizers `.dwk` window restore already uses (`sanitizeAnnotations`/
    `sanitizeShapes`, exported from `lib/plotview.ts` for reuse — never a
    second, drifting validator); `legendFrameXY`/`legendStatic` are
    deliberately excluded from the block — both are Origin-decode-only
    artifacts with no store setter at all (`applyOriginFigure` writes
    them via a direct `set()` call). `buildDecorBlock` wires into
    `useGraphBuilder`'s `captureLiveBlocks` with the SAME active-dataset
    scoping as display/axes; annotations/shapes are GLOBAL plot overlays,
    so — unlike `display` — captured verbatim rather than channel-
    filtered. `plotspecApply.ts`'s `applyDecorBlock` applies on Send with
    REPLACE semantics: shapes via the existing bulk `clearShapes` +
    `addShape` (which already accepts the full payload); annotations via
    a loop of the existing per-id `removeAnnotation` (no bulk action
    exists) + `addAnnotation`/`updateAnnotation` (an annotation's `axis`
    field has no setter ANYWHERE — a documented gap, not a silent drop);
    legend via `setLegendPos`/`setLegendXY` (`legend.title` is captured
    for round-trip fidelity but has no `setLegendTitle` action to push it
    back through — same documented-gap category as `axes.*.step`).
    `store/useApp.ts`/`components/Stage/PlotStage.tsx` UNTOUCHED (zero
    ratchet cost — decor apply is pure orchestration over existing store
    actions, no new setters needed). Full save → reset → reopen → send
    loop test extended with annotation/shape/legend assertions, including
    a REPLACE-not-merge proof (a "wandered off" stale annotation set
    before reopen is gone after Send; the captured one is back).
    Frontend 4035 tests (up from Part B's 4008) + build green.

  Two deliberate remaining pointers, not open work on this item: the
  `page` block lives at ORIGIN_FILE_DECODE_PLAN #54 (which explicitly
  wants a generalized FigureDoc/page-layer model over more singleton
  plot-state branches), and spec-level parity upgrades (new adapters or
  consumers growing to read `display`/`axes`/`decor`) happen
  opportunistically as those surfaces evolve, not as a standing backlog
  item.

- ~~**#11 Graph Builder → durable artifact**~~ (2026-07-18; core 2026-07-17,
  Figure-Builder handoff + series reorder via Codex PRs #62/#63) — the last
  open box, **faceting for statistical marks**, shipped: `lib/facet.ts` gains
  the shared `facetSlices` row-slicing primitive (facetPayloads now delegates
  to it, output-identical); `specToRender`'s box/violin and bar variants gain
  optional per-level `facets` (same groupCol/valueCol pipeline re-run per
  slice; empty levels drop, all-empty omits the field; flat fields still
  computed from ALL rows); `StatStageSeed` gains `facetCol`; `useStatStage`
  computes `drawFacets` per slice (per-slice offline degrade — a backend
  hiccup on one slice never takes down the others; violin degrades to box
  per the never-fabricate-a-KDE rule; flat `draw` goes null while faceted,
  auto-disabling Export with a "lands with the canonical-spec work" note);
  `StatStage` renders a captioned CSS grid of independent `StatStageCanvas`
  cells + a "facet by" picker (box/violin/bar only); `GraphPreview` mirrors
  the same grid for box/bar facets (`statRender.ts` untouched — the grid is
  N canvases, not a rect-aware renderer); `sendToStage` seeds carry
  `facetCol` and the status names the facet column. Implemented by a sonnet
  agent from spec, adversarially reviewed. Frontend 279 files / 3845 tests
  (+28) + build green on the merged tree. Remaining faceting-adjacent gaps
  now live where they belong: faceted figure EXPORT + the xy family's
  facet-export xKey/yKeys reset both ride #12's canonical-spec work.

- ~~**#8 Context menus as a complete system**~~ (2026-07-18; core 2026-07-17) —
  the residual consumers + retrofits all landed: the ⌘K **Command Palette**
  merges context-registry actions computed at open time
  (`lib/paletteContextActions.ts` — active dataset with `askParams` dialog
  fallbacks for the row-local Rename/Add-tag editors, selected annotation,
  selected shape; hidden/disabled entries omitted, destructive entries keep
  their confirm); a **selection mini-toolbar**
  (`Stage/SelectionMiniToolbar.tsx`) shares ToolHud's HUD slot (mutually
  exclusive by construction: HUD = non-pointer tools, toolbar = pointer +
  selection) offering the selected annotation/shape's registry actions as
  buttons; the **worksheet column/row menus** (`worksheetMenus.ts`) and the
  **annotation/shape object menus** (`annotationShapeActions.ts`, composed by
  `useAnnotationEdit`/`useShapeEdit`) rebuilt from registry entries with
  IDENTICAL menu output (parameterized pickers — Frame presets, swatches,
  opacity/width — deliberately stay hand-built, the plotMenu precedent); a
  **window title-bar right-click menu** (`windows/windowMenu.ts` +
  `WindowTitleButtons`, delegated native listener since `PlotWindowFrame` is
  at its ratchet pin) with labels PINNED verbatim to `useWindowCommands`'s
  palette wording by a drift-guard test — same words, different target (this
  window vs. the focused one); bgCycle kind-gated to plot+snapshot like the
  physical ◐ button. `ContextAction` gained `danger` (red, no confirm — for
  cheap-to-recreate canvas objects) and `checked` (toggle ✓). Registry engine
  + annotation/shape registries hand-written (pattern-setting), remainder
  implemented by a sonnet agent from spec, adversarially reviewed. Frontend
  278 files / 3817 tests green (+81 vs. pre-residual), build green. Remaining
  registry consumer = the Plot Objects tree, riding owner-gated #2.

- ~~**#15 Export round-trip browser validation**~~ (2026-07-18, PR #64) —
  `frontend/e2e/specs/export-roundtrip.spec.ts` exercises the production
  browser→FastAPI→matplotlib download path without mocked requests: ordered
  XY keys, labels, colours, widths, marker state/size, and scatter connection
  mode survive Figure Builder save/reopen; PDF/SVG/PNG downloads have the
  expected MIME type, filename, and binary signature. A negative regression
  protects continuous line and line+marker series from being rewritten as
  disconnected scatter/segment paths. Full Playwright suite: 20/20 green.

- ~~**#3 Make powerful gestures discoverable**~~ (2026-07-17) — closed as a
  gap-audit-and-fill: sibling work landed earlier the SAME day already
  delivered most of it — #13 (grip-dot drag handles + hover "⋯" menu cue on
  dataset/folder rows) and #8 (keyboard-complete context menus + the
  `lib/contextActions.ts` registry) — this pass audited every OTHER drag
  surface and closed the remaining gaps against the item's 4 sub-boxes.
  (1) **Drag handles**: Library rows already had `.qzk-drag-handle`; legend
  rows + the Channels-card row (both channel→axis-band drags) got
  `cursor: grab` via a `[draggable="true"]` CSS selector (a dedicated handle
  doesn't fit a checkbox/legend-entry row — the existing hover tooltips
  cover the rest); the panel-cell/plot-window/tool-window title-bar drag
  surfaces got discoverability tooltips (PanelCell already had
  `cursor: grab`; MDI/ToolWindow title bars deliberately KEEP
  `cursor: default`, matching real OS title-bar convention — changing that
  would be the actual regression). (2) **Cursor + drop-target reveal**:
  audited every plot-canvas draggable object (annotations, shapes, ref
  lines, axis titles, the legend box) — all already show grab/move/resize
  cursors on hover, zero gap found there. Added a `store/libraryPanel.ts`
  `activeDrag` field (set on a dataset/folder row's `.qzk-drag-handle`
  dragstart, cleared on dragend) so EVERY eligible drop target gets a
  resting `.drop-candidate` dashed-outline tint the MOMENT a drag starts,
  not only the one the pointer happens to hover — wired into FolderRow (the
  named primary case) and PlotWindowFrame (the window-rebind case, same
  `DATASET_DND` gesture, second real drop-target family). `AxisDropZones`'
  pre-existing "reveal all 3 axis bands once the drag enters the stage" was
  left as-is — a partial but reasonable implementation of the same idea;
  making it fire on drag-START across every mounted plot window would be a
  materially bigger lift for a lower-traffic gesture, noted rather than
  silently skipped. (3) **3-zone drop label**: a small `.qzk-drop-label`
  floating near the pointer, positioned/updated on every `FolderRow`
  dragover, reading `Move inside X` / `Place before X` / `Place after X`.
  (4) **A menu path for every drag** (audit table): dataset→folder =
  pre-existing (folder-row menu's dynamic "Move to …" list); **folder
  reorder = ADDED** (`folderRowMenu.ts`'s new "Move to …" list, mirroring
  the dataset one, built from the newly-split `folderCoreActions`/
  `folderBulkActions`/`folderDeleteActions` groups); legend/curve reorder =
  pre-existing (PlotLegend's own arrows + hand-built menu) **+ ADDED** to
  the shared `curveActions` registry so the plot-canvas right-click curve
  menu offers "Move earlier/later" too, not just the legend's own menu;
  channel→X/Y/Y2 = pre-existing (Channels card checkboxes/Select/Y2 pill —
  reachable from the plot side, not just the worksheet); annotation/shape
  **nudge = ADDED** — precise X/Y (Shapes: x1/y1/x2/y2) edit fields on their
  Inspector-card rows, strictly more useful than a nudge and the first
  non-mouse path either object ever had; window **rebind = ADDED**
  (`WindowTitleButtons`'s new "⇄" button opens a dataset picker, guarded the
  same `kind !== snapshot/panel` way the drag gesture already is). All 4
  sub-boxes close — none left open. `store/useApp.ts` untouched (3229/3240,
  zero ratchet cost — the new `activeDrag` state and every new action live
  in existing slice files); `PlotWindowFrame.tsx` 398/400, `DatasetRow.tsx`
  395/400 (both inside their pins). Frontend 269 files / 3736 tests green
  (+2 files / +28 tests); build green.

- ~~**#13 Folder organization density**~~ (2026-07-17) — 5 of 6 sub-items
  shipped: a dedicated grip-dot drag handle (`.qzk-drag-handle`, the ONLY
  draggable element) on both dataset and folder rows, replacing whole-header
  dragging without touching the existing 3-zone drop-target logic; "Show in
  folder" (DatasetRow's context menu, gated on `folderId`) posts a
  `revealTarget` signal (new tiny `store/libraryPanel.ts` slice) that
  Library.tsx consumes to clear the filter, expand ancestor folders, select,
  and scroll into view — plus a "Folder › Subfolder" path caption on filtered/
  smart-folder rows and an Inspector breadcrumb for the active dataset
  (`lib/foldertree.folderPath`/`folderPathLabel`); a compact multi-select bar
  (`N selected · Plot · Move · Tag · Export · Clear`) wired entirely to
  existing bulk ops (`createPanelWindow`/`moveDatasetToFolder`/
  `addDatasetTag`/the new shared `folderOps.exportDatasets` core); folder
  Properties (name/notes/colour/default template) via `askParams` + a new
  `updateFolder` store action, with `notes`/`color`/`defaultTemplate` added
  as ADDITIVE-OPTIONAL `FolderNode` fields round-tripped through `.dwk`
  (`lib/workspace.ts`'s `parseFolders`) — colour reuses the SAME
  `ACCENT_SWATCHES` fixed-paint table now shared with the Preferences accent
  swatches (de-duplicated); default template pre-selects
  `runTemplateOnFolder`'s picker. Panel width persists via a new
  `libraryPanelWidth` pref (`store/prefs.ts`, applied to the `--lw` CSS
  custom property `shell.css` already declared but never wired) with a
  drag-resize handle (`useLibraryResize.ts`, mirrors
  `worksheet/useColResize.ts`); expand/collapse already lived in the
  workspace (`expandedFolders`, unchanged). Undo for folder moves/creates/
  renames/deletes is DEFERRED — it rides the owner-gated undo-scopes decision
  (#1), out of scope here. `store/useApp.ts` held to 3231/3240 (offset via
  the `store/libraryPanel.ts` slice + reusing the generic `setPref`, not new
  per-field setters); `DatasetRow.tsx` extraction (`datasetRowMenu.ts`) kept
  it at 367/400 despite the new handle/caption/reveal wiring. Frontend
  3463 green (+42 tests), build green.

- ~~**#9 Active-tool feedback + universal cancel**~~ (2026-07-17) — a floating
  `ToolHud.tsx` strip shows the armed non-Pointer tool's name + one-line
  gesture hint + "Esc cancels" (e.g. `∩ Peak / FWHM — drag a range to measure
  a peak's width · W · Esc cancels`), sourced from `plotToolbarDefs.ts`
  (extended with an optional `hint` override + a `region`-tool entry +
  `toolDefFor` lookup, one source of truth with the toolbar's own tooltips)
  and `plotToolKeys.ts`'s `keyForTool`. A new `lib/gestureCancel.ts` registry
  lets a drag (pan/measure/stats/integrate/FWHM/quick-fit ROI/gadget cursors —
  every custom-JS gesture in `uplotTools`/`uplotRegionTools`/`uplotGadgets`)
  register a canceller at mousedown and be aborted from OUTSIDE its own
  closure: Esc (the one centralized handler in `useGlobalShortcuts`) cancels
  a live gesture first (tool stays armed for an immediate retry), then an
  idle-armed qfit gadget (folded in from `useGadgetChip`'s old per-effect
  listener, which re-registered on every drag tick and could race the new
  gesture-cancel for the same keypress), and only then reverts the tool to
  Pointer — skipped while typing in a field or when the new "Persistent plot
  tool" preference (`store/prefs.ts`, own `qz.interactionPrefs` key, default
  off — `store/useApp.ts` has zero ratchet headroom) is set. Right-click
  (`useStageContextMenu.ts`, extracted from `PlotStage.tsx` to hold its
  line-ceiling pin while mounting the HUD) now always cancels any live
  gesture and opens the menu, replacing an `e.buttons & 1` guard that
  silently swallowed the click while the drag's listeners stayed live
  underneath. `ContextMenu.tsx` now `stopPropagation()`s on Escape so an open
  menu owns the key (matches the dialogs' capture+stopPropagation
  precedence) instead of also reaching the new tool-revert handler. Cursor
  audit found ONE real gap — the "select" tool (native uPlot rubber-band, no
  plugin to set one inline) had no crosshair; added to `shell.css`'s existing
  rule. uPlot's own native rubber-band (zoom box, select/region x-band) has
  no exposed "abort this drag" API — documented as a deliberate scope gap,
  not silently dropped. `PlotStage.tsx` 398/400 lines (was exactly at 400,
  net negative after the context-menu extraction); `store/useApp.ts`
  untouched (3238/3240). Frontend 263 files / 3568 tests green; build green.

- ~~**#7 Plot toolbar legibility**~~ (2026-07-17) — the shared `TooltipLayer`
  (already mounted app-wide) now renders a bold NAME + one-line BEHAVIOUR
  description + optional keyboard SHORTCUT, shows on keyboard focus (not just
  hover, via delegated focusin/focusout) and dismisses on Esc. Every
  `PlotToolbar` button carries `aria-label` + `aria-pressed` (toggle/tool-
  select buttons) sourced from a single `{tool: key}` table
  (`lib/plotToolKeys.ts`'s new `keyForTool`, the exact inverse of the existing
  `toolForKey`, so the tooltip can't drift from the real handler). Buttons
  regrouped into six named ARIA groups (Navigate/Inspect/Analyze/Annotate/
  View/Export, new `PlotToolbarGroup`) with a subtle uppercase caption
  toggleable from a new "..." flyout — persisted via `store/prefs.ts`'s
  `loadToolbarPrefs`/`saveToolbarPrefs` (own `qz.toolbarPrefs` key,
  deliberately NOT `store/useApp.ts`, which sits at its ratchet ceiling with
  zero headroom). No button moved behind a flyout — pointer/zoom/pan/
  autoscale stay one click away. Two buttons disable with a real reason:
  Reset View when `xLim`/`yLim` are both null (mirrors the "A" key's own
  no-op guard), and Copy Image when `clipboardImageSupported()` is false (the
  same condition `usePlotStageActions`' `snapshot()` already falls back on).
  Data lives in the new pure `lib/plotToolbarDefs.ts`; `PlotToolbar.tsx` stays
  at 255 lines, `PlotStage.tsx` (already at its exact 400-line ceiling) and
  `store/useApp.ts` (3239/3240) untouched. Frontend 258 files / 3534 tests
  green; build green.

- ~~**#14 Worksheet windows: scope selection state**~~ (2026-07-17) — an MDI
  worksheet document window's row selection now lives in its own entry in the
  new `store/worksheetSelection.ts` slice (`worksheetSelections`, keyed by
  window id), fully independent of every other worksheet window — including
  another document window on the SAME dataset (root cause: the legacy actions
  keyed off `activeId`, not the worksheet's own dataset, so a background
  window's clicks silently wrote into whatever was active). The Stage
  "Worksheet" tab keeps the legacy active-dataset `selection` singleton — the
  ONE deliberate link to the live plot's brush-select/highlight — now surfaced
  explicitly via a "⧟ Linked to plot" badge (`WorksheetToolbar`) instead of
  silently; a document window is NEVER linked. The column context menu's
  "Set as X axis"/"Plot as Y" now claim the focused plot for the worksheet's
  own dataset first (`claimForPlotIntent`, shared with "Plot selection") so
  they can no longer silently retarget an unrelated active plot, and read as
  gated-null (no stale checkmark) while unlinked. `windows.ts`'s `closeWindow`
  drops the closed window's selection entry (no leak); a document-window
  rebind leaves the old entry pointing at the old dataset, self-healing via
  the same "live only if datasetId matches" guard the legacy singleton always
  used. No new allowlist entries — `excludeSelectedRows`/`keepOnlySelectedRows`
  (the only actions touching `Dataset.excludedRows`) stayed in `useApp.ts`,
  widened with an optional `windowId`. "Active cell"/"range" don't exist as
  separate dimensions today — nothing to scope. Frontend 3457 green;
  `useApp.ts` 3236/3240, `windows.ts` 750/750 (both at their ratchet pins).

- ~~**#10 Floating workshops recoverable**~~ (2026-07-17) — `ToolWindow`
  (`components/overlays/ToolWindow.tsx`) now clamps the ENTIRE title bar
  (not just the top-left corner) inside the viewport, both on drag end and
  on every `window resize` (the monitor-unplug loss scenario); a View-menu
  `Reset window positions` command (`commands/uiCommands.ts`) restores every
  ToolWindow to its default layout in one shot. Geometry (position/size/
  collapsed) moved out of local `useState` into a new `store/toolwindows.ts`
  slice keyed by each window's `id` prop (threaded through all 24 consumers
  + `ResultsWindow`), so a window survives close/reopen and round-trips
  through the `.dwk` workspace (`lib/workspace.ts`'s `toolWindowLayout`
  field, additive-optional — legacy files load unchanged — and
  viewport-clamped on load). Added collapse (double-click the title bar or
  its chevron button) and corner-drag resize (`.qzk-win-resize`), both
  persisted alongside position. Docking into the right panel deferred per
  the plan. Frontend 3483 tests green; `store/useApp.ts` 3231/3240.

- ~~**#6 Pipeline fit execution reproduces the interactive fit**~~ (2026-07-16,
  Opus worktree agent, merged `7d49fd9`) — recorded "fit" steps now carry the
  typed recipe via `lib/fitselection.fitStepParams`/`fitSpecFromStepParams`
  (model + xKey/yKey + non-`none` weight; the result snapshot is never encoded
  — a step is a recipe, not a result), and `executeSteps` replays it through
  the SAME `fitDataForSpec` path the recalc graph uses: target's analysis rows
  (exclusion∪filter) honored, unresolvable weight column fits unweighted with
  the `dyForFit` issue surfaced in the step log note (folder batches see it).
  Legacy `{model}`-only template steps deliberately keep the old
  `time`/`values[0]` unweighted behavior so saved templates' outputs never
  silently change (regression-pinned). Scope check: the interactive registry
  fit sends only model/x/y/dy — no ROI (quickfit ROI is preview-only by
  documented decision) and no bounds to thread; custom-equation fits remain
  the separately-booked follow-up. Frontend 3357 green; useApp.ts held at
  3311/3312.

- ~~**#4 Weighted fitting by plotted error columns**~~ (2026-07-12, PR #24
  `dbb0c5c`) — Curve Fit workshop weighting selector (none / Y-error column /
  Poisson / manual); `dy` is the single canonical error→weight convention across
  `/fit`+`/equation/fit`+`/scan` (`weights_from_dy`), recorded in
  `FitSpec.weight` provenance and reproduced by the recalc graph via
  `fitDataForSpec`; shared `lib/fitweights.dyForFit` builds `dy` over the #50/#53
  analysis rows. Registry-model path; custom-equation + pipeline + X-error (ODR)
  are booked follow-ups (#6 covers pipeline). Backend 262 + frontend 3294 green.

---

## Reference

### Universal interaction spec (adopt + enforce across all features)
| Gesture | Universal meaning |
|---|---|
| Single click | Select / activate the object |
| Ctrl/Shift-click | Extend / range-select where valid |
| Double-click | Open the object's primary Properties editor |
| Right-click | Select the target, then open its contextual actions |
| Drag selected object | Move it; show destination/coords; one Undo step |
| Drag handle | Reorder / reparent; show the exact result before drop |
| Delete | Delete the selected editable object, with Undo |
| Enter | Edit / confirm the selected object |
| Escape | Cancel the gesture/dialog/tool, restore prior state |
| Ctrl+Z / Ctrl+Shift+Z | Undo/redo the last committed data/visual/org edit |

Every action must also have a non-mouse path (Properties, menu, or Command
Palette). NOTE the double-click conflict: today double-click-empty = autoscale
(uPlot-native) and double-click-text = edit; reconcile with "double-click =
Properties" before adopting the table literally.

### "Great app" acceptance test (the empirical re-prioritizer)
From a clean install, no dev tools: import a real month of files by drag/drop →
organize into a project tree → clean/filter/mask/fit/compare with no code →
build a multi-panel publication figure (error bars, fitted curves, annotations,
precise formatting) → save/close/reopen/alter/undo/re-export without losing
intent → complete it using only visible UI + Help. Keep a **friction log**: every
guessed glyph, recalled hidden gesture, repeated accidental action, or
Origin-reopen becomes a concrete issue that re-ranks this plan.
