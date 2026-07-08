# Gap Plot-Types Plan — statistical stage, contour layer, categorical axes, breaks & facets

Implementation plan for the plot-types batch of the remaining
`plans/ORIGIN_GAP_PLAN.md` items: the interactive statistical plots
(#16 remaining half), the interactive contour layer + tri-contour
export (#17 remaining half), categorical plots (#20), and axis breaks +
faceting (#21). The backend calc/export halves of #16 and #17 already
shipped (2026-07-03) and are UI-unwired — `/api/statplots/box`,
`/violin`, `/qq`, `/api/export/statplot-figure`, and
`/api/export/map-figure` have zero frontend callers today — so most of
this plan is connecting existing pure backends to new interactive
surfaces, plus the one genuine contract change (a categorical x-axis
concept in the shared plot payload).

**Status:** Active
**Created:** 2026-07-07
**Updated:** 2026-07-08

---

## Context

### How the pieces fit together

The Stage is a 3-tab switch (`frontend/src/components/Stage/Stage.tsx`:
plot / map / worksheet). Polar and multi-panel are NOT tabs — they are
store-boolean-gated early returns inside `PlotStage.tsx` (`polarMode` →
`PolarStage.tsx`, `stackMode` → `MultiPanelStage.tsx`).
`PolarStage.tsx` (180 lines) is the precedent for a custom Canvas2D
stage: raw canvas, data read directly from the active dataset, helper
math in a pure lib (`lib/polar.ts`), ResizeObserver repaint.
`MapStage.tsx` (346 lines) blits the gridded heatmap via
`Stage/mapRender.ts` from a `MapPayload` (`lib/mapdata.ts`: xAxis /
yAxis / row-major zGrid — exactly the input a contour generator wants);
its Inspector card is `components/Inspector/MapCard.tsx` (grid method +
resolution only, today). `MultiPanelStage.tsx` (169 lines) +
`lib/multipanel.ts` (26 lines: `splitPayload`, `panelHeights`) render
one panel per plotted channel with synced x — the faceting seam. The
shared interactive payload is `PlotPayload` in `lib/plotdata.ts` (464
lines): numeric-only uPlot AlignedData — **no categorical x concept
exists**, which is the #20 contract risk. Half the categorical machinery
already exists elsewhere: `lib/modeling.ts` (modeling types +
`isCategorical`), `lib/statschooser.ts` (`groupsByCategory` — the
box/violin group builder), and per-channel type overrides in the
Channels card. Backend: `calc/statplots.py` (box/violin/qq/histogram
stats), `calc/figure_statplots.py` (matplotlib renderer, same
algorithms), `calc/figure_map.py` (contourf/contour/heatmap/3-D over a
grid; `_contour_levels` lin/log; **no tri-contour**), `calc/figure.py`
(346 lines; single-axes — no twins), `routes/statplots.py`, and
`routes/export.py` — which is at **526 lines, already over the
500-line guard (red on main as of 2026-07-07)**; item 1 fixes that
before the other items add endpoints.

### Data / control flow

```
interactive:  dataset columns → modeling type / group partition
              → /api/statplots/* stats (or client fallback)
              → Canvas2D stat stage / uPlot payload / contour overlay
export:       same stats → calc/figure_statplots | figure_map | figure
              → /api/export/* → vector PDF/SVG (default) — export must
              equal interactive because both call the same calc
```

### Dependency map

- Item 1 (export-route split) precedes items 3, 4, 5's export
  sub-tasks (they all add `/api/export/*` endpoints) and unblocks the
  currently-red integrity guard. Do it first; it is mechanical.
- Item 2 (stat stage) is consumed by `plans/GAP_INTERACTION_PLAN.md`
  item 3 (Graph Builder box/violin marks). Independent of items 3–5.
- Item 4 (categorical payload) is the shared-contract change: it
  touches `lib/plotdata.ts`, which every plot consumer reads. Items 2
  and 5 do NOT depend on it, but GAP_INTERACTION item 2's
  nominal-on-X drop resolves through it.
- Item 5 (breaks + facets) extends `MultiPanelStage`/`multipanel.ts`
  and is consumed by the Graph Builder's facet zone (cross-plan).
- Items 2, 3, 4 are mutually parallelizable EXCEPT that 2 and 4 both
  touch `frontend/src/store/useApp.ts` (new mode/state) and 2, 4, 5
  all touch `lib/uplotOpts.ts` or `lib/plotdata.ts` — serialize those
  edits or use worktrees.

### Architecture constraints (binding — state, don't debate)

Pure calc/io (no fastapi imports); 500-line backend module ceiling
(routes/export.py is over it TODAY — item 1); ~400-line component
convention (PlotStage is at 405 — do NOT grow it; new stages are new
components); single parser registry; no eval; no GPL runtime deps
(d3-contour is ISC — safe); DataStruct contract; new analysis views
read rows via `rowstate.analysisData` (guard #11); vector export by
default; interactive uPlot / export matplotlib split — export and
interactive must derive from the same calc so they agree.

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


1. **Contour generation dep** — (a) add `d3-contour` (ISC, tiny,
   battle-tested marching squares); (b) hand-roll marching squares in
   a pure lib. *Recommendation: (a) d3-contour — license-clean, less
   code to maintain, testable through its data output.*
2. **Stat-stage surface** — (a) a store boolean + early-return
   component like `polarMode` (stays inside the plot tab); (b) a 4th
   Stage tab. *Recommendation: (a) — box/violin is a view of the same
   dataset, like polar; a tab implies a different data domain the way
   map does.*
3. **Categorical label source (v1)** — DataStruct values are numeric,
   so category labels are (a) formatted numeric level values; (b) text
   labels recovered from metadata (e.g. Origin text columns) when
   present, numeric otherwise. *Recommendation: (b) with (a) as the
   fallback — cheap, and instrument label columns are the common
   case.*
4. **Interactive axis-break representation** — uPlot has no native
   broken scales: (a) render an x-break as two side-by-side synced
   sub-panels with break glyphs (extends the multipanel machinery);
   (b) fake it with a discontinuous tick formatter on one axis (lies
   about slope); (c) interactive breaks out of scope — breaks are
   export-only. *Recommendation: (a); (b) misleads and violates the
   honest-rendering instinct.*

---

## Tier 1 — High Impact

(all shipped — see `## Completed`)

~~1. **Split `routes/export.py` back under the 500-line ceiling**~~
   **CLOSED 2026-07-08** — done (boxes were plan drift, verified against
   code):
   - [x] Four figure endpoints (`/api/export/figure`, `/figure-hitmap`,
         `/statplot-figure`, `/map-figure`) live in
         `src/quantized/routes/export_figures.py`; shared helpers
         (`_FIGURE_MIME`, dpi clamp, `_safe_name`, `_attachment`) in
         `src/quantized/routes/_export_common.py`
   - [x] `export_figures.router` registered in `src/quantized/app.py`;
         `export.py` now 280 lines, `test_no_god_modules` green, all
         `/api/export/*` endpoints unchanged (e2e-smoke verified)

(item 3, tri-contour export, shipped 2026-07-08 — see Completed; gap #17 is
now fully closed, interactive + export halves both shipped)

---

## Tier 2 — Medium Impact

(items 4 and 5 shipped 2026-07-07, with item 5's two booked interactive
residuals — paneled x-breaks and the Graph Builder facet send-to-stage —
closed in a 2026-07-08 follow-up; see Completed for the full outcome,
including two deliberate deviations from the bullets below)

---

## Tier 3 — Nice-to-Have

(none — the plot-types long tail, WebGL 3-D and ternary/quiver, lives
in `plans/GAP_TIER3_PLAN.md`)

---

## Completed

- ~~**1. Split routes/export.py (guard red)**~~ (2026-07-07) — split into
  `export.py` (280 lines, data exporters) + `export_figures.py` (244,
  figure endpoints) + `_export_common.py` (27, shared helpers);
  `test_no_god_modules` green again. Merge fix-up: the split had been
  cut from a pre-#13 base and dropped the #11 `overrides` passthrough
  on /figure + /figure-hitmap — restored (field + both kwargs). Full
  suite 1769 green.

- ~~**2. Interactive statistical plot stage (gap #16 remaining)**~~
  (2026-07-07) — `Stage/StatStage.tsx` (Canvas2D, the `PolarStage.tsx`
  precedent) + `Stage/statRender.ts` (pure draw fns, `mapRender.ts`
  precedent) + `Stage/useStatStage.ts` (state hook) + `lib/statstage.ts`
  (pure grouping/box-stats-offline-fallback/scale-layout math, unit
  tested — cross-checked a hand oracle against
  `calc.statplots.box_stats` bit-for-bit). All 4 modes (Box/Violin/Q-Q/
  Histogram+fit) render on ONE Canvas2D stage per the owner's explicit
  direction (a deliberate deviation from this item's original
  "Q-Q/histogram via ordinary uPlot payloads" bullet — keeps it one
  self-contained stage, matching PolarStage). `statMode` store boolean +
  `▦` toggle in `PlotToolbar.tsx` + early-return in `PlotStage.tsx`
  (mirrors `polarMode`/`stackMode`); also wired into the `⌘K` command
  palette (`App.tsx`, alongside "Toggle stacked layout"). Grouping reuses
  `lib/statschooser.ts` (`groupsByCategory`/`groupsFromColumns`) and
  `lib/modeling.ts` (`channelModelingType`/`isCategorical`) rather than
  reinventing them; rows through `rowstate.analysisData` (guard #11).
  Box has an offline client fallback; Violin degrades to Box rather than
  ever fabricating a KDE; Q-Q/Histogram surface an inline error when the
  backend is unreachable. `lib/api.ts` gained `statsBox`/`statsViolin`/
  `statsQQ`/`exportStatplotFigure` (first frontend callers of
  `/api/statplots/box`+`/violin`, and of `/api/export/statplot-figure`).
  Scope note: the plan's "group-by-dataset via `lib/grouping.ts`
  `groupDatasets`" sub-bullet was NOT implemented — out of the task's
  explicit scope (per-dataset grouping only); left for a follow-up if
  wanted. Frontend 1204 tests green (+31 new), `npm run build` green.

- ~~**3. Interactive contour layer (gap #17 interactive half)**~~
  (2026-07-07) — `lib/contour.ts` (pure): `contourLevels` ports
  `calc/figure_map.py::_contour_levels`'s count/explicit-list, lin/log
  semantics field-for-field (including the log-floor rule), cross-checked
  numerically against the Python function; `computeContours` is a thin
  typed wrapper over `d3-contour` (added as a runtime dep — ISC, plus its
  transitive `d3-array`/`internmap`, both ISC; `@types/d3-contour` +
  transitive `@types/d3-array`/`@types/geojson` are MIT dev-only — no GPL
  anywhere, confirmed via `npm view ... license` on every package that
  landed in `package-lock.json`) turning a MapPayload grid into polygon
  rings in DATA coordinates (documents and inverts d3-contour's
  cell-centred `i+0.5` index convention); `ringToCanvas` reuses the same
  rect/axis-extent transform `mapRender.ts` already uses for peak markers.
  17 unit tests: hand-computed level cases (incl. log floor), a 3x3
  grid cross-checked against a raw `d3-contour` probe run, a synthetic
  Gaussian-bump grid (half-max ring radius/centroid match the analytic
  value), null-cell (gap) handling, and degenerate-input non-throwing.
  Wired into `Stage/mapRender.ts` (`drawContours`, ink-coloured lines —
  not per-level colormap samples, which would blend into same-hue
  heatmap cells right where contrast matters most — clipped to the plot
  rect, `ContourOptions` threaded through `draw()`'s existing optional-arg
  tail so old positional call sites are untouched) and `MapStage.tsx`
  (a `∿` toolbar quick-toggle beside `log`, contour state read from the
  store). Level controls live in `Inspector/MapCard.tsx` (on/off, level
  count, lin/log spacing) backed by new store fields `contourOn`/
  `contourLevelCount`/`contourScale` (session state, same non-localStorage
  pattern as `mapMethod`/`mapRes` — persists across dataset switches
  within a session, not across reloads). Isoline labels were skipped per
  the plan's "optional, skip if it bloats" — export already labels via
  `clabel`; filled contours (contourf) also deferred, lines only for now.
  Real-raster tests added to `mapRender.test.ts` (the `CANVAS_OK`-gated
  node-canvas pattern) confirm the overlay actually paints distinct
  pixels and that an all-null map draws no lines without throwing.
  **Remaining on gap #17: tri-contour export** (scattered-point RSM
  contours without regridding) — stays export-side per the plan; tracked
  as the now-narrowed Tier 1 item 3. Frontend 1270 tests green (+21 new:
  17 in `contour.test.ts`, 2 added to `mapRender.test.ts`, 2 in the new
  `MapCard.test.tsx`), `npm run build` green.

- ~~**4. Categorical plots (gap #20)**~~ (2026-07-07) — the contract piece
  first, reviewed in isolation: `PlotPayload.xCategories?: string[]` added to
  `lib/plotdata.ts` (additive; every existing transform already spreads
  `{...payload}` so it passes through for free — regression-tested explicitly
  in `plotdata.test.ts`'s new "xCategories (gap #20 contract)" block covering
  `maskExcludedPayload`/`applyWaterfall`/`withFitOverlay`/
  `highlightSelectedPayload`/`composeDisplayPayload`/`dropTrailingEmptyRows`).
  Ordinal tick formatting landed in `lib/uplotOpts.ts`
  (`categoricalTickFormatter`, wins over an explicit numeric `xFmt` on the x
  axis) — this consumer is real and tested but has ~~**no producer yet**~~
  CLOSED 2026-07-08: `lib/plotdata.ts` gained `categoricalXPayload(payload,
  data, xKey, modelingType)` — when `xKey` is a real value channel (not the
  time axis) whose modeling type (`lib/modeling.ts`'s `channelModelingType`,
  override-aware) reads nominal/ordinal, it remaps `data[0]` to ordinal
  level positions and sets `xCategories` via `lib/barlayout.ts`'s
  `resolveCategoryLabels` (Origin text-label column when one covers every
  level, else formatted numeric levels); a no-op passthrough otherwise
  (continuous channel, time axis, no finite levels). Wired into the main
  uPlot fetch path in `Stage/PlotStage.tsx` (the one `setPayload` call site,
  applied before the `composeDisplayPayload` overlay stack, which never
  reads x values — only length — so it's unaffected). 7 new tests in
  `plotdata.test.ts`'s new "categoricalXPayload (gap #20 producer)" block
  (passthrough for continuous/null-xKey/no-levels, ordinal remap + formatted
  labels, ordinal-vs-nominal both honored, Origin text-label preference,
  null/non-finite row handling). Known accepted gap (not introduced by this
  change — the field's own contract already blesses it): `lib/clipboard.ts`'s
  `payloadToTSV` still exports the raw `data[0]` (ordinal positions for a
  categorical x) rather than the resolved category labels; a future
  consumer-side enhancement, same shape as `categoricalTickFormatter`.
  Frontend 1559 passed, build green — "categorical X on the ordinary uPlot
  plot" is no longer just scaffolding, it now actually happens.
  New pure `lib/barlayout.ts` (category level/label resolution — an Origin
  `metadata.origin_text_columns` column when one consistently labels every
  level, RESOLVED decision b, else formatted numeric levels, decision a;
  mean±SEM per series; grouped sub-slot offsets; stacked cumulative
  segments), unit-tested standalone.
  **Deviation from the plan's literal bullets (documented, not silent):**
  bar rendering did NOT use uPlot's native `bars()` path factory in the main
  plot. Investigated it (uPlot's `disp.x0`/`size`/`y0`/`y1` facets + `bands`
  config can do grouped/stacked bars, confirmed by reading the bundled
  source), but wiring it through the shared, everywhere-used
  `uplotOpts.buildOpts` was high blast-radius for a feature the codebase
  already has a lighter, precedented home for: the categorical mark family
  (box/violin/bar, `lib/plotspec.ts`'s own `CATEGORICAL_MARKS`) already
  renders through the Canvas2D stat stage (gap #16). Bar joined it as a 5th
  `StatMode`: `lib/statstage.ts` (`StatMode` +
  `barValueDomain` — a signed zero-anchored domain, unlike the existing
  `zeroBasedDomain`), `Stage/statRender.ts` (`drawBar` — grouped clustered
  bars OR one stacked bar per category, SEM error whiskers, reusing the
  box/violin `categorySlots` axis geometry), `Stage/useStatStage.ts` (a
  `barData` matrix computed locally — no backend round-trip needed for the
  interactive path — + a grouped/stacked `barStack` toggle), `Stage/
  StatStage.tsx` ("Bar" mode option + a Grouped/Stacked segmented control).
  `lib/plotspec.ts`'s `specToRender` now returns a real `{kind: "bar", ...}`
  (was a permanent deferred `note`); `GraphPreview.tsx` draws it via the same
  `statRender.draw` dispatcher; `useGraphBuilder.ts`'s `sendToStage` seeds the
  stat stage for bar the same way it already does for box/violin
  (`seedStatStage`) — completing the mark end-to-end, Graph Builder → stage.
  **Known limitation** (documented inline): the stat stage's bar series come
  from the MAIN plot's Y selection (mirrors box/violin's own pre-existing
  fallback), not necessarily the Graph Builder's own Y-zone picks when they
  differ from what's currently plotted.
  **Booked, not shipped:** horizontal bar orientation (bar vs column) — only
  vertical columns; a legend inside the Stat Stage's own Canvas2D bar view
  (series colors are visible but unlabeled there — the exported figure DOES
  carry a legend).
  Export: new pure `calc/figure_categorical.py` (grouped/stacked bar via
  matplotlib, `figure_style` presets, mean±SEM whiskers, always-visible zero
  baseline for mixed-sign data) + `POST /api/export/categorical-figure` in
  `routes/export_figures.py` (421 lines, still under the ceiling). Backend
  +43 tests (`test_calc_figure_categorical.py` + `test_api_export.py`
  additions), frontend +~90 tests across `barlayout.test.ts` (new),
  `statstage.test.ts`, `statRender.test.ts`, `plotspec.test.ts`,
  `uplotOpts.test.ts`. Full suites green (backend 2024, frontend 1479),
  `npm run build` green.

- ~~**5. Axis breaks + faceting (gap #21)**~~ (2026-07-07) — export-side
  breaks shipped first (per the plan's own dependency note, "it's
  unambiguous"), as an `overrides.x_breaks: [[lo,hi],...]` on the EXISTING
  `render_figure`/`POST /api/export/figure` (no new endpoint): validated in
  `calc/figure._validate_overrides` (non-empty, `[lo,hi]` pairs, `lo<hi`,
  sorted + non-overlapping). The renderer itself split into a new sibling
  `calc/figure_break.py` (twinned matplotlib panels, `sharey`, diagonal break
  glyphs at each seam, hidden inner spines, per-panel `set_xlim` clipping —
  the paneled representation the plan's RESOLVED decision required, never a
  discontinuous-tick trick) — `figure.py` was at 509 lines with the break
  logic inline (over the 500-line ceiling), so the guard decided the split,
  exactly per the plan's own fallback clause. Scoped deliberately smaller
  than the single-axes path: breaks combine with the plot + title/labels/
  basic legend/grid only, not the full gap #11 `_apply_overrides` sweep
  (legend/spines/limits/margins target ONE axes; a broken figure has
  several) — and not with the figure-hitmap collector (single-axes pixel
  harvesting). `lib/figureOverrides.ts`'s `FigureOverrides` gained `x_breaks`
  (type-only; `compactOverrides` drops an empty list) so a future UI control
  can pass it type-safely — no such control was built this pass (booked).
  Facet export shipped: new pure `calc/figure_facets.py` (grid of
  pre-split panels, `sharex`/`sharey`, per-panel titles, unused trailing
  grid cells hidden, `figure_style` presets) + a NEW
  `routes/export_facets.py` (`POST /api/export/facets-figure`) — kept
  separate from `export_figures.py` (already at 421 lines after item 4's
  bar endpoint) rather than risk the ceiling again.
  Interactive: new pure `lib/facet.ts` — `facetPayloads` (row-partition
  splitter; category labels resolve through `lib/barlayout.resolveCategoryLabels`,
  the same text-column-then-numeric rule bar charts use) shaped close to
  `lib/multipanel.ts`'s `splitPayload` output (`PlotPayload[]`) so a future
  `MultiPanelStage` facet mode is a small additive consume; `suggestBreaks`
  (pure gap-detection over the x column: any adjacent gap ≥4× the median
  gap is a candidate break) — unit-tested, NOT wired into any UI yet.
  Graph Builder's facet zone is now a real, thin consume for the **xy family
  only** (scatter/line): `lib/plotspec.ts`'s `SpecRender` xy variant gained
  an optional `facets` field (additive; regression-tested that it's absent
  when `zones.facet` is unset); `GraphPreview.tsx` renders a small-multiples
  grid (one mini xy panel per facet level, own label, `sqrt`-balanced
  rows/cols) instead of one panel when facets are present. Box/violin/bar
  don't facet (the categorical-x-facet cross-product was out of scope).
  **Booked (LANE-BLOCKED, not a scope choice):** this pass's lane forbade
  editing `lib/multipanel.ts` / `MultiPanelStage.tsx` beyond consuming an
  already-existing prop — neither file exposes a facet/break config seam
  today, so three interactive pieces from the original bullets could not
  ship: (a) facet-by-group in the MAIN stacked-panel Stage (would need a new
  prop on `MultiPanelStage`), (b) interactive x-breaks as paneled sub-views
  "sharing the multipanel machinery" (same blocker), (c) the Graph Builder's
  "Send to Stage" carrying a facet spec to the main plot (today it only
  toasts that group-split is preview-only). `lib/facet.ts`'s output shape is
  the hand-off point for whoever owns `multipanel.ts` next.
  Backend +43 tests (`test_calc_figure_break.py`, `test_calc_figure_facets.py`
  + `test_api_export.py` additions), frontend +~30 tests (`facet.test.ts`
  new, `figureOverrides.test.ts`, `plotspec.test.ts`). Full suites green
  (backend 2024 passed / 3 skipped, frontend 1479), `npm run build` green.
  **Follow-up (2026-07-08) — closes booked item (a):** the `multipanel.ts`/
  `MultiPanelStage.tsx` lane opened up once the Origin spatial-apply work
  merged, so facet-by-group in the MAIN stacked-panel Stage shipped: a new
  store action `facetByColumn(datasetId, col)` runs `lib/facet.facetPayloads`
  (through the analysis view, guard #11) and populates a NEW `facetPanels`
  field — deliberately PARALLEL to `spatialPanels`, not a reuse of it (a
  spatial panel is a dataset+channel *reference* `MultiPanelStage` fetches
  and gives independent axis state; a facet panel is an already-materialized,
  row-filtered `PlotPayload` slice of ONE dataset, and the whole point of
  faceting is a x-domain SHARED once across every panel, not independent
  per-panel state — see the field's doc comment in `store/useApp.ts`).
  `MultiPanelStage.tsx` gained a third render mode (facet grid, sqrt-balanced
  CSS grid via new `lib/multipanel.facetGridSize`, shared x-domain via new
  `lib/facet.sharedXDomain`, per-panel uPlot `title` = the facet level,
  box-zoom/pan sync reusing the SAME idiom the plain per-channel stack uses
  — both now share one extracted `lib/multipanel.xZoomSyncHook` factory
  instead of two near-duplicate inline hooks, plus a shared `cellSize` helper
  replacing 4x-duplicated grid-cell math, keeping the component back under
  the ~400-line convention after the new mode's DOM-building code). A
  "Facet by column…" `⌘K` command palette entry (`App.tsx`) prompts for the
  column via `askParams` and calls the action on the active dataset.
  `PlotStage.tsx`'s stack-mode gate now also fires on `facetPanels`.
  Frontend +~35 tests (`facet.test.ts`, `multipanel.test.ts`,
  `useApp.test.ts`'s new `facetByColumn` describe block); full suite green
  (1570), `npm run build` green.
  **Code-health note:** `Stage/statRender.ts` (539 lines) and
  `Stage/useStatStage.ts` (416 lines) are now past the informal ~400-line
  mark — neither is a `.tsx` component (the enforced convention's literal
  scope) and no test fails, but both are candidates for a future split (e.g.
  bar drawing into its own sibling file, mirroring the `calc/figure_break.py`
  precedent) rather than growing further untouched.
  **Follow-up (2026-07-08) — closes booked items (b) and (c), gap #21 fully
  interactive now:** (b) paneled x-breaks shipped as a FOURTH `MultiPanelStage`
  mode. `lib/facet.ts` gained `breakPayloads` (splits a series into one panel
  per contiguous x-segment implied by a set of `[lo,hi]` breaks — typically
  `suggestBreaks`'s own output, finally wired up — segmenting the SAME way
  `facetPayloads` row-slices, just by x-range instead of by category level)
  and `sharedYDomain` (the opposite sharing axis from facet's `sharedXDomain`:
  break panels each keep their OWN local x-range but share ONE y-domain — an
  honest axis break only elides x). `lib/multipanel.ts` gained
  `breakPanelWidths` (a single ROW of panels, not facet's sqrt-balanced grid —
  breaks are conventionally 2-3 segments read left-to-right in x order, with a
  fixed-width gutter between each pair for the break glyph). The glyph itself
  is a pure-CSS diagonal-hash seam (`repeating-linear-gradient` on the
  `--border` token), not a text/unicode glyph, so it never depends on font
  rendering. New store slice: `breakPanels` (parallel to `spatialPanels`/
  `facetPanels`, cleared in lockstep everywhere those three are — `setActive`,
  `setStackMode`, `loadWorkspace`, dataset clone) and `breakAtGaps(datasetId,
  breaks?, gapFactor?)` (mirrors `facetByColumn`'s shape: reads the ANALYSIS
  view (guard #11), carries over the current x/y selection only when the
  dataset is already active, auto-detects via `suggestBreaks` when no explicit
  override is given, no-ops with a toast when no qualifying gap exists or
  fewer than 2 segments end up with data). A "Break x-axis at gaps…" `⌘K`
  command (`App.tsx`) prompts for the gap-factor threshold via `askParams`.
  (c) Graph Builder's "Send to Stage" now carries a facet spec:
  `useGraphBuilder.ts`'s scatter/line branch calls `setXKey`/`setYKeys` FIRST,
  then — only when the Facet zone is filled — calls the store's
  `facetByColumn` (which then carries over exactly the x/y selection just
  assigned, since the dataset is already active) instead of leaving the plot
  flat; `GraphBuilderPanel.tsx`'s facet-well note updated to match (was
  explicitly documenting the gap as NOT done). Box/violin/bar still don't
  facet (unchanged, out of scope — the categorical-x-facet cross-product).
  **Code-health follow-up:** `MultiPanelStage.tsx` would have crossed 450+
  lines with a 4th mode inlined, so it was split into a thin view (71 lines)
  + a new `Stage/useMultiPanelStage.ts` state/render-effect hook (421 lines,
  the `useStatStage.ts`/`StatStage.tsx` precedent) — the enforced ~400-line
  convention is `.tsx`-component-scoped, and 71 lines is comfortably under
  it. **Drive-by fix surfaced while writing the first-ever MultiPanelStage
  component test:** the spatial-payloads-fetch effect called
  `setSpatialPayloads([])` with a FRESH empty-array literal on every non-
  spatial render, which — being referentially unequal to the prior empty
  state — triggered a pointless extra re-render that re-ran (and
  double-built) the uPlot instances in the render effect on every
  facet/break/plain-stack mount or mode switch (silent in production since
  `destroyAll()` cleans up the first set before the rebuild; only visible
  once a test recorded constructor calls). Fixed with a functional update
  that preserves the same `[]` reference when already empty.
  Tests: `facet.test.ts` (+`breakPayloads`/`sharedYDomain`, mirroring the
  facet-side cases plus multi-break/unsorted-break/empty-segment-dropped
  cases), `multipanel.test.ts` (+`breakPanelWidths`), `useApp.test.ts`'s new
  `breakAtGaps` describe block (12 cases, including a same-active-vs-
  different-active x/y carry-over pair using a deliberately evenly-spaced
  decoy column), `useGraphBuilder.test.ts` (+2: facet-zone send enters the
  facet grid with the right channels baked into each panel; no-facet send is
  unaffected), and a NEW `Stage/MultiPanelStage.test.tsx` — the first
  component-level regression test for this file, mocking `uplot`'s
  constructor (headless — jsdom has no canvas/layout engine for it) and
  `ResizeObserver` (absent in jsdom) to confirm all FOUR modes (plain stack,
  spatial-apply, facet-by-column, paneled x-break) build the expected panel
  count without throwing. Frontend 1669 passed (was 1570 — some of the gap
  is other work merged in the interim), `npm run build` green.

- ~~**3. Tri-contour export (gap #17 last remaining piece)**~~ (2026-07-08) —
  `calc/figure_map.py` (199 → 281 lines, still well under the ceiling) gained
  a scattered-points path selected by a new `contour_source: "grid"|"points"`
  parameter (default `"grid"`, byte-identical to the pre-existing call
  convention — regression-tested explicitly). In `"points"` mode, `x_axis`/
  `y_axis`/`z_values` are raw equal-length scattered arrays (the RSM
  point-cloud shape `io/_xrdml_scan.py`'s snapshot/coupled layouts produce,
  never regridded); the cloud is Delaunay-triangulated
  (`matplotlib.tri.Triangulation`) and drawn with `tricontour`/`tricontourf`,
  restricted to `kind` `"contour"`/`"contourf"` (no scattered analogue for
  heatmap/3-D). Same level semantics as the grid path — `_contour_levels` is
  shared verbatim. Degenerate input (collinear points -> qhull `RuntimeError`)
  is caught and re-raised as a clean `ValueError` (-> 422, never a matplotlib
  internals leak); fewer than 3 finite points, mismatched array lengths, a
  missing `z_values`, and an unsupported `kind` in points mode all raise
  their own targeted `ValueError`s. `routes/export_figures.py`'s
  `MapFigureRequest` extended minimally: `z_grid` became optional (required
  only for `contour_source="grid"`), plus new `z_values`/`contour_source`
  fields — no new endpoint. Bundled in the same pass: the booked
  `GAP_TIER3_PLAN.md` item 2 follow-up (preset-dpi + mirrored-tick parity for
  `figure_map.py`/`figure_statplots.py`, see that plan's Completed entry).
  Tests: `tests/test_calc_figure_map.py` (+18 — tricontour render across
  kind×format, level-count-changes-output, collinear/too-few-points/
  mismatched-length/missing-z_values/bad-kind 422-shaped `ValueError`s, an
  explicit grid-default-matches-explicit-contour_source byte-identity
  regression, dpi-preset resolution, a `realdata`-marked corpus RSM-cloud
  render), `tests/test_calc_figure_statplots.py` (+2, dpi-preset resolution),
  `tests/test_api_export.py` (+5 — scattered tricontour PNG, collinear 422,
  kind-restriction 422, map/statplot dpi-preset-resolution round trips).
  Backend 2049 passed (was 2024), 3 skipped (realdata); ruff + mypy clean.
