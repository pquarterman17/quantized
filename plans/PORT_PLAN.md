# quantized — Port Plan

Ground-up port of the `quantized_matlab` toolbox to a Python/FastAPI
backend (feature parity) + React/TypeScript frontend (revamped GUI),
built on the clean architecture of the sibling `fermiviewer` project so
the codebase never accretes the god-scripts the MATLAB original did.

**Status:** Active
**Created:** 2026-06-21
**Updated:** 2026-06-25

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
17. **BG-from-file** subtraction + fit-BG-from-region.

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
    "Map" tab). **Remaining:** axis ticks, Inspector gridding controls, a 2-D
    area-detector (RSM) parser to feed it natively.

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
