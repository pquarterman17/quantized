# Release Blockers — Day-5 feature-freeze list

The single release-blocker list called for by
`ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md`'s Day-5 gate ("Create one
release-blocker list; everything else moves to post-sprint"). Compiled by
reconciling `LIBRARY_WORKBOOK_UX_PLAN.md` (H-N), `PRIMARY_SOFTWARE_AUDIT_PLAN.md`
(P0-P4), and `JMP_GAP_PLAN.md` (J1-J17) against the actual code on `main`
(commit `440b0cb` at compile time). Detail lives at the cited plan entries;
this doc stays a pointer index, not a duplicate.

**Corrected 2026-08-19 (orchestrator).** The original compile read the plans'
detailed evidence entries without checking the same plans' status headers, so
it was stale in BOTH directions: it quoted pre-fix measurements for two fixes
that had already shipped, and it listed two items as "in flight, not yet
landed" that merged during the sprint (#184, #186). Every entry below has now
been checked against code or measured on `main` rather than against a
document. One of the two original BLOCKERs survives that check - but for a
different reason than it was filed under, and a new one was found.

**Status:** Active
**Created:** 2026-08-19 (QA lane, Day-5 reconciliation)
**Parent:** `plans/ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md`

Kept deliberately short. A list where everything is a blocker is useless —
most open plan items are real gaps but do not stop the owner from using
Quantized as her daily driver today; those move to post-sprint.

---

## BLOCKER — must close (or get an owner-approved defer) before release

1. **Large 2-D map render at 1M-4M points (29.8 s / 141.6 s measured
   2026-08-19 on `main`).** The P2.8 regrid fast path
   (`calc/_grid_detect.py` routing detected grids through
   `RegularGridInterpolator`) DID ship, and works: an exact-precision 1M
   grid regrids in ~1.6 s. But it does not ENGAGE on realistic instrument
   data. `_grid_detect.py:69` tests pitch uniformity purely relatively
   (`_SPACING_RTOL = 1e-3`), while instrument exports quantize angular
   positions to 6 decimal places (`tools/baselines/rsm.py:69`,
   `f"{...:.6f}"`, and every committed `.xrdml` fixture). Quantization
   perturbs each consecutive gap by a fixed ~2e-6 ABSOLUTE, so relative
   jitter is ~2e-6/pitch and GROWS as the grid gets finer - backwards,
   since fine pitch is exactly the large-map case. Reproduced at three
   sizes: a 6dp-representable pitch (0.0008) has no jitter and still hits;
   an arbitrary pitch of 0.00083333 at 1000² jitters 1.2e-3 and falls
   back to Delaunay; 0.00041667 at 2000² jitters 2.4e-3 and is worse.
   **Why it blocks:** unchanged from the original entry - RSM/XRD maps are
   core to this owner's technique mix, and a 30-140 s wait sends a real
   session back to Origin. **Status:** fix in progress on
   `claude/p28-grid-detect-quantization` (quantization-aware combined
   absolute+relative tolerance; deliberately NOT a blanket rtol raise,
   which would weaken the near-miss guarantee the module's own comments
   and `test_calc_grid_detect.py` protect).

2. ~~**Server-side plot-payload decimation for very large series.**~~
   **CLOSED.** Shipped 2026-07-31 as `calc/decimate.py`, wired into
   `routes/plot.py`. Measured 2026-08-19 on `main` by driving the route's
   own path (`build_series` -> `decimate_columns` -> `jsonify` ->
   `json.dumps`) over a synthetic 1M x 7 DataStruct: **154.3 MB
   full-resolution -> 2.73 MB at `decimate_width=1280` (56x), 4.08 MB at
   1920.** The original entry's 78 MB figure was a pre-fix measurement.
   Zoom-refetch is also closed: `PlotRequest` carries `x_min`/`x_max`
   (`routes/plot.py:42-58`) and windows before decimating
   (`routes/plot.py:87-99`), with frontend wiring in
   `usePlotPayload.ts:412-451`.

3. **4M-point maps have no mitigation at all — new, not previously
   listed.** Distinct from item 1 and not closed by it. `/api/plot/map`
   (`routes/plot.py:139-156`) is a plain synchronous FastAPI endpoint: it
   is not routed through `routes/jobs_api` (whose only producer is still
   the DREAM/bumps fit), and there is no input-side decimation anywhere in
   `calc/map.py` or `calc/interp2d.py` for the scattered fallback. So a 4M
   map request today is a ~140 s blocking HTTP call with no progress and
   no cancel — qualitatively different from merely slow, because of
   proxy/browser timeout risk. Fixing item 1 should cut the common case
   dramatically; this entry covers what remains when the fast path
   legitimately cannot apply (genuinely scattered data).

No other item found in this reconciliation rises to BLOCKER. P3.4 slice 4
(staged render/mount on workspace restore) is likewise confirmed closed in
code: `frontend/src/store/windowHydration.ts` implements one-per-frame
hydration and is wired from the `loadWorkspace`/`appendWorkspace` call sites. The core
import → organize → Quick Plot/Quick Figure Builder → edit → save → close →
reopen loop has strong automated evidence behind it — G5's real-Chromium
lifecycle journey (`plans/LIBRARY_WORKBOOK_UX_PLAN.md` item 7's G5 entry)
drives that exact loop end to end, byte-exact, through the real native file
picker — and P1.1/P1.2/P1.7 landed a real named-project lifecycle
(atomic write, bounded autosave, consent-gated crash recovery, relink) on
top of it this sprint.

---

## IMPORTANT — NOT BLOCKING (real gaps; do not release-gate on them)

- ~~**Single-writer project locking is entirely unbuilt (PR I2).**~~
  **CLOSED 2026-08-19 (#184).** Landed as `lib/lockState.ts`,
  `store/projectLock.ts`, and `useProjectLockHeartbeat.ts`: read-only second
  open, Open as Copy, and guarded Take Over. Review caught and fixed a false
  safety claim here — the header promised the resumed original's next write
  would be refused, but `runSaveWorkspace` was reading a 30 s-stale cached
  `canWriteNow()`; it now re-verifies with a fresh `provider.read()`
  immediately before `saveProjectTo`. Save As could also overwrite a locked
  file; that is fixed too.
- **M's transactional multi-source "Reimport All" (L0.33) and the full
  Trash dependency-review UI (restore / delete-dependent / freeze-materialize
  as distinct choices, L0.45) are unbuilt.** Single-dataset reimport and
  delete both ship with an impact preview today (PR M slice 1, merged);
  the multi-source and full-recovery-choice cases do not. Owner:
  `LIBRARY_WORKBOOK_UX_PLAN.md` item 13 (PR M).
- ~~**J2 Recode workshop (merge/rename levels, find-replace) does not
  exist.**~~ **CLOSED 2026-08-19 (#186).** Landed as `store/recode.ts` and
  `components/workshops/recode/`, with P1.6b's worksheet C/O/N type badge and
  categorical cell-edit guard in the same PR. Review caught two defects
  pre-merge: a case-duplicate level picker that wrote the wrong code (levels
  `["pass","PASS","Fail"]`, picking `"PASS"` wrote `0`), and a "Save mapping"
  button whose result evaporated.
- **P1.3 reusable plot recipes are unbuilt beyond H's Quick Plot templates.**
  H (shipped) covers mapping + style + technique/schema matching, which is
  most of the daily value; the full recipe vocabulary (axis limits, legend,
  decorations, annotations, waterfall settings) is not saved/reused. Owner:
  `PRIMARY_SOFTWARE_AUDIT_PLAN.md` §P1.3.
- **N (managed large-data sidecars) is deferred with evidence, not built.**
  See the verdict at `LIBRARY_WORKBOOK_UX_PLAN.md` item 14 for the full
  reasoning and numbers; summary: the measured 5.8 s reopen freeze on a
  188 MB/1M-row-member `.dwk` is a residual at an edge-case project size,
  not the common case (50-dataset/20-window projects measure in
  milliseconds), and the same freeze class already responded well to
  mount/render fixes (P3.4) rather than storage-format changes. Flip
  condition: a re-measurement of that same case AFTER P3.4's fixes, or
  owner evidence that multi-hundred-MB projects are her normal case.

---

## OWNER-ONLY VERIFICATION OUTSTANDING (gates evidence, not code)

These cannot be closed by an agent — they need the owner's hands, screen,
and judgment. None has been run yet as of this reconciliation.

- **P0.1 real switch-trigger project + friction log.** One real project,
  raw files to reopened workspace to publication figure to Office paste,
  100% in Quantized, Origin/JMP closed, friction logged. Sprint Day-0 gate;
  not yet run. `PRIMARY_SOFTWARE_AUDIT_PLAN.md` §P0.1.
- **P0.2 Origin visual-fidelity review.** 0/353 matrix rows reviewed; 62
  paired screenshots exist but are unjudged. `PRIMARY_SOFTWARE_AUDIT_PLAN.md`
  §P0.2.
- **Windows/macOS Office copy/paste acceptance.** P0.1's own acceptance
  criterion ("copy/paste takes seconds and looks correct at normal Office
  scale") and the sprint's Day-0 gate; not yet confirmed on either platform.
- **Baseline Quick Figure smoke workflow + tagged preview build.** Sprint
  Day-0 gate (`ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md` Day 0); not recorded
  as run.
- **Packaged Windows/macOS desktop-bridge E2E.** P1.1's bridge logic is
  tested against `FakeWindow`/mocked `window.pywebview` only; no packaged
  app has exercised real OS Open/Save dialogs, long Unicode/network paths,
  or cancel semantics. `PRIMARY_SOFTWARE_AUDIT_PLAN.md` §P1.1.

---

## POST-SPRINT (everything else)

Every other open item in `LIBRARY_WORKBOOK_UX_PLAN.md` (I cross-instance
transfer, P1.7 Pack Project + linked mode, L slice 2 UI polish, the
column-role-inference/Quick-Figure-Builder detail checklists, large-Library
virtualization for Tree/Details/search beyond Tiles), `PRIMARY_SOFTWARE_AUDIT_PLAN.md`
Tier 2/3 (P2.x technique workbenches, P3.1 help, P3.2 onboarding, P3.3
accessibility, P3.5 recipe library, P3.6 export acceptance beyond copy/paste,
P3.7 full trash, P4.x), and `JMP_GAP_PLAN.md` Tier 3 (J13-J16, census-gated)
moves to the post-sprint inbox per the sprint's own freeze rule. None of
these were found to be silently mis-marked as done during this reconciliation
pass — see each plan's own Day-5 change-log entry for the specific
corrections that WERE made.

**In flight at compile time — do not read their branches' absence above as
"blocked," they are actively being implemented and will land after this
list was compiled:** PR I + I2 (`claude/i-transfer-locking`), J slice 2 +
L slice 2 UI (`claude/j2-l2-ui`), J2 recode + P1.6b worksheet categorical UI
(`claude/j2-recode-worksheet`).
