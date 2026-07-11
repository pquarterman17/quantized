# BACKLOG — quantized

The aggregated open-items dashboard, **derived from the plans in
`plans/`** (per the plan-hygiene rules: the code/git history is truth
#1, each plan's `## Completed` section is truth #2, this file is the
derived view — when they disagree, fix the plan first, then this file,
in the same commit). Every edit here must have a matching plan edit.

**Last regenerated:** 2026-07-10 (plan-tree restructure: MAIN_PLAN.md created as root; six residue plans folded up + archived; rows repointed with provenance)

---

## Actionable dev work (no blockers, no owner gate)

| # | Item | Plan / item | Size |
|---|------|-------------|------|
| 1 | Decompose `App.tsx` (954) + `ThinFilmTab.tsx` (442) — ratchet the component-ceiling pins to zero | MAIN #1 (was PROJ_ORG #10) | M |
| 2 | Extract the window-management slice from `store/useApp.ts` (~3,900 lines) into `store/windows.ts`; consider a store-size ratchet | MAIN #2 (was PROJ_ORG #11) | M |
| 3 | Worksheet per-column widths + drag resize (`lib/gridwindow` prefix-sum offsets) | MAIN #3 (was WORKSHEET #12) | M |
| 4 | Worksheet selection → Graph Builder handoff ("Open in Graph Builder" prefills a `lib/plotspec` spec) | MAIN #4 (was WORKSHEET #13) | S |
| 5 | `.otp`/`.otpu` template import — the frontend half (`api.ts` method + "Import Origin template…" open-file branch → saved graph-templates store; backend shipped 2026-07-07) | MAIN #5 (was GAP_ECOSYSTEM #5) | S |
| 6 | Origin decode: layer-region shading + composite title objects (`Graph1` SLD-profile bands — an undecoded graphic-object record class) | ORIGIN_FILE_DECODE #41 | M |
| 7 | Origin decode: Graph25 anomalies — extra hidden `T++/T--` curves + ~10× x-range; root cause narrowed 2026-07-09, needs a dedicated RE pass (no heuristic guessing) | ORIGIN_FILE_DECODE #42 | M |
| 10 | Register `import_lake_shore` in the registry (content sniffer + corpus routing sweep; found by the #52 matrix) | MAIN #7 | S |
| 9 | Defaults audit — interactive-side shots via `tools/visual/` + the export-dialog DPI field syncing to the preset's calibrated dpi | MAIN #6 (was GAP_TIER3 #2 residual) | S |
| 11 | W8 closure: reconcile the Tauri shell's actual state (committed `src-tauri/`, updater, NSIS hooks) into PORT_PLAN #46, verify auto-update end-to-end (#49), code signing (#47) | PORT_PLAN #46/#47/#49 | M |
| 14 | Anchor-point baseline (click anchors → interp baseline → recalc-DAG subtract step) | GOTO #2 | M |
| 15 | Shirley XPS/XAS background in the baseline picker | GOTO #3 | S |
| 16 | Multi-panel figure page composer (N plots → one vector PDF/SVG page, panel labels) | GOTO #4 | L |
| 19 | XRD low-angle background + XRR/NR footprint correction; analytic baseline UI completion | GOTO #7/#8 | S–M |

## Owner actions & owner-gated decisions

| Item | Plan / item |
|------|-------------|
| One-time **PyPI Trusted Publisher registration** (see RELEASE.md) + first tagged publish, then the fresh-machine acceptance run (install → import a CSV in 2 min) | MAIN gate (was ORIGIN_GAP #41) |
| **Corpus publish licensing sign-off** — `../test-data` repo is `git init`-ed; publish gated on the licensing pass + 6 flagged public files | MAIN gate (was ORIGIN_GAP #45) |
| **Defaults-audit eyeball** — rule on the taste calls in `plans/design/DEFAULTS_AUDIT.md` (aps preset height vs. log-decade label thinning; data-aware legend placement) | MAIN gate (was GAP_TIER3 #2) |
| **Origin gallery eyeball** — the standing human step of decode #39's comparison campaign (`../test-data/origin/_exports/PNR/`); new mismatches get booked in the decode plan | ORIGIN_FILE_DECODE (standing) |
| **Pop-out books/plots into windows** — PLAN WITH OWNER FIRST (gesture, "pop out a BOOK" semantics, bulk "window everything" command) | MAIN gate (was MULTI_PLOT #19) |
| **Worksheet view-state persistence** — decide once, with usage evidence, whether sort/widths/selection persist per-dataset in `.dwk` (default: no) | MAIN gate (was WORKSHEET #14) |
| **Apache-2.0 copyright holder line** for LICENSE/NOTICE | PORT_PLAN #1 |
| **GOTO owner gates** — 3-D (Q4), worksheet reshape (Q6), date-time axes (Q7), signal-processing non-goal (Q8), switch-trigger project pick + start timing (Q9; protocol in the plan's Context) | GOTO_PLAN Owner gates |

## Blocked on external samples / specs

| Item | Unblocks when | Plan |
|------|---------------|------|
| `importOxford` (Oxford Instruments MagLab) — no published spec, not attempted | a real example file arrives | PORT_PLAN #15 / PORT_CHECKLIST W1 |
| Rigaku `.raw` 2-D RSM — reverse-engineered header has no ω field | a multi-range Rigaku RSM sample arrives | PORT_PLAN #10 / PORT_CHECKLIST W1 |
| Consolidated-CSV polarized-asymmetry path (shared-Q interp + ++/−− spin asymmetry) | files with ++/−− polarization metadata | PORT_PLAN #12 / PORT_CHECKLIST W1 |

## Deliberate deferrals (decision gates — revisit on demand, don't schedule)

- **Interactive WebGL 3-D** (MAIN deferral; gate UNIFIED with GOTO Q4) — revisit when users ask to rotate views the static 3-D export can't satisfy.
- **`.opju` writer** (MAIN deferral = ORIGIN_FILE_DECODE #27) — revisit only if a real Origin build refuses `.opj`.
- **`quantized-plugin-template` starter repo** (MAIN deferral, was ORIGIN_GAP #8) — a separate repo, out of scope for this codebase.
- **Plugin pipeline-step route + frontend palette wiring** (MAIN deferral, was GAP_ECOSYSTEM #2) — v1 registers steps server-side only.
- **Database connectors** (MAIN deferral, was ORIGIN_GAP #47) — paste/append shipped; connectors on user pull.
- **Worksheet designation editing** (MAIN deferral, was WORKSHEET D2) — read-only in v1, deferred unless requested.
- **Graph Builder export button + `.dwk` plot-spec persistence** (booked debt from archived GAP_INTERACTION #51).
- **Stat-stage residuals** (archived GAP_PLOTTYPES, accepted): horizontal bar orientation; in-canvas legend for the bar view; `payloadToTSV` exports ordinal positions, not category labels; `statRender.ts` (539) / `useStatStage.ts` (416) split candidates (non-`.tsx`, no guard fails).
- **PORT_CHECKLIST tails** (all noted inline there): crystal cache (stateful), crystal bond angles (needs CIF coords), BG-region 2-D y-box, per-dataset view-config promotion (x-key/styles/limits), reflectivity density↔SLD toggle, user-defined plot templates, reductions frontend dialogs (W-H / FFT thickness / refl FFT — backend + routes shipped 2026-07-10, no Boson UI surface yet).
- **CI golden-test host** — de facto resolved as committed frozen values (option a); formalize or drop the open question (PORT_PLAN "still to decide").

## Plans dashboard

The plan TREE (per the global plan-consolidation rule): `MAIN_PLAN.md` is
the root; every active plan below is its declared sub-plan.

| Plan | Status | Open items |
|------|--------|-----------|
| `plans/MAIN_PLAN.md` | Active (ROOT) | #1–#7 + owner gates + deferrals |
| `plans/PORT_PLAN.md` (+ `PORT_CHECKLIST.md` appendix) | Active | #10+#15 (blocked), #12 (partial), #46–49 (partial), #50 (continuous) |
| `plans/GOTO_PLAN.md` | Active | #2–#4, #7–#8 open (#1/#5/#6/#9/#10/#11 shipped 2026-07-11); Tier 3 pending gates Q4/Q6/Q7/Q8/Q9 |
| `plans/ORIGIN_FILE_DECODE_PLAN.md` | Active | #41, #42; #27 deferred |
| `plans/archive/` | Complete | 12 plans incl. the 2026-07-10 fold-ups (MULTI_PLOT, WORKSHEET, PROJECT_ORGANIZATION, GAP_TIER3, GAP_ECOSYSTEM, ORIGIN_GAP) |
