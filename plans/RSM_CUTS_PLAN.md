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
**Updated:** 2026-08-09 (rev 4 — items 1/4/16 shipped and struck; adds
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

## Tier 1 — High Impact

5. **Preview math + cross-boundary parity harness**
   Files: NEW `frontend/src/lib/roiMath.ts` + `roiMath.test.ts` +
   `roiMath.golden.test.ts`, NEW `tools/freeze_roi_preview_fixture.py`,
   NEW committed `frontend/src/lib/roiMath.golden.json`, NEW
   `tests/test_roi_preview_fixture.py`. Depends on items 3 (semantics
   frozen in code) and 4 (types).
   - [ ] `roiMath.ts` — pure, typed-array-friendly mirrors of the
         COMMIT semantics, and the ONLY client implementation:
         `boxProfileLocal(cols, rect, {collapse, reduce, nBins, angle?,
         wrap?})`, `boxStatsLocal(cols, rect, {angle?, wrap?})`,
         `sectorProfileLocal(cols, {qMin,qMax,phiMin,phiMax,nBins,mode})`,
         `chiProfileLocal(...)`, plus the same mod-360 rebase helper
         (mirroring `_rsm_grid.wrap_mask`). `cols` = the caller-picked
         coordinate/intensity columns (mirrors `scatter_columns`).
         Behavioural unit tests independent of the fixture (wrap, empty
         bin → NaN, rotation).
   - [ ] `tools/freeze_roi_preview_fixture.py`: builds a SMALL synthetic
         map (~24×32) via `tests/fixtures/synthetic_rsm.py`, runs the
         backend calc for a case matrix (box grid/cloud × sum/mean/max,
         rotated ruler, wrapped band, sector, chi), writes
         `roiMath.golden.json` containing the INPUT COLUMNS and the
         outputs (inputs inside the fixture = both sides consume
         identical arrays; backend is the truth).
   - [ ] Parity assertions BOTH sides: pytest rebuilds the DataStruct
         from the fixture's inputs and asserts calc reproduces the
         frozen outputs (staleness guard — fails when semantics change
         without re-freezing); vitest feeds the same arrays to roiMath
         and asserts rtol 1e-9.
   - Acceptance: `uv run pytest tests/test_roi_preview_fixture.py -q &&
     cd frontend && npx vitest run src/lib/roiMath.test.ts
     src/lib/roiMath.golden.test.ts`

6. **Map interaction — box draw/move/resize, live preview, inline
   commit** ⚠ STRONGER MODEL (MapStage extraction churn + the gesture
   state machine + preview/commit/cut-tool interleaving on one canvas).
   Files: EDIT `frontend/src/components/Stage/MapStage.tsx`, NEW
   `Stage/MapToolbar.tsx`, NEW `Stage/MapRoiOverlay.tsx`, NEW
   `Stage/useMapRoi.ts` (+ test), NEW `Stage/useCutLanding.ts`, EDIT
   `Stage/useMapCuts.ts`. Depends on items 4 + 5. Sole owner of
   MapStage.tsx until item 7; parallel with item 8.
   - [ ] PAY FIRST: extract the float toolbar (~lines 211–334) + the
         `Picker` helper into `MapToolbar.tsx` (grouped props, dumb
         view). MapStage → ~250 BEFORE ROI wiring (~+40 → ~290 final).
   - [ ] `useCutLanding.ts`: extract useMapCuts' private `land()`/`busy`
         into `useCutLanding(): {busy, land(promise, namePrefix?)}`;
         refactor useMapCuts onto it (one landing implementation for
         line cuts, ROI commits, and the workshop).
   - [ ] `useMapRoi.ts`: mode "off"|"roi"; gesture machine
         idle→(draw|move|resize)→idle in data coords; writes
         `store.mapRoi` (space = cutSpace at draw time); per-rAF
         preview via roiMath (coalesced, latest rect wins, ≤200 bins) —
         preview state stays LOCAL to the hook (never the store, never
         the library); handlers `onDown/onMove/onUp/onLeave`, hover
         hit + cursor; `setActiveGestureCancel` registered at
         drag-start / cleared on mouseup (true abort — restores the
         pre-gesture rect); arrows nudge one payload cell, ×10 Shift,
         Delete clears; <3 px drag = click, discarded.
   - [ ] `MapRoiOverlay.tsx`: fragment of (a) the pointer-transparent
         SVG (accent rect, 8 six-px handles, bounds readout in
         JetBrains Mono, sector wedge when Q axes displayed) and (b)
         the INTERACTIVE inline bar — an absolutely-positioned
         `qzk-glass` div pinned near the ROI via `rectToPx`: sparkline
         (SVG polyline, "preview" label, x/y toggle), live N/∫I
         readout, and ∫x / ∫y / Stats buttons (stopPropagation; commit
         through `useCutLanding`; Stats opens/updates the panel
         readout). Design tokens only. Hides on axis-space mismatch.
   - [ ] MapStage wiring: mount hook + overlay; ROI handlers take
         precedence while armed; cursor from hook; container
         tabIndex + onKeyDown; MapToolbar gains ▭ ("Box ROI: drag to
         draw, drag inside to move, edges/corners to resize; ∫ and
         stats commit from the floating bar").
   - [ ] Hook test (mocked api + roiMath spy): draw commits normalized
         rect; move/resize/crossover; Esc mid-drag restores; preview
         called at most once per frame; inline ∫x posts the shaped
         body and lands.
   - Acceptance: `cd frontend && npx vitest run && npm run build`
     (MapStage ≤400 via architecture.test.ts, zero edits to the guard).

7. **Cut ruler — radial/transverse cuts about a peak**
   Files: EDIT `Stage/MapRoiOverlay.tsx`, EDIT `Stage/useMapRoi.ts` (+
   tests), EDIT `Stage/MapToolbar.tsx` (ruler arm button), possibly a
   small `Stage/rulerGestures.ts` if useMapRoi nears ~400. Depends on
   item 6 (same files — serialize after it).
   - [ ] Render the ruler (rotated outline via `rulerCorners`, endpoint
         + width handles) in the SVG; inline bar reuses item 6's
         (profile = along the ruler axis; preview via
         `boxProfileLocal` with angle).
   - [ ] Gestures: drag-to-draw along the cut direction (angle from the
         drag), endpoint handles adjust length/angle, width handles
         symmetric width, interior translates; same cancel/nudge
         contract as the box.
   - [ ] Peak-anchored actions: when `rsmPeaks` exist for the active
         dataset, "Radial cut" / "Transverse cut" (toolbar split-button
         or panel card — implementer picks the cheaper, both ≤2 clicks)
         build the ruler via `radialRulerForPeak` with the film peak as
         default and any peak marker clickable as the anchor.
   - Acceptance: `cd frontend && npx vitest run && npm run build`.

8. **ROI cuts workshop — numeric setup, sector, saved ROIs,
   registration**
   Files: NEW `frontend/src/components/workshops/roicuts/RoiCutsPanel.tsx`
   + `useRoiCuts.ts` + `useRoiCuts.test.ts`, EDIT
   `frontend/src/AppOverlays.tsx`, EDIT
   `frontend/src/commands/analysisCommands.ts`. Depends on item 4;
   parallel with 6/7 (disjoint files). Sole owner of AppOverlays.tsx /
   analysisCommands.ts; check both files' headroom before editing.
   - [ ] `useRoiCuts.ts` (orchestration only): numeric bound edits →
         `setMapRoi` (sync with the canvas is structural — same store
         field); ruler numeric fields → `setMapRuler`; sector fields
         (center±half primary / min-max secondary, q-range prefilled
         from the data, bins via `defaultSectorBins`, mode) + wedge
         preview exposure; POLAR ROUTING per the three-branch rule:
         Q available → `/sector` + `/chi-profile`; `polefigAxes` hit →
         the same buttons drive `/box` with wrap on the azimuthal axis
         (mode pre-selected, visible, overridable); neither → the
         buttons disabled with the branch-(iii) reason as tooltip.
         Actions: runBox/runRuler/runStats/runSector/runChi,
         saveCurrentRoi/applySaved/remove. All commits via
         `useCutLanding`.
   - [ ] `RoiCutsPanel.tsx` (≤400; ToolWindow like RsmPanel): Box card
         (space indicator, bounds, collapse, reduce, bins, Run, stats
         readout — copyable monospace), Ruler card (cx/cy/angle/length/
         width + radial/transverse-about-peak buttons), Sector card
         (parameterization toggle, q-range, bins, mode, Radial +
         Azimuthal profile buttons, pole-figure mode indicator, "switch
         to Q to preview" hint), Saved ROIs card (save/apply/delete).
         The panel is NEVER required for a plain box cut — that is
         item 6's inline bar; state this in the panel header comment.
   - [ ] Register: AppOverlays.tsx beside RsmPanel (grep the `"rsm"`
         tool-window id for the mechanism) + analysisCommands.ts entry
         (id `"roi-cuts"`, "ROI cuts (box / sector / ruler)…") — the
         numeric-only path must work without ever touching the canvas.
   - [ ] Hook test (mocked api): numeric edit updates mapRoi; polar
         routing picks /sector vs wrapped /box by fixture metadata;
         save/apply round-trips.
   - Acceptance: `cd frontend && npx vitest run && npm run build`.

9. **Batch across datasets — cuts + overlay figure + summary table**
   Files: EDIT `workshops/roicuts/useRoiCuts.ts` + `RoiCutsPanel.tsx`
   (+ tests). Depends on items 8 and 3. Reuses existing surfaces ONLY —
   any new table widget or plotting path here is scope failure.
   - [ ] `applyToSelected(opts)`: sequential loop over `selectedIds`,
         skip non-2D and space-ineligible datasets ("applied N, skipped
         M"), land each cut `"<dataset>: "`-prefixed, collect new ids.
         FLOOR (always on): the cuts land and plot.
   - [ ] "Plot results together" (checkbox, default ON) → pass the
         collected ids to `lib/plotSelectedTogether.ts::
         plotSelectedTogether(ids)` — the same function the Plot menu /
         context actions use; legend and axes come free.
   - [ ] "Summary table" (checkbox) → one `rsmBoxStats` per dataset,
         rows rendered with `workshops/tabulate/TabulateTable.tsx`
         (presentational reuse) in a batch-results card; "Export CSV"
         builds the CSV string and saves via
         `lib/download.ts::saveBlob`. Columns: dataset, ∫I, centroid
         x/y, peak x/y, max, N.
   - [ ] Hook test: skips + prefixes; ids forwarded to a mocked
         plotSelectedTogether; stats rows accumulate and CSV string is
         well-formed.
   - Acceptance: `cd frontend && npx vitest run && npm run build`.

---

## Tier 2 — Medium Impact

10. **Integration, realdata smoke, physics docs, bookkeeping** — serial,
    after 1–9.
    - [ ] Realdata smoke (existing conftest corpus fixture — grep
          `realdata`; never hardcode the path): parse
          `panalytical/xrd/synthetic_rsm.xrdml` AND
          `xrayutilities_polefig_point.xrdml` through `io/registry`;
          run sector/chi/box/box-stats on the RSM and the wrapped-box
          azimuthal profile on the pole figure; assert non-degenerate
          outputs + provenance metadata. Verify the fixed
          `/api/rsm/linecut` q-space cut on `epytaxy_rsm.xrdml` returns
          a band, not a row (spread check vs `cut_width_used`).
    - [ ] Deliverable check (deliverable-first rule) from ALL entry
          points: inline bar commit, panel numeric-only, peak-anchored
          ruler, batch floor (cuts + plot together) — each lands
          library datasets that plot, fit, export, and carry enough
          provenance to caption a figure and re-apply the ROI.
    - [ ] Physics docs (docs-after-physics-feature, via
          `physics-docs-expert`): docstrings shipped in items 1–3;
          append sector/chi/box/ruler math, the polar-space rule, and
          the counting-statistics caveat to `docs/theory/xrd.md`
          (create if absent); tutorial only if none covers RSM cuts.
    - [ ] Bookkeeping (plan-hygiene, one commit per closure): strike
          items with dates; register this plan in MAIN_PLAN.md's plan
          tree + BACKLOG.md; tick PORT_CHECKLIST rows (arc integral;
          note the line-cut fix + the sibling MATLAB defect report
          there per item 2).
    - Acceptance: `uv run pytest -q && uv run ruff check src tests &&
      uv run mypy src && cd frontend && npx vitest run && npm run build`.

11. **Golden parity: `sector_profile` vs MATLAB `extract2DArcIntegral`**
    — OWNER-GATED (needs a local MATLAB run). Freeze case in
    `tools/matlab/freeze_calc_values.m` (small Q grid; wrap + non-wrap
    sectors; Sum and Mean), `golden`-marked pytest. Chi/box/ruler have
    no MATLAB counterpart; their planted-Gaussian tests are the ground
    truth. Do NOT golden-freeze the MATLAB Q line cut — it is the bug.

---

## Tier 3 — Nice-to-Have

12. **Draggable sector wedge** — radial handles on the qMin/qMax arcs +
    angular handles on the wedge edges, same gesture machine. Numeric +
    live preview must prove insufficient first.

13. **Named-ROI workspace persistence** — serialize `savedRois` into
    `.dwk`. BLOCKED on paying `lib/workspace.ts`'s pin (754, zero
    slack): (de)serialization lives in `store/rois.ts`; workspace.ts
    must shed at least what the hook-in costs.

14. **Migrate the five existing `rsm*` wrappers from `lib/api.ts` to
    `lib/api/rsm.ts`** with re-exports (the api/stats.ts template) —
    lowers the 1828 pin; do when next touching those wrappers.

15. ~~**Commit-path dataset-handle cache**~~ — SUPERSEDED by Tier 1 item 18
    (owner promoted it, 2026-08-09). Original text: only if committing cuts on
    ≳400k-point maps proves painfully slow in practice: extend the
    `_uploadcache.py` pattern so commits send a handle instead of the
    full DataStruct. The preview stays client-side regardless (Resolved
    decisions, rev 2).

---

## Completed

- ~~**#18 Dataset-handle cache**~~ (2026-08-09) — `routes/_datasetcache.py`
  (232, new): a bounded (16 entries / 256 MiB, LRU) in-memory
  `OrderedDict[str, DataStruct]` keyed by a server-computed content hash
  (blake2b over the decoded ndarray buffers, ~13ms measured on a 45 MB
  payload vs. the ~1.15s already paid to decode it), following the
  `_bookcache.py` precedent (in-memory LRU) over `_uploadcache.py`'s
  disk-staged token precedent — there is no filesystem path or "book"
  boundary here. One shared pydantic mixin `CachedDatasetRequest`
  (`dataset`/`dataset_handle` + `.resolve()`) replaces the per-model
  `dataset: dict[str, Any]` field on all 8 dataset-taking endpoints
  (`/api/plot/map` + 7 of `/api/rsm/*`'s 8 — `strain` takes peak centres,
  not a dataset); the handle rides as an `X-Dataset-Handle` RESPONSE
  HEADER, never the body, so every existing response shape stayed
  byte-identical (all pre-existing tests pass unmodified). An
  unknown/evicted handle is a distinguishable HTTP 409
  (`DatasetHandleMiss` -> `resolve_or_409`), never a 422 or 500. Frontend:
  NEW `lib/api/datasetCache.ts` intercepts inside `lib/api/http.ts`'s
  `postJSON` itself (not in each wrapper) — a WeakMap keyed on the
  client's own `dataset` object reference remembers the server-issued
  handle and swaps it in on repeat calls, retrying transparently once on
  a 409. Because the interception lives in `postJSON`, the FIVE older
  `rsm*` wrappers still in the pinned (1782) `lib/api.ts` get the same
  saving for free with zero edits to that file. Client-side hashing was
  measured and rejected (frontend `DataStruct.values` is plain
  `number[][]`, not typed arrays — a JS hash pass would cost close to the
  `JSON.stringify` this cache exists to avoid, for a cross-instance-dedup
  benefit the real workflow never needs). Measured repeat-call payload on
  a 6,144-point synthetic map: 660,995 B -> 114 B (99.983% smaller).
  26 new backend tests (hashing, bounded eviction by count AND bytes,
  concurrent races on both a write and a shared read all succeeding, full
  route-level round trip + 409 miss-recovery for every cache-eligible
  endpoint) + 14 new frontend tests (retry logic + `postJSON` dispatch,
  including out-of-scope-path passthrough for `/api/plot/series`); full
  gate green (3648 backend + 5842 frontend tests, ruff/mypy/tsc/build
  clean).

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
