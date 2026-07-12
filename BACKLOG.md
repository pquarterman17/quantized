# BACKLOG — quantized

The aggregated open-items dashboard, **derived from the plans in
`plans/`** (per the plan-hygiene rules: the code/git history is truth
#1, each plan's `## Completed` section is truth #2, this file is the
derived view — when they disagree, fix the plan first, then this file,
in the same commit). Every edit here must have a matching plan edit.

**Last regenerated:** 2026-07-11 late night (v0.8.1 RELEASED to PyPI
as `quantized-lab` + GitHub with installers; MAIN #9–#24 all shipped;
the PyPI trusted-publisher registration + first publish are done —
only the fresh-machine acceptance run remains from that gate)

---

## Actionable dev work (no blockers, no owner gate)

| # | Item | Plan / item | Size |
|---|------|-------------|------|
| 42 | Drawing shapes (arrow/line/rect/ellipse + framed text) — agent in flight | MAIN #27 | M-L |

*(MAIN #9–#26 all shipped 2026-07-11 (the menu-survey pair: #25 rich-text
annotations + #26 split-by-value); a shapes/drawing feature (#27) is the
agent in flight. The #23 installer hooks BUILT into v0.8.1's setup.exe —
verified by the fresh-machine acceptance run.)*

## Owner actions & owner-gated decisions

| Item | Plan / item |
|------|-------------|
| **PyPI fresh-machine acceptance run** — on a machine without dev tools: `pipx install quantized-lab` → import a CSV within 2 min; also verify the v0.8.1 installer's two Start Menu entries (#23). Registration + first publish DONE 2026-07-12 (`quantized-lab` 0.8.1 live) | MAIN gate (was ORIGIN_GAP #41) |
| **Corpus publish licensing sign-off** — `../test-data` repo is `git init`-ed; publish gated on the licensing pass + 6 flagged public files | MAIN gate (was ORIGIN_GAP #45) |
| **Defaults-audit eyeball** — rule on the taste calls in `plans/design/DEFAULTS_AUDIT.md` (aps preset height vs. log-decade label thinning; data-aware legend placement) | MAIN gate (was GAP_TIER3 #2) |
| **Origin gallery eyeball** — the standing human step of decode #39's comparison campaign (`../test-data/origin/_exports/PNR/`); new mismatches get booked in the decode plan | ORIGIN_FILE_DECODE (standing) |
| **Pop-out books/plots into windows** — PLAN WITH OWNER FIRST (gesture, "pop out a BOOK" semantics, bulk "window everything" command) | MAIN gate (was MULTI_PLOT #19) |
| **Worksheet view-state persistence** — decide once, with usage evidence, whether sort/widths/selection persist per-dataset in `.dwk` (default: no) | MAIN gate (was WORKSHEET #14) |
| **Apache-2.0 copyright holder line** for LICENSE/NOTICE | PORT_PLAN #1 |
| **Code-signing cert + auto-update E2E** (two consecutive signed releases to verify the updater) | MAIN gate (was PORT #47/#49 residue) |
| **GOTO owner gates** — 3-D (Q4), worksheet reshape (Q6), date-time axes (Q7), signal-processing non-goal (Q8), switch-trigger project pick + start timing (Q9; protocol in the plan's Context) | GOTO_PLAN Owner gates |

## Blocked on external samples / specs

| Item | Unblocks when | Plan |
|------|---------------|------|
| `importOxford` (Oxford Instruments MagLab) — no published spec, not attempted | a real example file arrives | PORT_PLAN #15 / PORT_CHECKLIST W1 |
| Rigaku `.raw` 2-D RSM — reverse-engineered header has no ω field | a multi-range Rigaku RSM sample arrives | PORT_PLAN #10 / PORT_CHECKLIST W1 |
| Consolidated-CSV polarized-asymmetry path (shared-Q interp + ++/−− spin asymmetry) | files with ++/−− polarization metadata | PORT_PLAN #12 / PORT_CHECKLIST W1 |

## Deliberate deferrals (decision gates — revisit on demand, don't schedule)

- **Recover Origin drawn graphic objects + richer annotations on import** (LOW PRIORITY, ORIGIN_FILE_DECODE #47) — imported Origin figures currently drop arrows/lines/standalone rect-ellipse objects + framed/callout annotations (only curves, styles, legends, plain text, and Rect fill-shades recover). Unblocked once MAIN #25/#27 land a native Shape/framed-annotation target to decode onto; revisit after #27 ships.
- **Interactive WebGL 3-D** (MAIN deferral; gate UNIFIED with GOTO Q4) — revisit when users ask to rotate views the static 3-D export can't satisfy.
- **`.opju` writer** (MAIN deferral = ORIGIN_FILE_DECODE #27) — revisit only if a real Origin build refuses `.opj`.
- **`quantized-plugin-template` starter repo** (MAIN deferral, was ORIGIN_GAP #8) — a separate repo, out of scope for this codebase.
- **Plugin pipeline-step route + frontend palette wiring** (MAIN deferral, was GAP_ECOSYSTEM #2) — v1 registers steps server-side only.
- **Database connectors** (MAIN deferral, was ORIGIN_GAP #47) — paste/append shipped; connectors on user pull.
- **Worksheet designation editing** (MAIN deferral, was WORKSHEET D2) — read-only in v1, deferred unless requested.
- **Graph Builder export button + `.dwk` plot-spec persistence** (booked debt from archived GAP_INTERACTION #51).
- **Stat-stage residuals** (archived GAP_PLOTTYPES, accepted): horizontal bar orientation; in-canvas legend for the bar view; `payloadToTSV` exports ordinal positions, not category labels; `statRender.ts` (539) / `useStatStage.ts` (416) split candidates (non-`.tsx`, no guard fails).
- **PORT_CHECKLIST tails** (all noted inline there): crystal cache (stateful), crystal bond angles (needs CIF coords), BG-region 2-D y-box, per-dataset view-config promotion (x-key/styles/limits), reflectivity density↔SLD toggle, user-defined plot templates. (The reductions-frontend tail was refiled as actionable MAIN #11 by the 2026-07-11 audit.)
- **CI golden-test host** — de facto resolved as committed frozen values (option a); formalize or drop the open question (PORT_PLAN "still to decide").

## Plans dashboard

The plan TREE (per the global plan-consolidation rule): `MAIN_PLAN.md` is
the root; every active plan below is its declared sub-plan.

| Plan | Status | Open items |
|------|--------|-----------|
| `plans/MAIN_PLAN.md` | Active (ROOT) | #25 open (agent in flight) + owner gates/deferrals — MAIN #9–#24, #26 ALL shipped 2026-07-11 |
| `plans/PORT_PLAN.md` (+ `PORT_CHECKLIST.md` appendix) | Active | #10+#15 (blocked), #12 (partial), #47/#49 (owner cert), #50 (continuous) |
| `plans/GOTO_PLAN.md` | Active | ALL numbered items #1–#11 SHIPPED (2026-07-11); Tier 3 pending gates Q4/Q6/Q7/Q8/Q9 |
| `plans/ORIGIN_FILE_DECODE_PLAN.md` | Active | #27 deferred; #42 reopens only on new corpus evidence; #47 LOW-PRIORITY (recover Origin graphic objects/annotations on import — gated on MAIN #27) |
| `plans/archive/` | Complete | 12 plans incl. the 2026-07-10 fold-ups (MULTI_PLOT, WORKSHEET, PROJECT_ORGANIZATION, GAP_TIER3, GAP_ECOSYSTEM, ORIGIN_GAP) |
