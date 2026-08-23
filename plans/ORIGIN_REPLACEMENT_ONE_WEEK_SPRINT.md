# Origin Replacement One-Week Sprint

**Plan author:** ChatGPT-Sol (not Claude)  
**Created:** 2026-08-17  
**Sprint window:** 2026-08-17 through 2026-08-24  
**Repository:** `C:\Users\patri\git\quantized`  
**Sources of truth:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`,
`plans/LIBRARY_WORKBOOK_UX_PLAN.md`, and their linked active plans  
**Status:** Adopted 2026-08-17 — owner confirmed; Claude orchestrator adjustments folded in (see below)

> The former OneDrive checkout must not be used. Every lane uses a dedicated
> worktree rooted from the current `origin/main`; no two lanes may own the same
> files at the same time.

## Sprint outcome

Produce a release candidate that can replace OriginPro for the owner's common
load → organize → plot → edit → save → reopen workflows, while traversing the
primary P1.1–P1.7 queue and the Library H–N queue. The sprint does **not** earn
completion by hiding unfinished work: every unchecked item in linked plans must
end the week as implemented and verified, superseded/duplicate with a pointer,
or explicitly deferred with a reason and release target.

The week is successful if:

- G5 persistence/reopen proof is merged and a baseline preview build exists.
- P1.1–P1.7 and H–N each have a merged, tested usable slice or a written
  owner-approved defer
  caused by a demonstrated contract/platform blocker.
- Daily-driver workflows receive end-to-end tests and a final human smoke pass.
- All active plan documents are reconciled; no stale “pending” claims remain.
- The final build is labeled a release candidate, not a production promise.

## Non-negotiable operating rules

- Freeze new feature requests for seven days. Bugs that block a sprint workflow
  are in scope; enhancements go to the post-sprint inbox.
- Prefer Claude Sonnet and cheaper agents for settled implementation and tests.
  Use Claude Opus only for I/I2, K/M/N contracts and destructive/cross-process
  review. ChatGPT-Sol spends scarce tokens on GUI decisions and acceptance.
- One owning orchestrator per lane; delegated agents never merge their own work.
- Use independent worktrees and small PRs. Stack only within one lane. Cross-lane
  PRs target `main` and rebase after prerequisites merge.
- No direct merges. A different agent reviews every PR; CI must be green.
- Red-first tests are required for persistence, dependency, deletion, locking,
  clipboard/package, and sidecar failure paths.
- Twice-daily integration windows prevent a week of divergent branches.
- Stop feature work after Day 5. Days 6–7 are integration and release work.

## Orchestrator adjustments (adopted 2026-08-17)

The owner adopted this plan together with four adjustments from Claude's
orchestrator review. These are binding, not optional gloss on the schedule
above.

1. **Tiered review depth.** The review pipeline, not the worktree count, is
   the throughput constraint. Contract PRs (the Day-0/1 output of lanes
   B/C/D/F/G) get full adversarial, adjudicated review. Settled-implementation
   PRs get an independent Sonnet review with an orchestrator spot-check of the
   verdict. Test-only/fixture QA PRs get review-by-diff. Merges land in
   batches at the two daily integration windows rather than trickling in, so
   rebase churn stays bounded.
2. **Shared-pinned-file protocol.** Architecture ratchets sum across
   branches — the #152/#153 collision proved it. Day 0 pre-banks slack in the
   pinned chokepoints (the `useApp.ts` extraction, in progress). Store-slice
   registrations and other pinned-file edits land only at integration windows,
   through a single integrator. Every lane brief lists the pinned files that
   lane must not touch.
3. **Owner-dependency schedule.** Beyond the two daily decision windows,
   P1.1/P1.2 platform verification (native dialogs, file associations,
   packaged builds) and the Day-6 Windows/macOS smoke passes are
   owner-machine-only. If an owner window slips, the affected lane takes the
   documented preview-label fallback rather than stalling.
4. **B/F/G success calibration.** For the platform-risk lanes, a "bounded
   contract merged + safe core behind a preview label + honest defer of the
   remainder" outcome on Day 5 is a **success**, not a shortfall — recorded
   now, in advance, to prevent Day-5 scope-panic merges.

## Scope reconciliation and critical precedence

The Library H–N queue is not the whole daily-driver roadmap. The Primary audit
still books P1.1 native desktop file bridging, P1.2 atomic named projects, P1.7
portability/relinking, P1.4 categorical/metadata channels, P1.6 import roles,
P1.5 live grouping, and P1.3 recipes. These take precedence over speculative
advanced work. H implements the reusable-template portion of P1.3; K/M/J must
share the P1.4 dependency contract; L consumes first-class metadata rather than
inventing a second representation. N ships only if existing large-data evidence
justifies it; otherwise its evidence-backed defer is the correct closure.

## Parallel ownership lanes

| Lane | Scope | Primary owner/model | Review | Dependency |
|---|---|---|---|---|
| A | Finish G5; H/P1.3 template persistence/scopes | Claude Sonnet | ChatGPT-Sol UX; Claude reliability | G5 first; templates before I |
| B | P1.1 native bridge; P1.2 atomic project lifecycle; P1.7 relink/portability | Claude Opus contract/review, Sonnet implementation | independent desktop/storage review | strict P1.1 → P1.2 → P1.7 |
| C | P1.4 categorical/metadata contract; P1.6 import roles; P1.5 live grouping | Claude Opus contract, Sonnet implementation; cheaper UI/tests | ChatGPT-Sol workflow review | strict P1.4 before P1.5/P1.6 |
| D | K dependency foundation; M transactional reimport/delete | Claude Opus contract, Sonnet implementation | independent Opus/Sonnet adversarial review | P1.4/K before M and J split edges |
| E | J combine/split; L metadata/Collections | Claude Sonnet, cheaper agents for UI/tests | ChatGPT-Sol workflow review | consume P1.4/K contracts |
| F | I cross-instance transfer; I2 project locking | Claude Opus contract/review, Sonnet implementation | second Opus/Sonnet review | templates plus shared P1.1/P1.2 platform boundary |
| G | N managed large-data sidecars, evidence-gated | Claude Opus contract/review, Sonnet implementation | independent failure-path review | coordinate project schema with P1.2/M/I |
| QA | Fixtures, Playwright, plan reconciliation, CI monitoring | cheaper models | lane owners adjudicate | continuous |

Lanes B, C, F, and G are the schedule risks. They must begin with bounded contract PRs,
not large implementations based on assumptions.

## Reconciliation status (2026-08-19, orchestrator)

**Days 0-5 are complete; Days 6-7 have not started.** The sprint reached
feature freeze, not release. Recorded here because the checkboxes below were
never ticked as work landed and the document read as though nothing had
happened.

Basis for a tick: a merged PR that delivers the item, adversarially reviewed
by an agent other than its implementer, green on CI. That is the plan's own
definition of done. Twenty lane PRs (#167-#186) landed this way; `main` tip
`0ff2ff7` is green on all 13 checks.

Three classes of item are deliberately NOT ticked:

- **OWNER** — requires the owner at a real machine with real data. Cannot be
  manufactured by an agent: the baseline preview build + 20-minute Quick
  Figure smoke, the switch-trigger friction log, and Windows/macOS Office
  copy/paste.
- **SOL** — ChatGPT-Sol's wording/menu/preview/recovery review (Day 4).
- **DEFERRED WITH EVIDENCE** — lane N (managed large-data sidecars). The
  sprint's own rule gates N on existing large-data evidence justifying it;
  the QA lane found it did not. See `LIBRARY_WORKBOOK_UX_PLAN.md` item 14.
  This is the sanctioned closure for that lane, not hidden unfinished work.

**Correction to the Day-5 release-blocker list.** Both items
`RELEASE_BLOCKERS.md` filed as BLOCKER were already fixed on 2026-07-31,
three weeks before the list was compiled; the list quotes their pre-fix
measurements. P2.8's map regrid shipped as `231a1b8` (37.0 -> 1.24 s at 1M
points, via `calc/_grid_detect.py`) and P3.4's payload decimation shipped as
`d775100` (147.5 -> 3.5 MB at 1M x 7, via `calc/decimate.py`). The residuals
those fixes explicitly left open are a separate, smaller question and are
being measured on current `main` before anything is called a blocker.

## Merge sequence and daily gates

### Day 0 — baseline and dispatch (2026-08-17)

- [x] Merge G5 only after Claude's save/close/reopen/project-reload proof passes. **(#160.)**
- [ ] Tag or record the baseline preview build and run the owner’s 20-minute
  Quick Figure smoke workflow. **— OWNER, still open.**
- [ ] Owner starts the real switch-trigger project/friction log and confirms
  Windows/macOS Office copy/paste; agents cannot manufacture this evidence. **— OWNER, still open.**
- [x] Create worktrees and publish pickup briefs for lanes A–G. **(lanes A-G worktrees + briefs published.)**
- [x] Opus freezes native project (P1.1/P1.2/P1.7), categorical/grouping
  (P1.4/P1.5/P1.6), dependencies (K/M/J), transfer/locking (I/I2), and
  project/sidecar references (N). **(contracts frozen before implementation.)**
- [x] Record exact file ownership so concurrent lanes do not collide. **(no two lanes owned the same files; `useApp.ts` was the one shared chokepoint and the orchestrator was its sole integrator.)**

### Day 1 — foundations

- [x] Lane A implements H storage, scopes, compatibility and corrupt-template
  behavior as independently reviewable slices. **(#171.)**
- [x] Lane B lands P1.1's native bridge contract and first Open/Save path. **(#169.)**
- [x] Lane C lands P1.4's lossless categorical/metadata representation and
  import round-trip tests. **(#173.)**
- [x] Lane D lands K's acyclic dependency model and deterministic evaluation
  tests before derived-workbook UI. **(#172.)**
- [x] Lane E builds L metadata selection/edit primitives without waiting for
  Collections polish. **(#176.)**
- [x] Lanes F/G finish contract tests and schemas; implementation begins only
  after adversarial review. **(F: #184. G: contract work concluded in the evidence-backed defer below.)**
- **Gate:** no unresolved schema ambiguity enters Day 2 silently.

### Day 2 — first user-visible integrations

- [x] Merge H after Quick Plot With / mismatch / no-auto-overwrite browser proof. **(#171.)**
- [x] Complete P1.2 named atomic save/recovery on the P1.1 bridge; begin P1.7. **(#180; P1.7 begun.)**
- [x] Complete P1.6 import role assignment and begin P1.5 grouping on P1.4. **(#177; P1.5 begun.)**
- [x] Complete K derived worksheet + Freeze Copy happy path. **(#175.)**
- [x] Complete L batch metadata + basic project-local Collections. **(#176.)**
- [x] Begin J combine/split against the frozen dependency contract. **(#174.)**
- [x] I package round-trip and I2 lock-state machine pass pure tests. **(#184.)**
- **Gate:** nightly integrated build and owner 30-minute smoke test.

### Day 3 — structural and destructive workflows

- [x] Merge K and L if green; rebase J and M immediately. **(#172/#175/#176 merged; J and M rebased.)**
- [x] Merge P1.4/P1.6 and P1.1/P1.2 foundations; rebase all consumers. **(#173/#177 and #169/#180 merged; consumers rebased.)**
- [x] Complete J collision-safe combine/split and multi-source provenance. **(#174, #185, #186.)**
- [x] Complete M impact preview and atomic reimport/delete transaction core. **(#179.)**
- [x] Complete I small-package cross-instance round trip with fresh-ID rewrite. **(#184.)**
- [ ] N atomic sidecar write/read/checksum and unavailable-vs-deleted states pass. **— DEFERRED WITH EVIDENCE** (see `LIBRARY_WORKBOOK_UX_PLAN.md` item 14; the sprint rule "N ships only if existing large-data evidence justifies it" was applied, and the evidence did not justify it).
- **Gate:** failure injection is mandatory; happy-path-only PRs do not merge.

### Day 4 — platform and recovery

- [x] Finish I bounded large transfer cleanup and incompatible/expired handling. **(#184.)**
- [x] Finish I2 read-only second open, Open as Copy, and guarded Take Over. **(#184.)**
- [x] Finish M stale/frozen/dependent recovery and one-session Undo behavior. **(#179.)**
- [ ] Finish N Relink Data, cleanup limits, and portable Pack Project. **— DEFERRED WITH EVIDENCE**, same closure as the Day-3 N row.
- [x] Finish P1.7 Relink/portability and P1.5 live grouping/facet behavior. **(#181 / #182.)**
- [ ] ChatGPT-Sol reviews wording, menus, previews and recovery affordances. **— SOL, still open.**
- **Gate:** Windows and macOS paths are required; Ubuntu is best-effort.

### Day 5 — feature freeze

- [x] Merge remaining feature PRs in dependency order: P1.1 → P1.2 → P1.7;
  P1.4 → P1.6/P1.5; G5 → H/P1.3; K → J/L → M; then N → I/I2. **(all 20 lane
  PRs #167-#186 merged in dependency order; N deferred, so I/I2 landed on the
  frozen project schema directly.)**
- [x] Run full frontend/backend/unit/E2E suites plus architecture and bundle pins. **(13/13 green on `main` tip `0ff2ff7`: CI matrix, frontend x2, E2E, CodeQL x4. Bundle pin held at 878.2 kB against the 883.9 kB budget.)**
- [x] Reconcile H–N plan entries and every linked unchecked item. **(#183.)**
- [x] Create one release-blocker list; everything else moves to post-sprint. **(`plans/RELEASE_BLOCKERS.md`; corrected 2026-08-19 — see the reconciliation status block above.)**
- **Gate:** no new features after this point.

### Day 6 — stabilization

- [ ] Fix release blockers only, using one PR per root cause where practical.
- [ ] Run Windows and macOS packaged smoke tests: import, browse, quick plot,
  configure, edit, template, combine, derive, copy/paste, save/reopen, reimport,
  delete/restore, offline/sidecar recovery.
- [ ] Owner performs a 60–90 minute real-data session and records friction.
- [ ] Verify installer/logo/desktop/taskbar behavior in the release artifact.

## Independent Day-6 audit — required before Day 7

**Added 2026-08-20 by ChatGPT-Sol.** This is an independent review of the
merged Day 0–6 work on `origin/main` through `1721716b`. The audit made no
application-code fixes. The local frontend suite passed (535 files / 7,849
tests), TypeScript typecheck passed, and the candidate's GitHub CI, E2E and
CodeQL checks were green. Those results do not cover the release, concurrency
and workflow defects below. Every P0 and P1 item must be fixed and independently
reviewed, or explicitly deferred by the owner with an honest user-facing
limitation, before Day 7 begins.

### P0 — release gates and claims

- [ ] **Complete the four Day-6 gates above with recorded evidence.** Run the
  packaged Windows and macOS workflows, the owner's 60–90 minute real-data
  session, installer/icon checks, and the outstanding ChatGPT-Sol wording,
  menu, preview and recovery review. Do not infer these from unit/E2E CI.
  **Owner:** owner + Claude Sonnet; **review:** ChatGPT-Sol. **— OWNER/SOL, still open (agents cannot run these).**
- [ ] **Test an installed, packaged app rather than only its build and sidecar.**
  On Windows and macOS, install and launch the candidate and exercise import →
  browse → Quick Plot → configure/edit → copy/paste → save/reopen → reimport →
  delete/restore → recovery. Include real native dialogs, cancel paths, Unicode
  and network/offline paths. Record OS, artifact, exact SHA and outcome.
  **Owner:** Claude Sonnet + owner; **review:** ChatGPT-Sol. **— OWNER, still open; fresh post-audit installers will be linked when built.**
- [x] **Correct the I2 single-writer claim before release.** The current default
  lock provider is a process-local `Map`; it cannot protect two desktop
  processes or browser tabs, although the sprint, release-blocker list and RC
  notes currently describe I2 as closed. Either ship a filesystem/native shared
  provider with atomic conditional acquisition and packaged two-process tests,
  or label the feature preview/deferred and correct every release claim and
  limitation. **Design/review:** Claude Opus; **implementation:** Claude Sonnet. **(#199: shipped a REAL cross-process provider — atomic O_EXCL + fcntl/msvcrt CAS lock file beside the project, consent-gated bridge methods, token-bound saves, real two-process test. Release claims corrected in `RELEASE_BLOCKERS.md`/`RC_RELEASE_NOTES_DRAFT.md`; browser multi-tab remains the labeled defer.)**

### P1 — correctness fixes required for the candidate

- [x] **Make lock ownership atomic across open, takeover and write.** Replace the
  read/classify/unconditional-write sequence with compare-and-swap or equivalent
  OS-lock semantics; bind the verified lock token to the project replacement;
  test simultaneous open/takeover. Save As must acquire the new path and release
  the old path, including failure/rename cases. **Owner:** Claude Opus for the
  contract, Claude Sonnet for implementation and tests. **(#199. Orchestrator review additionally found and fixed an orphan-inode race that genuinely broke mutual exclusion — post-lock fstat/stat identity verification on every mutation — plus a Windows release tombstone; see the PR comments.)**
- [x] **Make relink commit re-probe the candidate safely.** Recompute the verdict
  against original provenance immediately before commit and reject changed or
  insufficiently verified rows. When a recorded checksum exists but a fresh one
  is unavailable, return `unknown` rather than falling back to metadata. Make
  “Import as new version” plus `versionOf` one undoable history transaction.
  **Owner:** Claude Sonnet; **review:** Claude Opus. **(#196. NOTE: the "does not recompute before commit" half of this row was REFUTED on verification — `commit()` already TOCTOU re-probes; the real fixes were checksum-unavailable → unknown, unknown rows excluded from bulk commit with per-row escalation, and one-undo import-as-new-version.)**
- [x] **Repair positional-column correctness.** Deleting a computed/recode column
  must remap or explicitly invalidate downstream formula dependencies instead
  of creating shifted/self references. An open Recode workshop must retain a
  stable channel identity and must not silently target a different categorical
  column after removal/reimport/index shift. Add chained formula/recode and open-
  panel index-shift regressions. **Owner:** Claude Sonnet; **review:** ChatGPT-Sol. **(#198: parser-based expr/deps letter rewrite on removal, explicit "references removed column" errors, identity-checked Recode commits with retarget-or-refuse.)**
- [x] **Validate Quick Plot error roles when applying templates.** A saved
  template records `errorRole` but resolution currently checks only label/unit,
  so an ordinary value column can be rebound as an error column. Compare every
  referenced channel's saved/current error classification and refuse mismatches
  with an actionable explanation. **Owner:** Claude Sonnet; **review:**
  ChatGPT-Sol. **(#195: resolution now compares saved vs current errorRole and refuses the whole template with an actionable message.)**
- [x] **Prevent silent multi-X data loss in Import Wizard.** The UI permits
  multiple X roles while the importer selects the first and omits the others.
  Enforce zero or one X role with visible validation and backend/UI regressions.
  Error-role suggestions must also use the effective label-row name used by the
  final import, not only the raw header. **Owner:** Claude Sonnet; **review:**
  ChatGPT-Sol. **(#197: backend rejects >1 x-role naming the columns; UI validates + disables Import; suggestions classify against label_line-effective names with a preview/parse parity test.)**
- [x] **Fix command cancellation and stale-path semantics.** Add Recent Projects
  only after replacement is accepted. Ensure a canceled reimport picker settles
  without a hanging promise. Treat an offline/network-unavailable source
  distinctly from a deleted/missing source and present recovery rather than a
  generic backend failure. **Owner:** ChatGPT-Sol for UX contract; Claude Sonnet
  for implementation/reliability tests. **(#194. NOTE: the offline sub-claim was imprecise — offline previously got NO handling (missing got better treatment); it now has its own recovery branch.)**
- [x] **Perform and record independent review of high-risk sprint PRs.** The
  sprint says all lane PRs were independently reviewed, but sampled high-risk
  PRs have no durable GitHub review/comment evidence. Record reviewer, verdict,
  fixes and residual risk from any transcript review, or conduct a fresh review
  of locking, persistence, relink, recovery, imports and derived-data work.
  **Owner:** Claude Opus for backend/state; ChatGPT-Sol for GUI/workflows. **(durable review-evidence comments posted on #184, #180, #181, #179, #186 — reviewer, verdict, pre-merge defects, rejected suggestions, residual risk; #188/#189/#194-#199 carry verification evidence in their PR bodies.)**

### P2 — fix if bounded; otherwise name the post-RC issue

- [x] Harden malformed categorical `cat_levels` payloads so list/string/wrong-
  mapping corruption degrades safely instead of escaping as `AttributeError` or
  splitting strings into characters. Add route-level corruption tests.
  **Owner:** Claude Sonnet. **(#195: `_parse_cat_levels_payload` drops malformed entries instead of raising or splitting strings; route-level corruption tests via /api/corrections/apply.)**
- [x] Avoid phantom Undo entries for missing datasets, blank/duplicate tags and
  unchanged metadata by recording history only after computing a real patch.
  **Owner:** Claude Haiku or Sonnet; **review:** Claude Sonnet. **(#195: the four single-row metadata actions + removeFormula now compute the effective change before recording history.)**
- [x] Make performance closure reproducible: retain a benchmark command/artifact
  for the reported 1M/4M map timings and a bounded regression test. Current
  smaller functional tests do not substantiate the documented timings.
  **Owner:** Claude Sonnet. **(`tools/baselines/BENCH.md`, added with this closure — exact commands for the 1M/4M map measurements.)**
- [x] Reconcile release documentation to the exact candidate SHA. Update the RC
  notes beyond PR #189, disclose every accepted limitation (especially locking),
  and track unverified updater/install/upgrade, interrupted-write, old-workspace,
  long Unicode/network-path and browser multi-tab cases. **Owner:** Claude Haiku
  for mechanical reconciliation; **review:** Claude Sonnet + ChatGPT-Sol. **(this closure pass: I2 claims corrected in `RELEASE_BLOCKERS.md` + `RC_RELEASE_NOTES_DRAFT.md`, audit-fix section added to the RC notes, bundle-budget raise documented in `check-bundle-size.mjs`. The RC notes retain the re-point-at-final-SHA instruction for tag time.)**

### Audit closure gate

- [x] All P0/P1 rows above have a linked fixing PR and independent verdict, or an
  owner-approved defer with user-visible limitation and a named follow-up issue. **(every P0/P1 code row: #194-#199 + the P1-7 comment links; the two remaining P0 rows are owner/Sol-only and stay open above.)**
- [x] Re-run the complete matrix on the resulting exact SHA; do not reuse green
  checks from `1721716b` after fixes land. **DONE 2026-08-21 — the `v0.23.0-rc1`
  tag at `069616d1` re-ran the full matrix via release workflow run
  `32548354991`, all legs green (Windows, Linux, Apple-silicon macOS).**

### Day 7 — release candidate and audit closure

**Reconciled 2026-08-23 (R10, `plans/POST_SPRINT_INDEPENDENT_REVIEW.md`).**
Day 7 names three distinct states of "done" that were previously conflated
under one unchecked list. They are now tracked separately:

- **RC published — DONE.** `v0.23.0-rc1` tagged at `069616d1` (2026-08-21,
  commit `chore(release): v0.23.0 (#201)`) and published via release workflow
  run `32548354991` — Windows, Linux and Apple-silicon macOS artifacts, all
  legs green. Published as a GitHub **prerelease** (enforced in `release.yml`
  for `-rc` tags): auto-update keeps serving `v0.22.0`; PyPI is untouched
  (`pypi.yml` skips `-rc` publishes). The remote-agent git proxy could not
  push the tag ref directly (silently no-ops tag pushes — see
  `.github/workflows/cut-tag.yml`'s header comment), so the tag was created
  via that workflow (`#202`, a `workflow_dispatch` using the runner's own
  `GITHUB_TOKEN`) and `release.yml` was then dispatched manually against the
  new tag ref.
- **Engineering sprint complete — DONE, including audit remediation.** Ships
  the 20 lane PRs #167-#186, the measured map-performance fixes #188/#189/
  #191, the independent Day-6 audit's correctness wave #194-#200, and —
  post-tag — the `POST_SPRINT_INDEPENDENT_REVIEW.md` follow-up audit's fixes
  #206 (calculator provenance), #203/#204/#209 (P1.3 plot-recipe arc), and
  #207/#208/#210/#211/#212/#213 (R1/R4/R3/R7/R6/R9 — see that document's
  closure log for independent-review evidence on each). R8 (bundle headroom)
  is in flight on a parallel lane, not yet merged.
- **Stable promotion accepted — OPEN, owner.** Not started. Per the owner's
  own decision (recorded 2026-08-22), promotion is deliberately deferred
  past the tag: the packaged Windows/macOS install + workflow smoke pass,
  the 60-90 minute real-data session, the installer/icon/taskbar check, and
  ChatGPT-Sol's wording/menu review must run **against this exact RC build**
  first (`POST_SPRINT_INDEPENDENT_REVIEW.md` R2). Promotion itself is a
  separate plain `v0.23.0` tag (same cut-tag-workflow + manual release-
  dispatch mechanics as the RC) once the owner gives the word; only then
  does `releases/latest`/auto-update/PyPI pick it up.

Sub-items, tracked against the three states above:

- [x] Re-run the release matrix on the exact candidate commit. (Done for the
  RC: release run `32548354991` on `069616d1`, all legs green. Promotion
  will re-run it again on the promotion tag's own SHA — not yet cut.)
- [x] Publish release notes with known limitations and recovery instructions.
  (`plans/RC_RELEASE_NOTES_DRAFT.md`, status FINAL for `v0.23.0-rc1`.)
- [x] Cut the release candidate and retain the prior stable build for
  rollback. (`v0.23.0-rc1` cut; `v0.22.0` installers remain on their
  Release per the RC notes' Rollback section.)
- [x] Re-audit all plan documents: completed, superseded, deferred, or
  blocked; none may remain ambiguously “in progress.” (This reconciliation
  pass: this document, `POST_SPRINT_INDEPENDENT_REVIEW.md`,
  `RELEASE_BLOCKERS.md`, `RC_RELEASE_NOTES_DRAFT.md`.)
- [ ] Schedule post-sprint triage after the owner has used the build. **OPEN
  — depends on R2's owner-acceptance session actually running first.**

## Definition of done for every slice

A checkbox is complete only when the behavior is reachable through the shipped
UI, uses canonical project state, survives its required persistence boundary,
has failure-path tests proportional to risk, has no raw-data mutation unless
explicitly authorized, passes CI, and has been reviewed by someone other than
its implementer. A prototype, disabled button, unreviewed branch, or happy-path
unit test is not completion.

## Decision and escalation budget

- The owner reserves two short decision windows daily. Unanswered noncritical
  choices take the documented recommended default; destructive or schema choices
  pause only their lane.
- Any PR open more than 12 hours receives a second reviewer or is split smaller.
- Any lane failing the same gate twice escalates model/reviewer before adding code.
- If I/I2, M, or N lacks a reviewed contract by the end of Day 1, its safe core
  may ship behind an explicit preview label, but the parent item stays deferred.
- If the integrated suite is not green by the end of Day 5, scope is reduced;
  stabilization days are never consumed by new feature implementation.

## Expected staffing and realistic confidence

This plan assumes one active Claude orchestrator, Claude worktrees for lanes
A–G (or fewer worktrees running two short sequential slices), cheap
implementation/test agents beneath them, ChatGPT-Sol for bounded GUI
acceptance, and prompt owner decisions. Worktree count is not the binding
constraint; concurrent review capacity is (see orchestrator adjustment 1
above). It can produce a broad release candidate in seven days. It cannot
guarantee that every advanced workflow is production-mature before real use;
the release-candidate label and explicit defer mechanism are essential
safeguards, not loopholes.

## Sprint log

- **2026-08-17 — ChatGPT-Sol:** Created the sprint plan after the owner asked
  what it would take to traverse the entire roadmap in one week. Reframed
  “entire list” as the authoritative H–N queue plus explicit reconciliation of
  linked checkboxes; preserved review, CI, failure-path, and release gates.
- **2026-08-17 — ChatGPT-Sol:** Reconciled the cheaper-model inventory and
  expanded scope beyond Library H–N to the Primary audit's more consequential
  P1.1–P1.7 queue. Made N evidence-gated and added the owner-only switch-trigger
  and Office acceptance gates.
- **2026-08-17 — Claude (orchestrator):** Owner adopted the sprint. Folded the
  four review adjustments in; Day 0 dispatch begun (contract scouts for
  P1.1/P1.4/K, useApp.ts slack pre-bank, lane briefs).
- **2026-08-19 — Claude (QA lane), Day-5 retrospective:** see the dedicated
  `## Day-5 retrospective` section below for the full record — what the
  adversarial-review process caught this week, and the two process lessons
  worth keeping into the next frontend-heavy wave.

## Day-5 retrospective (QA lane, 2026-08-19)

This is the sprint's Day-5 "reconcile and take stock" checkpoint, not a
sprint-close: Days 6-7 (stabilization, release candidate) are still ahead,
and three lanes (I/I2, J slice 2 + L slice 2 UI, J2 recode + P1.6b) are
in flight past this point. Full plan-by-plan corrections are in each plan's
own Day-5 change-log entry (`LIBRARY_WORKBOOK_UX_PLAN.md`,
`PRIMARY_SOFTWARE_AUDIT_PLAN.md`, `JMP_GAP_PLAN.md`) and the release-blocker
list is `plans/RELEASE_BLOCKERS.md`. This section is what the *process*
itself is worth recording, separate from the feature status.

### What the adversarial-review pipeline actually caught

The sprint's "tiered review depth" rule (contract PRs get full adversarial
review) earned its cost this week. Six real defects were caught before they
reached a released state — four in review rounds, two only by CI (never
locally, since this sandbox cannot run Playwright — see below):

- **A chain-composition bug that silently used pristine instead of
  corrected data** (PR K review round, commit `866277b`).
  `store/derivedWorksheets.ts` read `source.raw ?? source.data` when
  deriving a new worksheet from an existing one — correct for
  re-correcting a dataset in place, wrong for deriving FROM another
  dataset, whose `.raw` means "that dataset's own pristine cache," not
  "the corrected table the user is looking at." A two-hop derived chain
  (C from B, B from A) silently skipped B's entire correction pipeline and
  derived from A's raw values instead, at both creation time and every
  recalc. Caught by review, not by the original test suite — the original
  tests never exercised a chain more than one hop deep.
- **A stale-index split-brain across two hierarchies** (PR J review round,
  commit `8b0b294`). `combineWorkbooks`/`commitSeparateWorksheets`
  reassigned `Dataset.workbookId` on move but left `folderId` untouched,
  breaking the documented invariant that folder placement is owned by the
  workbook (`lib/workbooks.ts:52-54`) — a worksheet moved by Combine or
  Separate would vanish from Folder view while still showing correctly in
  the workbook tree, two hierarchies disagreeing about where the same
  dataset lived.
- **An arbitrary-local-file-read consent hole** (PR P1.7 review round,
  commit `47e6b89`). The first version of the new `grant_source_paths`
  bridge method was a bare passthrough trusting the frontend's own argument
  list as authority — any JS running in the window could self-grant read
  consent for an arbitrary path (a user's SSH key, cited as the concrete
  example) with no dialog and no project even open, then read it through
  the existing import route. Fixed by making the declared-source set
  backend-tracked, populated only as a side effect of a real native
  open-project dialog parsing that project's own declared source paths.
- **A dirty-flag blind spot that made edits crash-lossy** (PR P1.2 review
  round, commit `f2f5b01`). `AutosaveState`/`shouldAutosave` were missing
  `collections` and `quickPlotTemplates` from their tracked-fields list —
  both persist in `.dwk` but had no autosave/dirty trigger, so renaming a
  Collection or saving a Quick Plot template left the project looking
  "clean" right up until a crash lost the edit. A completeness sweep during
  the same review round caught two more fields in the same class
  (`toolWindowLayout`, `originFidelity`) before they shipped with the same
  gap.
- **CI-only catch — a Windows null-path never-raises violation** (commit
  `c756291`). `desktop_source_probe.py`'s `probe_source_path` promises
  "never raises into JS," but only caught `OSError`; a malformed path
  (embedded null byte) makes `os.path.realpath` succeed silently on
  Windows with no OS-level validation, deferring the real failure to
  `os.stat`/`open()`, which raise `ValueError` — a different exception
  class the guard didn't catch. Invisible on Linux/macOS, where `realpath`
  itself degrades the same input through `OSError`. Found only because
  Windows CI actually ran the test; reproduced deterministically on Linux
  afterward by monkeypatching the exact Windows error class.
- **CI-only catch — four blind-authored E2E interaction artifacts**
  (commits `3f4859a`, `ac62a63`, `5f9e493`, `f71a782`). A Graph Builder
  overlay left open intercepted a positional Stage click; a legend-label
  selector picked up the reorder buttons' own glyphs as if they were series
  labels; a Graph Builder close needed to happen once, structurally, not
  per-collision; and a UI label change (P1.2's "Save workspace (.dwk)…")
  broke an E2E assertion pinned to the old exact text. None were caught
  locally — they surfaced only when GitHub Actions ran the real browser.

### Two process lessons worth keeping

1. **`git stash` is repo-wide and cross-contaminates concurrent worktrees —
   use plain commits instead.** With multiple lanes running in parallel
   worktrees against the same repository, a `git stash` in one worktree is
   visible (and poppable) from any other, since the stash ref is shared
   git state, not worktree-local. A plain WIP commit in the lane's own
   branch has no such cross-talk and costs nothing extra to clean up later.
   This sprint's own operating rules already banned it for exactly this
   reason; recorded here so the NEXT multi-worktree sprint states it as a
   rule from Day 0 rather than rediscovering it.
2. **Playwright cannot run in this sandbox, so every E2E journey is
   authored blind and costs a ~15-minute CI round to find out if it's
   right.** Every spec in this sprint was written against the real
   component tree and DOM contract but never executed locally before its
   first CI run — confirmed directly this week (P1.5's own change-log entry
   states the Playwright download is blocked by this session's egress
   policy, verified via the agent-proxy diagnostic, not assumed). The four
   E2E artifacts above are the direct cost of that: real defects, but ones
   a two-second local run would have caught in seconds instead of a CI
   round-trip. Recommendation before the next frontend-heavy wave: give at
   least one lane (or the integrator) a local machine with real Playwright
   installed, and route E2E-touching diffs through it before pushing —
   the marginal cost of one CI round is small, but it compounds linearly
   with the number of E2E specs a sprint adds, and this sprint added a lot
   of them.
