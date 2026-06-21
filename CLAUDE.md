# CLAUDE.md — quantized

Python/FastAPI backend + React/TypeScript frontend port of
`quantized_matlab` (magnetometry / XRD / lab-data analysis toolbox).
Backend targets **feature parity** with the MATLAB toolbox; the GUI is a
**ground-up revamp**. EM tooling (Fermi viewer / EELS / EDS / imaging) is
intentionally **out of scope** — it lives in `fermi-viewer` (MATLAB) and
`fermiviewer` (Python), mirroring the split already made upstream.

This repo deliberately mirrors the **clean architecture of the sibling
`../fermiviewer`** (the Python EM port) so the two share UI conventions,
theme, tooling, and the enforcement discipline that the MATLAB monoliths
lacked. `fermiviewer` is the structural reference; `quantized_matlab` is
the behavioural reference (parity + golden values).

## Reference repos (siblings under `Coding/git/`)

| Repo | Role |
|------|------|
| `quantized_matlab` | **Behavioural reference** — authoritative source for every formula, parser, and feature. Golden test values are frozen from it. |
| `fermiviewer` | **Structural reference** — clean Python+React+Tauri port to mirror (layering, CLI, theme, enforcement tests). |
| `thin_film_toolkit` | **Salvage source only** — a stale, monolithic (5.5k-line `server.py`) prior port. Lift *pure domain logic* from it to save time, but re-verify against MATLAB and re-home into the clean layers. Never copy its architecture. |

## Architecture & hard rules

- **Layering:** `datastruct.py`, `io/`, and `calc/` are **pure libraries**
  (ndarray / DataStruct in → results out). They NEVER import
  fastapi / pydantic / starlette / `quantized.routes`. `routes/` are
  **thin adapters** only — validate, call calc/io, serialize. Enforced by
  `tests/test_repo_integrity.py`.
- **God-module ceiling: 500 lines per source module**, enforced by test.
  Split before merging. Raise ONLY with written justification in the
  commit message. (The predecessor `BosonPlotter.m` hit ~7k lines; the
  decomposition is still ongoing. Never again.)
- **Frontend component ceiling: ~400 lines per `.tsx` component**,
  enforced by a frontend test. Heavy features become a `workshops/`
  subtree (state hook + view + sub-components), the React analogue of the
  MATLAB "workshop pattern". (`thin_film_toolkit`'s `FigureBuilder.vue`
  hit 2,669 lines — the anti-pattern.)
- **Data contract:** every parser returns a frozen `DataStruct`
  (`quantized.datastruct`) with `.time`, `.values`, `.labels`, `.units`,
  `.metadata`. No ad-hoc dicts. Single source of truth for all downstream
  code.
- **Parsers:** single registration in `io/registry.py`; ambiguous
  extensions (`.dat`) get content-sniffer functions. (The MATLAB dual-
  registration footgun does not exist here — one registry.)
- **Physics constants port verbatim** from `quantized_matlab`. Annotate
  calibrated/intentional values as do-not-"fix".
- **License: Apache-2.0. No GPL runtime dependencies** (enforced). Prefer
  permissive scientific deps (numpy/scipy = BSD, uPlot = MIT).
- **Interactive vs publication rendering split:** uPlot (canvas) drives
  fast interactive plots; **vector publication export** (PDF/SVG) is
  rendered server-side via matplotlib in `routes/export`. Default export
  is vector (carry over the MATLAB vector-output preference).

## Stack

- **Backend:** Python ≥3.11, FastAPI, numpy/scipy, matplotlib (export
  only), `uv` for env/deps. Package `quantized`, CLI `qz` (alias
  `quantized`). Long-running work (batch fit/export/convert) runs through
  a **WebSocket job queue** (`routes/jobs`, mirrors fermiviewer); the
  queue is thin transport — the actual work stays pure in `calc/`.
- **Optional Origin (COM):** live "Send to Origin" is a **Windows-only,
  OS-gated optional** extra (pywin32), behind a feature flag and untestable
  in CI (mock-based tests only). The cross-platform, golden-tested Origin
  path is Origin-ASCII + `.ogs` export. Everywhere else degrades to that.
- **Frontend:** React 19 + TypeScript + Vite + Zustand (state) + uPlot
  (plots) + clsx. Vitest + Testing Library. Reuse `fermiviewer`'s theme
  tokens, `Shell/` chrome, and component conventions.
- **Desktop:** one-command launch (`qz`) serves API + SPA and opens the
  browser; `qz --desktop` for a native window (pywebview); `qz --dev` for
  Vite HMR + reloading backend. (Mirrors `fermiviewer`'s run model.)

## Commands (target — established as W0 lands)

```bash
uv sync --group dev        # backend deps
uv run qz                  # API + SPA on :8000, opens browser
uv run qz --desktop        # native window (pywebview)
uv run qz --dev            # Vite HMR + reloading backend
uv run pytest              # backend tests
uv run pytest -m golden    # parity vs frozen MATLAB outputs
uv run ruff check src tests
uv run mypy src
cd frontend && npm test    # frontend unit tests
cd frontend && npm run build
```

## Verification model (golden parity)

- `tests/golden/` — frozen `quantized_matlab` outputs with a
  `manifest.json` recording the source commit. Regenerate via a MATLAB
  freeze script (`tools/matlab/freeze_reference_values.m`, needs
  `../quantized_matlab`).
- Markers: `golden` (compares against frozen values), `realdata` (needs
  local-only instrument corpus; auto-skips in CI).
- Reuse `quantized_matlab/+test_datasets/` as the shared corpus via
  conftest fixtures.

## Planning docs

- `plans/PORT_PLAN.md` — the detailed, tiered, multi-workstream plan
  (W0–W9). Tracked for now (founding doc). Follow the user's
  `plan-format.md` conventions; keep a `## Completed` log.
- `plans/PORT_CHECKLIST.md` — exhaustive feature inventory (created with
  W1); check an item only when ported **and** golden-verified.
