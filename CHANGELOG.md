# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project does not (yet) commit to Semantic Versioning guarantees pre-1.0.

## [Unreleased]

- Pack Project (in progress): the backend can now produce a complete,
  movable portable project bundle — staging, verifying, and atomically
  publishing the packed project file and its dataset copies together —
  and a new orchestration bridge wires that into one cancellable, pollable
  job with a matching frontend state machine. The visual "Pack Project"
  dialog itself is still to come.
- Relink Sources now detects when two datasets with different recorded
  source paths would be pointed at the same file (for example `/old/a.csv`
  and `/OLD/a.csv` after a folder move) and asks you to choose which
  dataset keeps that file instead of silently relinking both. The other
  dataset is left exactly as recorded.
- Project files (P1.1 completion): Open Project and Save As now open in
  your current working folder (the one you last imported from, opened, or
  saved into), and Save As suggests the open project's own name. Reopening
  a Recent Project after relaunching the app asks you to confirm the file
  in its own folder instead of failing with "could not be reopened"; a
  moved or deleted project offers **Locate…**; a project on a disconnected
  drive says so and waits for you to reconnect (nothing is removed or
  relinked); a project you lack permission to read is reported as such
  rather than as "not found". Quick save no longer tries to write to a
  project on a disconnected drive.
- Extend the dataset-handle cache (`routes/_datasetcache.py`) to
  `/api/plot/series`: a committed zoom/pan on an already server-decimated
  series used to re-POST the whole dataset on every step. Measured on a
  1M x 7 dataset: ~11.8s server wall time resending the full payload on a
  windowed re-fetch vs ~0.3s reusing the handle (~38x). `PlotRequest` now
  extends `CachedDatasetRequest`; the frontend allowlist
  (`lib/api/datasetCache.ts`) adds `/api/plot/series`.
- Perf: vectorize the Debye D_3(u) heat-capacity integral in
  `calc/fit_models_special.py` (`_debye`, `_debye_einstein`) — replace the
  per-x-point `scipy.integrate.quad` loop with one fixed-order (N=32)
  Gauss-Legendre quadrature evaluated across the whole array (closed-form
  saturation above u=30, series below u=1e-4, same as before). Matches the
  old per-point quad implementation to ~1.5e-12 max relative error. A
  10k-point `evaluate()` call drops from 116ms to 17.5ms; `curve_fit(Debye)`
  at a matched 229 iterations drops from 57.7s to 7.4s (~7.8x); the
  default-registry AICc `scan_models` at 10k points drops from ~107s to
  ~88s. Golden parity (`calc_fit_models.json`) unchanged at rtol=1e-9.
- Frontend: `setCellValue`/`setCategoricalCell` (worksheet single-cell edits)
  now recompute formula columns incrementally — only the edited row — via a
  new `lib/formulaIncremental.ts`, instead of an unconditional full
  `recompute` over every row for every formula (~4.2s -> ~18ms per edit on a
  1M-row, 2-formula dataset). Falls back to the full recompute whenever a
  formula isn't provably row-local (an aggregate, `lag()`/`diff()`, a
  recode, or one already carrying an error) so correctness never depends on
  the fast path. Both cell-write actions also now patch the edited row via
  the same outer-array `.slice()` pattern `setCellBlock` uses, rather than
  a full-array `.map`.
- Fix a large `/api/parsers/upload`/`/api/import/template/upload` (Origin
  template) CSV/file import blocking every other request (job-queue
  polling, `GET /api/health`, other windows' plot fetches) for the whole
  parse: the synchronous, CPU-bound parse ran directly on the event loop
  inside these `async def` handlers instead of via `run_in_threadpool`.
  Also found and fixed two related GIL-monopolizing single-call bottlenecks
  uncovered while writing the regression test (FastAPI's default
  `jsonable_encoder`/`json.dumps` response encoding, and whole-array
  `ndarray.tolist()`/bulk `zip()` transpose calls in `io/delimited.py`) that
  each independently held the GIL long enough to stall a concurrent request
  even after the parse itself moved off the event loop; all three are now
  chunked or bypassed (`routes/parsers.py`, `routes/_payload.py`,
  `io/delimited.py`). Regression coverage in
  `tests/test_upload_concurrency.py` drives the real app under a live
  uvicorn socket and asserts `GET /api/health` stays responsive while a
  large upload is parsing.
- Perf: `io/delimited.py` (`import_csv`) gets a bulk-numeric fast path
  (`io/_delimited_fast.py`) for regular files — a lazy, on-demand
  tokenizer for layout detection plus a straight-to-`np.loadtxt` parse of
  the data block, bypassing the Python-level tokenize/transpose/convert
  stages entirely when a cheap prefix probe and the real parse both
  succeed. Any ragged row, text/NA cell, or parse failure anywhere falls
  back to the original path unchanged (verified bit-identical on every
  delimited fixture plus targeted ragged/text/NA/datetime/CRLF/semicolon
  cases). Measured on a 1M x 7 numeric CSV: `import_auto` 10.25s -> 1.88s
  wall time, 989MB -> 546MB peak memory (tracemalloc); a 100k-row file:
  0.56s -> 0.16s.
- Remove the never-wired bug-report downloader (`lib/errlog.ts`): its
  `/api/debug/report` fetch had no backend route, so the server half of
  every report silently dropped. The P3.4 diagnostics bundle is the
  supported path.
- Route every 422 calc adapter through a shared `CALC_ERRORS` mapping
  instead of one bespoke `except ValueError` per route (`routes/`).
- Share delimited-file parsing helpers across `io/` parsers and apply the
  D5 nan-row fix to the SIMS parser as well.
- Generate frontend API types from the OpenAPI schema, with CI drift
  detection so hand-edited types can't silently diverge from the backend.
- CI: parallelize backend tests with pytest-xdist, cache dependencies, and
  drop a redundant job.
- Docs: make `CLAUDE.md` the single agent-instruction file; `AGENTS.md` is
  now a pointer to it. Move the 24-pass BACKLOG reconciliation narrative
  into `plans/archive/BACKLOG_HISTORY.md`.
- Frontend: enable type-aware ESLint rules and fix the 27 floating and 25
  misused promises it found.
- Frontend: refactor `useApp` into domain-scoped store hooks
  (`useLibraryStore`, `useRoisStore`, `useWindowsStore`) over three
  slices, with an `architecture.test.ts` ratchet against calling
  `getState()` during render.
- Tooling: add `tools/gate.py`, a single cross-platform gate command
  (ruff + mypy + pytest, then npm lint/test/build) that CONTRIBUTING.md,
  README.md, and CLAUDE.md now point to first, with the individual
  commands kept after it for running one step by hand.
- Tooling: add `tools/bump_version.py` to make the release version bump's
  five file edits (plus the three lockfile regens) in one command instead
  of by hand.
- Lint `tools/` (`ruff check src tests tools`, now also enforced in CI)
  and prune three dead one-off scripts (`tools/smoke_live.py`,
  `tools/visual/build_compare_artifact.py`,
  `tools/bench/assemble_final_residuals.mjs`) that nothing in the repo
  referenced.
- Add shared `app`/`client` pytest fixtures (`tests/conftest.py`) and
  migrate 10 of the simplest `test_api_*.py` files onto them, removing
  their per-file `client = TestClient(app)` boilerplate.
- This item (9) — the gate/version-bump tooling, the `tools/` lint pass,
  the shared test fixtures, and this changelog — passes its own gate.
- Speed audit (final): defer `openpyxl` (`io/registry.py`'s `.xlsx`
  dispatch) and `periodictable` (`calc/sld_formula.py`) to inside the
  functions that actually use them instead of importing them eagerly at
  `create_app()` time, matching the existing matplotlib deferral. Measured:
  `openpyxl` costs ~0.2 s cold, `periodictable` ~0.03 s — the latter is
  deferred to keep an optional feature's dependency out of startup, not for
  its own speed. (`scipy.integrate`/`scipy.stats` deferrals considered for
  `calc/processing.py`, `calc/boxcut.py`, and `calc/fit_models_special.py`
  were reverted: `scipy.stats` is already imported eagerly by the
  statistics calc modules reachable from `create_app()`, so those three
  would have added a per-call import statement — one inside a hot
  per-point loop — for zero startup benefit.) Frontend: `PanelOverlayWindow`
  no longer rebuilds a full dropped-row set for every dataset on every
  render before its `useMemo` gate — the gate itself was also being
  defeated by a fresh `datasets` array reference every render; it now keys
  off a cheap, identity-only signature via a new
  `lib/rowstate.rowStateIdentity`.

## [0.24.0] - 2026-09-01

Shipped as a **minor** release rather than the originally planned
`v0.23.2` patch — the delta had grown to include the full P3.5 Recipe
Library, so "fixes only" no longer applied. Summarized from
`plans/RC_RELEASE_NOTES_DRAFT.md`; see that file for the complete
rc1→rc4→0.23.2-rc1/rc2 promotion history.

### Added
- **Native project lifecycle**: real Open/Save through the desktop bridge,
  named atomic saves, bounded autosave, and consent-gated crash recovery.
- **Relink & portability**: moved/renamed source files can be relinked
  with backend-enforced declared-source consent; a native folder-grant
  gesture enables real checksum verification instead of stat-only.
- **Single-writer project locking**: a second instance opening the same
  project gets read-only, Open as Copy, or a guarded Take Over, backed by
  a real cross-process lock; browser multi-tab is now also protected.
- **Workbook transfer packages**: export/import a workbook across
  instances with fresh-ID rewrite and bounded large-transfer handling.
- **Combine/split workbooks**, a **Recode workshop** (merge/rename
  categorical levels, find-replace), **derived worksheets with Freeze
  Copy**, **batch metadata & Collections**, and **Reimport/delete with
  impact preview**.
- **Quick Plot templates** and the **Quick Figure Builder**'s full
  create/edit/close/reopen/project-reload lifecycle.
- **P3.5 Unified Recipe Library**: one browse-first surface (filters,
  favourites, tags, last-used ordering, capability-aware row actions) over
  all six recipe systems that previously had separate homes.
- A copyable **diagnostic bundle** that excludes project content by
  default, and OS "reduce motion" + contextual per-workshop help.

### Fixed
- **Data loss**: re-importing a dataset with a computed column could
  destroy the base measurement data (live since v0.22.0); removing a
  computed column could silently re-fit a saved fit against the wrong
  column; two keystrokes in the peak table could delete a whole dataset
  or wipe a fit with no confirmation.
- Fifteen ordinary column names (`Kerr`, `Phase`, `Noise`, `Depth`, …)
  were being misclassified as error-bar columns, costing MOKE files real
  data channels; the error-label classifier was rewritten with explicit
  generate/rank/select stages.
- Formula integrity: deleting a computed column no longer lets later
  formulas silently read a shifted column.
- 34 HTTP 500s across 18 calculator routes are now proper 422s; three
  routes that could wedge the app for an hour on absurd input counts are
  now bounded; all error messages are ASCII.

### Performance
- Large 2-D RSM map regrid: 1M points 29.8 → 3.3 s; 4M points 141.6 →
  ~9-13 s, via a regular-grid fast path plus detection dedupe.
- Scattered-cloud maps denser than the output raster are bin-averaged
  before triangulation: 1M points 20.4 → 2.7 s; 4M points 88.2 → 4.8 s.

### Release engineering
- Every release now publishes a `SHA256SUMS` manifest covering all
  installer/build assets.
- macOS ships Apple-silicon only for this release (no Intel/x86-64 or
  universal build).

Older versions are documented in
[GitHub Releases](https://github.com/pquarterman17/quantized/releases).
