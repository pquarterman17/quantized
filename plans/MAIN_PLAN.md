# MAIN PLAN — quantized

The root of the plan tree (per the global plan-consolidation rule: one
main plan; sub-plans only where scale demands; small residues fold up
here). Mission: **quantized replaces OriginPro as the owner's daily
plotting & analysis tool** — MATLAB-toolbox backend parity (done,
golden-verified) plus a ground-up GUI that wins on reproducibility,
linked exploration, and domain depth. "Go-to" is achieved empirically
via the switch-trigger protocol (GOTO_PLAN).

**Status:** Active
**Created:** 2026-07-10
**Updated:** 2026-07-11

---

## Context

### The plan tree

| Sub-plan | Scope | Why it earns a separate file |
|----------|-------|------------------------------|
| `PORT_PLAN.md` (+ appendix `PORT_CHECKLIST.md`) | MATLAB parity, packaging (W8), CI/verification (W9) | Founding doc; W0–W9 history + the exhaustive per-feature parity inventory |
| `GOTO_PLAN.md` | The go-to capability push vs Origin (10 owner-decided items + switch-trigger protocol) | Active build campaign, own decision log |
| `ORIGIN_FILE_DECODE_PLAN.md` | `.opj`/`.opju` reverse-engineering + decode gaps | Large RE reference (format findings, §13 gap register) |

Six residue plans were folded up into this doc and archived on
2026-07-10 (fold-up rule): MULTI_PLOT, WORKSHEET, PROJECT_ORGANIZATION,
GAP_TIER3, GAP_ECOSYSTEM, ORIGIN_GAP — each was ≤3 open items. Their
`## Completed` histories live in `plans/archive/`. Provenance is kept on
every folded item below.

### Cross-plan dependencies
- GOTO #4 (fig composer) + #5 (rich text) gate the PNR half of the
  switch-trigger project (GOTO protocol).
- The WebGL 3-D deferral (below) shares its gate with GOTO Q4 — one
  answer resolves both.
- BACKLOG.md stays the derived cross-plan dashboard (plan-hygiene truth
  order unchanged: code > plan Completed sections > BACKLOG).

### Origin-parity surface audit (2026-07-11)
An independent 19-area enumeration of OriginPro's daily-driver surface
(analysis-software-expert, this-user profile) diffed against the live
command/route/workshop inventory. Conclusion: analysis + plotting
coverage is genuinely complete or owner-gated, but the prior gap
campaigns under-weighted **editor ergonomics** — items #9–#16 below are
the found gaps (none previously booked anywhere). Also caught + fixed:
GOTO #11 drift (implemented but listed open).

---

## Tier 1 — High Impact

*(items 9–11 booked from the 2026-07-11 Origin-parity surface audit;
18–19 from the owner's first hands-on testing session, same day)*

~~18. **Pointer tool as the DEFAULT + direct-manipulation plot
    objects**~~ COMPLETED 2026-07-11 (see Completed).

~~19. **Multi-plot panel builder**~~ COMPLETED 2026-07-11 (see
    Completed — v1 + the drag-rearrange follow-up both shipped).

~~21. **Page-anchored annotations**~~ COMPLETED 2026-07-11 (see Completed).

~~22. **Standalone DiraCulator launcher**~~ COMPLETED 2026-07-11 (see
    Completed).

~~23. **DiraCulator Start Menu shortcut in the installer**~~ COMPLETED
    2026-07-11 (see Completed). ⚠ Installer-path verification pending
    the next real release build (noted in the Completed entry).

~~24. **Axis tick formats in publication export**~~ COMPLETED 2026-07-11
    (see Completed).

~~9. **Undo/redo stack**~~ COMPLETED 2026-07-11 (see Completed).

~~20. **Axis tick-label precision + engineering notation**~~ COMPLETED
    2026-07-11 (see Completed).

~~10. **Re-import from source file**~~ COMPLETED 2026-07-11 (see Completed).

## Tier 2 — Medium Impact

~~12. **Reciprocal (Arrhenius) axis scale**~~ COMPLETED 2026-07-11 (see
    Completed).

~~13. **Fill between / under curves**~~ COMPLETED 2026-07-11 (see Completed).

~~14. **Color-mapped scatter**~~ COMPLETED 2026-07-11 (see Completed).

~~17. **Rich-text formatting shortcuts**~~ COMPLETED 2026-07-11 (see Completed).

~~1. **Decompose App.tsx + ThinFilmTab.tsx**~~ COMPLETED 2026-07-11 (see Completed).
~~2. **Extract the useApp window slice**~~ COMPLETED 2026-07-11 (see Completed).
~~3. **Worksheet per-column widths + drag resize**~~ ✅ completed 2026-07-11 (see Completed).
~~4. **Worksheet selection → Graph Builder handoff**~~ ✅ completed 2026-07-11 (see Completed).
~~5. **`.otp`/`.otpu` template import, frontend half**~~ ✅ completed 2026-07-11 (see Completed).
~~6. **Defaults-audit residuals**~~ ✅ completed 2026-07-11 (see
   Completed).
~~7. **Register import_lake_shore**~~ COMPLETED 2026-07-11 (see Completed).

~~8. **Post-review consolidation batch**~~ COMPLETED 2026-07-11 (see
   Completed — all 9 sub-items shipped).

## Tier 3 — Nice-to-Have

~~15. **Find X from Y / Y from X on a fitted curve**~~ COMPLETED
    2026-07-11 (see Completed).

~~16. **Append/merge workspace**~~ COMPLETED 2026-07-11 (see Completed).

*(further candidates arrive via GOTO owner gates Q4/Q6/Q7/Q8)*

---

## Owner gates (folded from the archived plans)

- **Pop-out books/plots into windows** (was MULTI_PLOT #19) — PLAN WITH
  OWNER FIRST: gesture, "pop out a BOOK" semantics, bulk "window
  everything" command.
- **Worksheet view-state persistence** (was WORKSHEET #14) — decide
  once, with usage evidence, whether sort/widths/selection persist
  per-dataset in `.dwk` (default: no).
- **PyPI Trusted Publisher registration** + first tagged publish + the
  fresh-machine acceptance run (was ORIGIN_GAP #41; see RELEASE.md).
- **Corpus publish licensing sign-off** (was ORIGIN_GAP #45) —
  `../test-data` repo is `git init`-ed; gated on the licensing pass + 6
  flagged public files.
- **Defaults-audit eyeball** (was GAP_TIER3 #2) — rule on the taste
  calls in `plans/design/DEFAULTS_AUDIT.md`.
- **Apache-2.0 copyright holder line** for LICENSE/NOTICE (PORT_PLAN
  #1 residue — lives with its sub-plan, listed here for visibility).
- **Code-signing certificate + auto-update E2E** (PORT_PLAN #47/#49
  residue, reconciled 2026-07-11): obtain a cert, sign a release, then
  verify updater end-to-end across two consecutive signed releases.

## Deferrals (decision gates — revisit on demand)

- **Interactive WebGL 3-D** (was GAP_TIER3 #7 / ORIGIN_GAP #22) — gate
  now UNIFIED with GOTO Q4; one owner answer resolves it.
- **`.opju` writer** (was GAP_ECOSYSTEM #6; = ORIGIN_FILE_DECODE #27)
  — revisit only if a real Origin build refuses `.opj`.
- **`quantized-plugin-template` starter repo** (was ORIGIN_GAP #8
  residual) — separate repo, out of scope here.
- **Plugin pipeline-step route + frontend palette** (was GAP_ECOSYSTEM
  #2) — v1 registers steps server-side only.
- **Database connectors** (was ORIGIN_GAP #47) — paste/append shipped;
  connectors on user pull.
- **Worksheet designation editing** (was WORKSHEET D2) — read-only in
  v1 unless requested.
- **Graph Builder export button + `.dwk` plot-spec persistence** —
  booked debt from archived GAP_INTERACTION #51.
- **Stat-stage residuals** (archived GAP_PLOTTYPES, accepted) — bar
  orientation, in-canvas legend, `payloadToTSV` ordinals,
  `statRender.ts`/`useStatStage.ts` split candidates.

## Completed

- ~~**#24 Axis tick formats in publication export**~~ (2026-07-11, sonnet
  agent) — matplotlib mirrors the screen's `AxisFormat` (fixed/sci/eng +
  the increment-aware precision floor + −0 normalization) via a new
  `calc/figure_ticks.py` (`Formatter` subclass reading
  `self.axis.get_majorticklocs()` lazily at DRAW time, since matplotlib's
  Formatter/Locator split has no `foundIncr`-equivalent argument);
  `auto` stays `None` (matplotlib's own default). Threaded through all 3
  drawing consumers: `figure.draw_series_axes` (single-figure + figure-
  page panels), `figure_break.render_breaks_impl` (broken-axis panels,
  applied per-panel — it draws its own axes, doesn't call
  `draw_series_axes`), and `figure_page.PagePanel` (per-panel own
  `x_fmt`/`y_fmt`, not one page-wide format). `figure.py` hit the
  500-line ceiling adding the params, so `_collect_map`/
  `_bbox_to_pixels`/`_artist_window_extent` were extracted to a new
  sibling `calc/figure_hitmap.py` first (416 lines after, was 496).
  Route wire model `TickFormatSpec` (routes/export_figures.py,
  `Literal["auto","fixed","sci","eng"]`) sent only when non-`auto`
  (`lib/types.ts`'s `axisFmtParam`) from `exportFigureCommand.ts`,
  `useFigureBuilder`, and `useFigurePage`'s per-panel window view (a
  saved Library-figure/FigureDoc panel has no persisted fmt to restore —
  documented gap, exports at auto). `y_fmt` documented as also covering
  the screen's y2 axis; the matplotlib backend has no y2/twinx rendering
  to mirror it onto. +23 backend unit tests (real `fig.canvas.draw()` +
  `ax.get_xticklabels()`, several ported 1:1 from
  `uplotOpts.test.ts`'s MAIN #20 cases) + 9 integration/route tests +
  9 frontend tests. Backend 2810 passed / frontend 2996 passed, ruff +
  mypy --strict clean.

- ~~**#23 DiraCulator Start Menu shortcut**~~ (2026-07-11, sonnet agent)
  — Tauri shell `--calc` mode (pure unit-tested `shell_mode`/
  `webview_url` helpers; retitles/resizes the config-defined "main"
  window to DiraCulator 520×680; sidecar logic byte-identical both
  modes; cargo check/test 7/7/clippy clean) + NSIS POSTINSTALL/
  POSTUNINSTALL hooks grounded in the TAG-PINNED tauri-bundler
  template source (tauri-cli-v2.11.2): `$SMPROGRAMS\DiraCulator.lnk` →
  `$INSTDIR\${MAINBINARYNAME}.exe --calc` (MAINBINARYNAME, not a
  hardcoded exe name — the binary is quantized-shell.exe), ambient
  SHCTX matches Tauri's own shortcut, uninstall gated on
  `$UpdateMode <> 1` + UnpinShortcut so upgrades never delete it.
  HONEST GAP: hooks verified by construction only — the full
  install/upgrade/uninstall path runs at the next real release build
  (pair it with the signing-cert owner gate's E2E).

- ~~**#22 Standalone DiraCulator launcher**~~ (2026-07-11, sonnet agent)
  — `qz --calc` + `diraculator` console-script alias (`cli.main_calc`);
  `?view=calc` mounts a 43-line `CalcOnlyApp` (titlebar + theme toggle
  + `CalculatorsContent`, extracted from CalculatorsPanel — no
  Library/Stage/menubar mounted); the one cross-workshop affordance
  (SLD → Reflectivity seed) degrades to a toast in calc-only mode.
  Port fallback went GLOBAL: a busy non-explicit port auto-falls-back
  to an OS-assigned free port with a printed note (explicit --port
  still errors); `--calc --desktop` = 520×680 pywebview "DiraCulator".
  End-to-end verified live: main app on 8000 + diraculator on a
  fallback port simultaneously, calc view 200. Honest tail: `--calc
  --dev` accepted but ignored (dev opens the plain Vite root).
  Frontend 2991 / backend 2779 green.

- ~~**#21 Page-anchored annotations**~~ (2026-07-11, sonnet agent) —
  `Annotation.anchor?: "data"|"page"` (page = canvas fractions, default
  data = full back-compat); right-click "Pin to page / Pin to data"
  toggle converts coords IN PLACE via `annotationAnchorConversions`
  (round-trip-exact, y2-scale aware; `canvasToOverCss` = the documented
  inverse of `overPointerToCanvas`); page drags move in fraction space
  with the same on-canvas clamp; sanitizeView gained real
  `sanitizeAnnotations` validation (was a bare cast); export renders
  page text via `ax.annotate(xycoords="figure fraction")` with the
  canvas-vs-matplotlib y-flip, verified against real matplotlib output.
  +~30 tests (frontend 2983 / backend 2766 green on its branch).

- ~~**#19 Multi-plot panel builder**~~ (2026-07-11, two sonnet agents;
  design decided with owner — Library-row selection, composite MDI
  window, quick picks, auto dual-Y) — v1 (`ccd91d8`): `panel` window
  kind + `store/panels.ts`; pure `lib/panelwindow.ts` (union-x overlay
  through the rowstate chokepoint, unit-family y2 assignment w/
  3+-family toast, grid tiling via facetGridSize); per-window x-sync
  group; DatasetRow quick picks (Side by side / Stack / Grid / Overlay)
  + ⌘K commands; removed datasets prune from panels
  (`pruneWindowDatasetRefs`); +68 tests, every ratchet held. Follow-up
  (`edac315`): drag the panel-cell HEADER (window furniture — works in
  any tool; canvas drag stays box-zoom) to splice-reorder
  `panel.datasetIds`, accent drop-target indicator, dragged cell dims,
  ✕ chip removes a dataset from the panel; header replaced uPlot's
  internal title so no canvas re-render on hover; +~30 tests.

- ~~**#18 Pointer tool default + direct-manipulation objects**~~
  (2026-07-11, sonnet agent) — `pointer` tool (glyph ➤, toolbar-first)
  is the NEW DEFAULT: no crosshair (`cursor:{x:false,y:false}`), arrow
  cursor, empty-drag still box-zooms; every other tool pixel-identical.
  Annotations: click-select / drag-move / corner-handle resize
  (`Annotation.size` 6–72px) / double-click edit (hand-rolled 400ms
  detector — uPlot owns native dblclick for autoscale) / right-click
  object menu / Escape deselect; hit-test = point-first then
  measureText rect (`lib/annotationHit.ts`), geometry shared with the
  draw pass so they can't drift. Ref-line drag gate extended to
  pointer. Legend: drag → `legendXY` fractions (rAF-throttled)
  overriding `legendPos`; double-click snaps to nearest corner. Export
  parity COMPLETE (annotations w/ size + legend loc/anchor through
  `liveViewOverrides` → the #14 bbox_to_anchor path; verified against
  real matplotlib hitmap output). New `store/pointerTool.ts` slice;
  all ratchets held (PlotStage 392/400 via useAnnotationEdit
  extraction; windows.ts untouched at 750/751 — the focus-reset was
  deliberately omitted, documented: annotation ids never recycle so a
  stale selection matches nothing). +~50 tests.

- ~~**#20 Axis tick-label precision + engineering notation**~~
  (2026-07-11, sonnet agent) — REPRODUCED first via `tools/visual`
  (new committed `dense_moment_axis_tick_repro` shot in
  `spec.example.json`): the mechanism is uPlot's OWN default axis
  `values` formatter (`numAxisVals` -> bare `Intl.NumberFormat` with no
  options -> spec-default 3-fraction-digit cap, `foundIncr` never
  consulted) — reproduced with `yFmt` untouched at `{mode:"auto"}`, no
  fixed/sci path involved (the fixed-mode `toFixed` duplicate was also
  independently proven, as a documented mechanism-class regression, but
  isn't what produced the owner's screenshot). Fix: `tickFormatter`
  (`lib/uplotOpts.ts`) no longer returns `undefined` for "auto" —
  `autoTickValues` overrides it with the same Intl locale-grouping
  behaviour but a `splitsIncrement`-derived (`lib/ticks.ts`'s
  `decimalsForIncrement`) precision floor instead of a hardcoded 3;
  `fixed`/`sci` modes get the same floor (`Math.max(digits, floor)`);
  a new `eng` `TickMode` (mantissa in [1,1000), exponent a multiple of
  3, sci-style `1.2e-3` suffix); `stripNegZero` normalizes any
  rounds-to-zero label (fixes the bare "−0"). Wired: Axes card's
  `TickFormat.tsx` Auto/Fixed/Sci/Eng segmented control; command
  palette "Cycle X/Y tick format" (`appCommands.ts`, `cycleTickMode` in
  `plotview.ts`); `.dwk` persistence rides the existing `AxisFormat`
  field for free (`isAxisFormat` only checks `mode` is a string).
  Export parity: audited — `xFmt`/`yFmt` don't flow to the matplotlib
  export path AT ALL today (only `x_scale`/`y_scale` do), a pre-existing
  gap, not a regression; left as an honest gap, not built new scope.
  Axis right-click menu deferred (owner directive: #18's pointer
  context-menu agent was actively editing `plotMenu.ts`/
  `PlotContextMenu.tsx` concurrently — untouched here). +139 new/changed
  frontend tests (uplotOpts/ticks/TickFormat/appCommands/
  MultiPanelStage), harness before/after screenshots prove the fix and
  no regression on a healthy large-integer axis (byte-identical
  Intl-grouped output). Frontend 216 files / 2799 tests green.
- ~~**#9 Undo/redo stack**~~ (2026-07-11, sonnet agent) — snapshot
  history slice `store/history.ts` (depth 50; Zustand structural
  sharing makes snapshots pointer copies), ~24 data-mutating actions
  record labeled entries (imports/remove/rename/merge, cell edits,
  corrections, formulas, exclusions, roles, tags, notes); Ctrl+Z /
  Ctrl+Shift+Z with a focus guard preserving native text undo;
  reactive "Undo <label>" Edit-menu entries (command registry now
  merges per-source). View/window state deliberately excluded. useApp
  pin 3292→3335 WITH written justification (24 non-compressible
  recorder lines — the documented escape). +28 tests. Known limits
  documented: no job-cancel on undo; window bindings don't participate.
- ~~**#13 Fill under/between curves**~~ (2026-07-11, sonnet agent) —
  `SeriesStyle.fill` none/under/{vs channel}; uPlot native series.fill
  + bands on screen, matplotlib fill_between at export via shared
  `calc/plotting.resolve_style_channels`; figure.py split
  (`figure_overrides.py`) to stay under the 500 ceiling.
- ~~**#14 Color-mapped scatter**~~ (2026-07-11, sonnet agent) —
  `SeriesStyle.colorBy` + colormap (lib/colormap reuse); draw-hook
  plugin paints per-point colors in the canvas-pixel frame; matplotlib
  scatter(c=z)+colorbar at export. Bonus: fixed a latent figure-hitmap
  misalignment (ax.lines indexing broke after any scatter series).
- ~~**#15 Find X↔Y on a fitted curve**~~ (2026-07-11, sonnet agent) —
  `calc/fit_findxy.py` (dense-grid bracketing + brentq, returns ALL
  crossings) + thin `POST /api/fitting/find-xy` covering registry
  models AND saved custom equations; FindXYSection in both fit panels.
- ~~**#17 Rich-text formatting shortcuts**~~ (2026-07-11, sonnet agent)
  — wrap-selection Ctrl/Cmd+I italic, Ctrl+= subscript (Ctrl-only;
  Cmd+= is the macOS zoom key), Ctrl+Shift+= superscript, Ctrl/Cmd+.
  opens the palette; emission grammar-verified (`$_{x}$` parses;
  whole-`$…$` selections bail to the safe fallback, regression-pinned);
  documented in TextFormatHelp.
- ~~**#16 Append/merge workspace**~~ (2026-07-11, sonnet agent) — pure
  `lib/workspace.mergeWorkspace` (two-pass id remap so forward bgRefs
  resolve; Origin-style " (2)" name suffixing via the dedupeWindowTitle
  convention; folder refs dropped-with-count — folders don't merge in
  v1) + `appendWorkspace` store action (never touches active/view/
  windows; undo-recorded) + File-menu "Append workspace (.dwk)…".
  Ratchets held by EXTRACTION not raise: saveWorkspaceToFile →
  store/workspaceIO.ts, Export-figure body → lib/exportFigureCommand.ts.
  +13 tests.
- ~~**#11 Reductions GUI**~~ (2026-07-11) — one workshop,
  `components/workshops/reductions/`: a method-picker ToolWindow
  (Williamson-Hall / FFT film thickness / Reflectivity FFT) over the
  already-golden `/api/reductions/*` routes, plus three Analyze-menu
  entries (`appCommands.ts`'s `openReductions`) that open it pre-set to
  a method via a new `store/reductions.ts` slice (kept the store-size
  and command-registry ratchets intact — two boolean-field pairs
  merged onto shared lines to hold `useApp.ts`/`appCommands.ts` at
  their pins). W-H peak entry is manual (2θ/FWHM editable rows,
  add/remove) — the Peaks workshop's fitted peaks live only in its own
  component state, never published to the store, so there is no
  durable prefill source without new cross-workshop plumbing (noted
  follow-up, not built). FFT thickness / reflectivity FFT read the
  active dataset through `lib/rowstate.analysisData` (#50/#53) and
  offer "→ Library" to save the FFT magnitude spectrum as a new
  dataset. Spin asymmetry stays OUT of the GUI — blocked on polarized
  (++/−−) metadata, same gap as the pair-discovery item above it.
  13 new tests (hooks + view + command registry); frontend 2657/2657,
  build clean; backend untouched (`test_api_reductions.py` +
  `test_calc_reductions.py` sanity-checked, still 28/28).
- ~~**#10 Re-import from source file**~~ (2026-07-11) — `Dataset.source?:
  {kind:"path", path}` (round-trips .dwk); honest matrix: real paths are
  knowable ONLY via the path-based `/api/parsers/import` route (`api.
  importFile`) and a lazy Origin book resolved from one — confirmed NEITHER
  the pywebview desktop shell (no `js_api` bridge) NOR the Tauri shell
  (`tauri-plugin-dialog` is Rust-only, never invoked from the frontend)
  currently surface a path from the browser file-picker/drag-drop
  (`uploadFile`/`DataTransfer.files`), so those never set `source` — matches
  the plan's own "browser uploads degrade gracefully" call. New composed
  slice `store/reimport.ts` (`reimportDataset`) + pure `lib/reimport.ts`
  (Origin book-matching, shape-change detection); corrections re-applied
  through the SAME `applyCorrectionsApi` chokepoint `useApp.applyCorrections`
  uses, inlined so the whole op is ONE `recordHistory` entry (single-step
  undo); row/column-indexed state (excludedRows/filter/channelRoles/
  channelTypes/formulas) cleared + toasted only on an actual shape change,
  kept otherwise. Library row context-menu entry + ⌘K command, both
  label-branching to a source-less "Re-import from file…" file-picker
  fallback. 13+8 new tests (store branches + pure helpers) green; store/
  appCommands/component-ceiling ratchets held (net small trims, no pin
  raised). No backend changes — reused the existing import/corrections/
  book-data routes.

- ~~**#12 Reciprocal (Arrhenius) axis scale**~~ (2026-07-11) — `xLog`/`yLog`
  booleans promoted to an `AxisScale` ("linear"/"log"/"reciprocal") enum
  across `PlotView`/store/`.dwk` (back-compat: `scaleFromLog` bridges old
  boolean saves; y2 nullable-inherit preserved). Screen: uPlot custom
  `distr: 100` + self-inverse `fwd`/`bwd` (`reciprocalTransform`), tick
  positions evenly spaced in 1/x with labels in the original units
  (`reciprocalAxisSplits`, always-supplied splits since uPlot has no native
  reciprocal locator). Export: matplotlib has no reciprocal scale either —
  `calc/figure_scale.py` (new, <500-line ceiling) applies it via
  `ax.set_xscale("function", functions=(f, f))` + a matching tick locator,
  wired through the shared `draw_series_axes` chokepoint so single-figure,
  paneled-break, and figure-page export all get it for free. Inspector Axes
  card: two checkboxes → `AxisScaleControls.tsx` (Linear/Log/Reciprocal
  `Select`s, extracted per the card's existing AxisLimits/TickFormat
  pattern). Command palette "Toggle log X/Y axis" → cycle
  linear→log→reciprocal→linear. Context menu axis submenu mirrors the
  3-way pick. Figure-hitmap preview-drag inversion (`lib/previewmap.ts`)
  also fixed for reciprocal (a real "missed consumer" caught by the sweep —
  the backend's `_collect_map` now reports the resolved scale name, not
  `ax.get_xscale()`, which reports a reciprocal axis as the generic
  `"function"`). Origin-decode paths (`SpatialPanel`, `OriginFigure`,
  Origin GRAPH/.ogs export) stay boolean-only by design — Origin has no
  reciprocal axis type; `scaleFromLog`/`=== "log"` bridges at each
  boundary. Backend 2757 tests green (+34), frontend 2706 green (+~60).
- ~~**#8 Post-review consolidation batch**~~ (2026-07-11) — all 9 sub-items,
  4 parallel workstreams (3 worktree agents + direct), zero merge conflicts:
  - Point-gesture core: `lib/pointGesture.ts` (pixel-frame conversion + hit
    test); `uplotAnchors`/`peakMarkerHit` both ride it — the cloned
    pixel-frame bug class is now un-clonable.
  - Anchor bridge identity-stable (`getAnchors` ref read): anchor edits no
    longer rebuild the uPlot instance twice per gesture; pixels cached per
    list-identity + scale window; plugin-level jsdom gesture tests added.
  - `api.ts`: private `ensureOk` + exported `unwrap`/`postForm` — SIX
    drifted error-extraction copies found (not 4), incl. `download.ts`
    (moved into api.ts to break a would-be cycle; download.ts is a DOM leaf).
  - `calc/_clipfit.py` shared Lieber loop; bit-identity vs HEAD proven by
    exact `==` over 50 trials × 18 configs (fit step + init parameterized,
    never harmonized).
  - Calculators card kit hoisted to `calculators/shared.tsx` (−547 lines,
    10 tabs + thinfilm migrated, SubstratesTab included; all ≤293 lines).
  - Legend parsers: forced delegation REJECTED (mixed dotted/plain input
    differs by design — regression-pinned); both parsers + the dotted probe
    now consume ONE `_iter_legend_entries` grammar walk.
  - Figure-page preview invalidation: `panelRenderInputs` store fingerprint
    (mirrors the export guard's reads) via `useShallow` effect dep; +3 tests.
  - `figures.py` 499 → 210 + `figure_layers.py` 333 (verbatim move, diffed).
  - `openInGraphBuilder` UX call: precedent REJECTED (contradicted the
    item-15 "books never move the plot" directive) — the builder now BINDS
    to its seed's dataset; `setActive` plot intent fires at sendToStage.

- ~~**#7 Lake Shore registration**~~ (2026-07-11) — preamble sniffer
  (first 2KB contains "Lake Shore"), .csv chain after SIMS + .dat chain
  after QD/refl1d/PPMS; corpus sweep = exactly 1 claim (the fixture),
  parser matrix green, zero real-file routing changes.

- ~~**#1 Decompose App.tsx + ThinFilmTab.tsx**~~ (2026-07-11) — App.tsx
  960 -> 74 (appCommands.ts registry + useGlobalShortcuts + AppOverlays),
  ThinFilmTab 441 -> 40 (workshop split); GRANDFATHERED component pins
  ratcheted to ZERO (mechanism kept); verbatim-move diff proofs; the two
  ?raw source-scanning tests repointed with intent preserved.
- ~~**#2 useApp window slice**~~ (2026-07-11) — 22 window actions + MDI
  state -> store/windows.ts (750) as a composed Zustand slice, ONE store
  instance so every selector survives; useApp 3,960 -> ~3,290; NEW
  store-size ratchet added (pin recalibrated to the Wave-A-merged
  baseline 3287); #50 row-state allowlist untouched.

- ~~**#6 Defaults-audit residuals**~~ (2026-07-11) — DPI-preset sync
  verified ALREADY SHIPPED in `useFigureBuilder.ts` (audit-referencing
  comment; the new figure-page workshop carries the same convention).
  Interactive-side shots generated via `tools/visual/`
  (`spec-defaults-audit.json` → `out-defaults-audit/`: linear default,
  log decades, rich-text labels — the last also visually verified GOTO
  #5 on the real uPlot canvas). The EYEBALL on these + DEFAULTS_AUDIT.md
  taste calls remains the owner gate above.

- ~~**#3 Worksheet column widths**~~ (2026-07-11) — variable widths via
  gridwindow prefix-sum + binary search (uniform fast path kept),
  header-edge drag + double-click autofit; session-only state (the .dwk
  persistence owner gate respected); resize perf case added.
- ~~**#4 Selection → Graph Builder**~~ (2026-07-11) — designation-aware
  `selectionToSpec` + one-shot store seed; toolbar button + context
  menu; rows via the rowstate chokepoint (allowlist untouched).
- ~~**#5 .otp template import (frontend)**~~ (2026-07-11) —
  `lib/originTemplate.ts` upload client → tagged, never-clobber entries
  in the graph-templates store; File-menu command.

- ~~**Fold-up restructure**~~ (2026-07-10) — created this root plan;
  absorbed the open residue of MULTI_PLOT, WORKSHEET,
  PROJECT_ORGANIZATION, GAP_TIER3, GAP_ECOSYSTEM, ORIGIN_GAP (six plans,
  ≤3 open items each) and archived them; PORT_PLAN / PORT_CHECKLIST /
  GOTO_PLAN / ORIGIN_FILE_DECODE_PLAN became declared sub-plans.
