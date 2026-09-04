# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project does not (yet) commit to Semantic Versioning guarantees pre-1.0.

## [Unreleased]

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
