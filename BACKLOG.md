# BACKLOG — quantized

The aggregated open-items dashboard, **derived from the plans in
`plans/`** (per the plan-hygiene rules: the code/git history is truth
#1, each plan's `## Completed` section is truth #2, this file is the
derived view — when they disagree, fix the plan first, then this file,
in the same commit). Every edit here must have a matching plan edit.

**Last regenerated:** 2026-07-10 (full reconciliation pass: all twelve
active plans audited against `PORT_CHECKLIST.md` + the code; stale-open
items struck in their plans with cross-references; GAP_INTERACTION,
GAP_PLOTTYPES, and M1_SPRINT archived as complete)

---

## Actionable dev work (no blockers, no owner gate)

| # | Item | Plan / item | Size |
|---|------|-------------|------|
| 1 | Decompose `App.tsx` (954) + `ThinFilmTab.tsx` (442) — ratchet the component-ceiling pins to zero | PROJECT_ORGANIZATION #10 | M |
| 2 | Extract the window-management slice from `store/useApp.ts` (~3,900 lines) into `store/windows.ts`; consider a store-size ratchet | PROJECT_ORGANIZATION #11 | M |
| 3 | Worksheet per-column widths + drag resize (`lib/gridwindow` prefix-sum offsets) | WORKSHEET #12 | M |
| 4 | Worksheet selection → Graph Builder handoff ("Open in Graph Builder" prefills a `lib/plotspec` spec) | WORKSHEET #13 | S |
| 5 | `.otp`/`.otpu` template import — the frontend half (`api.ts` method + "Import Origin template…" open-file branch → saved graph-templates store; backend shipped 2026-07-07) | GAP_ECOSYSTEM #5 | S |
| 6 | Origin decode: layer-region shading + composite title objects (`Graph1` SLD-profile bands — an undecoded graphic-object record class) | ORIGIN_FILE_DECODE #41 | M |
| 7 | Origin decode: Graph25 anomalies — extra hidden `T++/T--` curves + ~10× x-range; root cause narrowed 2026-07-09, needs a dedicated RE pass (no heuristic guessing) | ORIGIN_FILE_DECODE #42 | M |
| 8 | Reductions: Williamson-Hall, reflectivity FFT thickness, neutron spin asymmetry — the last unstarted backend-parity item (no `calc/` module yet) | PORT_PLAN #19 | M |
| 9 | Defaults audit — interactive-side shots via `tools/visual/` + the export-dialog DPI field syncing to the preset's calibrated dpi | GAP_TIER3 #2 (residual) | S |
| 11 | W8 closure: reconcile the Tauri shell's actual state (committed `src-tauri/`, updater, NSIS hooks) into PORT_PLAN #46, verify auto-update end-to-end (#49), code signing (#47) | PORT_PLAN #46/#47/#49 | M |
| 12 | W9 nice-to-haves: parameterized parser tests (every parser × corpus file); performance baselines | PORT_PLAN #52/#53 | M |

## Owner actions & owner-gated decisions

| Item | Plan / item |
|------|-------------|
| One-time **PyPI Trusted Publisher registration** (see RELEASE.md) + first tagged publish, then the fresh-machine acceptance run (install → import a CSV in 2 min) | ORIGIN_GAP #41 |
| **Corpus publish licensing sign-off** — `../test-data` repo is `git init`-ed; publish gated on the licensing pass + 6 flagged public files | ORIGIN_GAP #45 |
| **Defaults-audit eyeball** — rule on the taste calls in `plans/design/DEFAULTS_AUDIT.md` (aps preset height vs. log-decade label thinning; data-aware legend placement) | GAP_TIER3 #2 |
| **Origin gallery eyeball** — the standing human step of decode #39's comparison campaign (`../test-data/origin/_exports/PNR/`); new mismatches get booked in the decode plan | ORIGIN_FILE_DECODE (standing) |
| **Pop-out books/plots into windows** — PLAN WITH OWNER FIRST (gesture, "pop out a BOOK" semantics, bulk "window everything" command) | MULTI_PLOT #19 |
| **Worksheet view-state persistence** — decide once, with usage evidence, whether sort/widths/selection persist per-dataset in `.dwk` (default: no) | WORKSHEET #14 |
| **Apache-2.0 copyright holder line** for LICENSE/NOTICE | PORT_PLAN #1 |

## Blocked on external samples / specs

| Item | Unblocks when | Plan |
|------|---------------|------|
| `importOxford` (Oxford Instruments MagLab) — no published spec, not attempted | a real example file arrives | PORT_PLAN #15 / PORT_CHECKLIST W1 |
| Rigaku `.raw` 2-D RSM — reverse-engineered header has no ω field | a multi-range Rigaku RSM sample arrives | PORT_PLAN #10 / PORT_CHECKLIST W1 |
| Consolidated-CSV polarized-asymmetry path (shared-Q interp + ++/−− spin asymmetry) | files with ++/−− polarization metadata | PORT_PLAN #12 / PORT_CHECKLIST W1 |

## Deliberate deferrals (decision gates — revisit on demand, don't schedule)

- **Interactive WebGL 3-D** (ORIGIN_GAP #22 / GAP_TIER3 #7) — revisit when users ask to rotate views the static 3-D export can't satisfy.
- **`.opju` writer** (ORIGIN_FILE_DECODE #27 / GAP_ECOSYSTEM #6) — revisit only if a real Origin build refuses `.opj`.
- **`quantized-plugin-template` starter repo** (ORIGIN_GAP #8 residual) — a separate repo, out of scope for this codebase.
- **Plugin pipeline-step route + frontend palette wiring** (GAP_ECOSYSTEM #2) — v1 registers steps server-side only.
- **Database connectors** (ORIGIN_GAP #47) — paste/append shipped; connectors on user pull.
- **Worksheet designation editing** (WORKSHEET D2) — read-only in v1, deferred unless requested.
- **Graph Builder export button + `.dwk` plot-spec persistence** (booked debt from archived GAP_INTERACTION #51).
- **Stat-stage residuals** (archived GAP_PLOTTYPES, accepted): horizontal bar orientation; in-canvas legend for the bar view; `payloadToTSV` exports ordinal positions, not category labels; `statRender.ts` (539) / `useStatStage.ts` (416) split candidates (non-`.tsx`, no guard fails).
- **PORT_CHECKLIST tails** (all noted inline there): crystal cache (stateful), crystal bond angles (needs CIF coords), BG-region 2-D y-box, per-dataset view-config promotion (x-key/styles/limits), reflectivity density↔SLD toggle, user-defined plot templates.
- **CI golden-test host** — de facto resolved as committed frozen values (option a); formalize or drop the open question (PORT_PLAN "still to decide").

## Plans dashboard

| Plan | Status | Open items |
|------|--------|-----------|
| `plans/PORT_PLAN.md` | Active | #10+#15 (blocked), #12 (partial), #19, #46–49 (partial), #50 (continuous), #52–53 |
| `plans/PORT_CHECKLIST.md` | Active (live parity tracker) | 3 real-work lines (2 blocked + 1 partial) + inline deferral tails |
| `plans/MULTI_PLOT_PLAN.md` | Active | #19 only (owner planning session first) |
| `plans/WORKSHEET_PLAN.md` | Active | #12, #13, #14 (decision) |
| `plans/PROJECT_ORGANIZATION_PLAN.md` | Active | #10 (partial), #11 |
| `plans/GAP_TIER3_PLAN.md` | Active | #2 (owner eyeball + 2 small residuals), #7 (deferred gate) |
| `plans/GAP_ECOSYSTEM_PLAN.md` | Active | #5 frontend half; #6 deferred gate |
| `plans/ORIGIN_GAP_PLAN.md` | Active | #41 (owner + acceptance), #45 (owner), #8 (deferred residual), #22 (deferred) |
| `plans/ORIGIN_FILE_DECODE_PLAN.md` | Active | #41, #42; #21 frontend half → ECOSYSTEM #5; #27 deferred |
| `plans/archive/` | Complete | GAP_INTERACTION, GAP_PLOTTYPES, M1_SPRINT, boson-plotter-acceptance-fixes, ui-implementation-plan, frontend-reuse-library |
