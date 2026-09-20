# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project does not (yet) commit to Semantic Versioning guarantees pre-1.0.

## [Unreleased]

### Fixed

- Corrections now preserve bound uncertainty columns: additive operations leave
  their magnitudes alone, scale/unit/normalization operations propagate the
  appropriate absolute factor, and unsupported nonlinear propagation fails
  clearly instead of silently manufacturing error bars.
- Save As now refuses to overwrite raw sources recorded only on a workbook,
  including packed-project sources.
- Fast floating-window drags and resizes no longer lose their final movement or
  remain armed after pointer cancellation/window blur; clicks without movement
  no longer create empty Undo entries.
- Recent desktop files are keyed by source path, so identically named files in
  different experiment folders coexist and show compact folder context.
- Long-path test fixtures now distinguish unsupported Windows host policy from
  product failures.

## [0.26.0] - 2026-09-18

A **minor** release: the 43 merges since `v0.25.0` add new user-facing
surfaces — a user-settable category order, nested two-factor box plots,
greyscale and dash/marker-cycled export, persistent 2-D map views and a
durable XRD peak table — alongside a large data-integrity batch (text columns
that stay on their rows, non-finite cells that survive save, screen/export
parity) and a keyboard-focus overhaul.

### Plotting and export

- Plots are now drawn with a full axis box by default — a border on all four
  sides (left y, bottom x, right y2 and top) rather than just the left-and-
  bottom "L". This matches Origin's own default and the convention most
  journals expect, and it applies to the main stage, pop-out plot windows,
  panel cells and multi-panel overlays alike. Exported figures follow: they
  previously drew tick marks along the top and right edges with no border for
  those ticks to sit on. Turn it off per plot with **Axis box (frame)** in the
  Inspector; a saved project that had it off keeps it off.
- Exported SVG figures now carry axis titles, tick labels and annotations as
  real, editable `<text>` instead of outlined glyph paths, so they can be
  retyped in Illustrator, Inkscape or Origin (mathtext stays outlined). The
  correlation heatmap's cells are now vector rather than an embedded image.
- Exported figures draw the same marker shapes as the screen; every marker
  previously exported as a filled circle.
- **Greyscale (print-safe)** export option: each series gets an evenly spaced
  grey plus a forced dash/marker cycle. It covers single figures (including
  y2, x-axis breaks and grouped figures) and every page export — Export
  page…, the Figure Page composer (whose preview turns grey too), and
  exporting a saved page from the Library. Only the export changes; the
  screen stays in colour. Error-bar caps now take their series colour in
  vector output, which also fixes caps drawn in the wrong colour in ordinary
  coloured exports.
- **Vary dash & marker** (Appearance menu, off by default) cycles line dashes
  and marker shapes by series position, so series stay distinguishable
  without relying on colour. A plot cycles on screen only when its export
  will draw the same dash and marker at the same position; grouped, faceted,
  stacked, polar and statistical views opt out on both sides.
- The `tol-bright` series palette had two identical colours; its eighth slot
  now has a distinct colour that stays distinguishable under simulated
  colour-vision deficiency and legible on the dark canvas.
- Exporting a (non-faceted) figure now leaves out excluded and Data-Filtered
  rows, as the screen does, with error bars kept aligned to the remaining
  points.
- Long exports can be cancelled: each running export shows its own
  **Cancel** control in the status bar, and nothing is written to disk once
  it is cancelled. (A clipboard copy cannot be cancelled once the image is
  produced, and some download paths are not cancellable yet.)
- Screen, export and reopened project now agree in five cases that used to
  diverge: a saved x-axis break is drawn on screen after reopening the
  project; a waterfall's per-series stagger reaches the exported figure; a
  legend rename is exported as a legend label only (the data's real label
  and units are unchanged) and shows verbatim on facet, stacked and x-break
  panels; hidden series no longer shift the other series' export colours;
  and a grouped figure exports each level with its channel's dash, width,
  marker and colour as the screen draws them.
- The baseline **Fit from region** rubber band can also bound the y range (a
  2-D box, as in the MATLAB toolbox).

### Categorical data and statistics

- **Reorder levels…** (worksheet column context menu on a categorical column)
  sets a category's display order: move levels up or down, sort by label, or
  reset to code order. The order applies wherever the categories are drawn:
  bar, box, violin and strip axes, XY group split, Tabulate, facets,
  variability charts, the Data Filter's level list and publication exports.
  Level codes are never renumbered, so formulas, filters and macros that
  refer to a code keep their meaning, and a level that appears later still
  shows up, at the end. Each reorder is one undo step.
- Box, violin and strip plots gain a **then by** picker beside **group by**,
  which draws one box per combination of the two columns that has data
  (labelled `lot = 1 / wafer = 3`). The boxes are nested in order, following
  each factor's level order. Facets nest the same way, and exports carry the
  combined labels.
- Split Dataset now honours a column's categorical levels (an explicit level
  table, or an Origin text column). A small categorical column used to be
  treated as continuous and pooled into one group named after a level code;
  children are now named after their level.
- Corrections never applies numeric transforms to categorical level codes; it
  preserves their table and order through offsets, backgrounds, unit changes,
  smoothing, normalization and derivatives. Resample preserves a coincident
  grid exactly and refuses a different grid rather than interpolating codes or
  silently mixing methods. Reimport and workspace reopen preserve the same
  categorical metadata in both raw and corrected copies.
- Duplicate, Freeze copy, Extract rows and `.opj` export keep categorical
  level labels. Duplicate and Freeze copy used to reduce them to raw codes.
- The Stat Stage no longer keeps a group-by pick on a column you have since
  marked non-categorical. Changing the type back restores the pick.

### Data integrity

- Text columns (sample ids, operators, run labels) stay attached to their
  rows through Extract, Split, row exclusions and the Data Filter, facets,
  inserting and deleting rows, Merge, x-trim corrections and lazily loaded
  Origin previews. Each of these could previously pair a text cell with
  another row's measurement, and inserting or deleting rows could delete
  text cells beyond the last numeric row, which on a text-only Origin book
  meant the whole worksheet. Resample, which creates new rows, now drops
  them.
- Worksheet cells holding NaN, ±Infinity or −0 now survive save and reopen
  across `.dwk` save, autosave, Pack Project and workbook transfer. Ordinary
  data serializes byte-identically, so this is not a file-format change.
- Opening an NCNR reductus `.refl` file now plots only the measured
  reflectivity. Its uncertainty becomes the Y error bars and its Q resolution
  the X error bars; previously these were drawn as three separate curves.
  This also works with `R`/`dR`/`dQ` naming, blank (dimensionless) units and
  extra columns. The roles survive rebinding a window, reimport and a manual
  override, and the uncertainty columns stay in the worksheet.
- The Data Filter is part of undo. A slider drag or a typed value is a single
  step, and Ctrl+Z works while a slider has focus. Previously one Ctrl+Z
  could remove both a row exclusion and a filter, a redo could wipe out a
  filter, and a cleared filter could come back.
- Automatic recalculation handles datasets upstream-first, so a derived
  dataset is never rebuilt from a stale parent. A recalculation that fails
  now leaves that dataset, and anything derived from it, marked stale
  instead of clean. If a background-subtraction reference has been deleted,
  recalculation says it ran without it.
- Lazily loaded Origin books: row exclusions and filter edits are refused
  with a message while the book is still loading, instead of being silently
  discarded when its full data arrives. If loading the full data failed, the
  message now says why and suggests relinking or re-importing; it used to
  say "try again in a moment" forever. Pack Project and Save/Save As load
  pending books first and refuse, naming the book, if one cannot be loaded.
  Pack Project could previously ship a book's preview rows as its data.
- Warnings from migrating an older project now appear on every load path
  (crash recovery, autosave restore, Append Project, workbook Paste), not
  only File ▸ Open.
- Paste and Duplicate now say when a lineage or background-subtraction
  reference could not be carried across. A dropped background reference
  changes the plotted data, so it is reported separately.

### Analysis

- XRD: fitted peaks are saved with the project as a peak table, from which a
  Williamson-Hall analysis runs in one click. Editing a cell, changing an
  exclusion or changing a unit invalidates the table instead of leaving it
  describing data that no longer exists.
- 2-D maps: each map's colormap, scale, colour limits and cut slices are
  saved with the project. Slices survive a regrid or a colour-limit change;
  a slice the new grid cannot place is parked in a strip on the stage with
  the reason and stays removable. Opening a map no longer marks the project
  modified. A map window for a dataset other than the active one has
  colour-limit fields in its own toolbar.

### Library, search and Help

- In Tree view, a worksheet is now a compact one-line row like a graph,
  where it used to be a tall card. Its sparkline preview is an opt-in toggle
  per row and is remembered. Folders, workbooks, worksheets and graphs each
  show a type glyph.
- Large Libraries: Tree and Details (which also shows search results) render
  only the visible rows once past 150, and folder counts and selection
  lookups are indexed. Keyboard navigation continues past the visible
  window, screen readers are told the full row count, and if the focused row
  scrolls out of view, arrow keys and Delete keep working.
- The Details and Tiles views gain the Tree's rename, move and drag-and-drop:
  a drag grip, the same drop cues, and keyboard rename.
- Find in project searches instrumental metadata that did not become a
  channel: text-column and other column names, label rows (where sample ids
  live) and the file's preamble comments.
- Help search finds every described command, including ones such as Relink
  Sources, Paste Workbook, Take Over Editing and Open as Copy that it could
  not reach before.

### Keyboard and accessibility

- Dialogs and workshop panels take focus when they open, keep Tab inside,
  close on Escape and return focus to where it was, and this now includes
  Split, Separate, Combine, Reimport All, Shortcuts, Text Format Help,
  Preferences and Help. Escape is handled by one ordered ladder (menu, live
  gesture, window, workspace, selection, app), so a single press closes the
  innermost thing and nothing behind it. Known issue: with Preferences open
  over a confirmation, one Escape still closes both (BUG-018).
- Screen readers announce import, export and fit progress from the status
  bar, without interrupting.
- The Library marks the dataset bound to the active window with
  `aria-current`, separately from multi-selection.

### Under the hood

- About 42 kB of JavaScript moved off the startup path into lazily loaded
  chunks, which absorbs everything above: the startup bundle (~889 kB) is
  no larger than in 0.25.0.
- The central store module (`store/useApp.ts`) shrank from 2,808 to 1,450
  lines as seven domains (recalculation, ROI gadget, row state, plot-view
  settings, reports and figure documents, bulk view appliers, workspace
  hydration) moved into their own modules, most behind a characterization
  test written before the move.
- Dependency security updates: `anyio` 4.14.2 and `js-yaml` 4.3.2. The Rust
  advisory register was re-verified; everything in it is still blocked on
  upstream Tauri/gtk releases.

## [0.25.0] - 2026-09-08

A **minor** release: the window since `v0.24.0` adds new user-facing
surfaces — Pack Project, project trash, and the import wizard's error-
binding and metadata work — alongside a performance batch and the
completion of P1.1 project lifecycle.

- Pack Project: File → **Pack Project…** (desktop app) creates a portable,
  self-contained copy of the open project next to a folder you pick — the
  packed project file plus a verified copy of every reachable source file
  — after a review step that shows each source's readiness, size, and any
  blockers. Progress is shown per file and by bytes, packing can be
  cancelled at any point, and an existing destination folder is never
  overwritten. Your open project and original data files are never
  modified. Sources that are missing or offline keep their original
  absolute paths in the packed copy. Backend: staging, verification, and
  atomic publication of the bundle (an atomic no-replace rename on Linux,
  macOS, and Windows), with a cancellable, pollable orchestration job.
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
- Project trash: deleting a figure, page, report or folder now goes to trash
  rather than away. Reports and legacy publication figures recorded no undo
  entry at all before, so trash is their only recovery path. Restore is
  dependency-aware — a figure whose bound dataset is also in trash brings the
  dataset back with it and says so; if the dataset is gone entirely the figure
  restores with its binding cleared, exactly as opening a project clamps a
  dangling reference. Folder restore re-homes members and child folders still
  sitting where the delete sent them and leaves anything you have moved since.
  The panel shows counts by kind, per-row size, and the retention rules
  (128 MiB, plus the existing count and age caps; the newest entry is always
  kept). **Empty trash** names exactly what would be lost, and the Library
  dataset menu gains a **Delete permanently…** that states it bypasses trash
  and cannot be undone.
- Import Wizard — error columns. An error column is now bound to what it
  describes, and the pairing survives everything: saving an import filter and
  reapplying it used to restore the roles and silently drop every pairing, and
  a CLI or API import emitted error columns as ordinary channels with no
  record at all. Bindings are stored against raw file columns, so a saved
  filter still applies to a file whose channel numbering has shifted. The
  wizard offers the backend's inferred pairings as explicit, reviewable
  suggestions — never applied automatically — and applying one assigns the
  role and persists the binding together. A saved binding the backend has to
  reject is shown with the reason, naming the column rather than an index,
  instead of vanishing.
- Import Wizard — file preamble. Instrument header lines such as
  `Temperature: 300 K` or `##SCAN RATE=2` are parsed into structured fields
  and shown in the wizard, so a scan's conditions are readable instead of
  buried in free text. Every line is still retained verbatim and searchable as
  before. A key repeated with different values resolves to the last one and
  says so rather than overwriting silently. The wizard also shows the file's
  own label-line text separately from the column names you can edit.
- Import Wizard — categorical columns. A continuous numeric column mistakenly
  marked categorical produces one level per row; the wizard now shows that
  before import and blocks Import by default, with an explicit **Import large
  category anyway** override for the genuine case (hundreds of real sample
  IDs). Case-only collisions such as `Fe` and `fe` are reported as warnings
  and never merged — the distinction is real in some notations. Imported
  category names now also reach the Data Filter and the statistical tools
  (test chooser, box/violin/strip), which previously showed the raw numeric
  codes.
- Recipe Library: peak recipes, graph templates and fit models can be exported
  and imported as files, round-tripping losslessly; a malformed or
  wrong-shaped file is refused with a reason rather than partially loaded.
  Toolbar gains **Import recipe…**, which identifies the kind from the file
  itself. Each row gains a **Details** disclosure showing scope, schema
  version, timestamps, technique, tags and the kind's own facts (plot channels
  and marks, analysis steps, peak baseline/model/report, a fit model's
  equation and parameters, a graph template's style and override counts), plus
  the actions actually available for that row.
- Project files are saved more defensively. A save is now flushed and synced
  to disk before the atomic replace, closing a window in which a crash or
  power loss right after the rename could leave a zero-length or partial
  project file where a good one had been. Saving is refused outright — before
  any temporary file is written — when the destination is a data file the open
  project declares as one of its own sources, so Save As can no longer
  overwrite your raw data; the refusal is now reported to you rather than
  looking like a cancelled dialog.
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
