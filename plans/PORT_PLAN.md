# quantized — Port Plan

Ground-up port of the `quantized_matlab` toolbox to a Python/FastAPI
backend (feature parity) + React/TypeScript frontend (revamped GUI),
built on the clean architecture of the sibling `fermiviewer` project so
the codebase never accretes the god-scripts the MATLAB original did.

**Status:** Active
**Created:** 2026-06-21
**Updated:** 2026-06-21

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
                 └──────┬───────┘  (NO business logic here)
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
- **`calc/`** — corrections, fitting, calculators (DiraCulator),
  workspace formula engine, statistics, plotting math. Pure.
- **`routes/`** — one thin FastAPI router per domain (`parsers`,
  `corrections`, `fitting`, `calc_*`, `workspace`, `plot`, `export`,
  `session`, `dev`). No business logic.
- **`frontend/`** — React SPA; talks to the backend over HTTP + a
  WebSocket for long jobs. Interactive plots via uPlot (1D) + canvas/WebGL
  (2D maps). Reuses `fermiviewer` theme tokens + Shell chrome.

### Data / control flow

```
file ─► io/registry (sniff) ─► io/parser ─► DataStruct
     ─► calc/corrections ─► corrected DataStruct
     ─► calc/plotting (series build) ─► routes/plot ─► uPlot (interactive)
                                     └► routes/export ─► matplotlib ─► PDF/SVG (publication)
```

Each stage is independent and pure; the pipeline is composed in `routes/`.

### Reuse strategy (decision — Q1)

**Recommended path = "salvage domain logic, mirror fermiviewer's
architecture, verify against MATLAB."**

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
  (W0 + W1 #6–#8 + W6 #31–#32 + W7 #35–#38.)
- **M2 — Daily-driver parity:** all parsers, corrections, interactive +
  vector export, peak/curve fitting. (Adds W1 rest, W2, W3, W6 rest.)
- **M3 — Full parity:** DiraCulator calculators + DataWorkspace. (W4, W5,
  remaining W7.)
- **M4 — Distributable:** desktop packaging, installers, CI green on the
  golden parity sweep. (W8, W9.)

### Dependency map

- **W0** blocks everything (scaffold + enforcement + golden harness).
- **W1** (DataStruct + parsers) underpins W2–W6.
- **W7 #35–#36** (frontend scaffold + theme) can start in parallel right
  after W0 — only needs API contracts, not implementations.
- **W6** needs W1; **W3/W4/W5** need W1; mostly independent of each other.
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
| 7 | Parser registry + base + sniffers | W1 | First real data path |
| 8 | Quantum Design parsers | W1 | Most-used format; drives M1 |
| 31 | Plot state model | W6 | Needed to render anything |
| 35 | Frontend scaffold + Zustand stores | W7 | Parallelizable; unblocks UI |
| 36 | Theme system (reuse fermiviewer) | W7 | Set the visual language early |

**First milestone (M1)** is exactly these items end-to-end.

---

## W0 — Foundation & enforcement

### Tier 1 — High Impact
1. **Repo scaffold** — `src/quantized/{datastruct.py,io,calc,routes,assets}`,
   `frontend/`, `tests/`, `tools/`, `pyproject.toml` (package `quantized`,
   CLI `qz`), `uv` env.
   - [ ] Python package skeleton + `pyproject.toml` (deps, scripts, ruff/mypy config)
   - [ ] `frontend/` Vite+React+TS skeleton (mirror fermiviewer `package.json`)
   - [ ] `tools/matlab/` for the freeze script
2. **Enforcement tests** — port `fermiviewer/tests/test_repo_integrity.py`:
   no-GPL-runtime-deps, 500-line god-module ceiling, pure-layer import guard.
   - [ ] Backend `test_repo_integrity.py`
   - [ ] Frontend component-size test (~400-line `.tsx` ceiling)
3. **CLI + run model** — `qz` serves API+SPA + opens browser + auto-shutdown
   on last-tab-close; `--desktop` (pywebview); `--dev` (Vite HMR + reload).
4. **Golden-test harness** — `tests/golden/` + `manifest.json` (source
   commit), `tools/matlab/freeze_reference_values.m`, pytest markers
   (`golden`, `realdata`), conftest fixtures pointing at
   `../quantized_matlab/+test_datasets/`.
5. **CI workflow** — pytest + ruff + mypy + frontend vitest + build +
   integrity gates. (Self-hosted runner for golden tests that need MATLAB,
   per the MATLAB-side smoke-testing plan.)
6. **`DataStruct`** — frozen dataclass + validation + JSON (de)serialization
   for the route boundary.

---

## W1 — Data I/O & parsers

### Tier 1 — High Impact
7. **Parser registry** — `io/registry.py` single extension map + content
   sniffers for ambiguous `.dat`; `io/base.py` helpers (delimiter / header /
   data-start / unit auto-detection).
8. **Quantum Design** — `importQDVSM` / `importPPMS` (PPMS/VSM/DynaCool/
   MPMS) incl. column shorthands (`field`/`moment`/`temp`/`time`/`stderr`/`all`).
9. **XRD** — Rigaku, XRDML (incl. **2D area-detector** map extension:
   `is2D`, `map2D.intensity/axis/Qx/Qz`), Bruker, PANalytical.
10. **Other lab data** — Lake Shore VSM, NCNR neutron reflectometry,
    SIMS depth profile, generic CSV/Excel/TSV with auto-detection +
    column-mapper fallback.

### Tier 2 — Medium Impact
11. **Export writers** — Standard CSV + Origin ASCII, multi-row headers,
    HDF5, reflectivity/neutron consolidated CSV (port the role-based
    column logic, not R/dR assumptions).
12. **Session I/O** — save/load a full session (datasets + state).

### Tier 3 — Nice-to-Have
13. **Paused parsers** — `importOxford`, `importOpus`, `importSPC`
    (awaiting example files, as on the MATLAB side).

---

## W2 — Corrections & processing

### Tier 1 — High Impact
14. **Corrections pipeline** — offsets (X/Y), background (slope/intercept/
    polynomial order), trim, field/thickness units, magnetometry
    mass/dimension normalization, counts/s. Parser-aware config
    (the `applyParserAnalysisConfig` equivalent).
15. **BG-from-file** subtraction + fit-BG-from-region.

### Tier 2 — Medium Impact
16. **Processing utilities** — smoothing, normalize, resample,
    2D interpolation, baseline estimation, unit conversion, dataset
    math / algebra, merge.
17. **Reductions** — neutron spin asymmetry; reflectivity FFT / FFT
    thickness; Williamson-Hall.

---

## W3 — Fitting

### Tier 1 — High Impact
18. **Curve-fitting engine** — models + bounds + parameter errors +
    custom-equation parser (dispatch table, **no eval**).
19. **Model library** — port the `+fitting` catalogue.
20. **Peak fitting** — Lorentzian, auto-find peaks, baseline, multi-peak,
    constrained widths, peak tracking.

### Tier 2 — Medium Impact
21. **Batch fitting** + fit comparison (AIC/BIC/F-test) + confidence /
    prediction bands. (Closes the MATLAB→Python gaps in `origin-feature-gap`.)

---

## W4 — Calculators (DiraCulator parity)

### Tier 1 — High Impact
22. **Calc framework** — panel/registry pattern; pure functions in
    `calc/`; cross-panel data hand-off contract; headless-API equivalent.
23. **X-ray & neutron** — d-spacing, Q↔2θ, SLD, reflectivity builder.
24. **Crystal/CIF, optics, superconductor**.

### Tier 2 — Medium Impact
25. **Semiconductor, electrical/transport, magnetic, thermal/diffusion**.
26. **Vacuum, electrochemistry, periodic table, substrates, favorites,
    history**.

---

## W5 — DataWorkspace

### Tier 1 — High Impact
27. **WorkspaceModel** — datasets, columns, column roles.
28. **Formula engine** — column formulas (no eval) + computed-column
    snapshots + recompute.

### Tier 2 — Medium Impact
29. **Sort / filter / descriptive stats / masking.**
30. **Workspace file format + autosave.**

---

## W6 — Plotting & render

### Tier 1 — High Impact
31. **Plot state model** — axes/limits/scales (lin/log), dual-Y,
    per-dataset persisted state, tick formats.
32. **Interactive render contract** — DataStruct → uPlot series; 2D maps →
    canvas/WebGL (reuse fermiviewer `gl/` patterns).
33. **Publication export** — server-side matplotlib → **vector PDF/SVG**
    (default), PNG/TIFF at dpi; styles/templates (`aps`, report, web).

### Tier 2 — Medium Impact
34. **Plot features** — waterfall, overlays/unified legend, reference
    lines, insets, annotations, polar, multi-panel / figure builder.

---

## W7 — Frontend shell & UI revamp

### Tier 1 — High Impact
35. **App scaffold** — React + Vite + Zustand stores (datasets, plot,
    selection, theme); reuse fermiviewer `Shell/` chrome + `lib/` api client.
36. **Theme system** — Dark/Light/Auto, shared tokens with fermiviewer.
37. **Library panel** — dataset list, import, drag-add, groups, search.
38. **Stage** — plot canvas (uPlot) + 2D map viewer.
39. **Inspector** — corrections, axes, appearance controls (the revamped
    analysis panel — no monolith).

### Tier 2 — Medium Impact
40. **Workshops** — curve fit, peak, hysteresis, reflectivity, digitizer
    (React workshop pattern: state hook + view + sub-components, each
    under the component ceiling).
41. **DataWorkspace UI** — spreadsheet view.
42. **DiraCulator UI** — calculator panels.

---

## W8 — Packaging & distribution

### Tier 2 — Medium Impact
43. **Desktop shell** — pywebview standalone + optional Tauri shell;
    Python sidecar packaging.
44. **Installers** — Windows / macOS; signing considerations.
45. **Distribution** — `uv tool install` path / PyPI; versioning.

### Tier 3 — Nice-to-Have
46. **Auto-update / release workflow.**

---

## W9 — Parity verification & CI

### Tier 1 — High Impact
47. **Golden parity sweep** — freeze MATLAB outputs across parsers / calc /
    fitting; assert in CI. (Write the golden test as each feature lands.)
48. **`PORT_CHECKLIST.md`** — exhaustive feature inventory; check an item
    only when ported **and** golden-verified.

### Tier 3 — Nice-to-Have
49. **Parameterized parser tests** — every parser × every corpus file.
50. **Performance baselines** — load / render time regression guards.

---

## Open decisions (carry into implementation)

- **Long-running jobs** (batch fit/export): WebSocket job queue (mirror
  fermiviewer `routes/jobs_api.py`) vs synchronous with progress events —
  decide in W3/W6.
- **2D map rendering**: reuse fermiviewer's WebGL path vs a lighter canvas
  approach for XRD reciprocal-space maps — decide in W6 #32.
- **Origin integration**: the MATLAB "Send to Origin" path is Windows-COM
  only. Port as an optional, OS-gated feature or drop in favour of robust
  Origin-ASCII / `.ogs` export? — decide in W1 #11.
- **plans/ tracking**: keep this plan tracked, or adopt the sibling-repo
  convention (gitignore `plans/`, track a `BACKLOG.md` dashboard) once
  work starts.

---

## Completed

*(nothing yet — created 2026-06-21)*
