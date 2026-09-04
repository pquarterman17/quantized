# BACKLOG history — reconciliation-pass narrative

This file is the **append-only history** of `BACKLOG.md`'s reconciliation
passes (pass 1 through the twenty-fourth pass, 2026-08-28), moved out of
`BACKLOG.md` on 2026-09-03 to stop every session from paying to read ~540
lines of narrative before reaching the actionable tables. The text below is
verbatim from `BACKLOG.md` as it stood before the split — nothing summarized
or edited; it is a record, not a living document. New reconciliation passes
are appended here going forward (newest first, matching the existing
convention); `BACKLOG.md` itself keeps only a short "Last reconciled" summary
plus the current dashboard tables (`## Actionable dev work` onward) — it
remains the live derived view described in that file's own opening
paragraph.

---

**Last reconciled:** 2026-08-28 (twenty-fourth pass). What changed:

1. **`v0.23.0` and `v0.23.1` released 2026-08-28** (both stable; `v0.23.1`
   is Latest) — the RC4 fix tree was promoted early because it closes the
   `v0.22.0` reimport data-loss exposure (see item 2). `v0.23.1` is
   release-plumbing only (#249 gates real PyPI publish to a tag-only
   dispatch, #250 the version bump). Dependabot #230/#251/#252 merged the
   same window (superseding #229/#231).
2. **New sub-plan `SILENT_STATE_CORRUPTION_PLAN.md` registered** (Parent
   `MAIN_PLAN.md`, added to its plan tree) — tasks #1/#3/#5 shipped
   (`#253`/`#254`), plus its Completed table's F2/F5/F6 (`#255`) and
   backend D1–D8 (`#256`/`#257`) rows. Tasks #2/#4/#6–#9 shipped later the
   same pass as `#259` (2026-08-29); one new task #10 booked in Actionable
   dev work below.
3. **The release-tracking docs were reconciled without ticking owner
   boxes.** `POST_SPRINT_INDEPENDENT_REVIEW.md`'s R2 and Stable-promotion
   gate remain unticked but now carry a dated note recording the early
   promotion. `CHATGPT_SOL_TO_CLAUDE_RELEASE_HANDOFF.md`'s "Current truth"
   and `RC_RELEASE_NOTES_DRAFT.md`'s header (both still named rc4 as the
   live candidate) got matching dated superseded notes — the
   candidate was `v0.23.2-rc1` = `cd68ad16` (main after `#259`, 2026-08-29) — **superseded 2026-08-29**: it WAS cut and published as a prerelease (all nine assets), but `#260`-`#264` landed after it, so the candidate is `v0.23.2-rc2` = `1264b2a4`. `RELEASE_BLOCKERS.md` checked: nothing rises to BLOCKER, its
   owner-verification list is unchanged and accurate.
4. **`ERROR_LABEL_CLASSIFIER_PLAN.md` archived** — its generate/rank/select
   rewrite shipped as `#238` (verified: `errorLabelCandidates.ts` exists in
   the tree); no open items, never had a BACKLOG row.
5. **`DIRACULATOR_AUDIT_PLAN.md` registered for the first time** — merged
   `#143` (2026-08-16), MATLAB golden campaign frozen 2026-08-21 (248/248).
   Three follow-ups booked below (two dev, one owner decision).
6. **Two stale dashboard cells fixed against the plans' own current
   state:** `JMP_GAP_PLAN.md`'s row still listed J2/J4 as open — both
   shipped 2026-08-18/19, only J1 (partial) remains. `ORIGIN_FILE_DECODE_PLAN.md`'s
   row predated its own 2026-08-21 update (a harness bug had been
   misreporting "25 pre-existing renderer failures" since 2026-07-25;
   fixed, corpus re-swept clean at 350/332/18/0).
7. **Two drift fixes in the plans themselves** (not just BACKLOG):
   `LIBRARY_WORKBOOK_UX_PLAN.md`'s L0.33 entry said "not yet merged" — it
   merged 2026-08-23 as `#221`. `ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md` had
   no declared `**Parent:**` (a plan-consolidation violation since it has
   its own sub-plans) — added `Parent: MAIN_PLAN.md` and a plan-tree row.

Prior (twenty-third pass, 2026-08-13 — the quick-deliverables
session). What changed:

1. **The v0.20.0 release was found HALF-FINISHED and completed.** The
   2026-08-12 overnight session merged the eight-file version bump (PR
   #131, `4bea713`) but never pushed the tag, so main self-identified as
   0.20.0 for a day while tags/releases/PyPI stopped at v0.19.0. Tagged
   `4bea713` (annotated, v0.19.0-style message); the tag push ran
   release.yml + pypi.yml — both green, GitHub release published as Latest
   with the full asset set (installers, server bundles, updater
   latest.json). Debris cleaned in the same sweep: the two fully-merged
   remote branches (`claude/github-security-fixes-fn9ajn`,
   `claude/quantized-repo-overnight-idqp5q` — both verified
   patch-equivalent via `git cherry` before deletion) and the stray
   v0.19.0 DRAFT release duplicate.
2. **Dependabot #24 booked open** (dependency-security section below) —
   extract-zip high, upstream-blocked, owner decided not to dismiss.
3. **`LIBRARY_WORKBOOK_UX_PLAN.md` committed + registered** (`6fe1b2f`) —
   it had been left untracked at its interview pause point; LQ.1 (Quick
   Plot template contract) CONFIRMED as recommended = L0.14. NOTE: a
   parallel session advanced the interview further (L0.15 tile placement,
   L0.16 child ordering — uncommitted at this writing); that session owns
   booking those.
4. **GUI #17's `clearShapes` judgment call CLOSED — confirm shipped
   `77bc718`** (owner decision 2026-08-13; row removed from the
   carried-over table below). Its "un-undoable" premise had gone stale —
   `clearShapes` records a history entry since GUI #1's edit history
   landed — corrected in the plan's Completed entry and the dialog copy.
5. **The region-shades owner gate is DECIDED: editable** — row removed
   from Owner actions, booked as unblocked FIGURE_AUTHORING slice F2.3j
   (Stage card + Publication Preview panel in ONE slice, per F2.3d's
   consistency argument).

Prior (twenty-second pass, 2026-08-11 — closing the
parallel-worktree race the twenty-first pass itself lost). Four findings:

1. **MAIN #41 was already SHIPPED when the twenty-first pass recorded it
   open.** `5ad96db` (sector ROI fields → `store/rois.ts`, 21:04) merged
   five minutes before the reconcile commit (`a8357a3`, 21:09) was
   authored — in a *different worktree*, merged 21:13. Neither session
   could see the other; the drift existed only on the merged tree.
   Struck in MAIN_PLAN, actionable row removed, dashboard row updated.
2. **The TEST_DETERMINISM dashboard row predated its own plan's
   completions** — it still listed items 1/2/3/4/6 as open although the
   plan's Completed section records all five shipped 2026-08-10. Row
   rewritten; #7 (the docs note) promoted to the actionable table; #5 is
   a standing opportunistic rule, not a schedulable item.
3. **The twenty-first pass's "#55 correct-red" note is superseded**:
   `610e299` widened the guard's `PARTIAL_QUALIFIERS` to treat
   "GATE OPEN" as a partial qualifier, so
   `tests/test_repo_integrity.py` is now fully green with #55 correctly
   left open.
4. **Unbooked ships since the last pass** (no rows needed, recorded here
   for the narrative): v0.19.0 released 2026-08-10 (all 8 version files
   bumped, lockfiles included); PR #127 closed the open high/medium
   GitHub security alerts (SECURITY.md added, hardening across
   `desktop_consent`/`io.delimited`/`io.sqlite_query` + 6 route
   modules); PR #128 closed the last 5 CodeQL alerts via a fenced query
   exclusion in `.github/codeql/codeql-config.yml` with a new
   integrity-test guard on the exclusion list. Alert count: 0 open.
   Also: `weak-waits-inventory.md` re-headed as a standing
   TEST_DETERMINISM appendix (its "delete when task 5 completes" note
   contradicted the 2026-08-10 owner decision that task 5 is never
   done) and given a `**Parent:**` declaration per plan-consolidation.

Prior (twenty-first pass, 2026-08-10 — `docs/plan-drift-guard`
guard follow-through). The new `test_plan_items_claiming_completion_are_moved_to_completed`
guard (tests/test_repo_integrity.py) was RED on real drift in three plans;
fixed per-plan, one commit each:

1. **`GUI_INTERACTION_PLAN.md` #2/#5/#15/#17 struck.** All four had every
   sub-box checked in their tier sections (Plot Objects tree closing slice,
   baseline X/Y binding, the Playwright e2e harness, buttons/menus/tooltips
   polish) but were never moved to Completed — verified against the plan's
   own owner-gate resolutions, PR references, and dated progress notes, then
   moved with their real completion dates (2026-07-18 through 2026-07-24).
2. **`JMP_GAP_PLAN.md` tier-section duplicates removed.** Items 3/6/7/8/9/
   10/11/12/13/14 (J3, J6, J7, J8, J9, J10, J11, J12, J17, module-size
   follow-ups) were marked SHIPPED/COMPLETE and — as most of them say in
   their own text — "(see Completed)": the work was already recorded there.
   Deleted the stale tier-section copies rather than double-logging.
3. **`ORIGIN_FILE_DECODE_PLAN.md` #4/#21/#55 triaged individually**, not
   uniformly: #4 was a guard false positive (a prose goal statement with no
   sub-items of its own inherited #48–#52's checked boxes because the
   guard's item-boundary regex didn't recognize the "`N. ~~**Title**~~
   **STATUS**`" already-struck format as a boundary — fixed in the guard,
   see below). #21 (`.otp`/`.otpu` template import) was genuinely complete:
   its deferred frontend half shipped `07e9d4fa` (2026-07-11) and is
   recorded in `MAIN_PLAN.md`'s own Completed section, but #21's text was
   never updated — struck and moved. **#55 was left OPEN, deliberately** —
   "TOOLING COMPLETE; OWNER VISUAL-REVIEW GATE OPEN" is a real, unfinished
   owner-review gate (0/353 reviewed), not drift; laundering it into
   Completed would have been a false claim. The guard's `PARTIAL_QUALIFIERS`
   list doesn't contain the literal substring "owner-gated" that #55's
   phrasing would need to auto-pass — flagged here rather than widened
   unilaterally, since the corpus only has this one instance to judge a
   general rule from.
4. **One narrow guard fix** (`tests/test_repo_integrity.py`): the
   "stop scanning sub-items at the next top-level item" boundary regex only
   matched `^\d+\.\s+\*\*`, so an already-struck item formatted
   `N. ~~**Title**~~ **STATUS**` (very common in this repo's Completed
   entries) was invisible as a boundary — the scan for whatever open item
   preceded it ran straight through and could vacuum up unrelated checked
   boxes from items further down. Widened to `^\d+\.\s+(?:~~)?\*\*`, which
   only makes scan windows *smaller/more accurate* (a boundary recognized
   earlier can never hide real drift, only stop false-positive over-collection).
   `tests/test_repo_integrity.py -q` is green except the deliberate #55 case
   above, which is correct-red, not guard-red.

Prior (twentieth pass — plan-hygiene
reconciliation sweep). Three-part pass, one commit each:

1. **`PORT_PLAN.md` drift fixed.** W0 #1/#2/#5 (repo scaffold, enforcement
   tests, CI workflow) shipped 2026-06-21 with every sub-box checked but
   were never struck or moved to the plan's Completed section — verified
   against git history (`8a017e62`/`84cbd519`/`b26d1d00`/`a700c44c`, plus
   the frontend enforcement half `f41180af` 2026-07-08) and fixed. #48's
   claim that PyPI Trusted Publisher registration + first tagged publish
   were still open was stale — both were done 2026-07-12; only the
   fresh-machine acceptance run remains. Both "still to decide" items (CI
   golden-test host, Apache-2.0 copyright line) were already resolved in
   practice — the copyright line has been in `NOTICE` since the first
   commit, never a placeholder — moved to Resolved decisions. #10/#12/#15/
   #47/#49/#50 verified still genuinely open/blocked/owner-gated.
2. **`RSM_CUTS_PLAN.md` folded up and archived.** Its build phase completed
   2026-08-09 but the header was never refreshed after items #11–14 closed
   same day, leaving only item #25 (component-local sector ROI state) open
   — ≤3 open items on a finished campaign, so #25 folded up into
   `MAIN_PLAN.md` Tier 3 #41 with provenance, #11 (owner-skipped) folded
   into MAIN_PLAN's Deferrals, and the plan archived. `GOTO_PLAN.md` and
   `PRIMARY_SOFTWARE_AUDIT_PLAN.md` were also evaluated and **rejected**
   for fold-up: GOTO_PLAN reads as the initiative's standing mission doc
   (its Tier 3 is deliberately empty pending the Q4/Q8/Q9 gates, and Q9 is
   duplicate-tracked as PRIMARY's own Gate A item); PRIMARY_SOFTWARE_AUDIT
   has 188 open checklist items across five acceptance gates — nowhere
   near residue.
3. **This file reconciled against both plan edits** (below) plus a stray
   pre-existing drift catch: `RSM_CUTS_PLAN #11`'s Owner-actions row and
   the `PORT_PLAN #1` Apache-2.0 owner-gate row (also stale in MAIN_PLAN's
   own owner-gates table, fixed there too) both removed as resolved/moot
   rather than pending. `TEST_DETERMINISM_PLAN.md` (created 2026-08-09,
   absorbed two items from RSM_CUTS_PLAN) added to the dashboard — it was
   never added when created.

Prior (nineteenth pass, 2026-08-09). `plans/RSM_CUTS_PLAN.md`
(sector/annulus, azimuthal-chi, and box-ROI cuts for 3-axis XRD reciprocal-
space maps) is registered in the plan tree below for the first time — it
was built and merged item-by-item across several sessions without ever
being added to the dashboard. Items 1–9, 16–21, 23 are ALL shipped; item 10
(realdata HTTP smoke test against the real corpus + physics docs + this
bookkeeping pass) is the plan's last build-phase item and is CLOSED this
pass, struck in the plan's own Completed section. Three rows added below:
**#11** (owner-gated MATLAB golden-parity freeze for `sector_profile` vs
`extract2DArcIntegral.m`, needs a local MATLAB run) joins Owner actions;
**#12–14** (Tier 3: draggable sector wedge, named-ROI `.dwk` persistence,
`lib/api.ts` wrapper migration — none scheduled, each has its own revisit
condition) joins Deliberate deferrals; **#22** (an intermittent
`useFigureBuilder` F2.4b vitest flake the plan's own post-merge gate
surfaced — NOT caused by this plan's work, still unbooked anywhere) joins
Actionable dev work. A second MATLAB defect was found while closing item
10: `+fitting/rsmStrain.m` (see `PORT_CHECKLIST.md`'s RSM row, "MATLAB bug
#6") has the same unguarded-near-degenerate-Qx defect the Python port's
item 23 already fixed on its own side; reported only, per sibling-repo-
first — `Quantized_matlab` was not touched. (Note, 2026-08-10: #11 and
#12–14 both closed the same day this paragraph describes and are now
folded up/archived per the twentieth-pass note above — this paragraph is
kept for history, not current state.)

Prior (eighteenth pass, 2026-08-05). Two stale cells fixed
against the plans and git: the PRIMARY row still listed the P3.4
zoom-refetch residual as "actionable now" although it shipped 2026-08-01
(`232cf4f`, booked `cb8e9d2` — the 17th-pass header already said so; the
row cell was missed), and the FIGURE row still read "F0 first" although
**F0 and F1 are fully complete** and 2026-08-02 shipped seven bounded F2
slices (PRs #110–#115 line: canonical Publication Preview session,
legacy-figure promotion, Graph Builder detached preview, property/context-
menu/readiness slices) plus F4.2a. The actionable table below is refilled
with the figure campaign — F2 broader parity, F3 PageDocument, F4
recipes — which has been the live dev queue since it was booked.
`git branch --no-merged main` is clean. Also this pass (unbooked drive-by,
owner report 2026-08-05): the **launch identity fix** `d37ac38` — both
quantized and fermiviewer answered /api/health with identical
`{"status": "ok"}` payloads on the shared default port 8000, so every
reuse-if-healthy launcher probe (Tauri shell, `qz --desktop`) could adopt
a running fermiviewer and render the EM app inside a Quantized window
(the owner saw fermiviewer's "Open a microscopy dataset" screen as
quantized's opening screen). Health now carries `app: quantized` and all
probes require it; mirror fix landed in fermiviewer (`9db61cf`). A
graceful-coexistence follow-up (Tauri shell falls back to an ephemeral
port instead of a 60 s timeout dialog when the sibling holds 8000) is in
flight this session. Same day, a scripting/API design pass shipped two
MAIN items: **#40 the Origin/Host CSRF+DNS-rebinding request guard**
(`4016ed5` — quantized had CORS but no Host/Origin check, unlike sibling
fermiviewer; a pre-existing gap the scoping surfaced and closed same-day,
ahead of being booked) and **#39 `quantized.client` slice 1** (a network
client — `pip install quantized[client]` — for driving an already-running
`qz` server the way the SPA does: import/corrections/fit/DREAM-via-job-
queue, with a mandatory identity handshake so a script can't silently
adopt the sibling fermiviewer the way #40 closes for browser requests).
Neither needed an actionable-table row (shipped same session); the one
residual — deciding the in-app scripting console's design (DSL vs. a real
Python kernel) — is the new owner-gate row below.

Prior (seventeenth pass, 2026-08-01). ChatGPT-Sol's v0.14.0
figure-authoring audit is booked as active child plan
`FIGURE_AUTHORING_WORKFLOW_PLAN.md`: Stage is the rich internal editor, while
Figure Builder is currently a detached/reduced publication surface and Figure
Page is ephemeral. F0 terminology/create-vs-apply/loss warnings are the first
bounded slices; the FigureDocument/PageDocument migrations remain open. Prior
same day: **PLOT_WORKFLOW is
COMPLETE and ARCHIVED** — #4 batch overlay offer (`f367eb6`, first
generic toast action button) and #5 per-technique view memory
(`97e3a3b`, label-rekeyed, `.dwk`-persisted) shipped; #6's interface
contract folded up into PRIMARY P1.3. All four of the owner's
2026-07-31 import→plot design decisions are live within ~24 h of the
design session. Also this pass: ROBUSTNESS #4/#5 shipped (Haiku agent +
orchestrator hardening), #7 census done (one real gap → `tools/` size
guard `c70b895`; seven recorded LEAVEs), P3.4 zoom-refetch shipped
(decimation ship complete). Final-tree gate: backend 3,471 / frontend
5,209 across 361 files / build 904.2 kB (15.0 kB headroom) / lint 0
errors. Later the same day, **ROBUSTNESS
completed and ARCHIVED**: #6 recurring vuln sweep SHIPPED (`9b7e91d` —
weekly tokenless OSV scan of all three lockfiles, red/green
plant-verified in live Actions runs), #9 SHIPPED (`a56a726` — the
malformed-dataset sweep enumerates routes from the OpenAPI schema, 3→18
swept), #10 pre-commit hooks DECIDED NO (reopen condition recorded),
and owner-parked #8 folded up to MAIN Owner gates. **Remaining
actionable dev work: NONE** — everything open is owner-, sequencing-,
or evidence-gated.

Prior (fifteenth pass, 2026-07-31). **The four-agent queue
sweep SHIPPED and the plot-workflow design is SET.** Four parallel worktree
agents, zero merge conflicts, one merged-tree gate (backend 3,422 / frontend
suite + build + lint green, eager 898.4 kB): P3.4 server-side payload
decimation (147.5→3.49 MB @1M×7, ~93×; overlay/error-bar paths stay
full-res; zoom-refetch residual booked as a new row), P2.8 regrid
gridded-input fast path (37→1.24 s @1M, scattered path byte-identical),
ROBUSTNESS Tier 1 (#1 second Node CI lane, #2 `node-version-file` single
source + engines ≥22, #3 streamed uploads with a 512 MiB evidence-based cap
→ 413), and the JMP residual wave (J8 UI → J8/J10/J3/J7 ALL fully closed;
Dixon table verified correct, unchanged). Every census-independent JMP
register item is now shipped. Same session, the owner set the import→plot
workflow design (4 structured decisions): new sub-plan
`plans/PLOT_WORKFLOW_PLAN.md` — technique tags, silent standard-plot
defaults, batch overlay offer, per-technique view memory; explicitly NOT
Gate-A-sequenced. Its Tier 1 refills the actionable table below.

Prior (fourteenth pass, same day). **Both export-dialog
defects CLOSED** — a `git branch --no-merged main` check found their fix
COMPLETE but UNMERGED on an orphaned worktree branch (`29ad044`, authored
2026-07-26, the night the defects were booked; the spawning session ended
before merging). Adversarially re-verified against current main, gated
(lint / 5,076 vitest / build + ratchet), merged. Row removed below;
outcome in the PRIMARY plan's Completed section. The no-merged check is
now part of every reconcile pass.

Prior (thirteenth pass, 2026-07-29). **JMP #14's
module-size follow-ups SHIPPED** — `routes/export_figures.py` 493→323
(new `export_statplots.py` sibling), `lib/api.ts` 2,282→1,895
(`lib/api/http.ts` + `lib/api/stats.ts`, re-exported so no consumer
moved), `useDistribution.ts` 583→492 (`useDistributionByLevels.ts`).
The row is removed below per the archival rule. The real finding was
the missing guard, not the three files: non-store `.ts` had neither a
ceiling nor pins, so a new `MODULE_PINS` ratchet in
`architecture.test.ts` now covers it (both branches verified by
planting violations). Same pass, a second defect found and FIXED: the
frontend suite failed **176 tests on a clean checkout** under Homebrew's
Node 26 — Node 20+ ships its own `localStorage` global whose accessor
shadows jsdom's and returns undefined without `--localstorage-file`, so
every persistence test died on a message naming neither Node nor the
flag. CI runs Node 22 and could not see it. `src/test/setup.ts` now
installs a real jsdom Storage when the global is missing (suite:
**348 files / 5,055 tests green on Node 26**); PR #93's `.nvmrc` Node-22
pin was merged alongside it as belt-and-braces, not as the fix. Open
question for the owner, from #93's own description: `fermiviewer` pins
Node with **Volta** — standardizing both repos on one mechanism would
drop the second.

Prior (twelfth pass, 2026-07-28). **The mission now
includes JMP** (owner directive): `plans/JMP_GAP_PLAN.md` is a new
MAIN sub-plan holding the code-grounded JMP gap register (J1–J17).
New actionable rows below (census-independent Tier 1 backend/UI halves);
new owner row (Gate J usage census + JMP switch trial); GOTO's
stats-platform non-goal superseded and PRIMARY P2.6's demand clause
satisfied, both annotated in place.

Prior (eleventh pass, 2026-07-27). **The final measurement
wave is DONE** (`2ea1f9a`) — every locally-measurable P0.4 case is now
measured; the TTFP anomaly is resolved (harness pins the focused window;
4–13 ms deterministic). It surfaced two defects (export-dialog SVG hang;
missing vector-copy menu item) and the map-regrid mechanism (full-input
Delaunay per regrid, 37 s @1M — P2.8's profile requirement satisfied),
all booked as actionable rows below alongside the payload-decimation
queue head. Earlier same pass: the window-mount "divergence" fix
(`89499cc` — render-phase memoization; window open 6.1→3.8 s).

Prior (tenth pass, same day). **The feedback/cancel tails
SHIPPED** (`9e2e476`: job-queued model scan with progress + cooperative
cancel — the queue's second producer; per-peak `fitEach` progress +
cancel; ReportPanel format labels) — the P0.4 ">500 ms feedback/cancel"
acceptance box is CLOSED. The window-mount divergence fix is in flight
(its agent is A/B-measuring); it remains the one actionable row until its
result lands.

Prior (ninth pass, 2026-07-26). **Slice 4 + the P4.1 lazy
boundary SHIPPED in parallel** (`65e3670` staged window hydration:
time-to-first-paint on a 188 MB restore 906→106 ms, freeze −24 %;
`95bf0b2` CalcOnlyApp dynamic import: eager 948.4→881.2 kB, budget
ratcheted DOWN to 919.2 kB, 38 kB headroom restored). The freeze target
was missed for a NAMED reason now at the queue head: a window on the 1M
dataset mounts in ~6 s while the same data's stage frame takes 874 ms —
that divergence is the one actionable row. PR #90 (tray icon + README
branding, ChatGPT) was adversarially reviewed, PyPI-image defect fixed,
and squash-merged (`c76cdee`).

Prior same day (eighth pass). **P3.4 slices 1–3 ALL
SHIPPED** (`3c3ccee` pendingOps + universal async-command signal;
`08c6a5b` cancellable import + double-import guard, live-verified at 1M
rows; `481e0ea` workspace-open busy state + worker parse). Slice 3's
instrumentation CORRECTED the freeze attribution — parse is ~0.5 s, the
real ~5–6 s is React render/window-mount, now booked as **slice 4** (the
one actionable row). The owner's branding drop (icons/favicon/brand
source) was adversarially reviewed and merged (`8fad871`). Eager-bundle
headroom is down to **0.8 kB** — P4.1's lazy-boundary item is imminent
and gates any new eager UI.

Prior same day (seventh pass). **The large
derived-`.dwk`/1M-worksheet measurement is DONE** (`be40a69`): worksheet
virtualization and autosave hold at 1M-row scale (bounded DOM, 51 ms
scroll p95, a 188 MB IndexedDB write succeeds), and the reopen path
freezes the renderer **5.8 s** in synchronous `JSON.parse` — P3.4 slice 3
is upgraded from conditional to confirmed. Every locally-measurable P0.4
case is now measured; P0.4's remaining opens are browser-side big maps,
UI copy/export at 1M, P1.1-blocked offline transitions, and the owner's
real-GPU zoom check. The actionable queue is P3.4 slices 1–3.

Prior same day (sixth pass — executing the fifth pass's
queue). **`_detect_layout` SHIPPED** (`9f12216`: lazy + chunk-vectorized
scoring, 1M-row import ~7→4.72 s, 36 differential tests). **The >500 ms
feedback/cancel audit is DONE and the criterion is NOT met** — the job
queue has one producer (DREAM fit, the only op with progress + cancel),
zero `AbortController` anywhere; ranked gaps are now P3.4 slices 1–3 in
the actionable table (the audit satisfies P3.4's Gate E evidence rule).
The large derived-`.dwk`/1M-worksheet measurement is in flight. CLAUDE.md's
"WebSocket job queue" description was corrected (poll-based; single
producer).

Prior same day (fifth pass, ChatGPT-Sol status audit after
v0.12.0). The performance sprint is real and green, but "all work that does
not require the owner is implemented" is false. The immediate owner-free P0.4
queue has three rows: `_detect_layout` scoring, a large derived-workspace
measurement, and the >500 ms progress/cancel audit. P1.1-P1.7 and later
P2/P3/P4 engineering are incomplete but sequencing-gated; they are not owner
actions and must not be described as shipped. This dashboard now distinguishes
**actionable now**, **sequencing-gated**, and **owner/evidence-gated** work.

Prior same day (fourth pass). **The viewport-rebuild fix SHIPPED**
(`bcbfb2e`: committed view limits apply via `u.setScale`/no-op instead of
tearing down the uPlot instance; autoscale transitions still rebuild by
design). Zoom p95: F3 **86 ms — meets the 100 ms target**; F1
238→**112 ms** under headless software rendering, with the last 12 ms
deliberately NOT booked pending a real-GPU re-measure.

Prior same day (third pass). **Both P0.4
follow-ups SHIPPED** (`244551c` window-aware plot decimation, default-on,
7M→~82k points fed to uPlot; `51af22d` bounded sniffer reads 63→0.5 ms +
vectorized column conversion, import peak 1,117→869 MB). The <100 ms zoom
target is NOT yet met (259→238 ms): each fix exposed and root-caused the
next term, both code-verified and re-booked below — the PlotViewport
teardown on committed zoom, and `_detect_layout`'s per-cell scoring.
Numbers in `docs/performance_envelope.md` §Follow-up run.

Prior same day: **P0.4's core envelope SHIPPED** (`5a2ce6e` backend + `5c938b9` frontend harnesses + first
dated run; synthesis in `docs/performance_envelope.md`). The measurement row
below is replaced by the two evidence-backed follow-ups it produced: the
interactive plot path has NO point reduction (78 MB JSON payload and zoom
p95 259 ms at 1M×7 — pan meets <100 ms everywhere), and CSV import costs 16×
file size in peak memory with whole-file sniffer reads in front. Persistence
measured cheap at 50-dataset scale (P1.2's container question: not required
there). P0.4 stays open only for named residuals (worksheet grid @1M, big
`.dwk`, browser maps, offline transitions — last one blocked on P1.1).

Prior same day: P0.3's dev half SHIPPED (`9d4ce6d`:
`tools/baselines/` deterministic generator, 9 matrix-validated fixtures,
`docs/timed_workflow_baselines.md` protocol + results template); its residue —
the first dated timed runs — needs the owner's hands and moved to Owner
actions. **P0.4 is now unblocked** (its P0.3-fixtures dependency shipped; the
`--large` generator produces the 1M-row/large-map/dense-multiseries set on
demand). The grouped-factors fixture probe produced concrete P1.4 evidence
(text columns cannot enter as import data: silent all-NaN time axis or a hard
`ValueError`, depending on column order) — recorded under P1.4 in the plan.

Prior: 2026-07-25 (late — standing-issues sweep). P4.1 (lint
restore) and P4.2's npm-ci reproducibility item SHIPPED (PRs #88/#87);
PORT_PLAN #54's four SPC/JCAMP defects ALL fixed same-day they were booked
(PR #89) — including the silent m_xyxy data loss; the glib Dependabot alert
was DISMISSED as tolerable risk (Linux-only transitive dep, fix blocked on
Tauri adopting gtk-rs 0.20; dated rationale on the alert). Rows removed per
the archival rule; outcomes live in the plans' Completed/struck entries.

Prior: 2026-07-25 (fresh primary-software readiness audit) —
`plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` owns the new evidence-led,
multi-session campaign. Its Gate A acceptance work comes first; implementation
priorities are conditional on the resulting friction log. The prior MAIN
#30–#38 campaign is complete and is not being reopened.

Prior: 2026-07-25 — a ChatGPT-Sol follow-up audit added MAIN
#31–#38 after checking the current implementation against the owner's
OriginPro daily-driver workflows. Summarized in Actionable dev work below;
MAIN_PLAN holds the problem, goal, completion criteria and dependencies for
each. **All eight problem statements were verified against the code before
booking** — several are quoted from the implementation's own docstrings
(`recentFiles.ts` on picker-only reopen, `autosave.ts` on the ~5 MB quota,
`plotExport.plotPngBlob` on the screen-resolution grab). Two corrections were
applied during that review: #32's quota failure is NOT silent
(`useWorkspaceAutosave.ts` sets a status message — the real gap is that a
transient line is weaker than a persistent error, plus no durable generations),
and the audit's per-item Claude-model routing was dropped from both files as
stale process detail that does not belong in a plan. Earlier the same day, a
plan-TREE consolidation audited the set of plan FILES and found two that no
dashboard derived from:

- **The two orphan ChatGPT-"Sol" audit docs were absorbed and DELETED**
  (`SOL_FEATURE_GUI_INTERACTION_AUDIT.md`, 924 lines / 257 permanently-unchecked
  boxes; `SOL_ORIGINPRO_REPLACEMENT_AUDIT.md`, 261 lines). Neither declared a
  `**Parent:**`, neither appeared in the plans dashboard below, and
  `GUI_INTERACTION_PLAN.md` had to carry a standing disclaimer that the raw
  audit's unchecked boxes were *not* current status. That is the
  plan-consolidation rule's warning sign verbatim. Full text stays in git
  history @ `e4f6590`.
- **Absorption was verified against the code before deleting, not assumed.** Of
  the findings the audit itself still listed as open: the pipeline
  `executeSteps` fit-step channel residual is **shipped** (it replays a typed
  per-step spec via `fitSpecFromStepParams`/`fitDataForSpec` with a legacy
  fallback — exactly the prescribed fix), and the baseline residual is **shipped**
  behind the GUI #5 gate resolution. The Origin-migration and owner-decision
  findings were already tracked as gates or blocked rows below.
- **Two findings were booked NOWHERE and became MAIN #29 and #30** — the
  frontend bundle (measured today at **1,120.96 kB** in one chunk, up from ~969 kB
  at audit time) and the fit-recipe residual fields.
- **#29 SHIPPED the same day** — eager JS **1,120,960 → 932,219 B (−16.8%)** by
  lazy-loading the 25 flag-gated workshop panels out of `AppOverlays.tsx`, plus a
  `check-bundle-size.mjs` ratchet wired into `npm run build` that budgets *eager*
  JS (entry + modulepreloads = what the browser fetches before first paint) and
  fails BOTH over budget and well under it. Both branches were verified by
  planting violations. #30 remains the one open dev row.

Prior: 2026-07-24 — a FULL reconciliation pass, prompted by
finding that several rows below had gone stale against the plans they derive
from. What changed:

- **ORIGIN #54's generalized page/layer MODEL is COMPLETE.** Pass B (the y2
  singleton) shipped `50b4c9c`, joining A + C. One pure `lib/axisspec.ts`
  now owns the y2 representation and derivation; the pass surfaced a real
  screen-vs-export divergence (the spatial page export omitted `y2_fmt`
  entirely, so a non-default Y tick format formatted the primary axis only).
  Corpus swept both ways: identical, zero regressions. #54's only remaining
  sub-item is the specimen-gated >2-Y-axes rendering, which is evidence-
  blocked, not actionable — it has moved to the blocked table.
- **Security: 13 of 14 Dependabot alerts CLOSED** (`c63f7af`) — pillow
  12.2.0→12.3.0 (10 high + 3 medium) and setuptools 82.0.1→83.0.0. Only the
  upstream-blocked `glib` alert remains. All ten open Dependabot PRs were
  applied in that one commit, plus TypeScript 5.9.3→7.0.2 (`f398ac9`).
- **Four owner gates were already answered and are struck below** — GOTO Q6
  (worksheet reshape) and Q7 (date-time axes) were DECIDED YES and SHIPPED
  on 2026-07-19; GUI #1 (undo scopes) and #5 (baseline framing) were RESOLVED
  the same day during the Codex-stack review; GUI #2 (Plot Objects tree
  scope) was delivered by PR #66, so its gate is moot.
- **GUI #17 is fully complete** — the three items this file still listed as
  remaining (split buttons, the cross-menu ownership move, first-run
  interaction hints) are all struck in the plan.
- **v0.11.1 is the version in `pyproject.toml`** (v0.10.0 in the old note
  below was two releases stale).

Prior: 2026-07-21, after the three index-staleness follow-ups
booked 2026-07-19 ALL shipped (background-window view remap, spec re-key by
label, corrections overlay-clear — see the section below), plus a fourth
`reimportDataset` view-scoped clear found and fixed while working the first.
Prior: 2026-07-19, after ORIGIN_FILE_DECODE #54's page/layer
model passes A + C shipped (composition discriminated union replacing the three
parallel panel arrays, then PlotSpec's reserved `page` block filled). Prior context:
2026-07-18, after the six-PR Origin visual-import stack
merged and received an independent tip verification (frontend 3,759 + build,
18/18 Playwright, full corpus baseline-identical). The last full regeneration
was 2026-07-17, at the end of the autonomous GUI_INTERACTION campaign (11
merges; CI + CodeQL + live E2E all green): the
entire no-blocker actionable list was worked — #3, #7, #9, #10, #13, #14
CLOSED in full; #8, #11, #15 CORE shipped with residuals re-dashboarded
below; plus the ORIGIN_FILE_DECODE #54 spatial page-coordinate export
residual and an `appCommands.ts` decomposition (684→36, per-domain
`commands/*` modules, pin 684→56). Verified on the final merged tree:
frontend 3736 unit + 18 Playwright e2e + build green; backend 2906 + ruff +
mypy green. What remains actionable = the #8/#11/#15 residual rows
(#12 CLOSED 2026-07-18, see the plan's Completed section),
Tier 3 larger bets, and #54's explicit page/layer architecture residual.
Origin graphic objects (#53) are evidence-gated, not routine implementation.
The #55 owner screenshot-review
gate is unchanged (62 paired screenshots, 0/353 reviewed). v0.10.0 is the
current release. Prior context: GUI_INTERACTION adopted 2026-07-12 from the
ChatGPT-Sol audit; MAIN holds only owner gates + deferrals; the
fresh-machine PyPI acceptance run is still open.)
