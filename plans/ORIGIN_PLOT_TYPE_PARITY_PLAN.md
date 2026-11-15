# Origin Plot-Type Parity Plan

Every 2D plot type a researcher makes in Origin must (1) be buildable from
scratch in quantized and (2) import from an Origin-made `.opju` to the same
figure. The evidence comes from a generated corpus. A seeded data generator
plants known data, and the locally installed Origin 2026b Student builds each
plot type from it over COM. Origin's own answers are saved as the oracle: the
plotted datasets, the plot type, axis ranges, styles and a PNG. quantized is
then scored against those answers on both paths. Passing examples join the
private `test-data` corpus.

**Parent:** MAIN_PLAN.md
**Status:** Active
**Created:** 2026-11-15
**Updated:** 2026-11-15

---

## Context

### How the pieces fit together

- **Creation side.** Gallery `frontend/src/lib/plotTypes.ts` (line, scatter,
  line+symbol, area, column, stacked column, box, violin, histogram,
  contour/heatmap, double-Y, polar, waterfall, stacked panels, ternary). Stat
  modes are in `lib/plotviewSanitize.ts`, which also has strip. Marks are in
  `lib/plotspec.ts`, which also has step. Multi-panel is in
  `lib/composition.ts`, insets in `components/Stage/InsetPlot.tsx`, and
  quiver/streamline in `workshops/fieldplot`.
- **Import side.** `.opj` plot type byte 76 is in
  `io/origin_project/opj_curves.py`; `_PLOT_TYPES` covers 203 column, 215 bar
  and 219 histogram. `.opju` reads the `8f 01 <type> 83` style tag;
  `opju_sheet_signals.py` draws only types 200-203. The frontend routes
  histograms in `lib/originFigureSelection.ts`.
- **Gaps known at creation:**
  - column and bar are decoded but never reach the bar renderer;
  - `.opju` sets no `plotType`;
  - box, violin, polar, contour, ternary and waterfall Origin graphs have no
    mapping;
  - there is no horizontal bar;
  - step and strip have no gallery tile.
- **Oracle.** `Origin.Application` over COM only, never `ApplicationSI`; see
  CLAUDE.md "Origin COM oracle runs". Student saves `.opju` but not `.opj`
  (measured 2026-11-15: `Save("x.opj")` writes `.opju`), so Origin-made
  specimens are `.opju` only. Export with
  `expGraph type:=png path:=... filename:=...` works.

### Data / control flow

```
tools/plot_corpus/generate.py   seeded data families + .truth.json
        │
        ▼
tools/plot_corpus/origin_build.py  (COM) book per family → graph per plot type
        │                            → save .opju + oracle.json (%Z datasets,
        │                              plot type, axis from/to/type, styles) + PNG
        ├──────────────► check 1: quantized import → score vs oracle.json
        └──────────────► check 2: quantized recipe (same data, same type)
                                  → score vs oracle.json + PNG side by side
passing specimens → test-data/origin/generated/<type>/<family>/
```

### Plot-type codes (Origin 2026b, measured 2026-11-15)

`plotxy plot:=N` reports success for ANY N (even 999), and no LabTalk or COM
property reports a plot's type. The readback is Origin C
`DataPlot::GetPlotType()` (`tools/plot_corpus/qz_oracle.c`), checked against
the exported PNGs. "Menu recipe" is Origin's own Plot-menu command from its
installed `Plot.ogs`, with ids from `PlotPopup/FilterPlotTypes.xml`.

| Read-back type | Plot type | Menu recipe (`worksheet -p`) | Notes |
|---|---|---|---|
| 200 | line | `200 Line` | also polar (`192 Polar`), 2D stacked/offset lines (`200 OffsetStackY`) and steps |
| 201 | scatter | `201 Scatter` | also bubble (`193 bubble`), colour-mapped (`247 colormapped`) and ternary (`245 Ternary`) |
| 202 | line+symbol | `202 LineSymb` | double-Y (`? DOUBLEY`) is two layers of 202 |
| 203 | column | `203 Column` | |
| 204 | area | `204 Area` | |
| 205 | high-low-close | `205 HLClose` | |
| 206 | box | `206 Box` | violin (`206 Violin`) and strip (`206 ColumnScatter`) read back the SAME 206; the template is what differs |
| 207 | floating column | `207 FloatCol` | needs >= 2 Y columns |
| 208 | vector XYAM | `208 vector` | |
| 213 | stacked column | `213 StackColumn` | |
| 214 | stacked area | `214 StackArea` | |
| 215 | bar (horizontal) | `215 Bar` | |
| 216 | stacked bar | `216 StackBar` | |
| 219 | histogram | `219 Hist` | |
| 220 | image (matrix) | `220 image` | |
| 226 | contour (matrix) | `226 Contour` | |
| 243 | contour (XYZ) | `243 TriContour` | |
| 105 | heatmap (matrix) | `105 HeatMap` | `105 HeatMap` on an XYZ sheet made no graph |
| 231 / 233 | Y- / X-error bars | added for Y-error / X-error columns | `plotxy plot:=231` on a sheet with no error column KILLED Origin |
| 232 | data labels | `plotxy` scan | |
| 241, 249 | fill area between curves | `plotxy` scan | |

- **Line connect is not a plot type.** Steps set `layer.plotN.line.connect`:
  1 none, 2 straight, 3/4 2-/3-point segment, 7 step horizontal, 8 step
  vertical, 9/10 centred steps. `set %C -l` numbers these differently.
- **Polar and ternary are layer coordinate systems.** Their plots read back
  as 200/201, so an importer must read the layer, not the plot byte.
- **The type is one byte.** Codes 256 and above read back mod 256. The
  exceptions are template-level ids that map onto base types:
  - 263 → 206 (split violin);
  - 264 / 271 → 104;
  - 265-268 → 225 (pie family);
  - 269 → 203 (radial bar);
  - 270 → 213;
  - 343 → 120;
  - 344 / 345 → 123;
  - 349 → 200 (colour-mapped line).
- **Codes 234-239, 244 and 250-255** are accepted with XY input and draw
  nothing (234, 235, 244, 250-255) or 3D-style lines (236-239). Their input
  shape is still unknown.
- **Out of scope (3D).** Origin 2026b's `Waterfal` template is the 3D
  waterfall, and `247 CMAP` draws 3D walls (it read back 204).
- Earlier visual codes kept from the first probe: 120/123 bubble map, 122
  doughnut/sunburst, 225 3D pie, 114 compass, 218 vector XYXY (made no
  graph from a 4-column XY selection), 108 polar tree, 210/212 3D.

### Dependency map

- Items 2 and 3 use the shipped item 1 harness and are independent of each
  other.
- Item 4 needs 2 and 3.
- Items 5-8 are per plot-type family and parallelizable. Each one runs its
  import fixes (this session, COM) and books its creation gaps (cloud).
- Item 9 (round trip quantized → Origin) is a later batch and reuses item 1.
- Items 10-19 are creation gaps for the cloud sessions, independent of each
  other; #10 and #14 share the missing bar-creation UI. Re-run
  `tools/plot_corpus/scratch_run.py` to verify each.

### Resolved decisions (owner, 2026-11-15)

- **Scope.** All 2D plot types in the first batch. 3D is out of scope.
- **Missing creation types.** A type that cannot be built from scratch in
  quantized (e.g. horizontal bar) is booked as a plan item for the cloud
  sessions. This local session does generation, COM checks and import
  fixes.
- **Comparison.** Automated field checks (data, plot type, axes, styles),
  plus Origin's PNG beside quantized's render for owner review. No pixel
  diff.
- **Round trip.** quantized → Origin export checked by Origin comes in a
  later batch.
- **Defaults.** Synthetic data only, licence-clean; large cases are kept
  small enough to keep `test-data` cheap to clone.

### Owner gates

- None open.

---

## Tier 1 — High Impact

2. **Check 1 — Origin → quantized import scorer**
   - [ ] Score each specimen's import against `oracle.json`:
         - curves, bindings and values;
         - plot type mapped;
         - axes and styles.
         Report per (type × family): match / wrong / omitted-with-reason.

4. **First scorecard** — every 2D type × family, both checks, with a review
   page of side-by-side PNGs for the owner

## Tier 2 — Medium Impact

5. **XY family import parity** — line, scatter, line+symbol, step, area,
   stacked area, double-Y, error bars/bands, log/reversed axes, multi-layer
6. **Category/statistics family import parity** — column, horizontal bar,
   stacked column/bar, floating column, histogram, box, violin, strip, and
   wiring `.opj`/`.opju` column/bar/histogram to the bar/stat renderers
7. **Specialised family import parity** — polar, contour, heatmap, ternary,
   waterfall, bubble/colour-mapped scatter, vector, inset, axis break,
   multi-panel
8. **Commit passing specimens** to `test-data/origin/generated/<type>/` with
   their `oracle.json`, PNG and `.truth.json`, plus the generator command that
   rebuilds them; add realdata tests that score them

### Creation gaps found by check 2 (cloud items, owner decision 2026-11-15)

Evidence for every item below: `tools/plot_corpus/scratch_run.py` over the
231 ok specimens (scorecard in `<review>/scorecard.md`, side-by-side
`<review>/index.html`); "N/M" = specimens of that type affected.

10. **Horizontal bar** — no way to create one (11/11 `bar` specimens
    unbuildable). `SeriesStyle.bars = "horizontal"` already renders on the
    canvas (`lib/uplotOrient.ts`) and in export (`calc/figure_orient.py`),
    but only an Origin import sets it: no gallery tile, Series card control
    or Stat Stage orientation.
11. **Horizontal stacked bar** — 11/11 `stacked_bar` unbuildable: the Stat
    Stage bar is vertical only and `bars: "horizontal"` has no stacking.
12. **Floating column** — 9/9 `floating_column` unbuildable: no bar that
    spans two Y columns (low to high); every bar starts at zero.
13. **Stacked area** — 8/8 `stacked_area` unbuildable: `fill` is
    under-zero or between two curves, never cumulative on the previous
    series.
14. **Column / stacked column per X row** — 8/11 `column` and 8/11
    `stacked_column` built the wrong figure. With a numeric X the gallery's
    Column routes to the Stat Stage, which has no category column and
    falls back to ONE bar per Y column (its mean ± SE, "n=50"); Origin
    draws one bar per row at its X value, one series per Y column.
    `duplicates` (1 Y) gives one bar for 20 rows. Only text-category X
    (`text_categories`) and one-row data match. The XY-stage bar renderer
    (`SeriesStyle.bars`) would draw Origin's figure but has no creation UI
    (shared with #10). The bars also take no Series card colour (11/11
    styles wrong on both types).
15. **Histogram of several columns** — 8/11 `histogram`: the gallery's
    Histogram bins only the first plotted column; Origin bins every
    selected Y column in one graph. `single_point` (1 row) exports nothing
    (the stage needs >= 2 values); Origin draws a one-bin histogram.
16. **Double-Y axis assignment** — 6/8 `double_y` put the wrong curve on the
    right axis: `plotTypePatch("doubleY")` moves the LAST plotted column to
    Y2, Origin's `DOUBLEY` template puts the SECOND Y column on the right
    and keeps the rest on the left (measured: layer 2 holds only `y2` of
    `y1,y2,y3`). Both agree only with exactly two Y columns.
17. **Ternary from an A,B,C sheet** — 1/1 `ternary` wrong axis order: the
    gallery Ternary tile refuses the sheet ("Needs three composition
    columns") because the first CSV column imports as the X axis, leaving
    two channels; Plot > Ternary diagram... builds it, but its default picks
    (`auxColumns.defaultPicks`) take channels first and the X column last,
    so the axes come out B, C, A instead of A, B, C.
18. **Bubble axis padding** — 5/7 `bubble`: X runs exactly to the data
    ([0, 10]) so edge bubbles are cut in half; Origin pads the axis to the
    largest bubble ([-0.68, 10.46]).
19. **Polar line width** — the polar export always draws
    `POLAR_LINE_PX` (`lib/polarFigureSpec.ts`), so a Series card width
    (2 pt in the corpus) never reaches a polar figure.

## Tier 3 — Nice-to-Have

9. **Round trip quantized → Origin** — export each passing figure (`.opj`
   writer / `.ogs`), open it in Origin over COM, and score Origin's readback
   against the same truth

## Completed

- ~~**#1 Plot-corpus harness**~~ (2026-11-15). Built in `tools/plot_corpus/`
  (README there), with `tests/test_plot_corpus_tools.py` running without
  Origin.
  - `generate.py` / `families.py` write 23 seeded families, each with a
    `.truth.json`. Output is byte-identical for the same seed. Designations,
    display units and the Origin date epoch are imported from quantized.
    Each family asserts its own edge case. "Large" is 20,000 points.
  - `origin_build.py` builds every applicable (family × type) with Origin's
    own menu recipe, applies known styles, saves `.opju`, exports a PNG, and
    writes an `oracle.json` read back from Origin. That readback covers plot
    type, `%Z` per layer, `[Book]Sheet!Col` and X dataset per plot, axis
    from/to/type, colour, line width/connect/dash, symbol kind/size, and the
    book's sheets.
  - `origin_session.py` refuses to start beside another Origin. It records
    the `-Embedding` PID with its creation time and kills only that exact
    process, from `finally`, `atexit`, a KILL_ON_JOB_CLOSE job object and a
    per-specimen deadline. In the scan the deadline caught Origin dying on
    code 231, and the run continued on a fresh instance.
  - **Plot-type readback found:** Origin C `DataPlot::GetPlotType()`, loaded
    with `run.LoadOC` (backslash path, CRLF file). LabTalk `layer.plotN.*`,
    `get %C -a..z`, the COM `DataPlot`/`Theme` tree and embedded `originpro`
    all lack a type property. Verified against PNGs; see the code table
    above.
  - **Codes probed:** contour, heatmap, ternary, polar, violin, step, strip,
    bubble/colour-mapped, and codes 231-420. All recorded in the table above.
  - **Corpus run.** 233 specimens across 25 types × 23 families (in
    `$SCRATCH/plot_corpus/corpus`, NOT in test-data; item 8 commits them).
    231 are ok and every read-back type is in the expected set. The other 2
    are input refusals: floating column needs >= 2 Y, and `duplicates` and
    `single_point` have one Y.
  - **Student refused no type.** What does not reach the 2D corpus is a
    recipe or scope matter, not a refusal: heatmap from an XYZ sheet made no
    graph (heatmap is built from the matrix family); the waterfall template
    is 3D; vector XYXY (218) made no graph from the probe selection.
- ~~**#3 Check 2 — quantized-from-scratch scorer**~~ (2026-11-15). Built in
  `tools/plot_corpus/scratch_*.py` plus the vitest recipe harness
  `frontend/src/test/plotCorpus/`; `tests/test_plot_corpus_scratch.py` and
  `recipeHarness.test.tsx` run without Origin or the corpus.
  - **Route.** Each family's graphed sheet is written as the CSV a user
    opens and imported through the app's own `/api/parsers/upload` (a
    matrix as long-form X,Y,Z; dates as ISO dates). The recipe table
    (`scratch_recipes.py`) names the user's clicks; the harness replays them
    on the real store (worksheet Set As, masked rows excluded, log axes,
    `applyPlotType`, Series card modes/styles, Stat Stage picker, Map contour
    toggle, Plot > Ternary diagram...) and builds the request with the app's
    own export entry for what is on screen: `buildStageFigureSpec`, the
    mounted `<StatStage>`'s registered exporter, `fetchMap` +
    `mapFigureBody`, `buildTernaryRequest`. The app's `/api/...` calls go to
    a live in-process backend, so nothing on the path is mocked. Each request
    is posted to its export route at PNG; `/figure-hitmap` gives an XY
    figure's drawn axis limits.
  - **Scoring** vs `oracle.json`: type, curves (Y columns), binding (each
    curve's drawn X points against Origin's X column, error-bar companions,
    Y2 membership, ternary axis order), values, axes (scale, range within
    5 % of span) and styles. `match` = built and the first four ok.
  - **First run (231 ok specimens): 191 built, 158 match, 40 unbuildable.**
    Matching every specimen: line, scatter, line+symbol, area, step, y-error,
    waterfall offset, polar, box, violin, strip, bubble, colour-mapped,
    contour (XYZ and matrix), heatmap. Unbuildable: horizontal bar, stacked
    bar, floating column, stacked area (#10-#13). Built but wrong: column and
    stacked column (#14), histogram (#15), double-Y (#16), ternary (#17).
    Axis ranges differ on 7/18 XY specimens per type (Origin pads to a tick,
    matplotlib to round numbers; area bases at 0 in Origin) and bubble
    padding (#18); styles reach the request everywhere except stat bars
    (#14) and polar width (#19).
  - Review page with Origin's PNG beside quantized's for every specimen:
    `scratch_run.py --out <review>` writes `index.html`, `scorecard.md`,
    `scorecard.json` (run output stays out of the repo).
