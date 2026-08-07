# BACKLOG — quantized

The aggregated open-items dashboard, **derived from the plans in
`plans/`** (per the plan-hygiene rules: the code/git history is truth
#1, each plan's `## Completed` section is truth #2, this file is the
derived view — when they disagree, fix the plan first, then this file,
in the same commit). Every edit here must have a matching plan edit.

**Last reconciled:** 2026-08-05 (eighteenth pass). Two stale cells fixed
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

---

## Actionable dev work (no blockers, no owner gate)

The table below is the immediate cross-plan queue. Detailed goals,
dependencies, acceptance criteria, and model routing for the new campaign live
in `PRIMARY_SOFTWARE_AUDIT_PLAN.md`.

The prior implementation campaign is complete. New work is organized by the
readiness plan and begins with evidence instead of another speculative feature
stack.

Historical: the 2026-07-24 reconciliation left this table empty. The 2026-07-25 plan-tree
consolidation first refilled it from the deleted Sol audit docs; the later
ChatGPT-Sol implementation audit then added eight current-code gaps that could
still make the owner switch back to Origin.

| Item | Plan / item |
|------|-------------|
| Figure-authoring campaign, next slices — F2 broader parity (legacy + Graph Builder convergence on the canonical session, remaining Stage property bridge, direct-manipulation parity, render-path unification), F3 COMPLETE (F3.1–F3.6 shipped 2026-08-05/06/07 — see the F3 exit-criterion note in the plan's 2026-08-07 log), then F4 recipes/templates + live grouping parity (F4.1, F4.2 rest, F4.3, F4.4); A1–A10 acceptance journeys are the exit gate | FIGURE_AUTHORING F2, F4 |

The plan's other two Gate A items, **P0.1** (run a real switch-trigger project)
and **P0.2** (review the Origin visual corpus), are NOT dev work — they are
owner actions, and both already existed as owner-gate rows before this plan was
written. They are annotated on those rows under Owner actions below rather than
duplicated here; P0.1 is GOTO gate Q9 and P0.2 is the ORIGIN #55/#56 screenshot
review.

After Gate A, the current dependency-ordered implementation candidates are
**unfinished engineering campaigns, not owner actions**. Gate A controls
their order and exact scope; it does not make them complete:

| Item | Plan / item |
|------|-------------|
| Native packaged-desktop file/project bridge and real paths | PRIMARY SOFTWARE P1.1 |
| Named project identity, atomic save/recovery, bounded autosave, and scalable workspace | PRIMARY SOFTWARE P1.2 |
| First-class categorical/text/metadata channels | PRIMARY SOFTWARE P1.4 |
| Import Wizard multi-row metadata and complete error-role mapping | PRIMARY SOFTWARE P1.6 |
| Live Stage parity for Graph Builder grouping/faceting | PRIMARY SOFTWARE P1.5 |
| Full semantic plot-recipe templates with technique scope and opt-in application | PRIMARY SOFTWARE P1.3 |
| Portable projects and safe source relinking | PRIMARY SOFTWARE P1.7 |
| Continue contextual help after the first five Inspector `?` links, using real-use friction to select workshops and context actions | PRIMARY SOFTWARE P3.1 |

The table above is the first dependency chain, not the whole unfinished
engineering inventory. P2.1-P2.8 contain technique-workbench implementation,
P3.2-P3.7 contain usability/accessibility/recovery/export engineering, and
P4.1-P4.2 contain decomposition and regression-matrix engineering. Their
open boxes remain open. They are intentionally scheduled after evidence and
higher-impact gates; they are neither implemented nor automatically owner-gated.

Carried over from the prior campaign, two items are judgment calls their plans
explicitly parked for the owner rather than tasks:

| Item | Plan / item |
|------|-------------|
| `clearShapes` ("Clear all" in ShapesCard) — a one-click, un-undoable BULK wipe of N hand-placed shapes, riding on a confirm-exemption policy written for deleting them ONE at a time. Arguably in the spirit of the documented canvas-object exception, arguably not; the 2026-07-19 destructive-action class sweep flagged it and deliberately left it | GUI_INTERACTION #17 (open judgment call) |
| Owner-dependent Origin feature gaps — prioritize ONLY from real projects (#16); its one open sub-item is `.opju` migration edges (matrix books, some 2-D instrument data), which needs owner-supplied real files to prioritize | GUI_INTERACTION #16 |

(The two rows that stood here through 2026-07-21 — GUI #17's polish tail and
the ORIGIN #54 layout-generality residual — are CLOSED as of 2026-07-24 and
have been removed per the plan-hygiene archival rule. Their outcomes live in
the respective plans' Completed/struck entries; the header above summarizes
what landed. Do not re-add shipped work here.)

### Index-staleness follow-ups (booked 2026-07-19 by a class sweep)

A fourth instance of the row/column-index staleness class was found and fixed
(`5ac2674` — `removeFormula` remapped the dataset-scoped index-keyed fields but
not the parallel VIEW-scoped ones, so hiding a formula column and then removing
it silently hid a DIFFERENT column). The same sweep confirmed three more, each
with a concrete reproduction; **all three shipped 2026-07-21**, each with a
fail-before/pass-after regression test:

- ~~**Background windows keep a stale `PlotView`**~~ (2026-07-21) — `removeFormula`
  now walks every `PlotWindow.view` bound to the dataset via a new pure
  `remapWindowViews` (`lib/channelRemap.ts`), not just the live singleton that
  the `5ac2674` fix covered.
- ~~**Saved Graph Builder specs go stale and are re-applied blind**~~ (2026-07-21)
  — `buildDisplayBlock` now captures the plotted channels' labels
  (`DisplayBlock.labels`) and `applyDisplayBlock` re-keys `series`/`order` by
  label at apply time (identity-first + duplicate-safe; drop when the label is
  gone; by-index fallback for legacy specs).
- ~~**`alignOverlayY` assumes a TAIL trim; `xTrimMin` is a FRONT trim**~~
  (2026-07-21) — the four fit/peak/baseline/deriv overlays are now cleared at the
  source (`store/corrections.ts`) whenever a trim changes the row count, the same
  `rowsChanged` guard that already clears `excludedRows`.

- ~~**`reimportDataset` view-scoped clear on a shape change**~~ (2026-07-21) — a
  fourth instance of the same class, found while fixing the first: reimport
  cleared the dataset-scoped index-keyed state on a shape change but never the
  view-scoped state. Now resets the live view (if active) AND every bound window
  to the new shape's `datasetViewDefaults` (the derivation setActive/addDataset
  already use, re-seeding errKeys/hiddenChannels from the fresh columns); an
  unchanged shape still keeps the user's styles/hidden/keys.

### Backend hardening round (2026-07-19, `4d61e56`)

A second sweep of the "route catches a narrow exception tuple, callee raises
something else" class first named on 2026-07-05. Three live HTTP 500s on
plausible user input, all confirmed against the real app before fixing and all
now 422: `DataStruct.from_dict`'s TypeError on a non-numeric `dataset` (the
class-wide one — ~17 handlers across 7 route modules, fixed in the ONE shared
constructor), `semiconductor.fermi_level`'s ZeroDivisionError from an
underflowed `ni`, and `fitting.curve_fit`'s ZeroDivisionError on empty arrays.
Backend 3000 + ruff + mypy green. The class recurs as new routes land —
re-sweep periodically.

## Owner actions & owner-gated decisions

| Item | Plan / item |
|------|-------------|
| **In-app scripting console** — decide DSL-over-`executeSteps` (a REPL over the macro recorder's typed `{kind, params}` objects, no string ever evaluated as code, needs no new backend surface) vs. a real out-of-process Python kernel (genuinely arbitrary code, but heavier: process lifecycle, stdout/stderr streaming, kernel death/restart, packaging) before building either. `quantized.client` (slice 1, shipped 2026-08-05) is what either option would end up driving | MAIN gate (was MAIN #39 owner gate) |
| **First dated timed-workflow runs** — follow `docs/timed_workflow_baselines.md` (8 journey checklists, results template at the bottom); the gesture/confusion/discoverability fields need the owner's hands. Fixtures + protocol SHIPPED 2026-07-26 | PRIMARY SOFTWARE P0.3 residue |
| **Gate J: JMP usage census + JMP switch trial** — list the JMP platforms actually opened in the last ~6 months (ranks JMP Tier 2, decides census-gated clustering/SPC/MSA/DOE), then run one real JMP-shaped deliverable under the P0.1 protocol with JMP closed. Can share a session with P0.1/Q9 | JMP_GAP Gate J |
| **Real-GPU F1 interaction acceptance** — the automated headless run is 112 ms p95, 12 ms over target under software rendering; close only after a visible hardware-accelerated run on the owner workstation confirms or refutes it | PRIMARY SOFTWARE P0.4 acceptance |
| **PyPI fresh-machine acceptance run** — on a machine without dev tools: `pipx install quantized-lab` → import a CSV within 2 min; also verify the v0.8.1 installer's two Start Menu entries (#23). Registration + first publish DONE 2026-07-12 (`quantized-lab` 0.8.1 live) | MAIN gate (was ORIGIN_GAP #41) |
| **Corpus publish licensing sign-off** — `../test-data` repo is `git init`-ed; publish gated on the licensing pass + 6 flagged public files | MAIN gate (was ORIGIN_GAP #45) |
| **Defaults-audit eyeball** — rule on the taste calls in `plans/design/DEFAULTS_AUDIT.md` (aps preset height vs. log-decade label thinning; data-aware legend placement) | MAIN gate (was GAP_TIER3 #2) |
| **Origin corpus screenshot review** — the #55 review dashboard exposes 62 paired Origin↔Quantized screenshots (Moke 8, PNR 50, RockingCurve 4); review state is 0/353 until the owner exports gallery marks. The campaign (#56) closes only on this visual sign-off; new mismatches get booked in the decode plan | ORIGIN_FILE_DECODE #55/#56 gate = PRIMARY SOFTWARE **P0.2** |
| **Pop-out books/plots into windows** — PLAN WITH OWNER FIRST (gesture, "pop out a BOOK" semantics, bulk "window everything" command) | MAIN gate (was MULTI_PLOT #19) |
| **Worksheet view-state persistence** — decide once, with usage evidence, whether sort/widths/selection persist per-dataset in `.dwk` (default: no) | MAIN gate (was WORKSHEET #14) |
| **Apache-2.0 copyright holder line** for LICENSE/NOTICE | PORT_PLAN #1 |
| **Code-signing cert + auto-update E2E** (two consecutive signed releases to verify the updater) | MAIN gate (was PORT #47/#49 residue) |
| **Node version-manager standardization** — Volta (fermiviewer) vs `.nvmrc` (quantized); fix the machine-level cause first (fnm precedes `~/.volta/bin` in PATH, so neither pin takes effect). Comfort, not correctness — CI is already authoritative via `node-version-file` | MAIN gate (was ROBUSTNESS #8, folded 2026-08-01) |
| **GOTO owner gates** — 3-D (Q4), signal-processing non-goal (Q8), switch-trigger project pick + start timing (Q9; protocol in the plan's Context — Q9 is the same task as PRIMARY SOFTWARE **P0.1**, whose friction log gates that plan's Gate A). ~~Q6 worksheet reshape~~ and ~~Q7 date-time axes~~ were DECIDED YES and SHIPPED 2026-07-19 (Codex PRs #67/#68) — struck here 2026-07-24 | GOTO_PLAN Owner gates |
| **Shared AnalysisSelection contract timing** — when to generalize the #4 `lib/fitweights` seed into the full cross-workflow selection contract | GUI_INTERACTION gate |
| ~~**Undo scopes** (#1)~~ **RESOLVED 2026-07-19** — one flat current-session EDIT history (data + visual/layout + organization) with a SEPARATE Back/Forward view history for zoom/pan/autoscale; neither persists across restart. Owner-approved during the Codex-stack review; #1 shipped behind it | GUI_INTERACTION #1 gate |
| ~~**Baseline: frontend channel-bind vs. backend corrections-DAG** (#5)~~ **RESOLVED 2026-07-19** — the established DAG stays authoritative for its default time/value-0 channel; an arbitrary plotted X/Y baseline subtracts into a DERIVED dataset carrying explicit channel provenance, so the raw source and unrelated channels are never silently rewritten | GUI_INTERACTION #5 gate |
| ~~**Plot Objects tree scope** (#2)~~ **MOOT 2026-07-24** — the large bet was taken and delivered (PR #66) as a bounded Inspector extension, not a full Object Manager; every #2 sub-item is struck. The gate was simply never closed behind the shipped work | GUI_INTERACTION #2 gate |

### Dependency security (swept 2026-08-06 — 6 alerts closed)

`fd7c5d0` applied all 5 open Dependabot PR groups as ONE commit (same
mutually-conflicting-lockfile rationale as the 2026-07-24 sweep below):

- **aiohttp 3.14.1 → 3.14.3 closed 3 alerts** (1 high: OOB heap read in the
  C response parser; 2 moderate: WS request smuggling + unnegotiated
  compressed frames). Transitive RUNTIME dep via `bumps` (DREAM fit engine,
  reached through `routes/jobs_api`).
- **ip-address 10.2.0 → 10.4.0 closed 3 alerts** (1 high SSRF-class octal
  decode + 2 moderate misclassifications) in `tools/visual` — dev-only
  screenshot harness, low reachability, fix was free within semver range.
- Routine riders: fastapi 0.141.1 + ruff 0.16.1, frontend npm dev-tooling
  minors (vite 8.2.0, playwright 1.62.1, types), `codeql-action` pinned
  v4.37.4 at both call sites. TypeScript untouched at ~6.0.3 (deliberate).
- Full dual gate green: pytest 3745 passed / **3822 collected** (no
  shrinkage), ruff/mypy clean, frontend 5,639 tests + build, tools/visual
  audit now 0.
- **Left for owner:** `brace-expansion` shows as an npm-audit high
  (eslint→minimatch, frontend devDependency only) but has NO Dependabot
  alert and no PR — out of the sweep's scope, not yet fixed.

### Dependency security (swept 2026-07-24 — 13 of 14 alerts CLOSED)

`c63f7af` applied all ten open Dependabot PRs in one commit. They fell into
three mutually-conflicting groups (`uv.lock` ×3, frontend lock ×3, workflows
×4), so merging them serially would have meant nine rebase waits for no
added safety.

- **pillow 12.2.0 → 12.3.0 closed 13 alerts** (10 high, 3 medium): heap
  out-of-bounds writes in `ImageCmsTransform.apply()`, `Image.paste`/`crop`,
  `ImageFilter.RankFilter` and the mmap path, plus several
  decompression-bomb-check bypasses (`GdImageFile`, `BdfFontFile`,
  `FontFile.compile`, `PcfFontFile`) and an EPS infinite loop. Pillow is NOT
  a declared dependency — it arrives transitively via `matplotlib`, which
  `routes/export` renders user-supplied data through, so the exposure is
  real. This is also why the whole class was missing from this file: the
  repo enforces a dependency *policy* (Apache-2.0, no GPL) but has no
  standing check on transitive *vulnerability* surface. Re-sweep with
  `gh api repos/:owner/:repo/dependabot/alerts` periodically.
- **setuptools 82.0.1 → 83.0.0** closed the fourteenth (MANIFEST.in
  exclusion bypass via Unicode NFC/NFD collision on macOS).
- `npm audit` separately flagged a high-severity unbounded-expansion DoS in
  `brace-expansion`; fixed in the same pass. Frontend is at 0
  vulnerabilities.
- CI action versions had drifted to an inconsistent v4/v6/v7 mix across the
  five workflows; now uniform (checkout v7, setup-node v7, upload-artifact
  v7, download-artifact v8).
- **TypeScript 5.9.3 → 7.0.2** (`f398ac9`) was held back since 2026-07-13 as
  the one major bump deserving a deliberate call, because `npm run build` is
  `tsc -b && vite build` — TypeScript IS this repo's type-check gate. Adopted
  only after a forced full `tsc -b --force` came back clean, the emitted
  bundle hashes proved byte-identical, and a PLANTED type error confirmed the
  gate still fails (zero errors from a major bump is also what a silently
  disabled checker looks like).

### Dependabot alert #1 (RESOLVED 2026-07-25 — dismissed as tolerable risk)

`glib` 0.18.5, `RUSTSEC` unsoundness in the `Iterator`/`DoubleEndedIterator`
impls for `glib::VariantStrIter`. Medium, runtime scope, `src-tauri/Cargo.lock`.

- **Not fixable here.** Patched upstream in glib 0.20.0, but the chain is
  `glib 0.18.5 <- gtk 0.18.2 <- tauri 2.11.5`. Tauri 2.11.5 IS the current
  latest and our `Cargo.toml` already floats on `tauri = "2"`, so we are on
  the newest release; Tauri v2's GTK stack has not moved to the glib 0.20
  ecosystem. `cargo update -p glib` locks 0 packages — 0.18.5 is already the
  latest COMPATIBLE version. Forcing it would mean patching Tauri.
- **Linux-only, but genuinely shipped.** gtk/webkit2gtk are Tauri's Linux
  backend and are not compiled on Windows/macOS — however `release.yml` does
  build a `.deb`, so the artifact exists. Exposure is not zero.
- **Not reachable from our code.** Quantized never calls `glib` directly, let
  alone `VariantStrIter`; it sits deep inside GTK bindings driven by Tauri.
  It is a soundness hole, not a directly exploitable RCE.
- **Owner decision:** the 2026-07-19 session deliberately did NOT dismiss
  autonomously (a visible security-posture change on a public repo) and parked
  it as an owner call. **Resolved 2026-07-25**: the owner delegated the
  standing-issues decisions ("you just figure this out"), and an independent
  re-investigation reproduced the identical chain and reachability analysis —
  dismissed as `tolerable_risk` with a dated rationale on the alert naming
  the re-eval condition (Tauri adopting the gtk-rs 0.20 line; the alert then
  auto-resolves via the ordinary lockfile bump).

## Blocked on external samples / specs

| Item | Unblocks when | Plan |
|------|---------------|------|
| `importOxford` (Oxford Instruments MagLab) — no published spec, not attempted | a real example file arrives | PORT_PLAN #15 / PORT_CHECKLIST W1 |
| Rigaku `.raw` 2-D RSM — reverse-engineered header has no ω field | a multi-range Rigaku RSM sample arrives | PORT_PLAN #10 / PORT_CHECKLIST W1 |
| Consolidated-CSV polarized-asymmetry path (shared-Q interp + ++/−− spin asymmetry) | files with ++/−− polarization metadata | PORT_PLAN #12 / PORT_CHECKLIST W1 |
| Origin graphic objects / rich annotations (#53) | controlled specimens plus Origin COM/LabTalk and rendered-output oracles establish each object record, with negative controls and a plausible corpus distribution | ORIGIN_FILE_DECODE #53 (subsumes #47) |
| Native >2-Y-axes rendering (#54's last open sub-item; moved here 2026-07-24 now that the page/layer MODEL is complete) | a corpus figure with a proven ≥3-coincident-axis composition exists AND the decoder can attribute a third axis — today `figure_text._TITLE_OBJECT_BUCKETS` buckets only YL/YR titles. Until then the ≥3 case fails closed with provenance + a toast (the Graph25 discipline: don't build unproven mechanisms) | ORIGIN_FILE_DECODE #54 |

## Deliberate deferrals (decision gates — revisit on demand, don't schedule)

- **Interactive WebGL 3-D** (MAIN deferral; gate UNIFIED with GOTO Q4) — revisit when users ask to rotate views the static 3-D export can't satisfy.
- **`.opju` writer** (MAIN deferral = ORIGIN_FILE_DECODE #27) — revisit only if a real Origin build refuses `.opj`.
- **`quantized-plugin-template` starter repo** (MAIN deferral, was ORIGIN_GAP #8) — a separate repo, out of scope for this codebase.
- **Plugin pipeline-step route + frontend palette wiring** (MAIN deferral, was GAP_ECOSYSTEM #2) — v1 registers steps server-side only.
- **Database connectors** (MAIN deferral, was ORIGIN_GAP #47) — paste/append shipped; connectors on user pull.
- **Worksheet designation editing** (MAIN deferral, was WORKSHEET D2) — read-only in v1, deferred unless requested.
- **Stat-stage residuals** (archived GAP_PLOTTYPES, accepted): horizontal bar orientation; in-canvas legend for the bar view; `payloadToTSV` exports ordinal positions, not category labels; `statRender.ts` (539) / `useStatStage.ts` (416) split candidates (non-`.tsx`, no guard fails).
- **PORT_CHECKLIST tails** (all noted inline there): crystal cache (stateful), crystal bond angles (needs CIF coords), BG-region 2-D y-box, per-dataset view-config promotion (x-key/styles/limits), reflectivity density↔SLD toggle, user-defined plot templates. (The reductions-frontend tail was refiled as actionable MAIN #11 by the 2026-07-11 audit.)
- **CI golden-test host** — de facto resolved as committed frozen values (option a); formalize or drop the open question (PORT_PLAN "still to decide").

## Plans dashboard

The plan TREE (per the global plan-consolidation rule): `MAIN_PLAN.md` is
the root; every active plan below is its declared sub-plan.

| Plan | Status | Open items |
|------|--------|-----------|
| `plans/MAIN_PLAN.md` | Active (ROOT) | MAIN #9–#40 are shipped (#39 = `quantized.client` slice 1, its in-app-console sub-item moved to the owner gates below; #40 = the Origin/Host request guard); remaining work is owner gates, evidence-gated deferrals, and the active sub-plans |
| `plans/PORT_PLAN.md` (+ `PORT_CHECKLIST.md` appendix) | Active | #10+#15 (blocked), #12 (partial), #47/#49 (owner cert), #50 (continuous); **#54 SPC/JCAMP gaps CLOSED 2026-07-25 same-day booked** |
| `plans/GOTO_PLAN.md` | Active | ALL numbered items #1–#11 SHIPPED (2026-07-11); Tier 3 pending gates **Q4/Q8/Q9 only** — Q6 (worksheet reshape) and Q7 (date-time axes) were DECIDED YES and shipped 2026-07-19 |
| `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` | Active | Gate A: owner switch-trigger trial, Origin visual review, timed workflows, and the real-GPU performance check. **P3.4 is fully SHIPPED** — server-side payload decimation 2026-07-31 (147.5→3.49 MB @1M×7) and the zoom-refetch residual 2026-08-01 (`232cf4f`); P2.8's regrid defect-class and both export-dialog defects also landed 2026-07-31. **Sequencing-gated, incomplete engineering:** P1.1-P1.7 native lifecycle/portability/metadata/import/grouping/recipes (P1.3 recipes will key on the technique tag), followed by evidence-ranked P2/P3/P4 work. |
| `plans/FIGURE_AUTHORING_WORKFLOW_PLAN.md` | Active | **F0 + F1 COMPLETE** (honest transitions; versioned FigureDocument with lifecycle, reversible conversions, migration). F2 mid-campaign: seven bounded slices shipped 2026-08-02 (canonical Publication Preview session PR #111, F2.1a–d/F2.2a–c/F2.3a/F2.4a/F2.5a); F2.1–F2.5 stay open for legacy/Graph-Builder convergence, the remaining Stage property bridge, direct-manipulation parity, and render-path unification. **F3 COMPLETE 2026-08-07** (F3.1–F3.6: versioned PageDocument + persistence, missing/frozen panel semantics, Save/Save As/dirty/reopen lifecycle, unified panel editing, complete layout controls, unified export — one `buildSpec` path for preview/file-export/clipboard-copy, a real window-panel fidelity fix (error bars/y2/groups/breaks/overrides now render from the window's own canonical document instead of a reduced ad-hoc spec), and Library "export a saved page without reopening it"); the plan's own F3 exit criterion is coded-and-tested (round-trip test proves save→close→reopen→export byte-identical) but NOT owner-verified in the live app — A6 stays an owner acceptance check, not ticked here. F4 open except F4.2a (plot type + error designations, with the Graph Builder error-bar wells + step/Line+Symbol marks, v0.16.0). A1–A10 acceptance journeys unchecked. Authored by ChatGPT-Sol, not Claude. |
| `plans/JMP_GAP_PLAN.md` | Active | **Every census-independent register item is SHIPPED** — campaign 2026-07-28/29 (J3, J5, J6, J7, J9, J10, J11, J12, J17 + J8 backend) + the 2026-07-31 residual wave (J8 UI, J10 export parity, J3 mosaic/prediction band, J7 curve-fit By, Dixon table verified) + #14 module splits w/ `MODULE_PINS` ratchet (2026-07-29). Open: J1 string categoricals (with P1.4), J2 recode, J4 live group split (= P1.5) — all Gate-A-sequenced; Tier 3 census-gated = J13 clustering, J14 control charts/capability, J15 MSA, J16 DOE. Owner gate: Gate J census + switch trial |
| `plans/GUI_INTERACTION_PLAN.md` | Active | **Tier 1 #1, #2, #5 ALL SHIPPED 2026-07-19** (Codex PRs #65/#66 + the two gate resolutions); **#17 CLOSED** (its last three items — split buttons, cross-menu ownership move, first-run hints — are struck); the ONLY open box in the whole plan is #16's `.opju` migration edges (owner-dependent). Remaining gates: the AnalysisSelection contract timing. Historical: #8, #11, #12 CLOSED and #15 fully covered except the #1-gated folder-undo journey, ALL 2026-07-18 (#8: palette bridge + mini-toolbar + worksheet/window/annotation retrofits; #11: stat-mark faceting end-to-end; #12: PlotSpec v2 canonical spec (display/axes/decor blocks) across Stage/Graph Builder/Figure Builder/export — all 5 slices + parts A (y2Fmt)/B (grouped-series export)/C (decor: annotations/shapes/legend) shipped same day, `page` block deferred to ORIGIN_FILE_DECODE #54; #15: channel-drag + annotation/shape + window-arrange journeys, e2e 33/33 across the zoom matrix); #4 SHIPPED 2026-07-12, #6 SHIPPED 2026-07-16, #3+#7+#9+#10+#13+#14 SHIPPED 2026-07-17 (#10 docking deferred, #13 undo sub-item deferred to the #1 gate), #8 core SHIPPED 2026-07-17 (registry + keyboard-complete menu + resting cue + confirm; residual = Command Palette/Plot Objects tree/mini-toolbar reuse + remaining menu retrofits), #11 core SHIPPED 2026-07-17 (residual = stat-mark faceting; arbitrary multi-panel ordering belongs to #54), #15 core harness + 7 journeys SHIPPED 2026-07-17 and export round-trip SHIPPED 2026-07-18 (residual = folder undo, channel→axis drag, annotation/shape edit, window arrange); 4 owner gates (undo scopes, baseline framing, tree scope, selection contract) |
| `plans/ORIGIN_FILE_DECODE_PLAN.md` | Active | Plot Fidelity campaign: #48–#52 complete; #54 page-setup control + spatial-export residual + overlap/inset layout slice ALL SHIPPED 2026-07-17 (Codex PR #55); visual-import campaign #58–#63 ALL SHIPPED 2026-07-18 (Codex stack #56–#61 `854271c`: spatial legends, region bands, imported-view + spatial-page export parity, saved-preview window, presentation templates); **#54's generalized page/layer MODEL is COMPLETE — pass B shipped `50b4c9c` 2026-07-24**, joining A + C; open = #53 graphic objects (evidence-gated; subsumes #47) and #54's specimen-gated >2-Y-axes rendering (now in the blocked table); #55 tooling is complete and #55/#56 close on owner screenshot review. #27 deferred; #42 reopens only on new corpus evidence |
| `plans/archive/` | Complete | 14 plans incl. the 2026-07-10 fold-ups (MULTI_PLOT, WORKSHEET, PROJECT_ORGANIZATION, GAP_TIER3, GAP_ECOSYSTEM, ORIGIN_GAP), PLOT_WORKFLOW (Complete 2026-08-01 — all 4 owner design decisions shipped in ~24 h; #6 interface note folded into PRIMARY P1.3), and ROBUSTNESS (Complete 2026-08-01 — Tiers 1+2 and #7/#9 shipped, #10 decided NO, owner-parked #8 folded to MAIN Owner gates) |
