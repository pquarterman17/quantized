# Boson Plotter — Acceptance-Testing Fixes & Feature Ports

Bugs and feature gaps found during real-data acceptance testing of the Boson
Plotter (loading magnetometry / reflectometry / XRDML corpus files). Covers
plot-rendering bugs, dataset selection/removal, parser disambiguation, Inspector
declutter, and two sizable feature ports (waterfall, two-frame reflectometry).

**Status:** Active
**Created:** 2026-06-28
**Updated:** 2026-06-28

> **Note (2026-06-28):** item 4 (NCNR legend) was reframed — the parser
> labels are golden-frozen and MATLAB-faithful (bare `dQ/R/dR/theory/fresnel`),
> so polarization can't go in the parser. It belongs in a frontend
> multi-dataset overlay legend instead; tracked under the parity work below.
> Item 5 (.refl sniffer) is robustness-only: every corpus `.refl` is reductus
> 4-column, and the refl1d "with model" set ships `*-refl.dat`/`*-profile.dat`
> (not `.refl`), so the two-frame view (item 11) actually depends on a refl1d
> *.dat-set* parser, not on `.refl` disambiguation.
>
> **Parity audit (2026-06-28):** a full survey of the MATLAB `BosonPlotter.m`
> GUI (plotting options, 6 uicontextmenus, ~40 dropdowns, ~95 menu items) vs.
> the port found most *actions* already exist as Inspector controls — the gap
> was the right-click access pattern (now item 10, done) plus the plotting
> options captured as items 12–20.

---

## Context

### How the pieces fit together
- **Plot render:** `frontend/src/lib/uplotOpts.ts` builds the uPlot options
  (scales/axes/cursor/plugins). `frontend/src/lib/plotdata.ts` packs dataset
  columns (`buildColumns`, `effectiveChannels`, `applyWaterfall`) and fetches
  `/api/plot/series` with an offline fallback. `components/Stage/PlotStage.tsx`
  wires store state → options → draw; `Stage/PlotLegend.tsx` is the legend.
- **State:** single Zustand store `store/useApp.ts`. `activeId` is a *single*
  selection; `datasets[]` is the library; per-dataset view state (yKeys, styles,
  waterfall, …) resets on `setActive`/`addDataset`.
- **Library (left):** `components/Library/{Library,DatasetRow}.tsx` — click to
  activate; ▲▼/duplicate/✕ row actions. No multi-select, no Del key.
- **Inspector (right):** `components/Inspector/{Inspector,MetadataCard}.tsx` —
  a hardcoded "Scan metadata" card + a free-form MetadataCard.
- **Parsers:** `src/quantized/io/` with a single `registry.py` (extension map +
  content sniffers). `.refl` is hardcoded to `import_ncnr_refl` (no sniffer).

### Data / control flow
```
file → io.import_auto → DataStruct(.time/.values/.labels/.units/.metadata)
     → store.addDataset → PlotStage → plotdata.fetchPlot/buildColumns
     → uplotOpts.buildOpts → uPlot draw
```

### Root-cause notes (verified)
- **uPlot x-axis defaults to TIME mode.** `uplotOpts.ts` never sets
  `scales.x.time = false`; in default "auto" tick format `tickFormatter` returns
  `undefined`, so uPlot uses its built-in *date* formatter. Magnetometry field
  is negative (−5001→5000) → time scale renders blank (item 1a). Reflectometry
  Qz (0.04–0.06) → `:00.040` ticks + `12/31/69` epoch label (item 1b). **One
  fix (`time: false`) resolves both.**
- NCNR `.datA/.datB/...` labels are hardcoded `["dQ","R","dR","theory","fresnel"]`
  with polarization only in metadata → identical legends (item 4).
- XRDML 2D RSM: `import_xrdml` flattens to scattered `.values` with
  `metadata.is2D`/`map_shape`; `.time` is just row indices — the plot path
  doesn't route 2D files to the map view (item 9).

### Dependency map
- Items 1, 4, 6 (done) were independent quick wins; 2 + 3 (done) shared the
  Library selection model.
- Item 11 (two-frame refl, done) needed only the frontend — the io/refl1d parser
  already reads `*-refl.dat` + `*-profile.dat` (labels locked by tests). Item 5
  (.refl sniffer) was never a dependency; it stays robustness-only.
- Item 10 (right-click menu, done) shipped a reusable `ContextMenu`; item 18
  (done) extended it to the worksheet grid; items 12/13 add actions it can host.

---

## Tier 2 — Medium Impact

5. **`.refl` dual-format disambiguation** — reductus 4-col vs refl1d-with-fits
   - [ ] Add `is_ncnr_refl` (JSON `"columns"` header) + sniffer list for `.refl`
   - [ ] Route refl1d-style `.refl` to the refl1d parser; tests + fixtures

## Completed

- ~~**#9 XRDML 2D RSM → map view**~~ (2026-06-28) — the map view already consumed
  the 2-D scattered `.values` via the regrid (channels default to 2θ/ω/I with a
  Q toggle); the only gap was import-time routing. Added pure `mapdata.is2DMap` +
  `useApp.nextStageTab`; `addDataset`/`setActive`/`duplicateDataset`/`loadWorkspace`
  now open a 2-D map on the Map tab and a 1-D scan on Plot, never overriding an
  explicit Worksheet choice. 7 tests.
- ~~**#1 Fix uPlot x-axis time-mode**~~ (2026-06-28) — set `scales.x.time=false`
  in `uplotOpts.ts`; magnetometry (negative field) + refl Qz now plot with
  numeric ticks, no epoch label. Regression test in `uplotOpts.test.ts`. (`32b6d1f`)
- ~~**#2 Multi-select datasets**~~ (2026-06-28) — `selectedIds` set in the store
  (distinct from `activeId`); ctrl/cmd-click toggles, shift-click ranges, both
  leave the plot untouched. Rows tint via `.qzk-ds.selected`. (`66b2b81`)
- ~~**#3 Delete key removes dataset(s)**~~ (2026-06-28) — global Delete/Backspace
  handler in `App.tsx` (ignored while editing a field) calls `removeSelected`,
  reselecting the first survivor. (`66b2b81`)
- ~~**#4 NCNR cross-section legend labels**~~ (2026-06-28) — reframed, not done in
  the parser: labels are golden-frozen + MATLAB-faithful, so polarization can't
  go there. Re-homed to the frontend multi-dataset overlay legend (parity work).
- ~~**#6 Declutter the Inspector**~~ (2026-06-28) — removed the "Scan metadata"
  card + `MetadataCard.tsx`. (`32b6d1f`)
- ~~**#10 Right-click context menu**~~ (2026-06-28) — reusable portal-based
  `overlays/ContextMenu.tsx` wired to three surfaces: Library row
  (plot/duplicate/rename/tag/move/remove + "Remove N selected"), plot legend
  (rename/hide/show/move-to-Y2/reorder), and the plot area (reset/log X·Y/grid/
  legend/copy-TSV/save-PNG). Worksheet-table + on-canvas-trace menus are tracked
  as #18. (`9569ccb`)
- ~~**#8 Waterfall port**~~ (2026-06-28) — multi-dataset Waterfall workshop
  (`workshops/waterfall/`): stacks one channel across N datasets (defaults to the
  multi-selection), auto-spacing (0.8 × median range), additive/multiplicative
  offset, reverse, log-Y; renders its own uPlot. Pure `lib/waterfall.ts` +
  consolidated CSV export **with or without** the offset baked in. 20 tests.
- ~~**#18 Worksheet table context menus**~~ (2026-06-28) — extended `ContextMenu`
  to the grid: column (sort asc/desc · set-X · plot/hide-Y · new formula column ·
  toggle stats) + row (mask/unmask · unmask-all · copy-row-TSV). WorksheetTable
  gained onHeaderContext/onRowContext; container owns the menu.
- ~~**#11 Two-frame reflectometry view**~~ (2026-06-28) — `workshops/reflview/`:
  top = R + theory (+ fresnel) vs Q (log-Y); bottom = SLD ρ(+irho) vs z. Pure
  `lib/reflview.ts` classifies + auto-pairs the refl1d `-refl.dat`/`-profile.dat`
  set by filename stem; two stacked uPlots. The io/refl1d parser already read both
  (labels locked by `test_io_refl1d.py`), so this was frontend-only — item 5
  (.refl sniffer) was NOT a dependency after all.
- ~~**#7 Zoom UX**~~ (2026-06-28) — visible box-zoom selection rectangle while
  dragging; double-click resets/auto-scales; a ⊿ "smart auto-scale" toolbar button
  (picks log/lin). (`c55e327`)
- ~~**#12 Cross-dataset apply**~~ (2026-06-28) — `applyCorrectionsToMany` re-derives
  each target from its own raw; exposed from the Library row menu ("Apply
  corrections to all / to N selected"). Style-to-all deferred (styles are global/
  channel-keyed). (`4edcd59`)
- ~~**#13 Series colormap / palette presets**~~ (2026-06-28) — `lib/palettes.ts`
  (default / Okabe-Ito / Tol-bright / Tableau10 / Viridis); a palette overrides the
  `--series-1..8` CSS tokens so it flows through legend, overlays, and export for
  free. Picker in the Appearance menu. (`0fc05b6`)
- ~~**#14 Marker shape variety**~~ (2026-06-28) — `lib/markers.ts` shape geometry
  (o/s/^/d/v/x/+/*); pure `markerSubpaths` (testable) + a thin `markerPaths` Path2D
  builder used only at draw time. SeriesStyle gained `markerShape`. (`4ab6bb4`)
- ~~**#15 Legend position selector**~~ (2026-06-28) — store `legendPos`
  (ne/nw/se/sw) applied as a legend class; selector in the Inspector + a legend
  context-menu move. (`dad7fe0`)
- ~~**#16 Live publication template**~~ (2026-06-28) — `lib/plotTemplates.ts`
  (screen/APS/Nature/thesis…); `resolveTemplate` feeds `fontSize`/`baseLineWidth`
  into `buildOpts` so the preset styles the on-screen plot, not just export.
  Inspector selector. (`3842882`)
- ~~**#17 Interactive axis fine-controls**~~ (2026-06-28) — `showAxisBox` toggle
  (`axisBoxPlugin` strokes `u.bbox`) + ⊿ smart auto-scale (`suggestLogScale`:
  strictly-positive + ≥2 decades → log). Tick-direction/minor-ticks deferred
  (uPlot has no native support). (`c0d4560`)
- ~~**#19 Merge selected datasets**~~ (2026-06-28) — pure `mergeDatasets`
  concatenates the multi-selection (≥2) row-wise into a new Library dataset (guards
  <2 inputs + column-count mismatch); store `mergeSelected` + a row-menu item.
  (`4402cbf`)
- ~~**#20 Small menu/dropdown parity**~~ (2026-06-28) — keyboard-shortcuts sheet
  (`overlays/ShortcutsDialog` + pure `lib/shortcuts`, opened by `?` / Help menu /
  palette); File ▸ Recent imports history (`lib/recentFiles`, persisted; a browser
  picker can't re-open by path so a Recent entry re-opens the import dialog);
  Library group-filter dropdown (`groupNames`). 26 tests.
