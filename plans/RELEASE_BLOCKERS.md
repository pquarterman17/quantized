# Release Blockers — Day-5 feature-freeze list

The single release-blocker list called for by
`ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md`'s Day-5 gate ("Create one
release-blocker list; everything else moves to post-sprint"). Compiled by
reconciling `LIBRARY_WORKBOOK_UX_PLAN.md` (H-N), `PRIMARY_SOFTWARE_AUDIT_PLAN.md`
(P0-P4), and `JMP_GAP_PLAN.md` (J1-J17) against the actual code on `main`
(commit `440b0cb` at compile time). Detail lives at the cited plan entries;
this doc stays a pointer index, not a duplicate.

**Status:** Active
**Created:** 2026-08-19 (QA lane, Day-5 reconciliation)
**Parent:** `plans/ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md`

Kept deliberately short. A list where everything is a blocker is useless —
most open plan items are real gaps but do not stop the owner from using
Quantized as her daily driver today; those move to post-sprint.

---

## BLOCKER — must close (or get an owner-approved defer) before release

1. **Large 2-D map interactive render time (12-59 s to visible at
   500²-2000²).** Measured 2026-07-27 (`PRIMARY_SOFTWARE_AUDIT_PLAN.md`
   P0.4): browser-side map-visible time is 12-13 s at 500² and 52-59 s at
   1000², mechanism identified as full-input re-triangulation per regrid.
   **Why it blocks:** XRD/XRR reciprocal-space maps and SIMS-adjacent 2-D
   data are core to this owner's actual technique mix (see CLAUDE.md);
   a 12-59 s wait to see a map render is exactly the kind of friction that
   sends a real session back to Origin, and the mechanism (not merely
   "slow hardware") is already diagnosed. **Owner:** booked as a P2.8 class
   fix, `PRIMARY_SOFTWARE_AUDIT_PLAN.md` §P2.8; the 4M-point decimation
   case is separately noted as pending in P0.4.

2. **Server-side plot-payload decimation for very large series.**
   `/api/plot/series` ships 78 MB of JSON for a 1M×7 payload; network +
   encode + parse (~2-5 s) is the measured remaining term in both
   window-mount (~3.8 s) and workspace-restore freeze (~3.7 s vs. the
   1.5 s target), per `PRIMARY_SOFTWARE_AUDIT_PLAN.md` P3.4's own
   pre-authorized next slice. **Why it blocks:** every other P3.4 slice in
   this chain already shipped and measurably helped (TTFP 906→106 ms,
   window mount 6,066→~3,800 ms) — this is the one still-open piece of an
   otherwise-closed performance chain, and it is the dominant remaining
   term for anyone with a million-row-class dataset. **Owner:** P3.4,
   `PRIMARY_SOFTWARE_AUDIT_PLAN.md` §P3.4, the "Server-side plot-payload
   decimation" bullet.

No other item found in this reconciliation rises to BLOCKER. The core
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
