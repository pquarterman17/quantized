# Gap Interaction Plan — gadgets, drag-to-axis, Graph Builder, linked-view residuals

Implementation plan for the plot-interaction batch of the remaining
`plans/ORIGIN_GAP_PLAN.md` items: the quick-fit gadget (#33) and ROI
gadget family (#34), drag-to-axis (#49), the Graph Builder workshop
(#51), the linked-view residuals left open on #52/#53/#55, plus the
Peak Analyzer wizard's deferred click-on-plot marker editing (booked on
closed item #31). Everything here builds on seams that already exist —
the region-tool plugins, the overlay-series mechanism, the row-state
chokepoint, and the typed pipeline steps — and this plan names those
seams file-by-file so implementers extend rather than reinvent.

**Status:** Active
**Created:** 2026-07-07
**Updated:** 2026-07-08

---

## Context

### How the pieces fit together

The interactive plot is a uPlot instance assembled by `buildOpts` in
`frontend/src/lib/uplotOpts.ts`, which owns the `PlotTool` union
(zoom/pan/cursor/region/select/measure/stats/integ/fwhm), composes the
tool plugins, and hosts the rubber-band `setSelect` hook. Tools split
across three libs: `frontend/src/lib/uplotTools.ts` (pan / measure /
stats / wheel-zoom / readout), `frontend/src/lib/uplotRegionTools.ts`
(the ∫ integrate and ∩ FWHM drag-a-band analysis tools — the direct
precedent for gadgets), and `frontend/src/lib/uplotOverlays.ts`
(passive draw-overlays incl. the draggable `refLinePlugin`, the one
interactive-drag precedent). `frontend/src/lib/regionSelect.ts` is pure
range math (`normalizeRange`). Fit/baseline/peak curves are NOT
plugins: they are synthetic series appended by `composeDisplayPayload`
in `frontend/src/lib/plotdata.ts`, driven by the store's
`fitOverlay`/`baselineOverlay`/`peakOverlay` fields.
`frontend/src/components/Stage/PlotToolbar.tsx` declares the tool
buttons (`TOOLS` + `ANALYZE_TOOLS` arrays; active tool = store
`plotTool`); `frontend/src/lib/plotToolKeys.ts` maps keys;
`frontend/src/components/Stage/PlotResultChips.tsx` is the floating
result-chip surface. Axis assignment is already pure store state
(`xKey`/`yKeys`/`y2Keys` + `setXKey`/`setYKeys`/`setY2Keys` in
`frontend/src/store/useApp.ts`) — drag-to-axis adds gesture, not
machinery. Row-state (#50) is the law: analysis features read rows
through `rowstate.analysisData` and brush via the store `selection`
(`setRowSelection`), guarded by `frontend/src/architecture.test.ts`.
Workshops follow the state-hook + view + sub-components pattern
(`workshops/distribution/`, `workshops/datafilter/`,
`workshops/tabulate/`, `workshops/peakwizard/` are the ones extended
here). Typed pipeline steps live in `frontend/src/lib/pipeline.ts`
(kinds ui/import/expression/correction/reset/fit) with the shared
executor at `frontend/src/components/workshops/pipeline/executeSteps.ts`;
report sheets ride `frontend/src/lib/report.ts` + `/api/report/emit`.

### Data / control flow

```
gesture (drag ROI / drop chip / click marker / drag well)
  → pure lib math (hit-test, range, spec)      [unit-testable, jsdom-safe]
  → store action (useApp)                       [macro-recorded where curated]
  → rowstate.analysisData rows → calc call (/api/fitting, /api/statplots, …)
  → overlay series (composeDisplayPayload) + floating chip / workshop panel
  → optional endings: report sheet (/api/report/emit), pipeline step, export
```

### Dependency map

- Item 1 (quick-fit gadget) defines the gadget frame; item 4 (gadget
  family) requires item 1. Item 5 (peak-wizard click editing) is
  independent but should land after item 1 to reuse its plot-click
  hit-test helper and tool-activation pattern.
- Item 3 (Graph Builder) is the contract item: its `ZoneWell` drop-zone
  component is reused by item 8 (Tabulate wells). Its box/violin marks
  consume `plans/GAP_PLOTTYPES_PLAN.md` item 2 (stat stage) — the
  Graph Builder ships with a placeholder for those zone combos until
  that lands. Its facet zone consumes GAP_PLOTTYPES item 5.
- Item 2 (drag-to-axis) is independent of item 3 (Stage drops vs
  workshop wells) but its nominal-on-X drop only renders categorically
  once GAP_PLOTTYPES item 4 (categorical axes) lands.
- Items 6 and 7 are independent of everything above.
- **Shared-file conflict warning:** items 1, 2, 3, and 6 all edit
  `frontend/src/store/useApp.ts` (~1931 lines). Do not run their
  agents in parallel against the same working tree — serialize them or
  use worktree isolation and merge in sequence.

### Architecture constraints (binding — state, don't debate)

Pure calc/io (no fastapi/pydantic imports in `src/quantized/calc|io`);
500-line backend module ceiling (test-enforced — NOTE
`src/quantized/routes/export.py` is at 526 lines and the guard is
currently red on main; do not add to it); ~400-line frontend component
convention via the workshop pattern; single parser registry; no eval
(expression steps go through the formula parser); no GPL runtime deps;
DataStruct contract; **every new analysis view reads rows via
`rowstate.analysisData`** (guard #11, `frontend/src/architecture.test.ts`);
vector export by default.

### Open questions

**RESOLVED 2026-07-07 (owner):** import filters persist in the SERVER
config dir (platformdirs); plugins are TRUSTED installs (no sandboxing);
pole figures import as a 2-D map (`mesh_kind="pole"`); WebGL 3-D (#22)
STAYS DEFERRED. Adopted planner defaults (owner may override later):
#41 closes with PyPI-only (installers already shipped); Graph Builder
v1 zones = X/Y/Group + typed-inert Facet; quick-fit ends in a chip with
EXPLICIT commit; GLM/survival ship as an optional `stats` extra; axis
breaks render as panels with break glyphs; plus the minor calls as
written below.


1. **Graph Builder v1 zone scope** — (a) X/Y/Group only, Facet stub
   until GAP_PLOTTYPES #5 lands; (b) full X/Y/Group/Facet in one go;
   (c) add a Color zone distinct from Group. *Recommendation: (a) —
   ship the grammar with a declared-but-inert facet zone so the spec
   type is final from day one.*
2. **Quick-fit result ending** — (a) read-only chip; (b) chip + a
   "commit" action that writes the durable `fitSpec` (recalc #1) and
   can emit a #36 report; (c) auto-commit every ROI move.
   *Recommendation: (b) — explicit commit; auto-commit would spam the
   recalc graph.*
3. **Histogram brush scope (item 6)** — brushing selects rows among
   the analysis view only (excluded/filtered rows can never be
   selected from a bar) vs. raw rows. *Recommendation: analysis rows
   only, mapped back to full row indices — consistent with #50.*
4. **Worksheet reflect of the global filter (item 7's optional half)**
   — the worksheet today greys manual exclusions only; should
   filter-dropped rows also grey there? *Recommendation: yes, fold it
   in — one read of `rowstate.droppedRows` in the worksheet row
   styling; it closes the last "linked everywhere" asymmetry.*

---

## Tier 1 — High Impact

(all shipped — see `## Completed`)

---

## Tier 2 — Medium Impact

(all shipped — see `## Completed`)

---

## Tier 3 — Nice-to-Have

7. **Data-filter dual-thumb sliders (gap #53 residual)** — replace the
   min/max number-field pair with a proper range slider; optionally
   close the worksheet-reflect asymmetry.
   *Model: sonnet.* *Agent: ux-frontend-expert.*
   - [ ] New dual-thumb `RangeSlider` primitive in
         `frontend/src/components/primitives/index.tsx` (keyboard
         accessible, theme tokens, JetBrains Mono value readouts)
   - [ ] Swap it into the range branch of
         `frontend/src/components/workshops/datafilter/DataFilterPanel.tsx`,
         committing through the existing `setRange` in
         `useDataFilter.ts`; keep the NumberFields as fine-entry twins
   - [ ] (Per open question 4) grey filter-dropped rows in the
         worksheet via one `rowstate.droppedRows` read in
         `frontend/src/components/Stage/WorksheetTable.tsx`
   - Acceptance: dragging either thumb live-filters every linked view
     (plot ghosting, Tabulate, Distribution) without mutating the
     dataset; slider and number fields stay in sync.

---

## Follow-up debt (booked, not blocking)

- `components/Stage/PlotStage.tsx` crossed the ~400-line convention during
  items 1/4 (now ~451): extract the gadget/overlay wiring into a
  workshop-style hook. Rolls up into PROJECT_ORGANIZATION_PLAN #7 (the
  committed component-ceiling test) — do both together.

## Completed

- ~~**5. Peak Analyzer click-on-plot marker editing (deferred from closed
  gap #31)**~~ (2026-07-08) — add/remove peak markers by clicking the plot
  during wizard step ②. New pure `frontend/src/lib/peakMarkerHit.ts` (a
  sibling to `uplotGadgets.ts`, not an addition to it — peak-wizard-specific,
  not generic gadget-frame infra): `visiblePeakMarkers` (candidates →
  included-only, tagged with their FULL-array index — what `removePeak`
  expects), `peakMarkerPixels` (data → pixel via `valToPos`, the same
  `fakeU`-testable idiom as the sibling gadget plugins), `hitTestPeakMarkers`
  (2-D Euclidean nearest-wins, unlike `hitTestRoiHandles`/
  `hitTestCursorHandles`'s 1-D edge tests — a marker is a POINT), and
  `peakMarkerEditPlugin` (a plain click, sub-6px movement like the gadget
  plugins' click-vs-drag threshold, either removes the hit marker or adds one
  at the clicked x; composes unconditionally of `tool`, like
  `wheelZoomPlugin`, since the interaction is wizard-scoped not toolbar-tool-
  scoped). **Seam decision** (the plan's "thread the minimal state through
  the store or a focused prop" call): `usePeakWizard.ts` stays the SOLE owner
  of `candidates`/`addPeakAt`/`removePeak` (no parallel state model, no
  migration into the store); a new store field `peakWizardEdit`
  (`PeakWizardEditBridge` — markers + the two callbacks, mirrors
  ReflectivitySeed/StatStageSeed's cross-panel-hook shape) carries a THIN,
  disposable projection into `useApp.ts`, pushed by a `usePeakWizard` effect
  only while step ② is showing, a dataset is active, and Escape hasn't
  paused it — null otherwise (wizard closed, another step, or paused). PlotStage
  reads it as a normal reactive prop into `buildOpts` (unlike `qfitRoi`/
  `gadgetCursors`, which are read imperatively to avoid rebuilding mid-drag —
  this only changes on discrete clicks, so a rebuild per change is correct
  and cheap), adapting the bridge's `addPeakAt`/`removePeak` names to
  `uplotOpts.ts`'s own `onAdd`/`onRemove` convention at that one seam.
  Escape pauses the mode without leaving step ② (mirrors `useGadgetChip`'s
  Escape-to-dismiss); any step change resets the pause, so returning to ②
  always starts un-paused. `steps.tsx`'s `StepFindPeaks` shows a status hint
  ("Click the plot to add a peak · click a marker to remove it (Esc to
  pause)") while `w.markerEditActive`. 23 new tests
  (`lib/peakMarkerHit.test.ts` — tolerance/nearest-wins/ties/empty-list/2-D-
  not-just-x; `components/workshops/peakwizard/usePeakWizard.test.ts` —
  click→add and click-near→remove through the exposed `addPeakAt`/
  `removePeak` handlers, scoping across wizard-closed/other-step/no-active-
  dataset, Escape pause + re-arm). Frontend 1567 tests + `npm run build`
  green. jsdom canvas caveat: the live click gesture itself (`peakMarkerEdit
  Plugin`'s `ready` hook) is not unit-tested, same as the sibling gadget
  plugins' drag hooks — only the pure hit-test math is. Housekeeping while
  in this file: removed a stale duplicate open Tier-3 entry for item 8
  (already fully documented below, dated 2026-07-07) left over from a prior
  strike-and-move that forgot to delete the open stub.

- ~~**8. Tabulate residuals (gap #55)**~~ (2026-07-07) — drag-drop wells and
  report-block export for the pivot workshop. The two Group/Value `<Select>`s
  in `frontend/src/components/workshops/tabulate/TabulatePanel.tsx` are
  replaced by item 3's `ZoneWell` (imported directly from
  `workshops/graphbuilder/ZoneWell.tsx` — no shared-location move), each
  passed `multiple` so its click-to-assign Select stays visible as the
  keyboard/AT fallback even once a column is assigned (Tabulate's wells are
  conceptually single-slot, but `onAssign` always REPLACES via
  `setGroupCol`/`setValueCol` — `multiple` here only keeps the fallback
  Select rendered, it doesn't enable multi-assign). `useTabulate.ts` gained
  `datasetId` (the wells' foreign-dataset guard), `removeGroupCol`/
  `removeValueCol` (the chip "×" affordance reverts to the same
  categorical/continuous auto-pick used on first load, since Tabulate always
  needs SOME column assigned — there's no "empty" grouping state, unlike
  Graph Builder's nullable zones), and `reportBusy`/`toReport` (mirrors
  `workshops/statschooser/useStatsChooser.ts`'s `toReport`: one `stats_table`
  record per group — `{group, count, mean, sd, min, max, median}` — via
  `reportEmit`/`calc/report_emit.py`'s `from_stats_table`, title
  `"<value> by <group> — <dataset>"`, landing via `addReport`). Deviation
  beyond the plan's scope: `ZoneWell` gained an optional `onReject(reason)`
  prop (backward-compatible — Graph Builder's usage is unaffected) so a
  cross-dataset (or malformed) drop can surface a toast
  ("dropped a chip from a different dataset") instead of silently
  no-op'ing; ZoneWell's OWN prior behavior stayed silent-by-default (matches
  `useAxisDrop`'s documented "dragging is exploratory" philosophy) since
  `onReject` is optional and Graph Builder doesn't pass one. 17 new tests
  (`useTabulate.test.ts` — datasetId, remove-reverts-to-default, toReport
  success/failure; `TabulatePanel.test.tsx` (new) — default well contents,
  synthetic-drop reassignment, click-fallback reassignment, foreign-dataset
  reject + toast, report emission success/failure; `ZoneWell.test.tsx` — the
  new `onReject` callback). Frontend 1260 tests + `npm run build` green.
  Eyeball caveat: the live drag gesture is unverified in jsdom, same as every
  prior ZoneWell/CHANNEL_DND item — eyeball via a browser / `tools/visual`.
- ~~**4. ROI gadget family (gap #34)**~~ (2026-07-07) — generalized the item-1
  ROI-band frame into a mode-aware gadget: a "Fit / Integrate / Stats /
  Differentiate / FFT / Cursors" picker on the SAME chip, keeping the `qfit`
  tool id and the existing ROI band (`quickFitPlugin`/`qfitRoi`) as the shared
  drag surface for the four region-based modes (fit's own code path —
  `qfitModel`/`qfitBusy`/`qfitResult`/`qfitError`/`runQuickFit` — is
  **completely unchanged**). New store fields `gadgetMode` + shared
  `gadgetBusy`/`gadgetError` + one result slot per mode
  (`gadgetIntegrateResult`/`gadgetStatsResult`/`gadgetDerivResult`/
  `gadgetFftPreview`) and a `runGadget()` dispatcher generalizing
  `setQfitRoi`'s debounce (still 350ms, still cancels a pending request on the
  next move). **Integrate** mode calls `/api/peaks/integrate` with a single
  `[lo,hi]` region over the first visible plotted channel (area/centroid/FWHM
  chip — richer than the existing one-shot ∫ tool's client-side trapz, and
  edit-in-place like the fit ROI rather than a one-shot drag). **Stats** mode
  calls `/api/stats/descriptive` on the ROI's y values (N/mean/sd/min/max
  chip — a distinct, backend-verified sibling of the existing live "Σ stats"
  tool's client-side `regionStats`). **Differentiate** mode is a new pure
  `frontend/src/lib/differentiate.ts` (`centralDifference` — MATLAB
  `gradient`'s non-uniform-spacing weighted formula, sorts by x internally
  then un-permutes back to the caller's row order so `rowstate.expandToFull`
  aligns correctly) — overlays dy/dx via a new `derivOverlay` store field
  (same `{datasetId,y}` shape as `fitOverlay`, new `withDerivOverlay` in
  `lib/plotdata.ts`, drawn on the **secondary Y axis** since a derivative's
  scale rarely matches the data's) plus an extremum-value chip. **FFT**:
  `calc/spectral.fft_spectral` already existed (Welch/window/one-two-sided
  magnitude-psd-phase-complex, ported+golden already) but **no route exposed
  it** — added a new thin `src/quantized/routes/spectral.py`
  (`POST /api/spectral/fft`), registered in `app.py`, and a
  `frontend/src/lib/api.ts` `fftSpectral` wrapper. The route explicitly never
  accepts `output_type=complex` (422) since a numpy complex array isn't
  JSON-serializable (the CLAUDE.md jsonencode-quirks lesson); ROI rows are
  sorted by x before the call (`differentiate.ts`'s new `sortByX`, shared with
  the differentiate path) since `fft_spectral`'s sampling-rate inference
  assumes ascending x and ROI rows arrive in acquisition order. The FFT gadget
  recomputes a **live preview** on every ROI move (N points / window name
  chip) like the other modes, and an explicit "→ Spectrum" commit action
  (reusing the fit mode's "Commit" button slot) adds it as a **new library
  dataset** via `addDataset` — never auto-committed, matching the #33 explicit-
  commit precedent. **Cursors** mode is NOT ROI-based: a new
  `gadgetCursorsPlugin` in `lib/uplotGadgets.ts` (structurally mirrors
  `quickFitPlugin`'s create/move-edge state machine but draws two independent
  thin lines with no fill, no "move both" gesture) drives a new
  `gadgetCursors` store field, recomputed **synchronously** (nearest-sample,
  not interpolated — new `lib/gadgetCursors.ts` `nearestY`/
  `computeCursorReadout`, reusing `lib/measure`'s `Measurement` type +
  `computeMeasurement`/`formatMeasurement` directly for the Δx/Δy/slope math
  instead of re-deriving it) against the FULL first-plotted-channel data (not
  ROI-scoped). Selecting cursors mode clears any armed ROI and vice versa —
  they're mutually exclusive on the one `qfit` tool. "→ Report" (via the
  existing `/api/report/emit`) is wired for fit (unchanged `curve_fit`),
  integrate (`kind:"integrate"`, the full response passed through verbatim —
  `from_integrate` wants it as-is), and stats (`kind:"stats_table"`,
  `records:[result]`, `columns:["N","mean","std","min","max"]`); differentiate
  /fft/cursors have no natural report ending and the chip omits the button for
  them (fft gets "→ Spectrum" instead; cursors/differentiate get neither).
  `useQuickFitChip.ts`/`.test.ts` renamed to `useGadgetChip.ts`/`.test.ts`
  (mode-aware `GadgetChipState`); `PlotResultChips`'s `qfit` prop renamed
  `gadget`, chip class `.qzk-qfit-chip` → `.qzk-gadget-chip`. Deviations from
  the plan bullet text: Integrate/Stats route through the BACKEND
  (`peaksIntegrate`/`statsDescriptive`) per the orchestrator's explicit spec,
  not `lib/integrate.ts` trapz / `lib/regionStats.ts` (those remain the
  existing ∫/Σ tools' own client-side math, untouched — a deliberate parallel
  sibling, not a replacement); cursors' readout renders in the CHIP (per the
  orchestrator's spec), not `PlotReadouts.tsx`; no new `PlotTool`/toolbar
  button for cursors — it is a `gadgetMode` on the existing `qfit` tool/chip,
  not a separate tool, so the toolbar only grew a longer tooltip. 92 new/
  reworked tests (`lib/differentiate.test.ts`, `lib/gadgetCursors.test.ts`,
  `store/gadget.test.ts`, `components/Stage/useGadgetChip.test.ts` +
  `lib/quickfit.test.ts`/`lib/uplotGadgets.test.ts`/`lib/uplotOpts.test.ts`/
  `lib/plotdata.test.ts`/`components/Stage/PlotResultChips.test.tsx`
  additions; backend `tests/test_api_spectral.py`, 5 tests, transport only —
  the FFT math itself is already golden in `tests/test_calc_spectral.py`).
  Frontend 1313 tests (was 1249) + `npm run build` green; backend 1922 passed
  + 3 skipped, `ruff check src tests` + `mypy src` clean. Eyeball caveat: the
  live ROI-band and paired-cursors drag gestures are unverified in jsdom
  (canvas) — eyeball via `tools/visual` or a manual browser check, same as
  items 1/2/3. Known pre-existing debt (not introduced by this item, not
  fixed either — out of scope): `PlotStage.tsx` crossed the ~400-line
  convention back in item 1 (405→421 lines) and is now 451 after this item's
  additions; a future item should extract its gadget/overlay wiring into a
  `workshops/`-style hook if it keeps growing.

- ~~**3. Graph Builder workshop (gap #51 phase 2)**~~ (2026-07-07) — the
  plot-spec grammar + a drop-zone workshop. New pure
  `frontend/src/lib/plotspec.ts` is the contract (the review centre): a
  versioned, serializable `PlotSpec` = `{version:1, zones:{x:ChannelRef|null,
  y:ChannelRef[], group:ChannelRef|null, facet:ChannelRef|null}, mark}` where
  `ChannelRef={datasetId,channel}` (by id → survives .dwk). Morph rules
  (`inferMark`/`validMarks`/`cycleMark`, driven by the X well's ModelingType
  from `lib/modeling`): continuous/empty X + Y → the **xy family**
  scatter|line (line only when X is sorted-monotonic — `defaultMark`; else
  scatter); nominal/ordinal X + Y → the **categorical family** box|violin|bar;
  a group channel → colour/series split (xy preview). `inferMark` is STICKY
  within a family (keeps the user's cycled mark) and SNAPS across families
  (scatter↔box when X's type flips). `specToRender(spec, datasets)` reads
  `rowstate.analysisData` (guard #11) and returns an xy `PlotPayload`
  (lib/plotdata), client box-stats (lib/statstage — violin degrades to a box
  preview offline, real KDE on the stage), or a message (incomplete hint / bar
  deferred to GAP_PLOTTYPES #4). `serialize`/`deserialize`/`validate` round-trip
  the spec for future figure/template/macro replay. Workshop
  `frontend/src/components/workshops/graphbuilder/`: `useGraphBuilder.ts`
  (state hook), `GraphBuilderPanel.tsx` (view), `ZoneWell.tsx` (the reusable
  drop-zone — item 8 consumes it; accepts the #49 `CHANNEL_DND` drag + a
  click-to-assign Select for keyboard/AT), `GraphPreview.tsx` (Canvas2D
  mini-preview: statRender for box, compact scatter/line otherwise). Store:
  `graphBuilderOpen` flag + `⌘K` Analyze entry (statschooser wiring); "Send to
  Stage" maps xy → `setXKey`/`setYKeys` (macro-recorded free) + statMode off,
  box/violin → a new `statStageSeed` cross-panel hook (`seedStatStage` →
  `useStatStage` consumes the mode/groupCol/valueCol pickers, mirrors the
  reflectivity SLD seed). **Facet is TYPED-BUT-INERT**: the zone accepts,
  displays, and serializes a facet ref from day one (the spec type is final),
  but rendering the small multiples is deferred to GAP_PLOTTYPES item 5 — the
  well shows that note. Deviations: `inferMark`'s 2nd arg is a `MarkContext`
  (typeOf + xMonotonic) not a bare modeling-type map — monotonicity is
  data-derived, not a modeling type; group-in-xy is preview-only in v1 (Send to
  Stage can't row-split the column-oriented main plot, so it toasts and applies
  x/y only); `.dwk`/pipeline-step persistence wiring is left as a follow-up —
  the serialize/validate contract lives in `lib/plotspec` ready for it. 45 new
  tests (`lib/plotspec.test.ts` — every morph rule + round-trip + specToRender
  branch incl. the #50 exclusion path; `ZoneWell.test.tsx` — synthetic drop via
  the `AxisDropZones.test.tsx` hand-built-event workaround + click-to-assign +
  foreign-dataset reject; `useGraphBuilder.test.ts` — morph + send-to-stage
  store effects). Frontend 1249 tests + `npm run build` green. Eyeball caveat:
  the live drag gesture and the Canvas2D preview are unverified in jsdom —
  eyeball via a browser / `tools/visual`.

- ~~**1. Quick-fit gadget (gap #33)**~~ (2026-07-07) — drag an ROI band on
  the live plot; a debounced live fit of the region's rows (`rowstate
  .analysisData` ∩ ROI, guard #11) overlays via the shared `fitOverlay`
  slot. `qfit` tool + `PlotToolbar`/context-menu entries; new
  `lib/uplotGadgets.ts` (ROI-band plugin generalizing `integratePlugin`'s
  drag pattern — create/move/edge-resize, pure `hitTestRoiHandles`) and
  `lib/quickfit.ts` (pure ROI∩analysis row/x,y selection, curated
  Linear/Gaussian/"Exponential Decay" model list, param formatting); store
  slice (`qfitRoi`/`qfitModel`/`qfitBusy`/`qfitResult`/`qfitError` +
  `setQfitRoi`/`setQfitModel`/`runQuickFit`/`commitQfit`/`clearQfit`,
  debounced like the recalc engine); chip in `PlotResultChips.tsx` (model
  picker, params ± SE + R², **explicit** Commit → durable `fitSpec` +
  macro step, optional → Report via `reportEmit`, ✕ dismiss) driven by a
  new `useQuickFitChip` hook (Escape-to-dismiss + the report async flow).
  Deviations: no hotkey (F is already the Curve Fit workshop's — see
  `plotToolKeys.ts`); commit reuses `fitSpec: {model}` as-is (no ROI
  persisted into the durable spec — a future data-change refit runs over
  the FULL analysis view, matching the Curve Fit workshop's own semantics)
  rather than extending the recalc #1 schema. 49 new tests (
  `lib/quickfit.test.ts`, `lib/uplotGadgets.test.ts`,
  `store/quickfit.test.ts`, `components/Stage/useQuickFitChip.test.ts`,
  + `PlotResultChips.test.tsx` additions); the live drag gesture itself
  is un-tested in jsdom (canvas) — eyeball via `tools/visual`.

- ~~**2. Drag-to-axis (gap #49, Graph Builder phase 1)**~~ (2026-07-07) —
  channel chips in the Channels card and legend entries are HTML5-draggable
  (`CHANNEL_DND` mime, mirrors the Library's `DATASET_DND`); dropping onto
  one of three bands overlaid on `PlotStage` (bottom = X, left = Y, right =
  Y2) re-plots through the SAME store actions the card's clicks already use
  (`setXKey`/`setYKeys`/`setY2Keys` — no new plot machinery). New pure
  `lib/dragaxis.ts`: `resolveAxisZone` (band-geometry hit-test against the
  stage's own bounding rect) + `resolveAxisDrop` (the decision — validates
  the payload against the active dataset, enforces the same invariants the
  Channels card's click handlers do: a Label/Ignore-role channel can't ride
  Y/Y2, the last primary Y series can't be moved to Y2, adding to Y
  collapses back to the `yKeys=null` auto sentinel when the result matches
  the dense default) + payload encode/decode. A nominal/ordinal chip
  dropped on X still sets it (degrades to numeric) and surfaces a toast
  ("categorical axes land with plot-types item 4"). New thin
  `components/Stage/AxisDropZones.tsx` (the drop-target shim — one
  listener set on the Stage's outer element catches drag events bubbled
  from every descendant, so no per-band handlers are needed; the three
  band `<div>`s are `pointer-events: none` visual-only, driven by local
  enter/leave-depth + zone state) and `useAxisDrop.ts` (applies
  `resolveAxisDrop`'s actions + the categorical toast, mirrors
  `useQuickFitChip`'s extraction so `PlotStage.tsx` only grew 6 lines).
  Macro recording is free (the real `setXKey`/`setYKeys`/`setY2Keys`
  record their own steps) — verified directly. 54 new tests
  (`lib/dragaxis.test.ts` — zone geometry + every drop-decision branch;
  `components/Stage/AxisDropZones.test.tsx` — synthetic dragenter/
  dragover/drop with a hand-built dataTransfer + a manually-constructed
  event for clientX/clientY, since jsdom has no `DragEvent` constructor at
  all and RTL's `fireEvent.dragOver`/`.drop` sugar silently drops
  coordinates as a result; `components/Stage/useAxisDrop.test.ts`;
  `ChannelsCard.test.tsx` (new) + `PlotLegend.test.tsx` additions).
  Deviations: named the pure lib `lib/dragaxis.ts` (not the plan's
  `lib/dragchannel.ts` — matches the parent task's explicit instruction);
  Esc-cancel relies on native HTML5 DnD (the browser aborts the drag
  before any `drop` fires — no extra code, same as the Library's
  `DATASET_DND` precedent, which also has no Escape handling). Eyeball
  caveat: the real drag gesture (cursor tracking, band visuals, drop
  physically landing) is unverified in jsdom — eyeball via `tools/visual`
  or a manual browser check.

- ~~**6. Distribution platform residuals (gap #52)**~~ (2026-07-07) — box/
  quantile strip, a distribution-fit overlay, and histogram bar-brushing in
  `workshops/distribution/`. Split into sub-components to stay under the
  ~400-line convention: `HistogramStrip.tsx` (DOM bars + drag/click brushing
  + an SVG fit-curve overlay) and `BoxStrip.tsx` (min/Q1/median/Q3/max
  positioned as a % of the histogram's own domain), composed by
  `DistributionPanel.tsx`. Box strip reads straight off the ALREADY-fetched
  `/api/stats/descriptive` response (it already returns q1/median/q3/min/
  max) — no new endpoint call needed. Fit overlay: `setFitDist` lazily calls
  the new `statsFitDistributions` client fn (`/api/stats/fit-distribution`,
  dist omitted → fits all 5 curated families in one call, ranked by AIC —
  `fits[0]` is always the AIC-best regardless of the picked family); the
  pdf CURVE itself is evaluated client-side by a new closed-form `lib/
  distpdf.ts` (gammaFn via Lanczos + the 5 family pdfs + a curve sampler +
  an SVG-points builder) from the SAME params `fit-distribution` returned —
  deliberately NOT chained through `/api/statplots/histogram`'s own `fit=`
  overlay, since that endpoint fits positive-support families with a free
  `loc` while `calc/stats_dist.fit_distribution` fixes `loc=0`, which would
  draw a curve visually disagreeing with the reported AIC/KS-p family.
  Brushing: new pure `lib/distribution.ts` (`binRange`/`rowsInRange`/
  `rowsInBins`, numpy.histogram-compatible half-open bins with an inclusive
  last bin, `pctPosition` for the box strip) — `useDistribution.brushBins`
  maps a bin (or drag-spanned range, or shift-click-extended range from a
  remembered anchor) to PRUNED-row indices, then expands to ORIGINAL rows
  via `rowstate.activeRowIndices(n, droppedRows(active))` before calling
  `setRowSelection`; re-brushing the identical range clears it. Deviation:
  did NOT add `/api/statplots/box` as a consumer (the plan's (a) option) —
  descriptive stats already had every quantile needed, so the box call
  would have been a redundant round-trip; used the fetched-once-per-N-
  families "all fits" endpoint instead of one call per family swap (simpler,
  accepted the minor redundancy of a re-fit on every family switch). 42 new
  tests across `lib/distpdf.test.ts`, `lib/distribution.test.ts`,
  `useDistribution.test.ts` additions, `HistogramStrip.test.tsx`,
  `BoxStrip.test.tsx`, `DistributionPanel.test.tsx` (new). Eyeball caveat:
  the drag-across-bars gesture is exercised in jsdom (DOM bars, unlike
  canvas — `fireEvent.mouseDown/mouseEnter/mouseUp` all work) but the SVG
  curve's visual alignment is unverified — eyeball via `tools/visual` or a
  manual browser check.

- ~~**7. Data-filter dual-thumb sliders (gap #53 residual)**~~ (2026-07-07)
  — a new `RangeSlider` primitive (two overlapping `<input type="range">`,
  CSS custom-property-driven fill bar) in its own
  `components/primitives/RangeSlider.tsx` (re-exported from `primitives/
  index.tsx`, which was already at 389 lines — kept the barrel under the
  ~400 convention rather than inlining ~70 more lines into it). Crossing-
  thumb math (a drag never pushes lo past hi or vice versa) + step-snapping
  is a new pure `lib/rangeslider.ts` (`clampLow`/`clampHigh`/`clampRange`/
  `snapToStep`). Wired into `DataFilterPanel.tsx`'s range branch above the
  existing NumberField pair (kept as fine-entry twins); `useDataFilter.ts`
  now also computes each range column's own finite `dataMin`/`dataMax`
  (ignoring the CURRENT filter — the slider's fixed domain, not the kept
  subset) for the slider's `min`/`max`. A thumb left at the column's data
  extreme commits as an open bound (`undefined`), matching the NumberField's
  blank-is-unconstrained semantics — only a thumb actually moved off the
  domain edge becomes an explicit predicate. Worksheet-reflect half: new
  `lib/rowstate.filteredOutSet(ds)` (a sanctioned wrapper around
  `datafilter.filteredOutRows`, since `Worksheet.tsx` isn't on the guard's
  `filteredOutRows(` allowlist and this avoids needing to extend it) feeds
  a new `filteredOut` prop into `WorksheetTable.tsx`: rows dropped by the
  global data filter grey distinctly from a manual exclusion (opacity +
  italic, not strikethrough; title "dropped by data filter" vs "excluded
  row"); a row that's both stays styled as excluded. Did NOT touch
  guard-#11's allowlist in `architecture.test.ts` — confirmed green as-is.
  24 new/changed tests across `lib/rangeslider.test.ts`,
  `primitives.test.tsx`, `useDataFilter.test.ts`, `DataFilterPanel.test.tsx`
  (new), `rowstate.test.ts`, `Worksheet.test.tsx` additions.
