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

*(items 9–11 booked from the 2026-07-11 Origin-parity surface audit)*

~~9. **Undo/redo stack**~~ COMPLETED 2026-07-11 (see Completed).

~~10. **Re-import from source file**~~ COMPLETED 2026-07-11 (see Completed).

## Tier 2 — Medium Impact

12. **Reciprocal (Arrhenius) axis scale** — 1/x axis option beyond
    linear/log (transport/relaxation figures; pairs with the shipped
    VFT/Arrhenius calc in `calc/relaxation.py`).

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
