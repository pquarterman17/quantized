# RSM Sector Cuts & Box Integrations

Sector/annulus integration, azimuthal (chi) profiles, radial/transverse
cuts through a reciprocal-lattice point, honest fixed-Qx/Qz line cuts, and
a draw-then-drag box ROI with LIVE preview and one-click commit, for
3-axis XRD maps (PANalytical `.xrdml` area scans: 2θ × ω × intensity).
The MATLAB reference (`+bosonPlotter/extract2DArcIntegral.m` + the blind
numeric dialog `onArcIntButton.m`) is the behavioural floor, not the
target: MATLAB has no visual ROI, no chi profile, no box integration —
and its Q-space line cut shares the defect item 2 fixes here. The
deliverable of every operation is a 1-D `DataStruct` landing in the
library (plots, fits, exports like any scan) plus the summary scalars
(∫I, centroid, peak position) a user pastes into a paper; batch apply
additionally yields a summary table and a single overlaid figure.

**Status:** Active
**Parent:** MAIN_PLAN.md
**Created:** 2026-08-09
**Updated:** 2026-08-09 (rev 5 — item 10 closed: realdata smoke test
(`tests/test_api_rsm_realdata.py`) + physics docs + bookkeeping
(registered in MAIN_PLAN.md's plan tree + BACKLOG.md; PORT_CHECKLIST.md
gains MATLAB bug #6, `+fitting/rsmStrain.m`'s near-degenerate-Qx guard
gap). Build phase complete: every item except the owner-gated #11 and the
Tier 3 #12–14 residuals is now struck. Prior revisions: rev 4 — items
1/4/16 shipped and struck; adds
item 17, the aspect-ratio defect that turned out to be the real cause of the
owner's reported plotting problem, and item 18, the dataset-handle cache,
which supersedes Tier 3 item 15; rev 3 — added item 16; rev 2 — owner scoping answers + the Q-space
line-cut bug folded in BEFORE execution started; item numbering was
rebuilt in this revision, nothing had shipped)

---

## Context

### How the pieces fit together

Backend (pure `calc/`, thin `routes/`, both ratcheted at 500 lines):

- `src/quantized/calc/linecut.py` (269) — H/V cuts, segment cuts,
  projections. Its private helpers `_full_grids` / `_require_q` /
  `_cut_result` (+ the scatter-column block inline in `cut_segment`) are
  exactly what the new modules need — item 1 promotes them into a shared
  internal module `calc/_rsm_grid.py` so all cut families use ONE grid
  reshape and ONE result assembler. **Its `space="q"` path is BROKEN
  today** (see Resolved decisions, FINDING 1) — item 2 fixes it.
- `src/quantized/routes/rsm.py` (136) — the `/api/rsm` router; the thin
  adapter idiom (pydantic model → `DataStruct.from_dict` → calc →
  `datastruct_payload`; `ValueError|KeyError|IndexError` → 422). FOUR new
  endpoints land here (`/sector`, `/chi-profile`, `/box`, `/box-stats`);
  rotation and periodic-axis support ride as FIELDS on `/box` +
  `/box-stats`, not extra endpoints. Final estimate ~266 lines — no
  router split needed.
- `src/quantized/io/xrdml.py` — already emits `metadata.is2D`,
  `map_shape`, `axis1_name`, `Qx`/`Qz` when wavelength is known. Pole
  figures (`xrayutilities_polefig_point.xrdml`, 91×1199) arrive
  `is2D=True` with NO Q columns — the polar-space rule below covers
  them. NO io changes in this plan.

Frontend (`.tsx` ceiling 400; pinned `.ts` modules in
`frontend/src/architecture.test.ts` — pins only ratchet DOWN):

- `components/Stage/MapStage.tsx` (385/400) — CANNOT absorb the feature;
  item 6 extracts its float toolbar to `MapToolbar.tsx` (≈−145) to pay
  for the ROI wiring.
- `components/Stage/mapRender.ts` (376) — owns `hitTest` (px→data);
  item 4 adds the inverse `dataToPx` BESIDE it (shared `plotRect`, can't
  drift — the `lib/shapeHit.ts` argument).
- `lib/mapcuts.ts` + `Stage/useMapCuts.ts` — the purity split to copy.
- Reuse, don't reinvent: `lib/shapeHit.ts` (segment/rect primitives),
  `lib/gestureCancel.ts` (Esc-abort registry), `lib/regionSelect.ts`,
  `lib/plotdata.ts` (the offline-client-math precedent the preview
  design leans on), `lib/plotSelectedTogether.ts` (batch overlay figure),
  `workshops/tabulate/TabulateTable.tsx` (presentational table) +
  `lib/download.ts::saveBlob` (CSV export).
- `lib/api.ts` is PINNED (1828) — new wrappers go in NEW `lib/api/rsm.ts`
  per api.ts's own pin comment; api.ts is not touched.
- `store/useApp.ts` is PINNED (2868, zero slack) — the new
  `store/rois.ts` slice pays for its composition lines by relocating
  `rsmPeaks`/`setRsmPeaks` into it (cohesive: RSM map-overlay state).
- Workshop pattern: `components/workshops/rsm/` (panel 125 + hook 123 +
  mocked hook test) is the template for `workshops/roicuts/`.
  Registration: `AppOverlays.tsx` + `commands/analysisCommands.ts`.

### Data / control flow

```
draw/drag box on map ──► useMapRoi ──► store.mapRoi (RoiRect, data coords)
type exact bounds ─────► RoiCutsPanel fields ─► store.mapRoi (same field = in sync)
peak-anchored action ──► ruler from rsm_analyze peak ─► store.mapRuler
        │
        ├─ every rAF while dragging ─► lib/roiMath.ts (CLIENT, typed arrays over
        │                              the loaded DataStruct columns) ─► sparkline
        │                              in the inline bar — "preview", never lands
        │
        └─ ONE click on the inline bar (∫x / ∫y / Stats) or panel Run ─► BACKEND:
              POST /api/rsm/box · /box-stats (angle, wrap) · /sector · /chi-profile
              calc.boxcut / calc.sectorcut  (calc.linecut for H/V + segment tools)
                     │
                     ▼
       1-D DataStruct (Intensity + "N points") with cut_label + ROI provenance
                     └─► addDataset → library → plot / fit / export
   batch over selectedIds ─► N prefixed cuts ─► lib/plotSelectedTogether(ids)
                          └─► per-dataset /box-stats ─► TabulateTable + saveBlob CSV
   parity: tools/freeze_roi_preview_fixture.py ─► roiMath.golden.json ─► asserted
   by BOTH pytest (backend == fixture) and vitest (roiMath == fixture)
```

### Resolved decisions

Original (2026-08-09, rev 1 — still standing unless amended below):

- **Module split (backend):** `calc/_rsm_grid.py` (shared internals from
  linecut.py), `calc/sectorcut.py` (polar family), `calc/boxcut.py`
  (Cartesian family + stats). Growing linecut.py to ~700 was rejected
  (500 ceiling; distinct cohesive families).
- **Wrap handling:** MATLAB's three-branch sector mask replaced by one
  rebase: `span = ((max−min) mod 360) or 360; a' = (a−min) mod 360;
  mask = a' < span`. One formula for sector masks, chi binning domains,
  AND the pole-figure periodic axis. Tests assert equivalence to the
  MATLAB branches on wrap and non-wrap sectors.
- **Dual sector parameterization at the boundary:** calc takes canonical
  `phi_min/phi_max`; pydantic also accepts `phi_center/phi_halfwidth`
  (mutually exclusive, 422 if both pairs, full circle if neither).
- **Counts column everywhere:** binned profiles return
  `labels=["Intensity","N points"]` — see the corrected uncertainty
  statement below (rev 2).
- **Box = exact on angular grids, mask+bin in Q / scattered:** angular
  grids are axis-aligned (exact line selection); Q grids are curvilinear,
  so mask + `scipy.stats.binned_statistic` is the honest reduction there.
- **ROI is a first-class named definition** in `store/rois.ts`
  (`mapRoi` working box + `savedRois`); deliberately NOT cleared by
  `focusTransientReset` — survival across dataset switches IS the
  repeat-across-datasets feature (and windows.ts is pinned at 749).
- **ROI keeps the space it was drawn in**; no silent angular⇄Q
  conversion; overlay hides on axis-space mismatch; batch skips
  space-ineligible datasets.
- **`architecture.test.ts` must not change.** No pins raised, none
  added. A task editing that file is the ratchet demanding a bigger
  extraction.

Revised 2026-08-09 (rev 2 — owner answers + verification findings):

- **FINDING 1 (verified, blocking): `line_cut(space="q")` ships wrong
  answers today.** It selects a whole detector row/column by nearest
  MEAN Qz/Qx and returns it labelled "fixed Q" — but Q grids are
  curvilinear: on the real corpus one "fixed-Qz" row sweeps 79–99% of
  the map's whole Qz range (epytaxy 98.1%, pixcel 98.8%, test_area
  79.1%). The angular path is correct (rows ARE constant-ω) and stays
  byte-identical. Fix (item 2): the Q path becomes a perpendicular band
  mask + bin over the scattered cloud — the same treatment the box's Q
  path uses. Public signature unchanged. This is the CLAUDE.md
  "golden-freeze ERROR is often a real source bug" lesson striking
  again: the sibling `Quantized_matlab/+bosonPlotter/extract2DLineCut.m`
  has the IDENTICAL defect (verified: `meanQz = mean(map.Qz,2);
  min(abs(meanQz − clickY))` → returns the whole curvilinear row) and
  the port replicated it faithfully. Per sibling-repo-first: item 2
  REPORTS the sibling bug (PORT_CHECKLIST note + task summary for the
  owner); fixing MATLAB is deliberate separate work, never silent.
- **Live preview is CLIENT-SIDE math, not a dataset-handle cache.**
  FINDING 2 rules out per-drag-frame round-trips (m3learning is 465,885
  points × 5 cols — multi-MB JSON per request). The
  `routes/_uploadcache.py`/`_bookcache.py` handle-cache precedent was
  considered and REJECTED for the preview: even with the payload
  amortized, a drag frame would still pay HTTP latency jitter at ~60 Hz,
  it adds server-side session state for a purely visual affordance, and
  it breaks the repo's offline-fallback model (`lib/plotdata.ts`: the UI
  and tests run without a backend). Chosen: `lib/roiMath.ts` — one pure
  TS module mirroring the COMMIT semantics (box grid path, box cloud
  path incl. angle + wrap, sector, chi) over the already-loaded
  DataStruct columns. Drift mitigation, all three mandatory: (a) the
  preview is labelled "preview", drawn only in the inline bar/panel, and
  NEVER lands in the library — commits always come from the backend;
  (b) a frozen parity fixture (`frontend/src/lib/roiMath.golden.json`,
  generated once by `tools/freeze_roi_preview_fixture.py` from the
  backend on a small synthetic map whose input columns are INSIDE the
  fixture) is asserted by BOTH pytest (backend reproduces it — staleness
  guard) and vitest (roiMath matches it, rtol 1e-9 — same float64 math);
  (c) roiMath is the ONLY client implementation — the sparkline, the
  inline stats readout, and the panel preview all call it. Throttling:
  rAF-coalesced (latest rect wins, at most one compute per frame),
  preview capped at ≤200 bins; a mask+bin pass over 465k Float64 points
  is single-digit ms. Escalation path if commit latency on huge maps
  ever hurts: the handle cache for COMMITS only (Tier 3 note, not now).
- **Rotated cuts (owner answer 2.2, promoted Tier 3 → Tier 1): the
  primitive is a CUT RULER** — `{cx, cy, angle, length, width}` — not a
  rotated rect with a rotation handle. Rationale: the epitaxial intent
  is "cut along/across this direction", which centre+angle+length+width
  states directly and repeats numerically; a rotation handle is the
  most expensive part of a rotated rect and serves no extra intent.
  Rendered as a rotated outline with two endpoint handles (length/angle)
  and two width handles. Backend: `box_cut`/`box_stats` gain optional
  `angle` (rotate coordinates about the ROI centre, then the EXISTING
  cloud mask+bin path applies verbatim — ~15 lines; the counts column
  and no-interpolation honesty come free). `cut_segment` (interpolating)
  remains the freehand segment tool; the ruler commits through
  `/box` — mask+bin, not interpolation. Peak-anchored flow: "Radial
  cut" / "Transverse cut" actions take a peak centre auto-filled from
  `rsm_analyze`'s substrate/film peaks (radial: angle = atan2(qz,qx);
  transverse: +90°; length default ±15% of |Q| about the peak, width
  default 3 grid cells) — the common case is ≤2 clicks.
- **Polar-space rule (owner answer 2.3 — replaces the blanket Q-only
  ban):** three branches, auto-detected default, always user-visible.
  (i) **Q pair available** → true polar in (Qx,Qz): `sector_profile` /
  `chi_profile` as specced (|Q|, azimuth about the reciprocal origin).
  (ii) **Native-polar axis pair** (pole figure: an azimuthal axis
  spanning ~360° — φ — against a tilt axis ψ/χ): the data IS polar
  natively, so no hypot/atan2 is ever needed — "azimuthal profile" =
  collapse onto φ within a ψ band and "radial profile" = collapse onto
  ψ within a φ range, i.e. the BOX machinery with a periodic axis:
  `box_cut`/`box_stats` gain `wrap: "x"|"y"|None` applying the mod-360
  rebase to that axis's bounds. Detection heuristic lives in
  `lib/roi.ts::polefigAxes` (axis name in {Phi,Psi,Chi} AND span ≥
  350°), surfaces as a pre-selected mode the user can see and override —
  never silent. (iii) **Generic incommensurate pair (2θ/ω)** → polar ops
  stay forbidden with the reason in the error: hypot(2θ, ω) mixes axes
  with different physical meanings; there is no radius. A generic
  centre-relative polar mode for arbitrary pairs was rejected — (i) and
  (ii) cover every real workflow named, and (iii) is where it would
  silently produce nonsense.
- **Uncertainty claim corrected (rev 1 overclaimed):** "N points" does
  NOT give √N error bars. For SUMMED raw counts the Poisson error is
  σ = √(ΣI) — computable from the Intensity column itself; N is the
  pixel count per bin, kept because it is what mean-normalization needs
  and what flags under-sampled bins (N=0 → NaN already; small N →
  unreliable). XRDML intensities are often cps, not raw counts (a
  counting time lives in the file metadata), and √I is NOT valid for
  cps. Therefore: no σ column is emitted; docstrings state "σ = √(ΣI)
  is defensible only when the intensity unit is raw counts — check
  `units`; for cps, scale by counting time first", and the N column's
  actual purposes are named. Honest and cheap beats wrong-by-default.
- **Live preview + inline commit (owner answer 1):** the panel is never
  required to get a cut. While a box/ruler exists, a floating inline
  bar (HTML `qzk-glass` div positioned from `rectToPx` — NOT inside the
  pointer-transparent SVG) pins to the ROI: a ≤200-bin sparkline
  (roiMath, "preview" label, x/y toggle), live n-points/∫I readout, and
  ∫x / ∫y / Stats buttons that commit via the backend in ONE click.
  The panel remains the numeric setup, sector fields, saved-ROI and
  batch surface. Sector preview: the wedge outline on the map (Q axes
  displayed) + a sparkline in the panel's sector card.
- **Batch artifacts (owner answer 3) map onto EXISTING surfaces:** the
  floor is "make cut, plot line" and it is the default. (b) N cuts land
  name-prefixed via the shared landing helper; (c) "plot together" =
  `lib/plotSelectedTogether.ts::plotSelectedTogether(ids)` (the exact
  function the Plot menu and context actions already share) called with
  the new cut ids — legend/axes come free, zero new plotting code;
  (b)+(c) is one checkbox ("plot results together", default ON). (a)
  the summary table = one `/box-stats` call per dataset rendered with
  `workshops/tabulate/TabulateTable.tsx` (presentational — reused, not
  forked) in the batch results card, exported via
  `lib/download.ts::saveBlob` as CSV. No new table widget, no new
  overlay-figure path.
- **Interaction budget (owner "easy and often" check):** box→profile:
  arm ▭, drag, click ∫x = 3 actions. Fixed Qx/Qz cut: arm H/V, click =
  2. Radial/transverse about a peak (after analyze): action button,
  pick peak (0 clicks when film-peak default holds) = ≤2. Arc/annulus:
  open panel, adjust prefilled q-range, Run = 3 (defaults: full circle,
  q-range from data, bins from map_shape). Pole-figure azimuthal: ▭
  band + inline ∫ = 3, or panel button = ≤3. Nothing exceeds 3.
- **Numbering rebuilt in rev 2** (nothing had shipped); rev-1 item
  numbers are void. Rotated cuts moved Tier 3 → Tier 1 (item 7); batch
  grew from a hook action into item 9; the line-cut fix (item 2) and
  the parity harness (item 5) are new.

Revised 2026-08-09 (rev 3 — owner-reported Q-space plotting defect):

- **Item 16 booked and put FIRST in merge order** (appended number, so
  items 1–15 keep their already-delegated IDs). Owner: "the Qx and Qz
  selection did not work great, seemed like plotting that way was a
  struggle." Verified: the viewer's default gridding method makes a
  Q-space map take **19.34 s** vs **0.34 s** for `linear` — 57×, same
  NaN pattern, 1e-5 % median difference. Item 6's live-preview box
  cannot be built over that, so 16 blocks 6.
- **Gridding default: auto-select by size / regular-grid detection**
  (owner decision) — not a blanket switch to `linear`, and not
  caching-only. `natural` survives for small clouds and as an explicit
  Inspector override; MATLAB parity is untouched because the golden
  case pins `interpolate2d(method="natural")` directly, not the default.
- **The client fallback keeps existing but must announce itself**, and
  may honour `mapRes` only up to a cap (~120) — its `O(nx·ny·N)` brute
  force is bounded solely by its small grid, so an uncapped 200×200 over
  465,885 points is a worse freeze than the bug being fixed.
- **Cancellation, not a timeout** — a deadline would kill a slow-but-
  working backend; the actual defect is a superseded request that keeps
  computing. `postJSON` already accepts a signal (`lib/api/http.ts:17`).
- **The 33–44 % NaN coverage in Q space is correct** and must not be
  "fixed": a rectangular ω/2θ mesh is a curved fan in reciprocal space.

### Dependency map

- Items 1 and 4 are independent — start both immediately in parallel
  worktrees (Lane A backend, Lane B frontend).
- Item 2 (linecut fix) and item 3 (box) both require item 1 merged;
  2 ∥ 3 (disjoint files: 2 owns linecut.py + test_calc_linecut.py;
  3 owns boxcut.py + routes/rsm.py + test_api_rsm.py).
- Item 5 (parity harness) requires 3 (backend semantics) and 4 (types).
- Item 6 requires 4 + 5; item 7 requires 6 (same MapStage/overlay
  files — serialize). Item 8 requires 4; 8 ∥ 6/7 (disjoint files).
- Item 9 requires 8 (panel) + 3 (box-stats). Item 10 requires 1–9.
- Conflict magnets, single-owner rule: `routes/rsm.py` +
  `tests/test_api_rsm.py` (items 1→3 serialize), `calc/linecut.py`
  (1→2), `MapStage.tsx`/`MapRoiOverlay.tsx` (6→7), `store/useApp.ts`
  (4 only), `AppOverlays.tsx`/`analysisCommands.ts` (8 only).

---

## Tier 2 — Medium Impact

24. **Wall-clock test assertions flake under load — a CLASS, not two
    incidents** (booked rev 9, 2026-08-09). Three separate timing-based
    frontend/backend tests went red during this session's merges, every one
    of them passing in isolation immediately after:
    - `test_calc_map.py::test_auto_qspace_map_builds_fast_on_real_corpus`
      — MY fault, I specified a 2 s wall-clock bound in item 16. Already
      fixed: it now asserts the RESOLVED METHOD (deterministic at any load)
      and keeps the clock only as a loose 8 s backstop.
    - `useFigureBuilder.test.ts` F2.4b parity (item 22, being diagnosed).
    - `GridViewport.perf.test.tsx` "bounded DOM node count and a generous
      time budget" (from `feat(ci)`, 2026-07-25) — failed under three
      concurrent agents, passed 4/4 alone 30 s later.
    The common shape: a wall-clock budget calibrated on an idle machine,
    then run on a 6-way shared-runner CI matrix or a loaded dev box. Each
    looks like a one-off; together they are a habit.
    - [ ] Sweep for wall-clock assertions across both suites (grep
      `perf_counter`, `Date.now`, `performance.now`, `elapsed`, `budget`).
    - [ ] For each, split the load-INVARIANT claim from the timing one and
      assert the invariant: node counts, chosen algorithm, complexity
      class. Keep a clock only as a loose backstop against a
      order-of-magnitude regression, never as a benchmark.
    - [ ] The item-16 fix is the worked example of the pattern — copy it.
    - Not blocking; these are green on CI today (which runs less
      concurrently than this session did).

22. **Intermittent frontend flake: `useFigureBuilder` F2.4b parity**
    (booked rev 7, 2026-08-09; found by the orchestrator's post-merge gate,
    NOT caused by this plan's work). `useFigureBuilder.test.ts > direct
    manipulation parity (F2.4b) > Apply commits legend drag, annotation
    drag, and title/xlabel/ylabel edits...` failed once in a full
    `npx vitest run` (1 of 5898), then passed on an immediate re-run of the
    identical tree, and passed 3/3 when run together with the roicuts
    suites that merged alongside it. So: not deterministic, not an
    ordering conflict with the new tests — an intermittent failure under
    full-suite parallel worker load.
    - Provenance: the test belongs to `feat(figure): F2.4b
      direct-manipulation parity` (2026-08-05), predating this plan.
    - [ ] Reproduce with `--no-file-parallelism` and with a repeat count to
      establish the rate before changing anything; a flake diagnosed from
      one observation usually gets "fixed" by hiding it.
    - [ ] Suspect shared module/store state that survives between workers,
      or a timing assumption in the Apply→document commit path.
    - Not blocking this plan; recorded so it is not rediscovered as "the
      RSM work broke the figure builder".

## Tier 3 — Nice-to-Have

12. **Draggable sector wedge** — radial handles on the qMin/qMax arcs +
    angular handles on the wedge edges, same gesture machine. Numeric +
    live preview must prove insufficient first.

## Completed

- ~~**#13 Named-ROI workspace persistence**~~ (2026-08-09) — precondition met
  the honest way: `workspace.ts` was at 753/754 (one line of slack), so
  `mergeWorkspace` + `WorkspaceMergeResult` (~144 lines, one caller) were
  extracted verbatim to `lib/workspaceMerge.ts` and re-exported, dropping it
  754 → 616 BEFORE any feature code, as its own commit with the pin lowered in
  the same change. Feature then took it to 632 — still 120 under the original.
  `serializeRois`/`deserializeRois` live in `store/rois.ts`, mirroring
  `lib/plotspec.ts::sanitizeSavedPlotSpecs`. A corrupt entry is skipped and
  named in `migrationWarnings`, never throws; a pre-item-13 `.dwk` loads to an
  empty list (both proven by test). **Decision:** only NAMED `savedRois`
  persist — `mapRoi`/`mapRuler` are working scratch with no dataset binding to
  validate on reload, so restoring raw geometry onto whatever map happened to
  be active risked showing a box drawn against different axes. Same reasoning
  the Graph Builder already applies to unsaved specs.
- ~~**#14 Migrate `rsm*` wrappers to `lib/api/rsm.ts`**~~ (2026-08-09) — five
  moved (`analyzeRsm`, `rsmStrain`, `rsmLinecut`, `rsmCutSegment`,
  `rsmProjection`); `lib/api.ts` 1782 → 1724 with the pin ratcheted to 1725,
  `lib/api/rsm.ts` 132 → 187 (under the 500 ceiling). **No compatibility
  re-exports left** — those would have kept the pin high and defeated the
  point. 4 import sites updated including two `vi.mock` paths. Done on Haiku.

- ~~**#11 Golden parity for `sector_profile`**~~ (2026-08-09) — **SKIPPED by
  owner decision**, not completed. Would need a local MATLAB run to freeze
  reference values from `extract2DArcIntegral.m`. The port's correctness rests
  instead on the planted-Gaussian round-trip (recovers |Q| and phi within one
  bin) plus the hand-derived wrap-equivalence truth table asserting the single
  rebase formula matches MATLAB's three branches. Reopen only if a sector
  discrepancy ever surfaces; do not freeze late/tired, since a bad reference
  value silently becomes the thing everything downstream "passes" against.
- ~~**MATLAB sibling `rsmStrain.m` guard**~~ (2026-08-09) — merged to
  `Quantized_matlab` main: same `|Qx|/|Qz| < tan(0.1 deg)` criterion as the
  Python fix (#23), `.warnings` string array added, docstring updated. Freeze
  case verified unaffected (substrate 1.28%, film 0.88% — clearing by 7.3x and
  5.1x), so a future re-freeze stays consistent across the two repos. All 11
  tests in `test_rsmAnalyze.m` pass headless.

- ~~**#10 Integration, realdata smoke, physics docs, bookkeeping**~~
  (2026-08-09) — the plan's serial closing item, delivered in two halves.
  **Physics docs** (already shipped, prior session): `docs/theory/xrd.md`
  gained the sector/chi/box math, the polar-space rule, and the counting-
  statistics caveat; `docs/tutorials/rsm-analysis-workflow.md` walks the
  full workflow. **This pass ships the rest.** Realdata smoke: new
  `tests/test_api_rsm_realdata.py` (`@pytest.mark.realdata`, skips cleanly
  without `../test-data`, uses conftest's worktree-depth-safe
  `_resolve_test_data_corpus`/`corpus_dir`) drives the real HTTP layer via
  `TestClient` on `epytaxy_rsm.xrdml` (sector full-annulus + phi-center/
  half-width + zero-half-width 422; chi-profile; box around the bright Q
  peak plain + rotated; box-stats; the item-2 Q-space linecut band) and
  `xrayutilities_polefig_point.xrdml` (box `wrap="x"` labelling Phi; sector
  422 naming the missing Qx/Qz). Assertions check MEANING, not just status:
  the sector profile's binned peak matches the raw brightest pixel's own
  |Q| (~4.827 Ang^-1) within 2 bins, the chi profile's peak azimuth matches
  its own phi (~90 deg) within 2 bins, box_stats' centroid lands within 3
  grid spacings of its own peak, and the Q-space linecut band stays <10% of
  the map's Qz range (item 2's own acceptance check, repeated here on the
  real corpus) — every expected numeric value is derived from the parsed
  corpus file at test time, never transcribed. 10 new tests, all green;
  full gate clean (`ruff check src tests`, `mypy src`, `pytest -q` 3702
  passed/184 skipped/9 xfailed). Deliverable check: not re-run fresh in
  this pass (out of this session's backend-only scope) — already covered
  by items 6/7/8/9's own Completed entries, each of which independently
  verified its entry point (inline-bar commit, peak-anchored ruler, panel
  numeric-only, batch floor) lands a plottable/fittable/exportable library
  dataset carrying re-applicable ROI/sector provenance. Bookkeeping: this
  plan registered in `MAIN_PLAN.md`'s plan tree and `BACKLOG.md` (rows for
  open items #11, #12–14, #22); `PORT_CHECKLIST.md`'s RSM row gains
  **MATLAB bug #6** — `+fitting/rsmStrain.m` has the identical unguarded
  near-degenerate-Qx defect item 23 already fixed on the Python side
  (fabricated `eps_parallel = 80.9%` on `epytaxy_rsm.xrdml`'s near-
  symmetric pair) — reported only, per sibling-repo-first;
  `Quantized_matlab` was not touched.

- ~~**#20 Frontend `.ts` size ratchet**~~ (2026-08-09) — closes the gap the
  owner's own `size-ratchet-every-language` rule named and predicted. A general
  500-line `.ts` ceiling (matching the backend's) now sits beside the 400-line
  `.tsx` one in `architecture.test.ts`, with **17** current offenders pinned at
  exact size — `uplotOpts.ts` 1446 down to `statRender.ts` 527 — plus the
  graduation test that deletes a pin once a file drops under. No source file was
  touched: the mechanic is to RECORD today's reality, not improve it. Guard
  independently verified by the orchestrator, not just by the agent: appending
  520 lines to `lib/inset.ts` produced
  `./lib/inset.ts: 534 > 500 — extract a cohesive sibling (lib/api/http.ts,
  lib/api/stats.ts are templates); do NOT raise the pin`, and it went green again
  on revert. Implemented on Haiku (~78k tokens vs 250-380k for the Sonnet
  items) — a census plus a pin list is the shape that tier handles well.

- ~~**#23 `rsm_strain` symmetric-reflection guard**~~ (2026-08-09) — on
  `epytaxy_rsm.xrdml` `eps_parallel` went from a fabricated **0.8087 (80.9 %)**
  to `nan` plus a machine-readable warning. Criterion is a RATIO guard,
  `|Qx|/|Qz| < tan(0.1 deg) ~= 1.745e-3` on either peak — chosen over an
  FWHM criterion because `rsm_strain` takes only centres and widths would
  ripple into routes + frontend. The threshold was bounded numerically before
  being picked, not reverse-engineered: ~10x above the real-data noise floor
  (~1e-4) and ~5-7x below the repo's own golden asymmetric fixtures
  (0.88-1.3 %), so golden stayed green (155). **The MATLAB sibling
  `+fitting/rsmStrain.m` carries the identical `Qx == 0`-only check** — same
  latent bug, reported not fixed, per sibling-repo policy. Panel now shows
  "not measurable" with the reason on hover, reusing the disabled-with-reason
  idiom item 7 established in the same panel rather than inventing a second.

- ~~**#23 `rsm_strain` returns nonsense on symmetric reflections, silently**~~
  (2026-08-09) — `calc/rsm.py` now guards `eps_parallel` on
  `|Qx|/|Qz| < tan(0.1°) ≈ 1.745e-3` for EITHER peak, not only exact
  `Qx == 0`: ~10x above the fit-noise floor measured on
  `epytaxy_rsm.xrdml` (~1e-4), ~5–7x below the repo's own golden
  asymmetric-reflection fixture (~0.9–1.3%) — chosen on physical grounds
  (a genuinely asymmetric reflection sits several tenths of a degree or
  more off-normal), not reverse-engineered from either dataset, and
  confirmed to leave `pytest -m golden -q` fully green (155 passed).
  `epytaxy_rsm.xrdml`'s substrate/film pair now returns `eps_parallel =
  NaN` (was the fabricated 80.9%) plus a new `warnings: list[str]` field
  (matches the `magnetometry.py` convention) explaining why. Confirmed
  the MATLAB sibling (`+fitting/rsmStrain.m`) has the identical
  unguarded `Qx == 0`-only check — a latent bug there too, left
  untouched per policy (fix `quantized_matlab` only deliberately, never
  as a side effect). `RsmPanel.tsx`: `eps_parallel` shows "not
  measurable" instead of a bare dash, with the reason on `title` —
  reused item 7's disabled-with-reason-on-hover idiom (landed on `main`
  mid-task) rather than adding a second way of explaining a blank/
  disabled value. Regression test against the real fitted peaks
  (`@pytest.mark.realdata`, `corpus_dir` fixture), a synthetic
  near-degenerate case mirroring the real numbers, and a genuinely
  asymmetric case proving the guard doesn't over-trigger. Theory doc and
  tutorial's worked example updated to the corrected output. Full gate
  green: ruff, mypy (255 files), 3692 backend tests + 155 golden, 5952
  frontend tests, build clean.

- ~~**#7 Cut ruler — radial/transverse cuts about a peak**~~ (2026-08-09) — the
  epitaxial pair, at **1 click** from a found peak (target was ≤2). New
  `Stage/useMapRuler.ts` (346) mirrors the box gesture machine; endpoint handles
  are the sole rotate affordance (drag lengthens + rotates), width handles
  resize symmetrically, Esc aborts through the shared `gestureCancel` registry.
  Box and ruler are mutually exclusive working shapes — drawing either retires
  the other. Peak-anchored actions live in `workshops/rsm/RsmPanel.tsx` (not the
  ROI panel) because that panel already lists every fitted peak with its
  classification, so the action needs no canvas machinery — a Q-centre plus the
  new pure `lib/rsmPeakCut.ts` shapes the request directly. Labels distinguish
  the physics: `"Radial cut — film peak (rank 2)"` /
  `"Transverse cut — substrate peak (rank 1)"`. Disabled-with-reason when there
  are no Q columns, no peaks, or no finite Q centre. Reused
  `cellSize`/`pxToData`/`boxColsFor` from `useMapRoi.ts` rather than
  duplicating. `MapStage.tsx` hit 404 mid-work and was brought back under the
  ceiling by extracting `mapToolArming.ts` (63) — the ratchet doing its job
  again. 407 files / 5950 tests green, `architecture.test.ts` zero-diff.

- ~~**#6 Map interaction — draw / drag / resize / live preview / inline commit**~~
  (2026-08-09) — THE owner's original ask, delivered. Ceiling paid first as its
  own commit: toolbar extracted to `MapToolbar.tsx` (239), `MapStage.tsx`
  396→281 BEFORE any ROI code, 364 after. `useMapRoi.ts` (349, 15 tests) holds
  the gesture machine; `MapRoiOverlay.tsx` (250) draws rect + 8 handles +
  sparkline + inline bar. **Draw→cut is 2 steady-state actions** (drag, then
  click ∫x/∫y); arming ▭ is once per session, not per box. Esc restores the
  exact pre-gesture rect via `gestureCancel` (3 tests, incl. a hidden-space
  rect). Preview is rAF-coalesced — a test asserts 3 rapid rect updates produce
  exactly ONE `boxProfileLocal` call, with the final not the stale rect. A test
  performs a full draw/drag/release and asserts the backend wrappers are never
  called, so the client preview provably cannot commit. Cut-width tooltip
  corrected for the Q-space band semantics item 2 introduced.
  `architecture.test.ts` zero-line diff.

- ~~**#9 Batch across datasets**~~ (2026-08-09) — new `useRoiBatch.ts`
  (287) + `BatchCard.tsx` (145), kept OUT of `useRoiCuts.ts` (still 476,
  unguarded — item 20) per the size-ratchet habit. `applyToSelected`
  sequentially applies the Box card's current ROI (+ its collapse/reduce/
  bins settings) to every `store.selectedIds` dataset, landing each
  `"<dataset>: "`-prefixed cut through the SAME `useCutLanding` path (the
  floor — always on, independent of either checkbox). "Plot together"
  (default ON) calls `lib/plotSelectedTogether.ts::plotSelectedTogether`
  with exactly the new ids (skipped below its own 2-dataset minimum, so a
  1-dataset batch never triggers a confusing toast). "Summary table"
  (default ON) runs one `/box-stats` per eligible dataset and builds a
  cross-dataset summary as its own `DataStruct` (data-contract rule, not an
  ad-hoc table) — dataset names carried via `metadata.origin_text_columns`
  (the same per-row-text convention `lib/barlayout.ts` already reads for
  category labels), landed in the library like any other dataset. The live
  preview reuses `TabulateTable.tsx` presentationally (not
  `lib/tabulate.ts`'s grouping engine — wrong tool, groups within one
  dataset): every metric is its own "group" column via `levelLabel`, never
  a value/StatKey pair, so no invented "mean"/"sum" sub-header appears over
  a number that isn't a statistic. Skip/error reasons are per-dataset and
  always named (never a bare count). A `useRef`-backed re-entrancy guard
  (not `useState` alone — a `useState` guard is stale until the next
  render, so two synchronous calls both pass it) makes "one batch at a
  time" actually hold, not just look like it holds from the disabled
  button. `land()` (`Stage/useCutLanding.ts`) widened to return the landed
  id (was `Promise<void>`) — backward compatible, existing `void land(...)`
  callers unaffected — so the batch can collect ids for
  `plotSelectedTogether` without a second landing implementation. 15 new
  tests in `useRoiBatch.test.ts`. `architecture.test.ts` untouched;
  `npx vitest run` (5898 passed) and `npm run build` both green.

- ~~**#21 Input hardening**~~ (2026-08-09) — one shared
  `_rsm_grid.require_finite(**params)` called from every public entry point, so
  all seven leaks now name the offending PARAMETER instead of blaming numpy or
  the data: `x_max=inf` no longer reports `cannot convert float NaN to integer`,
  `angle=inf` no longer `math domain error`, and NaN bounds no longer claim
  `box selects no data`. Zero-width sector keeps MATLAB's full-circle parity but
  the label now reads `FULL CIRCLE (phi_min == phi_max == 45 deg)`, and the
  route REJECTS `phi_halfwidth <= 0` outright — nobody types half-width 0
  meaning "integrate everything", and that spelling only became reachable when
  item 8 shipped centre ± half-width as the primary control. 13 new tests in
  `tests/test_calc_cut_hardening.py`, including a guard that wrapping sectors
  and rotated boxes still pass. Done by the orchestrator directly after the
  delegated agents hit the account session limit.

- ~~**#19 Pole-figure angular axes**~~ (2026-08-09) — `_rsm_grid.py` now
  resolves the angular pair through one shared helper: prefers
  `("2Theta", axis1_name)` when present (every RSM mesh, so byte-identical),
  else the dataset's own axis pair. Cuts carry the REAL axis names, so a pole
  figure is labelled `Phi`/`Psi` instead of being mislabelled `2Theta`. The
  leaked `tuple.index(x): x not in tuple` is replaced by a domain error naming
  the dataset's actual labels. Verified on main:
  `box_cut(space="angular", wrap="x")` over the 359.4° Phi axis of
  `xrayutilities_polefig_point.xrdml` returns 200 finite bins,
  `x_column_name="Phi"`. +290 test lines, ZERO deletions from existing test
  files. Salvaged and validated by the orchestrator after the agent hit a
  session limit mid-run with the work uncommitted.

- ~~**#5 Preview math + parity harness**~~ (2026-08-09) — `lib/roiMath.ts`
  (663) mirrors BOTH of `box_cut`'s paths (exact grid + cloud mask/bin with
  rotation and wrap), plus sector/chi. `tools/freeze_roi_preview_fixture.py`
  emits `roiMath.golden.json` (12 cases) asserted by BOTH pytest and vitest at
  **rtol 1e-9** — no loosened tolerance was needed. Red-then-green proven: a
  +1 bin-index shift reddened exactly the 4 cloud-path cases and left grid/stats
  green. Measured interactive at 465,885 points: box profile ~2.1 ms, stats
  ~2.7 ms (inside a 16 ms frame); sector/chi ~13.6/16.0 ms, documented honestly
  as not drag-driven in this design.
- ~~**#18 Dataset-handle cache**~~ (2026-08-09) — `routes/_datasetcache.py`
  (232) following the `_bookcache.py` precedent; handle rides in an
  `X-Dataset-Handle` response header so every existing response shape stays
  byte-identical. Hashing is server-side over decoded ndarray buffers (13.5 ms
  against the 1.15 s decode already paid); client-side hashing was measured and
  rejected because the frontend holds `number[][]`, not typed arrays. Client
  remembers handles in a `WeakMap` on the dataset object — zero hashing,
  self-evicting. **Measured: 660,995 B → 114 B on a repeat call (99.983%).**
  Bounded 16 entries / 256 MiB, LRU on either bound, lock-guarded, teardown on
  the FastAPI lifespan shutdown (never `atexit`). Eviction returns a clean 409
  the client transparently recovers from — proven on both sides.

- ~~**#8 ROI cuts workshop**~~ (2026-08-09) — `workshops/roicuts/`
  (`RoiCutsPanel` 47 + `BoxCard` 110 + `SectorCard` 94 + `SavedRoisCard` 73 +
  `Field` 38 + `useRoiCuts` 476), `Stage/useCutLanding.ts` (55) extracted from
  `useMapCuts` so one landing implementation serves every cut path. Registered
  in `AppOverlays.tsx` + `analysisCommands.ts`. Three-branch polar routing
  implemented as a pure exported `polarBranch()`. Interaction budget met:
  numeric box cut = 3 actions, sector = 3, repeat on another dataset = 2.
  `useApp.ts` 2860→2863 (pin 2868). Two follow-ups it surfaced are booked as
  items 19 (pole-figure path verified BROKEN downstream) and 20 (its own
  476-line hook is invisible to the ratchet).

- ~~**#3 Backend box ROI**~~ (2026-08-09) — `calc/boxcut.py` (453) with
  `box_cut` + `box_stats`; grid path exact in angular space, cloud mask+bin
  everywhere else (always in Q — the curvilinear-grid lesson from #2 applied
  by construction). `angle` rotates points about the ROI centre before masking
  (the cut-ruler primitive item 7 needs); `wrap="x"|"y"` reuses `_rsm_grid.
  wrap_mask` for pole figures. Routes `/box` + `/box-stats`, `routes/rsm.py`
  238→311. Verified after merge on `epytaxy_rsm`: box_stats centroid
  (0.0007, 4.8265) lands on the brightest point (-0.0001, 4.8274);
  `integrated_intensity` matches a direct numpy mask-sum exactly; provenance
  metadata carries roi/space/reduce/collapse/angle/wrap/n_bins/source, which is
  what makes the cut re-appliable and caption-able.

- ~~**#2 Fix `line_cut(space="q")`**~~ (2026-08-09) — Q path is now
  mask-and-bin over a real perpendicular band instead of nearest-mean row
  selection. Measured Qz spread of a "fixed-Qz" cut: epytaxy 98.1% → **0.93%**
  of the map range, pixcel 98.8% → **0.25%**; verified independently after
  merge. Q-space `width` is now a physical band half-width in Å⁻¹ (angular
  keeps line-averaging semantics), with the band actually applied recorded in
  `metadata.cut_width_used` and stated in the cut label. Regression test proven
  falsifiable: 5 of 6 new tests fail against pre-fix code. Angular path
  untouched. MATLAB origin recorded as bug #5 in `PORT_CHECKLIST.md`
  (`extract2DLineCut.m:40-42`); sibling repo deliberately not modified.
  **Follow-up for item 6/7:** `MapStage.tsx`'s width tooltip still says
  "average all lines within ±width/2", now imprecise for Q space.
- ~~**#17 Q-space equal-aspect lock**~~ (2026-08-09) — new pure
  `lib/mapAspect.ts` (`shouldLockAspect`, `fitAspectRect`, 15 tests);
  `plotRect` now takes the payload and letterboxes to the data's true aspect
  when both axis units match. Caught during implementation: 2Theta and Omega
  BOTH carry unit `"deg"`, so a naive same-unit rule would have locked the
  angular path too — the rule carves out angular units, justified because a
  degree of detector rotation and a degree of sample rotation are not the same
  displacement, while Qx/Qz genuinely are. `hitTest`/`dataToPx`/`draw` all
  share the one `plotRect` so they cannot drift; angular rect asserted
  byte-identical to before.

- ~~**#16 Q-space map render performance**~~ (2026-08-09) — `MapState.method`
  now defaults to `"auto"`, resolved in `build_map` via `_resolve_auto_method`
  (linear when ≥2000 points or `detect_regular_grid` fires, else natural):
  18.7 s → 0.34 s on the 102k-point pixcel file. Offline fallback capped at
  120×120 and no longer silent (returns `fallback:{reason,nx,ny}`);
  `AbortController` threaded through `fetchMap`→`mapSeries`→`postJSON` so
  channel switches cancel instead of racing. Golden untouched (155 passed).
  **Caveat recorded:** the store already set `mapMethod:"linear"` (88f052e4,
  2026-06-29), so the GUI was never on the 19 s path — this fixed the backend
  default for every other caller, NOT the owner-reported symptom. That symptom
  traced to the aspect-ratio defect, booked as #17.
- ~~**#1 Backend polar core**~~ (2026-08-09) — `calc/_rsm_grid.py` (191, shared
  `full_grids`/`require_q`/`cut_result`/`scatter_columns`/`wrap_mask`) +
  `calc/sectorcut.py` (281, `sector_profile` ports `extract2DArcIntegral.m`,
  `chi_profile` is new). `linecut.py` 269→199 with `tests/test_calc_linecut.py`
  untouched — proof the extraction was behaviour-neutral. Routes `/sector` and
  `/chi-profile` with dual φ parameterization. Planted-peak round-trip recovers
  |Q| and φ within one bin. Verified on real data post-merge: `epytaxy_rsm`
  peaks at |Q| 4.827 Å⁻¹, φ 88°.
- ~~**#4 Frontend foundations**~~ (2026-08-09) — `lib/roi.ts` (468, 58 tests:
  rect + ruler geometry, hit classification, cursors, drag/nudge, request
  shapers, `polefigAxes`, `radialRulerForPeak`), `lib/api/rsm.ts`,
  `mapRender.ts` gains exported `plotRect` + `dataToPx` with a round-trip test,
  `store/rois.ts` slice with `rsmPeaks` relocated out of `useApp.ts`
  (2859→2860, pin 2868). `architecture.test.ts` untouched. A required
  crossover test caught a real sign error in `applyRulerDrag` before commit.
