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

## Reference repos (siblings in the same checkout root)

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
- **Frontend component ceiling: ~400 lines per `.tsx` component.**
  Convention today, NOT yet test-enforced (a committed vitest is
  PROJECT_ORGANIZATION_PLAN #7; `architecture.test.ts` currently guards
  only the #11 row-state chokepoint, not line count). Two files exceed it:
  `App.tsx` (~780, root orchestrator) and `ThinFilmTab.tsx` (~440). Heavy
  features become a `workshops/` subtree (state hook + view +
  sub-components), the React analogue of the MATLAB "workshop pattern".
  (`thin_film_toolkit`'s `FigureBuilder.vue` hit 2,669 lines — the
  anti-pattern.)
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
  `quantized`). Long-running work is meant to run through a **poll-based
  job queue** (`routes/jobs_api`, ~1 s GET polling — NOT WebSocket;
  design mirrors fermiviewer). As of 2026-07-26 only the DREAM/bumps fit
  actually uses it (wiring import/export through it is plan P3.4); the
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
uv run pytest -n auto      # backend tests (pytest-xdist parallel across cores)
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
- `plans/archive/ui-implementation-plan.md` — frontend (W7) foundation
  tiers. **Complete/archived 2026-07-08**; the live frontend trackers are
  `PORT_CHECKLIST.md` + the `GAP_*` plans.
- `plans/archive/frontend-reuse-library.md` — the fermiviewer-port
  inventory (copy-vendor plan). **Complete/archived 2026-07-08.**
- `plans/design/` — the Claude Design "Quantized Design System" handoff
  (DESIGN_HANDOFF / DESIGN_GUIDE + token CSS); the authority for the UI.

## Lessons learned (working notes)

Practical conventions discovered while porting — follow them to stay green.

### Golden-parity porting
- **Loop:** read MATLAB source → port to `calc/`/`io/` → add a freeze case
  to `tools/matlab/freeze_calc_values.m` → run MATLAB to freeze → gate
  (`ruff check src tests && mypy src && pytest -q`) → commit + tick
  `PORT_CHECKLIST`. The freeze script needs `setupToolbox` for `+fitting`.
- **Replicate vs delegate:** replicate MATLAB's *algorithm* for idiosyncratic
  code (its local `betainc` CDFs, `tinv` norminv+Newton, window functions, SG
  edge fits, SNIP) — matching the answer isn't enough, match the method.
  *Delegate* to scipy for standard published algorithms (pchip/spline/makima,
  `quad`, Nelder-Mead). When scipy has **no** equivalent (Sibson
  natural-neighbour), document the gap — don't fake it.
- **MEASURE before loosening tolerance.** Run the port vs the golden in a
  quick `uv run python -c` first: scipy `quad`↔MATLAB `integral` matched
  ~1e-15, Nelder-Mead↔`fminsearch` ~1e-5..1e-16 on clean data. Most fits
  golden at 1e-9; don't pre-emptively relax.
- **A golden-freeze ERROR is often a latent MATLAB source bug**, not a harness
  problem (found 4: Bruker flatten, confidenceBand `NPoints {mustBePositive}=0`,
  datasetAlgebra positional-vs-named `createDataStruct`, autoGuess toolbox
  `range()`). Surface it (checklist + `project_matlab_bugs_from_golden`
  memory), freeze the *intended* behaviour inline, port the intent. Fix the
  sibling `quantized_matlab` repo only deliberately (a branch + headless
  verify), never silently.

### `jsonencode` golden quirks (the freeze boundary)
- Flattens N×1 columns to 1-D → `compare_calc` reshapes to the result shape.
- **Cannot serialize** complex or a MATLAB `dictionary` → freeze real-valued
  outputs (e.g. `|r|²`, not complex amplitudes); for dict-typed fields, freeze
  the structured outputs and test the raw map in Python.
- Writes `Inf`/`NaN` as `null` → keep freeze inputs finite (the VFT-overflow
  trap), or rely on `compare_calc`'s NaN-equality.
- A 1-element struct array encodes as an **object**, not a list → normalize.
- **Store 2-D arrays as 2-D** in the freeze, never flattened — MATLAB is
  column-major, numpy row-major, so a flatten+reshape transposes silently.

### mypy `--strict` + numpy
- Wrap any float64-array reassignment from a numpy op (`x**2`, `np.convolve`,
  `np.polyval`, `np.minimum`, `np.clip`, `np.linalg.*`, int×float) in
  `np.asarray(..., dtype=float)` — they infer `floating[Any]`/`Any`.
- No untyped lambdas in a typed context (e.g. a bridge table) — use `def`s.
- Hoist `Any | None` to a narrowed typed local before numpy calls.
- Don't reuse a return-variable's name for a `floating[Any]` loop intermediate.

### Pre-PR self-review discipline (adopted 2026-08-16, after PR #149 round 1)
- **Simulate the first real consumer before opening a PR** — infrastructure
  contracts get review-tested by writing the next slice's strawman code
  against them (the E-c1 miss: a page preview renders figures, so figures
  belong in the cache key — obvious the moment Sol's generator was sketched).
- **Cache/invalidation red-team question:** list ALL inputs the rendered
  output depends on (transitively); each one must be in the cache key.
- **Doc-promise audit:** every behavioral claim in a header/PR body needs a
  matching test, or the claim gets narrowed to what the code actually does.
- **Run the code-review skill (high) on your own diff before opening a PR**
  and fix what it finds — its first run caught a CI-red weak-wait, a deps-
  cursor desync, and two O(store)-per-tile inefficiencies pre-push.

### Test determinism
- **Evidence standard for flake fixes: `docs/testing.md`.** "It passed N times"
  is weak — 0 failures in n runs bounds the rate at only 3/n, so the 0/90 that
  "verified" one fix could not be told apart from no fix at all. Force the race
  instead; the worked example is the test named "forces the item-22 race" in
  `useFigureBuilder.test.ts`.
- Wall-clock budgets: assert the load-invariant property (which algorithm ran,
  DOM node count), keep the clock as a loose backstop, and **never lower an
  existing bound** — `GridViewport.perf` flaked with ~8x headroom.
- `architecture.test.ts` carries a **weak-wait ratchet**: new
  `waitFor(() => expect(mock).toHaveBeenCalled())` sites fail the build. Wait on
  STATE, not on the call. A bare `expect(mock).toHaveBeenCalled()` is fine.

### Lint / CI
- Always lint **`ruff check src tests`** (CI does) — not just `src`; a
  tests-only import-sort slipped past a `src`-only local run and reddened CI.
- CI is a matrix (ubuntu/win/mac × py3.11/3.13) + a frontend job; golden
  fixtures are committed so it needs no MATLAB. `main` is branch-protected
  (5 required checks, strict, conversation-resolution) with **admins exempt**,
  so direct pushes to `main` still work for the owner.
- Security: repo is public; secret scanning + push protection + Dependabot +
  CodeQL are on. The `gh` CLI token **cannot** enable CodeQL default setup
  (no `security_events` scope → 404); CodeQL runs as an advanced-setup
  workflow (`.github/workflows/codeql.yml`).

### Container / environment resets
- **A remote container reset can restore STALE installed dependencies — check
  deterministically, then act only if the check fails.** Do not assume every
  new session is a reset, and do not read anything from directory mtimes
  (`.venv/pyvenv.cfg` is written once at creation and never touched by `uv
  sync`; it was cited as a signal on 2026-09-02 and means nothing). The
  checks, both cheap:
  - Python: `uv sync --check --group dev` — exits **0** when in sync, **1**
    when not, and prints the exact package diff. Measured 2026-09-02 on a
    forced one-package downgrade; restored with `uv sync --group dev`.
  - Frontend: compare a pinned direct dependency in the lock against what is
    installed —
    `node -p "require('./frontend/package-lock.json').packages['node_modules/vite'].version"`
    vs `node -p "require('./frontend/node_modules/vite/package.json').version"`.
    A mismatch means `cd frontend && npm ci`.
  The incident: a gate ran against `node_modules` from 2026-08-22 (vite 8.2.1
  vs a lock at 8.2.2) and a venv from 2026-08-15 (statsmodels 0.14.6 vs
  0.15.0), and a full green suite on that tree was treated as evidence. It was
  caught only because an agent's fresh worktree disagreed by 0.9 kB on the
  bundle. The same reset recurred later that day and the vite one-liner caught
  it in one second.
- **The complete raw log is authoritative; extraction is a convenience.** A
  `| tail -5` gate log threw away the name of a one-off failing test (a flake
  that passed on identical re-run), and without the name it cannot be pursued
  per `docs/testing.md`. Save the whole output first, then search the saved
  file: bash `npx vitest run 2>&1 | tee gate.log` then
  `rg 'FAIL|AssertionError' gate.log`; PowerShell `npx vitest run 2>&1 |
  Tee-Object gate.log` then `Select-String 'FAIL|AssertionError' gate.log`.
  Never pipe through a filter alone — that repeats the original mistake.
  (Vitest 4's `FAIL` line is plain text even under a real pty — measured with
  `script` — so anchored matches work; portability across shells, not ANSI, is
  why the search runs on a saved file.)

### Frontend
- **Copy-vendor from `../fermiviewer/frontend/src`** with a
  `// Ported from fermiviewer …` origin header; swap `fvd-*`→`qz-*` classes
  and the store hook (`useViewer`→`useApp`); keep structure identical so a
  future diff stays small. Decouple a ported component from the store when it
  needn't be coupled (e.g. `ToolWindow` owns its position locally).
- Design tokens are the single styling source — read CSS custom properties
  (`--accent`, `--series-N`, …); never hardcode colours. Theme/accent/density
  switch via `data-*` on `<html>`. Unicode-glyph icons, never emoji; cursors
  `default`; JetBrains Mono for every number.
- The plot has an **offline client fallback** (`lib/plotdata.ts`): try
  `/api/plot/series`, fall back to local column packing so the UI + tests run
  without a backend.
