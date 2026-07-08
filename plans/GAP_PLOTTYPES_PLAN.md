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

2. **Interactive statistical plot stage (gap #16 remaining)** —
   box/whisker, grouped box, and violin as a live stage; Q-Q and
   histogram-with-fit through the normal uPlot path.
   *Model: sonnet.* *Agent: ux-frontend-expert.*
   - [ ] New `frontend/src/components/Stage/StatStage.tsx` on the
         `PolarStage.tsx` Canvas2D precedent (do NOT grow
         `PlotStage.tsx`, at 405 lines): store boolean `statMode` +
         early-return gate, toolbar toggle in
         `frontend/src/components/Stage/PlotToolbar.tsx` (per open
         question 2)
   - [ ] Grouping: nominal column via `lib/modeling.ts`
         `channelModelingType` + `lib/statschooser.ts`
         `groupsByCategory`; group-by-dataset via
         `lib/grouping.ts` `groupDatasets`; all values from
         `rowstate.analysisData` (guard #11)
   - [ ] Stats via `/api/statplots/box` and `/violin` (their first
         frontend consumers — add client fns in
         `frontend/src/lib/api.ts`); a new pure
         `frontend/src/lib/statplotdata.ts` holds the box-stats
         client fallback (quartiles/whiskers/fliers so the stage
         works offline) and the canvas layout math — unit-tested;
         violin honestly requires the backend (KDE) and degrades to
         box offline
   - [ ] Q-Q and histogram+fit rendered as ordinary uPlot payloads
         (scatter + line series) built in `statplotdata.ts` from
         `/api/statplots/qq` / `/histogram`
   - [ ] Export buttons wire `/api/export/statplot-figure` via a new
         postDownload helper in `lib/api.ts` (the `exportFigure`
         pattern); same stats feed both paths so export ==
         interactive
   - Acceptance (carried from the gap item): a grouped box and violin
     of a multi-sample worksheet render interactively and the vector
     export shows identical stats (quartiles/whiskers/fliers) because
     both derive from `calc/statplots.py`.

3. **Interactive contour layer + tri-contour export (gap #17
   remaining)** — labeled isolines over the live 2-D map; scattered
   (cloud) RSM contours export-side without regridding.
   *Model: sonnet.* *Agent: ux-frontend-expert (stage/Inspector);
   code-implementer for the tri-contour backend sub-task.*
   - [ ] Add `d3-contour` (ISC) to `frontend/package.json` (per open
         question 1); new pure `frontend/src/lib/contour.ts` —
         threshold generation (count / lin / log, mirroring
         `_contour_levels` in `calc/figure_map.py`) and
         MapPayload→d3-contour input adapting (zGrid flat + nx/ny);
         unit-tested against known grids
   - [ ] Contour overlay canvas in
         `frontend/src/components/Stage/MapStage.tsx`, layered over
         the heatmap blit (the same host-div layering the cut-drag
         preview uses); isoline labels along paths; keep
         `Stage/mapRender.ts` pure
   - [ ] Level controls in
         `frontend/src/components/Inspector/MapCard.tsx`: contour
         on/off, level count, lin/log spacing, label toggle —
         store-backed like `mapMethod`/`mapRes` (persisted prefs)
   - [ ] Tri-contour export: extend `calc/figure_map.py` (199 lines,
         plenty of headroom) with a scattered-points input path
         (matplotlib tricontour/tricontourf over raw x/y/z arrays);
         extend the map-figure request model in the item-1
         `routes/export_figures.py`; RSM cloud data
         (`io/xrdml.py` snapshot/coupled mesh kinds) is the driving
         case — synthetic + realdata tests
   - Acceptance: an RSM map shows labeled isolines tracking the level
     controls; exporting the same view produces matching contours; a
     scattered-cloud RSM exports via tricontour with no regridding
     artifacts.

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

(empty — nothing shipped against this plan yet)
