# quantized — Port Plan

Ground-up port of the `quantized_matlab` toolbox to a Python/FastAPI
backend (feature parity) + React/TypeScript frontend (revamped GUI),
built on the clean architecture of the sibling `fermiviewer` project so
the codebase never accretes the god-scripts the MATLAB original did.

**Status:** Active
**Created:** 2026-06-21
**Updated:** 2026-06-27

---

## Context

### How the pieces fit together

Four layers, strictly separated (enforced by `tests/test_repo_integrity.py`):

```
                 ┌─────────────────────────────────────────────┐
 frontend/  ───► │ React 19 + TS + Vite + Zustand + uPlot       │  HTTP/WS
 (revamp)        │ Shell · Library · Stage · Inspector ·        │ ◄──────┐
                 │ workshops · store · lib (api client, theme)  │        │
                 └─────────────────────────────────────────────┘        │
                                                                         │
 src/quantized/  ┌──────────────┐  thin adapters: validate → call →     │
   routes/   ───►│ FastAPI app  │  serialize. One small file per domain. ┘
                 │ + jobs (WS)  │  (NO business logic here)
                 └──────┬───────┘
                        │ calls
            ┌───────────▼───────────────────────────────┐
   calc/    │ PURE libraries — ndarray / DataStruct in,  │
   io/      │ results out. No fastapi/pydantic imports.  │
 datastruct │ This is where parity with MATLAB lives.    │
            └───────────────────────────────────────────┘
```

- **`datastruct.py`** — the canonical frozen `DataStruct`
  (`.time`, `.values`, `.labels`, `.units`, `.metadata`). The data
  contract every parser returns and every consumer reads.
- **`io/`** — parsers + a single `registry.py` (extension map + content
  sniffers) + export writers + session I/O. Pure.
- **`calc/`** — corrections, fitting, calculators (DiraCulator), workspace
  formula engine, statistics, plotting math. Pure.
- **`routes/`** — one thin FastAPI router per domain (`parsers`,
  `corrections`, `fitting`, `calc_*`, `workspace`, `plot`, `export`,
  `session`, `jobs`, `dev`). No business logic.
- **`frontend/`** — React SPA; talks to the backend over HTTP + a
  WebSocket for long jobs. Interactive plots via uPlot (1D) + Canvas2D
  (2D maps; WebGL only if needed). Reuses `fermiviewer` theme tokens +
  Shell chrome.

### Data / control flow

```
file ─► io/registry (sniff) ─► io/parser ─► DataStruct
     ─► calc/corrections ─► corrected DataStruct
     ─► calc/plotting (series build) ─► routes/plot ─► uPlot (interactive)
                                     └► routes/export ─► matplotlib ─► PDF/SVG (publication)
batch fit / batch export ─► routes/jobs (WebSocket) ─► progress + cancel
```

Each stage is independent and pure; the pipeline is composed in `routes/`.

### Reuse strategy (decision — Q1)

**"Salvage domain logic, mirror fermiviewer's architecture, verify against
MATLAB."**

- **Mirror** `../fermiviewer` for structure, CLI, theme, frontend stack,
  and the three enforcement guards. It already solved the monolith
  problem — copy the discipline, not just the code.
- **Salvage** pure domain Python from `../thin_film_toolkit` (parsers,
  calc formulas, fitting math) as a *starting point only*: re-home each
  function into `io/`/`calc/` under the 500-line ceiling, strip EM scope,
  and **golden-verify against MATLAB before trusting it** (TFT is stale
  and was a one-shot dump).
- **Reference** `../quantized_matlab` as the authoritative behaviour. All
  golden values freeze from it.

### Milestones (orientation)

- **M1 — Vertical slice:** load a QD/XRD file → corrected → plotted in the
  new React UI. Proves the full stack + clean layering + golden harness.
  (W0 #1–#6 + W1 #8–#9 + W6 #33–#34 + W7 #37–#40.) *Does not need the job
  queue.*
- **M2 — Daily-driver parity:** all parsers, corrections, interactive +
  vector export, peak/curve fitting, the WebSocket job queue for batch
  work. (Adds W0 #7, W1 rest, W2, W3, W6 rest.)
- **M3 — Full parity:** DiraCulator calculators + DataWorkspace + macro
  recorder. (W4, W5, remaining W7.)
- **M4 — Distributable:** Tauri packaging, installers, CI green on the
  golden parity sweep. (W8, W9.)

### Dependency map

- **W0** blocks everything (scaffold + enforcement + golden harness). The
  job queue (#7) is W0 infra but only gates M2 batch work, not M1.
- **W1** (DataStruct + parsers) underpins W2–W6.
- **W7 #37–#38** (frontend scaffold + theme) can start in parallel right
  after W0 — only needs API contracts, not implementations.
- **W6** needs W1; **W3/W4/W5** need W1; mostly independent of each other.
  Batch items (W3 #23, W6/export) depend on the job queue (W0 #7).
- **W8** is last (needs a working app). **W9** runs continuously — write
  the golden test for each feature as it lands, not at the end.

---

## Cross-cutting priorities (start here)

| # | Item | Workstream | Why first |
|---|------|------------|-----------|
| 1 | Repo scaffold + package layout | W0 | Nothing exists yet |
| 2 | Enforcement tests (license/500-line/pure-layer) | W0 | Cheaper than retrofitting; defines the rules from commit 1 |
| 4 | Golden-test harness + MATLAB freeze script | W0 | Parity is unverifiable without it |
| 6 | `DataStruct` | W0/W1 | The contract everything depends on |
| 8 | Parser registry + base + sniffers | W1 | First real data path |
| 9 | Quantum Design parsers | W1 | Most-used format; drives M1 |
| 33 | Plot state model | W6 | Needed to render anything |
| 37 | Frontend scaffold + Zustand stores | W7 | Parallelizable; unblocks UI |
| 38 | Theme system (reuse fermiviewer) | W7 | Set the visual language early |

**First milestone (M1)** is exactly these items end-to-end.

---

## W0 — Foundation & enforcement

### Tier 1 — High Impact
1. **Repo scaffold** — `src/quantized/{datastruct.py,io,calc,routes,assets}`,
   `frontend/`, `tests/`, `tools/`, `pyproject.toml` (package `quantized`,
   CLI `qz`), `uv` env, Apache-2.0 LICENSE/NOTICE.
   - [ ] Python package skeleton + `pyproject.toml` (deps, scripts, ruff/mypy config)
   - [ ] `frontend/` Vite+React+TS skeleton (mirror fermiviewer `package.json`)
   - [ ] `tools/matlab/` for the freeze script
2. **Enforcement tests** — port `fermiviewer/tests/test_repo_integrity.py`:
   no-GPL-runtime-deps, 500-line god-module ceiling, pure-layer import guard.
   - [ ] Backend `test_repo_integrity.py`
   - [ ] Frontend component-size test (~400-line `.tsx` ceiling)
3. **CLI + run model** — `qz` serves API+SPA + opens browser + auto-shutdown
   on last-tab-close; `qz --desktop` native window (**pywebview**);
   `qz --dev` Vite HMR + reloading backend. (Tauri packaging deferred to W8.)
4. **Golden-test harness** — `tests/golden/` + `manifest.json` (source
   commit), `tools/matlab/freeze_reference_values.m`, pytest markers
   (`golden`, `realdata`), conftest fixtures pointing at
   `../quantized_matlab/+test_datasets/`.
5. **CI workflow** — pytest + ruff + mypy + frontend vitest + build +
   integrity gates. Self-hosted runner for golden tests that need MATLAB.
   - [x] Backend CI — `.github/workflows/ci.yml` (ubuntu, uv sync, ruff +
     mypy + pytest). Goldens/fixtures committed → no MATLAB needed; the
     repo-integrity guard (pure-layer + 500-line) runs in pytest.
   - [ ] Frontend vitest + build (deferred — frontend not started, W7)
6. **`DataStruct`** — frozen dataclass + validation + JSON (de)serialization
   for the route boundary.
7. **WebSocket job-queue infrastructure** — `routes/jobs` (submit → progress
   → cancel), mirroring fermiviewer `jobs_api`. Pure work runs in `calc/`;
   the queue is the thin transport. *Lands before M2 batch features, not M1.*

---

## W1 — Data I/O & parsers

### Tier 1 — High Impact
8. **Parser registry** — `io/registry.py` single extension map + content
   sniffers for ambiguous `.dat`; `io/base.py` helpers (delimiter / header /
   data-start / unit auto-detection).
9. **Quantum Design** — `importQDVSM` / `importPPMS` (PPMS/VSM/DynaCool/
   MPMS) incl. column shorthands (`field`/`moment`/`temp`/`time`/`stderr`/`all`).
10. **XRD** — Rigaku, XRDML (incl. **2D area-detector** map extension:
    `is2D`, `map2D.intensity/axis/Qx/Qz`), PANalytical. (Bruker → fermiviewer:
    its .brml/.raw are 2D-detector/RSM image data, not line data.)
11. **Other lab data** — Lake Shore VSM, NCNR neutron reflectometry,
    SIMS depth profile, generic CSV/Excel/TSV with auto-detection +
    column-mapper fallback.

### Tier 2 — Medium Impact
12. **Export writers** — Standard CSV + **Origin-ASCII** + **`.ogs` LabTalk
    import script** (cross-platform Origin path), multi-row headers, HDF5,
    reflectivity/neutron consolidated CSV (role-based columns, not R/dR
    assumptions).
13. **Session I/O** — save/load a full session (datasets + state).

### Tier 3 — Nice-to-Have
14. **Live Send-to-Origin (COM)** — OS-gated, **Windows-only optional**
    extra (pywin32). Behind a feature flag; degrades to ASCII/`.ogs` export
    elsewhere. *Untestable in CI → mock-based tests only (port the
    `MockOriginCom` idea); golden tests cover the file-export path instead.*
15. **Paused parsers** — `importOxford`, `importOpus`, `importSPC`
    (awaiting example files, as on the MATLAB side).

---

## W2 — Corrections & processing

### Tier 1 — High Impact
16. **Corrections pipeline** — offsets (X/Y), background (slope/intercept/
    polynomial order), trim, field/thickness units, magnetometry
    mass/dimension normalization, counts/s. Parser-aware config
    (the `applyParserAnalysisConfig` equivalent).
17. ~~**BG-from-file** subtraction + fit-BG-from-region~~ — shipped (see Completed).

### Tier 2 — Medium Impact
18. **Processing utilities** — smoothing, normalize, resample,
    2D interpolation, baseline estimation, unit conversion, dataset
    math / algebra, merge.
19. **Reductions** — neutron spin asymmetry; reflectivity FFT / FFT
    thickness; Williamson-Hall.

---

## W3 — Fitting

### Tier 1 — High Impact
20. **Curve-fitting engine** — models + bounds + parameter errors +
    custom-equation parser (dispatch table, **no eval**).
21. **Model library** — port the `+fitting` catalogue: standard models +
    peak shapes (pseudo-Voigt, split Pearson VII, TCH), hysteresis models,
    reflectivity SLD presets, surface/2D models.
22. **Peak fitting** — Lorentzian, auto-find peaks, baseline, multi-peak,
    constrained widths, peak tracking.

### Tier 2 — Medium Impact
23. **Advanced & batch fitting** (via W0 #7 job queue) — batch / global /
    shared-parameter fits, fit comparison (AIC/BIC/F-test), residual
    diagnostics, confidence/prediction bands, MCMC sampling, ODR;
    **reflectivity fitting** (Parratt, SLD profile/spline, profile→layers),
    **RSM** analyze/strain, surface/2D fitting, Pawley refinement, peak
    tracking. (Full catalogue in `PORT_CHECKLIST.md`.)

---

## W4 — Calculators (DiraCulator parity)

### Tier 1 — High Impact
24. **Calc framework** — panel/registry pattern; pure functions in
    `calc/`; cross-panel data hand-off contract; headless-API equivalent.
25. **X-ray & neutron** — d-spacing, Q↔2θ, SLD, reflectivity builder.
26. **Crystal/CIF, optics, superconductor.**

### Tier 2 — Medium Impact
27. **Semiconductor, electrical/transport, magnetic, thermal/diffusion.**
28. **Vacuum, electrochemistry, periodic table, substrates, favorites,
    history.**

---

## W5 — DataWorkspace

### Tier 1 — High Impact
29. **WorkspaceModel** — datasets, columns, column roles.
30. **Formula engine** — column formulas (no eval) + computed-column
    snapshots + recompute.

### Tier 2 — Medium Impact
31. **Sort / filter / descriptive stats / masking.**
32. **Workspace file format + autosave.**

---

## W6 — Plotting & render

### Tier 1 — High Impact
34. **Interactive render contract** — DataStruct → uPlot series (1D shipped);
    2D maps → **Canvas2D** (WebGL only if RSM maps demand it). **2D backend +
    minimal Canvas2D viewer shipped** (`calc/map.MapData`/`build_map` +
    `/api/plot/map`; `Stage/MapStage.tsx` heatmap + colormaps/colorbar/cursor +
    lin/log scale + "Map" tab; verified on real RSM `.xrdml` meshes).
    **Remaining:** axis ticks, Inspector gridding controls, a 2-D area-detector
    (RSM) parser to feed it natively.

### Tier 2 — Medium Impact
36. **Plot features** — insets, polar, multi-panel / figure builder —
    **remaining** (waterfall, overlays/unified legend, reference lines,
    annotations all shipped → Completed).

> Items 33 and 35 shipped — see `## Completed`. Per-feature detail (with
> source mapping + golden status) lives in `PORT_CHECKLIST.md`'s W6 section.

---

## W7 — Frontend shell & UI revamp

### Tier 1 — High Impact
37. **App scaffold** — React + Vite + Zustand stores (datasets, plot,
    selection, theme); reuse fermiviewer `Shell/` chrome + `lib/` api client.
38. **Theme system** — Dark/Light/Auto, shared tokens with fermiviewer.
39. **Library panel** — dataset list, import, drag-add, groups, search.
40. **Stage** — plot canvas (uPlot) + 2D map viewer.
41. **Inspector** — corrections, axes, appearance controls (the revamped
    analysis panel — no monolith).

### Tier 2 — Medium Impact
42. **Workshops** — curve fit, peak, hysteresis, reflectivity, **graph
    digitizer** (React workshop pattern: state hook + view + sub-components,
    each under the component ceiling).
43. **DataWorkspace UI** — spreadsheet view.
44. **DiraCulator UI** — calculator panels.

### Tier 3 — Nice-to-Have
45. **Macro record/export** — record API actions → emit a reproducible
    Python script (the MATLAB macro recorder's equivalent; backend action
    log + frontend toggle).

---

## W8 — Packaging & distribution

### Tier 2 — Medium Impact
46. **Desktop packaging** — Tauri shell + Python sidecar (the polished
    distribution path; pywebview already covers dev/daily use from W0 #3).
47. **Installers** — Windows / macOS; signing considerations.
48. **Distribution** — `uv tool install` path / PyPI; versioning.

### Tier 3 — Nice-to-Have
49. **Auto-update / release workflow.**

---

## W9 — Parity verification & CI

### Tier 1 — High Impact
50. **Golden parity sweep** — freeze MATLAB outputs across parsers / calc /
    fitting; assert in CI. (Write the golden test as each feature lands.)
51. **`PORT_CHECKLIST.md`** — exhaustive feature inventory; check an item
    only when ported **and** golden-verified.

### Tier 3 — Nice-to-Have
52. **Parameterized parser tests** — every parser × every corpus file.
53. **Performance baselines** — load / render time regression guards.

---

## Resolved decisions

- **Origin integration** → COM "Send to Origin" ported as a **Windows-only
  OS-gated optional** (W1 #14); cross-platform path is **Origin-ASCII +
  `.ogs`** export (W1 #12). COM is untestable in CI → mock-based tests
  only; goldens cover the file path.
- **Long-running jobs** → **WebSocket job queue** (W0 #7), mirroring
  fermiviewer `jobs_api`. Lands for M2 batch features.
- **Delivery** → **pywebview desktop now** (W0 #3) + **Tauri packaging
  later** (W8 #46).
- **2D map rendering** → **Canvas2D first** (W6 #34); add WebGL only if
  XRD reciprocal-space maps demand it.
- **`plans/` tracking** → **tracked** (founding doc). Revisit the sibling
  convention (gitignore `plans/`, track `BACKLOG.md`) if it starts to churn.

### Still to decide (later, scoped)
- CI golden-test host: self-hosted MATLAB runner vs committing a broad
  frozen-value set so CI needs no MATLAB. (W0 #5 / W9 #50.)
- Apache-2.0 copyright holder line for LICENSE/NOTICE. (W0 #1.)

---

## Out of scope

- **EM tooling** (Fermi viewer, EELS/EDS, imaging, diffraction) — lives in
  `fermi-viewer` (MATLAB) / `fermiviewer` (Python), mirroring the upstream
  split.
- **Bruker `.brml`/`.raw`** and **AFM `.spm`** — image data (Bruker
  area-detector files; AFM topography images) → belong with the imaging
  tooling in `fermiviewer`, not quantized. (XRDML + Rigaku 2D RSM stay in
  quantized — reciprocal-space maps feed RSM analysis, not microscopy.)
- **Watch-file auto-reload** — deferred (niche live-acquisition feature).
- **In-app bug reporting** — dropped; a GitHub issue template covers it for
  an open-source app.

---

## Completed

> Note: W1–W3 backend parity (parsers, corrections, baselines, processing,
> stats, fitting engine/models/diagnostics, reflectivity) is largely landed and
> golden-verified — see `PORT_CHECKLIST.md` for the authoritative per-item state.
> This log is being backfilled starting with the W6 plotting work.

- ~~**#33 Plot state model**~~ (2026-06-25) — axes/limits/scales (lin/log),
  dual-Y, tick formats (Auto/Fixed/Sci), and per-series styling (color/width/
  line/markers) all shipped. `store` (xLim/yLim/xFmt/yFmt/seriesStyles) +
  `calc/plotting.PlotState` + `uplotOpts`. Per-dataset state via the dataset list.
- ~~**#35 Publication export**~~ (2026-06-25) — server-side matplotlib → vector
  PDF/SVG (default) + raster PNG/TIFF at selectable DPI (50–1200); style presets
  (`aps`/`report`/`web`/… from `+styles/template.m` → `calc/figure_styles.py`);
  figure title + axis-label overrides; **WYSIWYG** per-series color/width/line/
  marker carried into the figure (OKLCH→hex via canvas readout). `calc/figure.py`
  + `routes/export.py` + "Export figure…" dialog.
- ~~**#36 Plot features (partial)**~~ (2026-06-25) — waterfall, overlays +
  unified legend (fit/peak/baseline), reference lines, and text annotations
  shipped (uPlot plugins + Inspector cards), plus grid/legend show-hide toggles.
  **Remaining (#36 open):** insets, polar, multi-panel / figure builder.

### Session 2026-06-26 (golden backfill + region pick)

> Backend golden parity is now essentially complete. The remaining backlog is
> either out-of-scope (DiraCulator W4, MCMC/Pawley, Origin COM), blocked on real
> binary sample files (importOxford/Opus/SPC, Rigaku 2D, polarized CSV), or a
> larger frontend feature (a corrections workshop with a BG-from-file dataset
> picker — backend + API are ready). **Pick-up pointer for next session below.**

- ~~**BG-from-file dataset subtraction — golden**~~ (2026-06-26) — `applyCorrections`
  step 4 (`calc/corrections.apply_corrections` `bg_dataset`/`bg_interp`) was
  ported + routed but ungolden; froze `calc_bgfromfile.json` (linear/pchip/spline
  + 0-fill extrapolation, 2-channel) → matches MATLAB ~1e-14. Commit `4f645d7`.
- ~~**RSM Q-space — golden**~~ (2026-06-26) — `calc/qspace.compute_qspace` vs
  `parser.computeQSpace` on a 5×7 omega×2θ grid (N≠M catches an axis swap);
  **bit-exact**. Commit `a18c75a`. (The 2-D `_build_2d`/`map2D` matrix golden vs
  `importXRDML` itself is still open — structure-mismatched scattered-vs-matrix.)
- ~~**Rubber-band region pick (#36-adjacent)**~~ (2026-06-26) — baseline "Fit from
  region" gains a "⬚ Pick range on plot" drag: a `region` `PlotTool` → uPlot
  `setSelect`/`posToVal` → pure `lib/regionSelect.normalizeRange` (tested) →
  `store.regionPicked` → `useBaseline` fills the x-min/x-max box edges. x-only
  (2-D y-box is a future extension). Also fixed a latent RTL `afterEach(cleanup)`
  gap in the test setup. Commit `f531808`. Visual drag unverified (jsdom).

### Session 2026-06-27 (BG-from-file UI — closes #17)

- ~~**#17 BG-from-file picker (frontend UI)**~~ (2026-06-27) — the golden
  reference-background subtraction (`apply_corrections` step 4) was reachable only
  from the API; wired it into the UI. **Design choice (user-confirmed): extend the
  Inspector `CorrectionsCard`, not a separate workshop** — bg-subtraction composes
  into the *same single Apply* as the other params, matching how MATLAB
  `applyCorrections` runs step 4 inline (a separate "subtract → new dataset"
  workshop would have been a divergent second pass). `store.applyCorrections` now
  takes an optional `bg {datasetId, interp}`, forwards the picked dataset's current
  `data` as `bg_dataset`/`bg_interp`, and persists the choice as `Dataset.bgRef`
  (cleared on reset). Card gains a "Background" picker (other loaded datasets) + an
  "Interp" select. Store + card tests added; full frontend gate green (198 tests +
  build). Commit `66e4021`. The fit-BG-from-region half of #17 shipped earlier
  (`f531808`/`7d809a0`), so **#17 is now fully complete**.
- **W5 worksheet — per-column descriptive statistics** (2026-06-27) — the Stage
  `Worksheet` gained a "Σ Stats" toggle: fetches golden `descriptive_stats`
  (`/api/stats/descriptive`) for x + every channel in parallel and renders a
  column-aligned footer (mean/std/min/max/median/N). Computed over the FULL arrays
  (not the 500-row display cap / sort order) and via the backend so the numbers
  match the Inspector `StatsCard` (which only summarized channel 0). Commit
  `e8834aa`; gate green (202 tests). **Advances W5 #209 "descriptive stats"**.
- **W5 worksheet — non-destructive row filter** (2026-06-27) — structured filter
  (column + operator `> ≥ < ≤ = ≠ between` + value(s)) hides non-matching rows; the
  stats footer narrows to the filtered subset and "Extract →" materializes the kept
  rows as a new dataset. Empty value → NaN (no-op; dodges the `Number("")===0`
  trap). Filter-bar JSX extracted to `WorksheetFilterBar.tsx` to hold Worksheet
  under the ~400-line budget (385→323). Commit `b412725`; gate green (207 tests).
  **Advances W5 #209 "filter"** — sort + stats + filter now done; only **masking**
  (Origin click-to-mask individual rows, kept visible but excluded from analysis)
  remains on that bundled line, and is largely subsumed by filtering for most uses.
- **W5 worksheet — row masking** (2026-06-27) — click a row number to mask it: it
  stays visible (greyed/struck) but drops from the analysis set. Stats + Extract
  both consume one derived `analysisRows = filtered − masked`; "Unmask (N)" clears;
  mask keyed by original index, reset per dataset. Extract now writes
  `<name> (subset)`. Commit `61e479e`; gate green (211 tests). **Completes W5 #209**
  (sort / filter / descriptive stats / masking all done — checklist ticked).
- **W4 X-ray/Neutron calculator — d-spacing + Q↔2θ** (2026-06-27) — first W4
  calculator domain surfaced (Boson Plotter being done unblocks W4). New pure
  `calc/xray.py` (Bragg `d↔2θ` order n, `Q↔2θ`, no-eval mode dispatch, arcsin-domain
  guards), thin `/api/xray/calc` (registered in `app.py`), and an "X-ray" tab in the
  calculators workshop (mode select + Cu/Mo/Co/Cr Kα λ presets + live result).
  Reference-value tested (Cu Kα/Si(111) → 2θ≈28.44°, Q≈2.004; `Q=2πn/d` identity;
  round-trips) — **not** MATLAB-golden (universal formulas); theory in the module
  docstring (repo has no `docs/` tree). Commit `ad72c6c`; full gate green (backend
  17 + frontend 214 + ruff/mypy). **Partially addresses checklist #179** —
  SLD-from-formula still TODO (`calc/sld.py` is reflectivity-profile only).
- **W4 Crystal calculator — d-spacing** (2026-06-27) — second W4 domain. New pure
  `calc/crystallography.py` (1/d² quadratic forms for cubic/tetragonal/orthorhombic/
  hexagonal, no-eval dispatch, validation), thin `/api/crystallography/dspacing`
  (registered), "Crystal" tab in the calculators workshop (system select + per-system
  lattice inputs + hkl). Composes with the X-ray tab (lattice→d→2θ). Reference-value
  tested (Si(111)→3.1356, (h00)→a/h identity). Miller `l` needed a narrow ruff E741
  per-file-ignore in `pyproject.toml` (h,k,l is the unavoidable convention). Commit
  `e23d90b`; gates green (backend 26 + frontend 217 + ruff/mypy). **Partial #174**
  (cell volume / density / low-symmetry systems remain). The calculators workshop now
  has Units / X-ray / Crystal / Constants tabs — at ~224 lines, `CalculatorsPanel.tsx`
  is a future extraction candidate (per-tab sub-components) if more tabs land.
- **W4 Periodic-Table/Elements tab + panel decomposition** (2026-06-27, `9ea8cee`) —
  added an "Elements" tab over the golden `element_data` (`/api/reference/elements`):
  search symbol/name/Z + per-element details (mass/category/group/period/config/
  density/electronegativity/melting/boiling/neutron b_coh). Self-contained
  `ElementsTab.tsx` (owns its fetch+search). **Decomposed `CalculatorsPanel.tsx`
  224→39 lines** into per-tab sub-components (Units/X-ray/Crystal/Constants take the
  shared `CalculatorsState`; Elements standalone) — the decomposition flagged last
  session. Gates green (frontend 221 + build). **Ticks checklist #178.**
- **Dataset Math workshop** (2026-06-27, `14006ff`) — diversified off calculators.
  Surfaced the golden-but-unrouted `calc.aggregate.dataset_algebra`: new thin
  `/api/aggregate/algebra` route + a "Dataset Math" workshop (pick A; op A±B / A×B /
  A/B / (A−B)/(A+B) asymmetry; B; interp pchip/linear/spline → new dataset; B is
  resampled onto A's x-grid). Store `datasetMathOpen` flag + App command/mount. Route
  + hook tested; gates green (backend 6 + frontend 226). Annotates the W2 dataset-
  algebra checklist line (calc was already golden; the UI is the new part).
- **Workspace save/load (`.dwk`)** (2026-06-27, `97bd483`) — diversified off
  calculators (W5 #210, partial). Datasets lived only in memory, so a reload lost
  the whole library. New pure `lib/workspace.ts`: `serializeWorkspace`/
  `parseWorkspace` (JSON = format tag + version + datasets; defensive DataStruct
  validation at the untrusted file boundary). Store `loadWorkspace` hard-replaces
  the library and resets per-dataset view state (channels/styles/limits) + drops
  overlays/markers tied to the old datasets. Command-palette "Save/Open workspace
  (.dwk)…" via `saveBlob`/`openFilePicker`. Round-trip + validation unit-tested
  (frontend 238 + build green). Autosave deferred (future session/prefs layer).
- **Two-point plot measurement ruler** (2026-06-27, `d5c3244`) — W6 plotting
  (Boson-Plotter-only scope, user-reaffirmed; calculator alternation dropped).
  New `measure` PlotTool (∡ button): drag A→B over the plot → live Δx/Δy/slope
  readout chip. Pure `lib/measure.ts` `computeMeasurement`/`formatMeasurement`
  (vertical → null slope), unit-tested; `uplotPlugins.measurePlugin` (drag
  handlers mirroring panPlugin + a draw hook) keeps the endpoints in DATA coords
  so the dashed segment stays pinned across zoom/pan. Wired through `uplotOpts`
  (tool + `onMeasure`) and `PlotStage` (button, chip, cleared on tool/dataset
  change). Gates green (frontend 246 + build).
- **X-axis channel picker** (2026-06-27, `ad6b460`) — W5 column roles (X-role
  slice). Surfaced the already-routed `PlotState.x_key`: a "X axis" select in the
  Inspector ChannelsCard lets any value channel be the plot x-axis (M-vs-H, not
  M-vs-time). New `lib/plotdata.effectiveChannels` (y selection minus the x
  channel — single source of truth) drives both `PlotStage` and `MultiPanelStage`;
  store `xKey` resets with the dataset (addDataset/setActive/loadWorkspace);
  `buildColumns`/`fetchPlot` extended for the offline path. Backend already honored
  x_key — added `/api/plot/series` x_key route tests. Gates green (frontend 253 +
  build; backend plot 13 + ruff).
- **Error-bar role** (2026-06-27, `7da9a21`) — W5 column roles (Y-error slice).
  Per-row "± <channel>" picker in ChannelsCard pairs a plotted y-channel with the
  channel holding its uncertainty → vertical y±e whiskers. Frontend-only (the
  error is just a column of the same dataset, read client-side): pure
  `lib/errorbars.buildErrorColumns` (magnitudes keyed by uPlot data column) +
  `uplotPlugins.errorBarsPlugin` (draw hook, per-series y scale, clipped; reads
  the displayed y so waterfall offsets cancel). Store `errKeys` map resets with the
  dataset. Gates green (frontend 259 + build).
- **Copy plotted data to clipboard (TSV)** (2026-06-27, `c3780c0`) — W6 plotting.
  ⧉ tool-dock button serializes the display payload (x + plotted series, honoring
  x-channel / waterfall / overlays) to TSV and writes the clipboard for paste into
  Origin / Excel / a notebook. Pure `lib/clipboard.payloadToTSV` (header + rows,
  null → empty) unit-tested; capability-guarded `copyText` (false on insecure
  context / denial → "clipboard unavailable" status). Gates green (frontend 264 +
  build).
- **Interactive legend** (2026-06-27, `8ac41f3`) — W6 plotting. Click a legend
  entry on the plot to show/hide that series. Hidden series stays in the payload
  (uPlot `show:false`) so its color is stable and the legend entry remains (greyed
  + struck-through) to toggle back; hidden series drop out of autoscale. Store
  `hiddenChannels[]` + `toggleHidden` (reset with the dataset); `uplotOpts.hidden`
  arg; PlotStage maps legend index → plotted channel (overlays not clickable),
  refuses to hide the last visible series. Gates green (frontend 266 + build).
- **Duplicate dataset (Library)** (2026-06-27, `adc7ec4`) — W5/W7, diversified off
  the plot. ⧉ button on each Library row deep-copies a dataset (incl. raw /
  corrections / bgRef) as an independent "(copy)" inserted after the source and
  activated — for trying different corrections / formulas / dataset-math while
  keeping the original. Pure `lib/dataset.cloneDataStruct` (deep copy, no shared
  column arrays — non-aliasing asserted in tests); store `duplicateDataset(id)`.
  Gates green (frontend 272 + build).

**Next pick-up (highest value first):**
1. **Boson Plotter features ONLY** — user reaffirmed 2026-06-27 ("I only want to
   focus on bosonplotter features for now"); the calculator/non-calculator
   alternation is **dropped — no W4/DiraCulator/SLD-from-formula work**. Pick from
   plotting + W5 DataWorkspace: **plot interactions** (measurement ruler `d5c3244`;
   remaining — legend rename/reorder, copy-data-to-clipboard, more cursor
   read-outs; copy-data-to-clipboard `c3780c0` + interactive legend `8ac41f3`
   shipped), **W5 column roles** (X-role `ad6b460` + Y-error bars `7da9a21` shipped;
   remaining — label/ignore roles), the **computed-column formula engine**
   (snapshot model done — `Stage/Worksheet.tsx`; "recompute on source change" needs
   provenance links the architecture lacks → low priority), **Library** features
   (duplicate `adc7ec4` done; remaining — reorder, groups/tags), or **workspace
   autosave**. Non-Boson-Plotter parity items (XRDML `map2D` golden, blocked
   parsers) stay paused unless the user reopens scope.
2. **Optional bounded extras** — 2-D y-box for the region pick; XRDML `map2D`
   golden vs `importXRDML` (needs a reshape across scattered↔matrix shapes).
3. **Blocked until sample files land** — `importOxford`/`importOpus`/`importSPC`,
   Rigaku `.raw` 2-D RSM, polarized-asymmetry consolidated CSV.
4. **Standing verification gap** — frontend uPlot/Canvas render modes (map,
   multi-panel, inset, polar, RSM, baseline/region drag) + the new BG picker's
   visible effect are unit-tested but visually unverified (jsdom can't render);
   needs a human eyeball or browser automation.
