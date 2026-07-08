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
**Updated:** 2026-07-07

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

1. **Split `routes/export.py` back under the 500-line ceiling** — the
   integrity guard (`tests/test_repo_integrity.py::test_no_god_modules`)
   is red on main at 526 lines, and items 3–5 all add export
   endpoints.
   *Model: haiku (mechanical move, tests exist).* *Agent:
   code-implementer.*
   - [ ] Move the four figure endpoints (`/api/export/figure`,
         `/figure-hitmap`, `/statplot-figure`, `/map-figure`) into a
         new `src/quantized/routes/export_figures.py`; shared helpers
         (`_FIGURE_MIME`, dpi clamp, `_safe_name`, `_attachment`)
         into a small `src/quantized/routes/_export_common.py`
   - [ ] Register the new router in `src/quantized/app.py`; zero
         behavior change; every existing export test passes unmoved
   - Acceptance: `test_no_god_modules` passes; all `/api/export/*`
     endpoints respond byte-identically to before the split.

3. **Tri-contour export (gap #17 last remaining piece)** — scattered
   (cloud) RSM contours rendered export-side straight off the raw
   points, without regridding. The interactive half of this item (the
   d3-contour overlay + Inspector level controls) shipped 2026-07-07
   — see Completed.
   *Model: sonnet.* *Agent: code-implementer.*
   - [ ] Extend `calc/figure_map.py` (199 lines, plenty of headroom)
         with a scattered-points input path (matplotlib
         `tricontour`/`tricontourf` over raw x/y/z arrays)
   - [ ] Extend the map-figure request model in the item-1
         `routes/export_figures.py`; RSM cloud data (`io/xrdml.py`
         snapshot/coupled mesh kinds) is the driving case — synthetic
         + realdata tests
   - Acceptance: a scattered-cloud RSM exports via tricontour with no
     regridding artifacts.

---

## Tier 2 — Medium Impact

4. **Categorical plots (gap #20)** — grouped/stacked bar & column with
   error bars over a categorical x-axis. The payload-shape change is
   the risk: call it out, isolate it, test it.
   *Model: sonnet (the payload contract + interactive); haiku for the
   export renderer once the pattern lands.* *Agent:
   ux-frontend-expert.*
   - [ ] The contract piece FIRST, reviewed on its own: extend
         `PlotPayload` in `frontend/src/lib/plotdata.ts` with an
         optional categorical x concept (category labels + ordinal x
         positions) such that every existing consumer
         (`composeDisplayPayload` chain, overlays, waterfall,
         multipanel splitter) ignores it safely when absent —
         regression-test the untouched numeric path explicitly
   - [ ] Category detection via `lib/modeling.ts` `isCategorical`;
         labels per open question 3 (metadata text labels, formatted
         numeric levels as fallback)
   - [ ] Bar rendering: add uPlot's bars path factory to
         `frontend/src/lib/uplotPaths.ts`; ordinal tick formatting in
         `lib/uplotOpts.ts` `buildOpts`; new pure
         `frontend/src/lib/barlayout.ts` for grouped offsets/widths
         and stacked cumulative sums — unit-tested; error bars reuse
         `errorBarsPlugin` from `lib/uplotOverlays.ts`
   - [ ] Grouped/stacked toggle + orientation (bar/column) as store
         state surfaced in the Channels/Inspector cards
   - [ ] Export: new pure `calc/figure_categorical.py` (grouped/
         stacked bar via matplotlib, `figure_style` presets — the
         `figure_statplots.py` template) + endpoint in
         `routes/export_figures.py`
   - Acceptance: a worksheet with a nominal x column renders grouped
     bars with category tick labels and error bars; the stack toggle
     restacks; the exported PDF matches the on-screen arrangement;
     all existing numeric-plot tests still pass untouched.

5. **Axis breaks + faceting (gap #21)** — manual/automatic axis
   breaks and a trellis/faceted multi-panel generator, both
   interactive and export-side.
   *Model: sonnet.* *Agent: ux-frontend-expert.*
   - [ ] Facet-by-group interactive: extend
         `frontend/src/lib/multipanel.ts` with a facet splitter —
         panels keyed on a nominal column
         (`lib/statschooser.ts` `groupsByCategory`) or on library
         group (`lib/grouping.ts` `groupDatasets`) instead of
         per-channel; `MultiPanelStage.tsx` renders the facet grid
         with the existing x-sync (setScale hook + cursor sync);
         facet picker in the Inspector
   - [ ] Interactive x-break per open question 4: two side-by-side
         synced sub-panels with break glyphs, sharing the multipanel
         machinery; break ranges as store state; automatic break
         suggestion (gap detection over the x column) in a pure lib
         fn
   - [ ] Export-side breaks: twinned matplotlib axes with
         broken-axis marks and shared labels — in `calc/figure.py` if
         it fits the 154-line headroom, else a new
         `calc/figure_break.py` sibling (the guard decides)
   - [ ] Facet export: new `calc/figure_facets.py` (grid of axes from
         grouped series, shared scales/labels, `figure_style`
         presets) + endpoint in `routes/export_figures.py`
   - [ ] Graph Builder's facet zone (GAP_INTERACTION item 3) consumes
         the facet splitter — keep its API pure and spec-driven
   - Acceptance: a manual x-break renders on-screen and exports with
     break marks; facet-by-group produces small multiples with shared
     axes both interactively and in the exported vector PDF.

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
