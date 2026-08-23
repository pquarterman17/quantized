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

All three items below are now CLOSED (2026-08-20). The section is kept for
the record; nothing currently rises to BLOCKER.

1. ~~**Large 2-D map render at 1M-4M points (29.8 s / 141.6 s measured
   2026-08-19 on `main`).**~~ **CLOSED 2026-08-20 (#189).** Root cause was a
   quantization/tolerance mismatch: `_grid_detect` tested pitch uniformity
   purely relatively (`_SPACING_RTOL = 1e-3`) while instrument exports
   quantize coordinates to 6 decimals, so relative jitter (~2e-6/pitch)
   grew as pitch shrank and the largest maps fell back to full Delaunay.
   Fix: combined relative + absolute tolerance where the absolute term is
   derived from the data's own inferred decimal lattice (`_infer_quantum`),
   capped at 1% of pitch so round-numbered irregular axes cannot smuggle in
   a loose bound; continuous (non-lattice) jitter of the same magnitude
   still rejects, log-axis/irregular negative tests pinned. **Re-measured
   on merged `main` (`11e71a5`), un-instrumented, 200x200 output:**
   250k: 0.51 s; 1M: 29.8 -> **3.3 s**; 4M: 141.6 -> **17.3 s** (both
   detection now HITs on the realistic `.xrdml` fixtures). Residual note:
   of the 17.3 s at 4M, ~8 s is `detect_regular_grid` running twice on the
   linear path (once as #188's thinning gate in `regrid2d`, once inside
   `_interp_scattered`) at ~4.1 s per call on 4M points - a straightforward
   post-sprint dedupe, booked below under IMPORTANT, not a blocker.

2. ~~**Server-side plot-payload decimation for very large series.**~~
   **CLOSED** (unchanged from the 2026-08-19 correction: shipped 2026-07-31;
   measured 154.3 MB -> 2.73 MB at `decimate_width=1280`; zoom-refetch and
   P3.4 slice 4 confirmed closed in code).

3. ~~**4M-point maps have no mitigation at all.**~~ **CLOSED 2026-08-20
   (#188).** Genuinely scattered input denser than `4 * nx * ny` is now
   bin-averaged onto a 2x-output-resolution grid before Delaunay (actual
   coordinates averaged, not bin centres; bit-exact passthrough below the
   threshold, pinned by test against a direct scipy reference; hull holes
   preserved, never bridged; golden suite byte-identical). Measured at the
   route's default 200x200 output: 1M random points 20.4 -> **2.7 s**,
   4M 88.2 -> **4.8 s**; 500x500 output @4M: 94.7 -> **21.9 s**. With #189
   detecting realistic gridded data, this path now serves only true
   scattered clouds. The endpoint remains synchronous (no job-queue
   routing/progress/cancel) - acceptable at seconds-scale; revisit only if
   a real workload still exceeds ~10 s after both fixes.

No other item found in this reconciliation rises to BLOCKER.
(Reconfirmed 2026-08-20 after #188/#189: the blocker section above is fully
closed; the map double-detection dedupe is listed below.) P3.4 slice 4
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

- ~~**Map fast path runs `detect_regular_grid` twice for `method="linear"`
  above the thinning threshold.**~~ **CLOSED 2026-08-20 (#191).** The
  detection result is now threaded from `regrid2d` into `interpolate2d`
  via a sentinel-typed `_grid_hint` ("didn't check" re-detects; "checked,
  found None" does not), with a positional-misalignment guard falling back
  to a fresh detect if duplicate-row dedup shrinks the cloud. Call-count
  spy tests pin exactly one detection in all three boundary cases; output
  byte-identical to the two-call path. Measured same-box controlled
  comparison at 4M/200x200: ~22.9 s -> ~18.6 s (exactly one ~4.3 s call
  removed); warm steady-state on the merged tree measures ~9 s.

- ~~**Single-writer project locking is entirely unbuilt (PR I2).**~~
  **CLOSED — for real this time — 2026-08-21 (#184 + #199).** #184 landed
  the UI state machine (read-only second open, Open as Copy, guarded Take
  Over) but its default provider was an in-memory, process-local Map —
  honest in the code header, oversold in release docs, and correctly
  called out by Sol's Day-6 audit (P0-3). #199 makes the claim true on
  desktop: an atomic lock file beside the project (`O_EXCL` creation +
  `fcntl`/`msvcrt` compare-and-swap), consent-gated bridge methods with a
  server-minted instance id, token-bound `write_project_file` (a lost
  lock refuses the save), Save As acquire-new/release-old, and a real
  two-process race test. The orchestrator's review round then found and
  fixed a genuine mutual-exclusion race (locking an orphaned inode after
  a release unlink — fixed with post-lock fstat/stat identity checks) and
  a Windows release failure (delete-while-locked — fixed with a released
  tombstone). **Browser multi-tab remains a labeled defer** (the in-memory
  provider is the browser fallback).
  **Strengthened further, 2026-08-22-23 (post-sprint independent-review
  wave, `plans/POST_SPRINT_INDEPENDENT_REVIEW.md` R1 + R4, PRs #207/#208):**
  R1 closed the remaining verify-then-write gap — a save now holds the same
  exclusive OS lock across token verification, temp-write, AND
  `os.replace`, with an absent lock file now refusing a non-empty token
  (previously it proceeded) — so `RC_RELEASE_NOTES_DRAFT.md`'s "one atomic
  boundary" claim is now literally true, not aspirational. R4 made the frontend fail closed
  when the desktop lock bridge itself is absent, throws, or returns a
  malformed response (previously such cases could report `readOnly: false`
  without ever verifying ownership). Both landed with adversarial
  code-review rounds fixing real pre-merge findings; independent-review
  status is recorded in that document's closure log.
  **Browser multi-tab defer NARROWED, 2026-08-23 (`claude/browser-tab-lock`):**
  `lib/browserLockProvider.ts` implements the SAME `LockProvider` contract
  (no new verbs, no change to `lib/lockState.ts`'s classification/staleness
  rules) against `localStorage` for the record, with the Web Locks API
  (`navigator.locks.request`) — where available, in a secure context —
  guarding every mutating verb's read-compare-write as a per-path mutex, so
  two tabs' CAS attempts can never physically interleave; a browser lacking
  Web Locks degrades to the same read-compare-write with no `await` between
  read and write (single-threaded-JS atomicity within one tab), never
  throwing and never failing open. `App.tsx` installs it (dynamic import) in
  exactly the branch that used to keep the honest-but-unprotected in-memory
  default — the non-desktop (`hasDesktopShell() === false`) case. **Same-
  browser multi-tab is now covered; cross-browser, cross-machine, and
  cross-profile on the web remain OUT of scope** — `localStorage` is not
  shared across any of those, and closing that gap would need a server-side
  lock leg `qz` (no `--desktop`) does not have today; that boundary stays
  the desktop filesystem lock's domain. Red-first: a forced-race pair
  (`browserLockProvider.test.ts`, a deferred-promise `yieldForTest` seam)
  reproduces the no-mutex split-brain on every run and proves the Web Locks
  mutex closes it, alongside mutual-exclusion/refresh-CAS/takeOver-CAS/
  release-idempotence/stale-heartbeat/storage-exception/malformed-record
  coverage (29 tests). tsc, eslint, and the full vitest suite green.
  **CORRECTION, same day, coordinator review round (M1):** the entry above
  overclaimed — `lib/browserLockProvider.ts` landed as a working
  `LockProvider`, but nothing on any browser-tab CODE PATH ever called one
  of its verbs (a browser-picker open carries no `native` identity, so
  `registerWithLockStateMachine` never fires; quick-save falls straight to
  a blob download before any lock check), so "same-browser multi-tab is now
  covered" was false as shipped. Scouted the actual same-browser collision
  surface (`useWorkspaceAutosave.ts`'s header): one shared IndexedDB/
  localStorage autosave slot per origin, read on every startup and written
  on every debounced save, with NO project path involved at all — the thing
  two ordinary browser tabs actually silently clobber today. Fix: a
  synthetic, stable `BROWSER_AUTOSAVE_LOCK_PATH` the EXISTING lock state
  machine tracks like a real file (`App.tsx`'s install effect calls the
  unchanged `openProject` against it right after installing the provider;
  the debounced-save effect gates its write on the unchanged `canWriteNow()`
  for that exact path) — no new verbs, no `lib/lockState.ts` changes. An
  explicit browser file-picker open/save REMAINS ungated (named honestly in
  `store/projectLock.ts`'s header) — out of this round's scope, since giving
  a picked file a durable cross-tab identity is materially larger. Three
  more hardening fixes in the same round: (M2) the tab-close release now
  routes through the SAME Web Locks mutex the other verbs use, closing a
  read-then-delete TOCTOU window against a concurrent takeover (forced-race
  pair added); (M3) release is now tied to `pagehide`'s `persisted: false`
  only — `beforeunload` no longer releases at all, since it can't tell a
  real unload from a page merely frozen into the back/forward cache; a
  `pageshow` handler re-validates via the existing `heartbeat()` entry point
  on a bfcache restore; (M6) `subscribeUnload` returns an unsubscribe and
  the provider exposes `dispose()`, so the installing effect's own cleanup
  (StrictMode double-mount included) can't leak a permanent listener per
  remount. Red-first: two-simulated-tabs coverage of engage/read-only/
  Take-Over-Editing and the debounced-write gate in
  `useWorkspaceAutosave.test.ts`, plus the M2/M3/M6 tests in
  `browserLockProvider.test.ts` (35 tests there, up from 29; 5 new tests in
  `useWorkspaceAutosave.test.ts`). tsc, eslint, and the full vitest suite
  green.
- ~~**M's transactional multi-source "Reimport All" (L0.33)**~~ **BUILT
  2026-08-23 (`claude/m2-reimport-all`, not yet merged):** `store/reimportAll.ts`
  (two-phase stage/commit — see its module doc) + the workbook context
  menu's new "Reimport All"/"Reimport Available Sources" commands
  (`lib/workbookContextActions.ts`) + `components/overlays/ReimportAllDialog.tsx`
  (the per-source problem report, lazy-loaded via `AppOverlays.tsx`).
  Red-first, mutation-tested (the transactional refusal, the partial-commit
  subset, the one-undo-entry, the mid-stage-edit race, the overlapping
  invocation, the removed-dataset race, and the no-bridge browser degrade
  are each forced and confirmed to fail without their respective guard —
  see `store/reimportAll.test.ts`). **The full Trash dependency-review UI
  (restore / delete-dependent / freeze-materialize as distinct choices,
  L0.45) remains unbuilt** — single-dataset delete ships with an impact
  preview today (PR M slice 1, merged); the full recovery-choice case does
  not. Owner: `LIBRARY_WORKBOOK_UX_PLAN.md` item 13 (PR M).
- ~~**J2 Recode workshop (merge/rename levels, find-replace) does not
  exist.**~~ **CLOSED 2026-08-19 (#186).** Landed as `store/recode.ts` and
  `components/workshops/recode/`, with P1.6b's worksheet C/O/N type badge and
  categorical cell-edit guard in the same PR. Review caught two defects
  pre-merge: a case-duplicate level picker that wrote the wrong code (levels
  `["pass","PASS","Fail"]`, picking `"PASS"` wrote `0`), and a "Save mapping"
  button whose result evaporated.
- ~~**P1.3 reusable plot recipes are unbuilt beyond H's Quick Plot
  templates.**~~ **CLOSED 2026-08-22/23 (#203/#204/#209, refined by
  #215-#218).** The full recipe vocabulary now captures and reapplies —
  semantic X/Y/error/group/facet mapping by signature id, axis
  scales/limits-as-policy, legend, decorations, annotations, waterfall,
  series styles — with project + global scopes, import/export, and
  technique-equality matching. Golden of record:
  `PRIMARY_SOFTWARE_AUDIT_PLAN.md` §P1.3's own closure entry.
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

**2026-08-23 note:** every branch in the paragraph above landed during the
sprint; the paragraph is kept as a record of the compile-time snapshot.
Post-sprint, the independent-review campaign
(`POST_SPRINT_INDEPENDENT_REVIEW.md` R1-R10, PRs #206-#214) and the release
handoff's C1/C2 (#215-#218: relink native folder-grant consent closing the
inert-checksum limitation, and a measured 20.3 kB eager-bundle recovery)
are also on `main`. The only open gates in this document remain the
OWNER-ONLY VERIFICATION section — now to be run against `v0.23.0-rc2`
(rc1 at `069616d1` predates all of the above).
