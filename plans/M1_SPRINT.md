# M1 Sprint — Vertical Slice

The first executable slice through every layer, proving the clean
architecture end-to-end before breadth work begins. Covers `PORT_PLAN.md`
M1 (W0 #1–#6, W1 #8–#9, W6 #33–#34, W7 #37–#40) **plus a minimal
corrections subset** so "load → correct → plot" is genuinely complete.

**Status:** Active
**Created:** 2026-06-21
**Updated:** 2026-06-21

---

## Definition of Done

`uv run qz --dev` opens the app. The user adds a Quantum Design VSM `.dat`
file → it parses to a `DataStruct` → renders as an interactive uPlot line
in the Stage with working axis controls (limits, log toggle) and
Dark/Light theme → a minimal Corrections panel (Y-offset + linear/poly
background) re-renders the plot. One **golden test** proves the QD parser
matches MATLAB; all three enforcement guards pass; CI is green.

This slice deliberately does **not** include: the job queue, vector
export, additional parsers, full corrections, fitting, calculators, or the
workspace. Those are M2+.

---

## Architecture touched (M1 only)

```
frontend/src/                     src/quantized/
  store/{datasets,plot,theme}  ┐    routes/parsers.py   ─► io/registry → io/qd.py ─► DataStruct
  components/Shell             │    routes/plot.py      ─► calc/plotting.py
  components/Library           ├──► routes/corrections  ─► calc/corrections.py
  components/Stage  (uPlot)    │    app.py · cli.py
  components/Inspector         ┘    datastruct.py
  lib/api.ts
```

## Minimal API contract (M1)

| Method | Route | Body / params | Returns |
|--------|-------|---------------|---------|
| GET  | `/api/health` | — | `{status:"ok"}` |
| POST | `/api/parsers/import` | `{path}` (or upload) | `DataStruct` JSON |
| POST | `/api/plot/series` | `{dataset, xKey, yKeys, plotState}` | uPlot series + axis spec |
| POST | `/api/corrections/apply` | `{dataset, ops:[{type,params}]}` | corrected `DataStruct` |

`DataStruct` JSON = `{time, values (2-D), labels[], units[], metadata{}}`.
`plotState` = `{xLim?, yLim?, xLog, yLog, xKey, yKeys}` (the W6 #33 model,
minimal subset). Keep payloads boring and explicit — no magic.

---

## Task sequence (PR-sized)

Dependencies in brackets. Backend PRs 1–6 and frontend PRs 7–9 overlap
once the API contract (PR5) is fixed.

### Backend

1. **PR1 — Skeleton & tooling** ✅ **DONE** (`8a017e6`) [—]
   - Create: `pyproject.toml` (pkg `quantized`, deps numpy/scipy/fastapi/
     uvicorn/pydantic, `[project.scripts] qz`, ruff+mypy config),
     `src/quantized/__init__.py`, empty `io/ calc/ routes/` packages,
     `app.py` stub, `tests/conftest.py`, `LICENSE`+`NOTICE` (Apache-2.0).
   - DoD: `uv sync --group dev`; `import quantized` works; `ruff` + `mypy` clean.

2. **PR2 — Enforcement guards** ✅ **DONE** (`84cbd51`) [PR1]
   - Create: `tests/test_repo_integrity.py` (port fermiviewer's: no-GPL
     runtime deps, 500-line god-module ceiling, pure-layer import guard).
   - DoD: three tests pass on the skeleton. ✅ (negative-tested: the
     layering guard catches an injected web import.)
   - Frontend component-size (~400-line `.tsx`) ceiling: lands with PR7
     (needs `frontend/` to exist).

3. **PR3 — `DataStruct`** ✅ **DONE** (`10f4e7f`) [PR1]
   - Create: `src/quantized/datastruct.py` (frozen dataclass: `time`,
     `values`, `labels`, `units`, `metadata`; validation; `to_json`/
     `from_json`), `tests/test_datastruct.py`.
   - DoD: construct + validate + JSON round-trip; pure-layer guard still green.

4. **PR4 — Golden harness + QD parser** ✅ **DONE** (`fb3efe2`) [PR3]
   - Create: `io/base.py` (delimiter/header/data-start/unit detection),
     `io/registry.py` (extension map + sniffers), `io/qd.py`
     (`import_qd_vsm` ← `importQDVSM.m`, column shorthands),
     `tools/matlab/freeze_reference_values.m`, `tests/golden/manifest.json`,
     `tests/golden/qd_mpms_mvsh.json`, `tests/test_io_qd.py` (`@golden`),
     conftest fixture → `../quantized_matlab/+test_datasets/QuantumDesign/`.
   - DoD: parse a real QD `.dat` → `DataStruct` equals frozen MATLAB values
     within tolerance (golden test passes).

5. **PR5 — App + import/plot routes** ✅ **DONE** (`8be5e45`) [PR3, PR4]
   - Create: `app.py` (compose routers, CORS for dev), `routes/parsers.py`
     (`POST /api/parsers/import`), `routes/plot.py` (`POST /api/plot/series`),
     `calc/plotting.py` (series builder + `PlotState` model),
     `tests/test_api_parsers.py`, `tests/test_api_plot.py` (TestClient).
   - DoD: import → DataStruct JSON; plot/series → uPlot payload; tests pass.

6. **PR6 — CLI & run model** [PR5]
   - Create: `cli.py` (`qz` serves API+SPA + opens browser + auto-shutdown
     on last-tab-close; `--dev` = Vite HMR + reloading uvicorn; `--desktop`
     = pywebview window). Wire `[project.scripts]`.
   - DoD: `uv run qz --dev` boots backend+frontend; `uv run qz` serves the
     built SPA and opens the browser.

### Frontend

7. **PR7 — Frontend scaffold + theme** [PR1; API stubs ok]
   - Create: `frontend/{package.json,vite.config.ts,tsconfig.json}`
     (React 19 + Vite + Zustand + uPlot + clsx; mirror fermiviewer),
     `src/main.tsx`, `src/App.tsx`, `src/lib/api.ts`,
     `src/store/{datasets,plot,theme}.ts`, `src/components/Shell/*`
     + theme tokens (reuse fermiviewer), `frontend/.../componentSize.test.ts`
     (~400-line ceiling).
   - DoD: app boots, Dark/Light toggle works, `/api/health` round-trips.

8. **PR8 — Library panel + import flow** [PR5, PR7]
   - Create: `src/components/Library/*` (dataset list, add-file). Wire to
     `/api/parsers/import` → `datasets` store.
   - DoD: add a file → appears in list → DataStruct in the store.

9. **PR9 — Stage (uPlot) + axis controls** [PR8]
   - Create: `src/components/Stage/*` (uPlot wrapper), `src/components/
     Inspector/AxisControls.tsx`. Wire to `/api/plot/series` + `plot` store.
   - DoD: selected dataset renders as a line; limits + log toggles work.

### Close the slice

10. **PR10 — Minimal corrections** [PR5, PR9]
    - Create: `calc/corrections.py` (Y-offset, linear/poly BG subtract —
      subset of W2 #16), `routes/corrections.py`, `src/components/Inspector/
      CorrectionsPanel.tsx` (minimal), `tests/test_corrections.py` (`@golden`).
    - DoD: apply offset/BG → plot updates live; golden test vs MATLAB.

11. **PR11 — CI** [all]
    - Create: `.github/workflows/ci.yml` (pytest, ruff, mypy, frontend
      vitest + build, integrity gates). Golden tests gated to a self-hosted
      MATLAB runner *or* run against the committed frozen values.
    - DoD: CI green on a clean clone.

---

## Risks / watch-items

- **QD `.dat` quirks** — multi-section headers, comment lines, locale
  decimal commas. The golden test against a real file catches regressions;
  reuse the MATLAB `+test_datasets/QuantumDesign/` corpus.
- **uPlot + React lifecycle** — uPlot is imperative; wrap it so it mounts
  once and updates via `setData`/`setScale`, not re-create on every render.
  (Crib from fermiviewer's plotting wrapper if it has one.)
- **Pure-layer guard vs convenience** — resist importing pydantic models
  into `calc/plotting.py`; keep route schemas in `routes/`.
- **Golden tolerance** — float compare needs `rtol/atol`; record them in
  `manifest.json` alongside the source commit.

---

## Exit → M2

When M1 lands: the stack, layering, enforcement, golden model, theme, and
the import→correct→plot loop are all proven. M2 then fans out breadth
(remaining parsers, full corrections, fitting, vector export, job queue)
against a known-good skeleton.
