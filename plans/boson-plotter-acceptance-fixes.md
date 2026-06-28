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
- Item 11 (two-frame refl) needs a refl1d **.dat-set** parser (`*-refl.dat` +
  `*-profile.dat`), not `.refl` disambiguation — item 5 is robustness-only.
- Item 10 (right-click menu) is a host for actions that several other items add
  (remove, hide, waterfall) — design after 8 lands.

---

## Tier 2 — Medium Impact

5. **`.refl` dual-format disambiguation** — reductus 4-col vs refl1d-with-fits
   - [ ] Add `is_ncnr_refl` (JSON `"columns"` header) + sniffer list for `.refl`
   - [ ] Route refl1d-style `.refl` to the refl1d parser; tests + fixtures

7. **Zoom UX** — make box-zoom legible
   - [ ] Show a live zoom rectangle while dragging; Esc cancels
   - [ ] Consider a "reset zoom" affordance / double-click to autoscale

8. **Waterfall port** — port `+bosonPlotter/+figureBuilder/generateWaterfall.m`
   - [ ] Survey the MATLAB feature set (offset modes: fraction/abs/auto, per-
     series stagger, x-offset?, normalize-then-offset) and match it
   - [ ] Extend the existing `applyWaterfall` (currently y-fraction only)
   - [ ] Consolidated CSV export **with or without** the waterfall offset baked in
   - [ ] Legend/labels stay correct under offset

9. **XRDML 2D RSM → map view** — load 2D maps in 2D
   - [ ] On import, detect `metadata.is2D` and default the stage to the map tab
   - [ ] Feed `.values` (2θ/ω/I) + `map_shape` into the existing map regrid view

## Tier 3 — Nice-to-Have / Needs Design

10. **Right-click context menu** — a context menu of useful actions
    - [ ] Design pass: which actions, on what targets (plot series, legend item,
      library row, axis, empty plot). Reuse fermiviewer patterns if present.
    - [ ] Implement after items 2/3/8 so it can host remove/hide/waterfall

11. **Two-frame reflectometry view** — data+model (top) + SLD profile (bottom)
    - [ ] Parse a refl1d export set (`*-refl.dat` data+theory+fresnel, `*-profile.dat`
      SLD) — see `../quantized_matlab/+test_datasets/Ref1ld Xray with Model/NbAl_XRR`
    - [ ] Two-panel layout (linked x where sensible); depends on item 5

## Completed

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
