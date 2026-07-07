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
**Updated:** 2026-07-07

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

1. **Quick-fit gadget (gap #33)** — drag an ROI band on the live plot;
   a model fit of that region recomputes live as the ROI moves/resizes.
   *Model: sonnet.* *Agent: gui-interaction-expert.*
   - [ ] Add a `qfit` tool id to the `PlotTool` union in
         `frontend/src/lib/uplotOpts.ts` and an entry in
         `ANALYZE_TOOLS` in
         `frontend/src/components/Stage/PlotToolbar.tsx`; optional key
         in `frontend/src/lib/plotToolKeys.ts` (F is free)
   - [ ] New `frontend/src/lib/uplotGadgets.ts`: an ROI-band plugin
         generalizing `integratePlugin`'s drag pattern from
         `frontend/src/lib/uplotRegionTools.ts` — committed ROI kept in
         data coords, move + edge-resize handles on the committed band
         (pixels re-derived per draw via valToPos, the
         `uplotOverlays.ts` convention), `onRoiChange` callback,
         sub-6px drag = click no-op; pure handle hit-test math exported
         and unit-tested
   - [ ] Store slice in `frontend/src/store/useApp.ts`: gadget ROI,
         model name, busy flag, result; actions to set/clear (this is
         the shared-file chokepoint — see dependency map)
   - [ ] Debounced ROI-change → POST `/api/fitting/fit` through
         `frontend/src/lib/api.ts`, fitting only the ROI-sliced rows of
         `rowstate.analysisData` (guard #11); result overlay through
         `setFitOverlay` with nulls outside the ROI so it rides
         `composeDisplayPayload`/`withFitOverlay` in
         `frontend/src/lib/plotdata.ts` unchanged
   - [ ] Result chip in
         `frontend/src/components/Stage/PlotResultChips.tsx`: model
         picker (linear/gaussian/exponential via the
         `frontend/src/components/primitives/index.tsx` Select),
         params ± SE + R², a commit action (per open question 2), and ✕
         dismiss
   - [ ] Vitest: gadget math, debounce (fake timers), store wiring,
         model switch refits; note the real drag gesture needs the
         `tools/visual` harness eyeball (jsdom cannot drive canvas)
   - Acceptance: dragging/resizing the ROI over a synthetic Gaussian
     re-fits live with one debounced request per gesture; the overlay
     and chip track the ROI; switching model refits; clearing the tool
     removes overlay, chip, and store state.

2. **Drag-to-axis (gap #49, Graph Builder phase 1)** — drag a channel
   chip from the Channels card or legend onto the plot's X / Y / Y2
   axis regions to re-plot instantly.
   *Model: sonnet.* *Agent: gui-interaction-expert.*
   - [ ] New pure `frontend/src/lib/dragchannel.ts`: dataTransfer
         payload encode/decode (dataset id + channel index + modeling
         type via `frontend/src/lib/modeling.ts`
         `channelModelingType`) and drop-zone resolution rules;
         unit-tested
   - [ ] Make channel rows draggable in
         `frontend/src/components/Inspector/ChannelsCard.tsx` and
         legend entries in
         `frontend/src/components/Stage/PlotLegend.tsx` (HTML5 drag,
         no new dep)
   - [ ] Axis drop regions overlaid on
         `frontend/src/components/Stage/PlotStage.tsx`: left band →
         add to `setYKeys`, bottom band → `setXKey`, right band →
         `setY2Keys` — existing store actions only, no new plot
         machinery; active zone highlights with theme tokens; Esc
         cancels
   - [ ] Nominal chips dropped on X route through `setXKey` today and
         surface the categorical intent (the categorical axis itself
         renders once GAP_PLOTTYPES item 4 lands — cross-plan note,
         degrade gracefully to numeric)
   - [ ] Vitest: dragchannel lib + synthetic dragover/drop events on
         the zone components; macro recording covered free via the
         existing `setXKey` recorder
   - Acceptance: dragging a channel chip onto the left axis adds it as
     a Y series, onto the bottom axis makes it X, onto the right axis
     lands it on Y2 — all instant, all through existing store actions,
     all macro-recorded.

3. **Graph Builder workshop (gap #51 phase 2)** — a drop-zone canvas
   (X, Y, Group, Facet) that morphs the mark as columns land; the
   plot-spec grammar is the contract every later feature replays.
   *Model: opus (the plot-spec grammar + morph rules), sonnet (the
   workshop UI).* *Agent: ux-frontend-expert.*
   - [ ] Contract first — new pure `frontend/src/lib/plotspec.ts`: a
         versioned, serializable PlotSpec (zones x / y-list / group /
         facet, each holding channel refs + their ModelingType from
         `frontend/src/lib/modeling.ts`) and a pure mark-morph
         function (two continuous → scatter/line; nominal X +
         continuous Y → box → violin → bar cycle; filled facet →
         small multiples); exhaustively unit-tested — this file is the
         review centre of the item
   - [ ] `frontend/src/components/workshops/graphbuilder/`:
         `useGraphBuilder.ts` (state hook), `GraphBuilderPanel.tsx`
         (view), `ZoneWell.tsx` (reusable drop-zone component — item 8
         consumes it); each under ~400 lines (workshop pattern);
         command-palette entry under Analyze
   - [ ] Live preview: continuous marks reuse the existing payload
         path (`frontend/src/lib/plotdata.ts` builders); box/violin
         marks consume the GAP_PLOTTYPES item 2 stat renderers — until
         that lands, those combos show a "needs stat stage"
         placeholder rather than blocking the item
   - [ ] Rows via `rowstate.analysisData` (guard #11 — extend the
         allowlist deliberately if a direct read is ever needed)
   - [ ] "Send to Stage" maps the spec onto store actions
         (`setXKey`/`setYKeys`/`setY2Keys` + the stat-stage mode);
         "Export" maps it onto `/api/export/figure` or
         `/api/export/statplot-figure`
   - [ ] Spec round-trips: `.dwk` persistence via
         `frontend/src/lib/workspace.ts` and a recorded pipeline step
         (`frontend/src/lib/pipeline.ts`) so macros/templates replay a
         built graph
   - Acceptance: dropping two continuous columns yields a scatter;
     swapping a nominal column onto X morphs to box and cycles
     box→violin→bar; the serialized spec round-trips and "Send to
     Stage" reproduces the preview on the main plot.

---

## Tier 2 — Medium Impact

4. **ROI gadget family (gap #34)** — integrate, statistics, FFT, and
   differentiate gadgets in the item-1 frame; paired cursors with
   Δx/Δy/slope readout.
   *Model: haiku (the frame exists after item 1; per-gadget dispatch is
   mechanical) — escalate to sonnet for the FFT route.* *Agent:
   code-implementer.*
   - [ ] Generalize item 1's gadget frame with a gadget-kind dispatch
         table: integrate (client `frontend/src/lib/integrate.ts`
         trapz), statistics (client `frontend/src/lib/regionStats.ts`),
         differentiate (new pure finite-difference helper), FFT
         (backend `calc/spectral.fft_spectral` — **no route exposes it
         today**; add a thin route in `src/quantized/routes/calc.py`
         and a client fn in `frontend/src/lib/api.ts`)
   - [ ] FFT gadget result lands as a new library dataset (spectrum),
         the others as chips; "→ Report" ending via `/api/report/emit`
         stats_table where sensible
   - [ ] Paired cursors: two draggable vertical cursors extending the
         `refLinePlugin` interactive-drag pattern in
         `frontend/src/lib/uplotOverlays.ts`, readout via
         `frontend/src/components/Stage/PlotReadouts.tsx`
   - Acceptance: each gadget recomputes live on ROI move; the FFT
     gadget emits a spectrum dataset; paired cursors read Δx/Δy/slope
     between two draggable positions.

5. **Peak Analyzer click-on-plot marker editing (deferred from closed
   gap #31)** — add/remove peak markers by clicking the plot during
   wizard step ②.
   *Model: sonnet.* *Agent: gui-interaction-expert.*
   - [ ] Pure marker hit-test helper (marker pixel positions from the
         peak centers vs. click position, tolerance) — colocate with
         the gadget hit-test math from item 1 in
         `frontend/src/lib/uplotGadgets.ts` or a small sibling lib;
         unit-tested
   - [ ] Wizard-scoped interaction: while step ② of
         `frontend/src/components/workshops/peakwizard/` is active,
         plot clicks map x → `addPeakAt(x)` and clicks within
         tolerance of an existing marker → `removePeak`/`togglePeak`
         (all three already exist in `usePeakWizard.ts`)
   - [ ] Markers stay on the existing `setPeakOverlay` series
         (`withPeakOverlay` in `frontend/src/lib/plotdata.ts`); step ②
         shows a crosshair cursor + a hint line while the mode is on
   - Acceptance: in step ②, clicking an empty plot region adds a peak
     at that x, clicking a marker removes it, and the candidate table,
     overlay, and fit inputs stay in sync throughout.

6. **Distribution platform residuals (gap #52)** — box strip,
   distribution-fit overlay, and histogram bar-brushing in the
   Distribution workshop.
   *Model: sonnet.* *Agent: ux-frontend-expert.*
   - [ ] Box/quantile strip under the histogram in
         `frontend/src/components/workshops/distribution/DistributionPanel.tsx`,
         fed by `/api/statplots/box` (its first frontend consumer; add
         the client fn in `frontend/src/lib/api.ts`)
   - [ ] Distribution-fit overlay: family picker →
         `/api/stats/fit-distribution` (`calc/stats_dist.py` already
         returns the fitted pdf params and
         `/api/statplots/histogram` accepts a `fit` overlay) — draw
         the pdf as an SVG polyline scaled over the existing DOM bars
         in `useDistribution.ts`'s hist shape, AIC shown
   - [ ] Bar brushing: clicking a bar selects the rows in that bin —
         pure bin→rows helper over the analysis values with kept-index
         expansion back to FULL row indices (the
         `rowstate.expandToFull` pattern), then `setRowSelection`;
         shift-click extends; guard #11 respected (values already come
         from `analysisData`)
   - Acceptance: picking a family overlays its fitted pdf with AIC
     displayed; clicking a bar highlights exactly those rows in the
     worksheet and plot, correct even with exclusions and filters
     active.

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

8. **Tabulate residuals (gap #55)** — drag-drop wells and
   report-block export for the pivot workshop.
   *Model: sonnet (wells), haiku (report ending — the statschooser
   pattern exists).* *Agent: ux-frontend-expert.*
   - [ ] Replace the Group/Value Selects in
         `frontend/src/components/workshops/tabulate/TabulatePanel.tsx`
         with item 3's `ZoneWell` drop-zone component (Selects remain
         as keyboard fallback); accepts the item-2 `dragchannel`
         payloads
   - [ ] "→ Report" ending: emit the `lib/tabulate.ts` group-summary
         rows through `/api/report/emit` as a stats_table (the generic
         `from_stats_table` emitter in `calc/report_emit.py` — follow
         `workshops/statschooser/`'s existing pattern), landing in the
         Library Reports viewer via `addReport`
   - Acceptance: dragging a categorical column into Group and a
     continuous one into Value builds the summary table; "→ Report"
     produces a report sheet whose rows match the on-screen table.

---

## Completed

(empty — nothing shipped against this plan yet)
