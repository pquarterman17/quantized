# BACKLOG — quantized

The aggregated open-items dashboard, **derived from the plans in
`plans/`** (per the plan-hygiene rules: the code/git history is truth
#1, each plan's `## Completed` section is truth #2, this file is the
derived view — when they disagree, fix the plan first, then this file,
in the same commit). Every edit here must have a matching plan edit.

**Last reconciled:** 2026-07-18, after the six-PR Origin visual-import stack
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
mypy green. What remains actionable = the #8/#11/#15 residual rows, #12,
Tier 3 larger bets, and #54's explicit page/layer architecture residual.
Origin graphic objects (#53) are evidence-gated, not routine implementation.
The #55 owner screenshot-review
gate is unchanged (62 paired screenshots, 0/353 reviewed). v0.10.0 is the
current release. Prior context: GUI_INTERACTION adopted 2026-07-12 from the
ChatGPT-Sol audit; MAIN holds only owner gates + deferrals; the
fresh-machine PyPI acceptance run is still open.)

---

## Actionable dev work (no blockers, no owner gate)

From `GUI_INTERACTION_PLAN.md` (see it for the full tiered list + per-item
detail). Owner-gated items in that plan (#1 undo scopes, #2 tree scope, #5
baseline framing) are under Owner actions below, not here.

| Item | Plan / item |
|------|-------------|
| Larger bets / polish: unified select→edit Plot Objects tree (#2, owner-gate scope), canonical plot spec across surfaces (#12), buttons/menus/tooltips polish (#17), owner-dependent Origin gaps (#16) | GUI_INTERACTION Tier 1–3 |
| **Origin layout generality residual** — free-positioned/overlapping layers + insets SHIPPED 2026-07-17 (Codex PR #55 `90c49ad`, page-mode classification, fail-closed); remaining: generalized page/layer model + >2 Y axes (do NOT extend the greedy double-Y heuristic) | ORIGIN_FILE_DECODE #54 |

## Owner actions & owner-gated decisions

| Item | Plan / item |
|------|-------------|
| **PyPI fresh-machine acceptance run** — on a machine without dev tools: `pipx install quantized-lab` → import a CSV within 2 min; also verify the v0.8.1 installer's two Start Menu entries (#23). Registration + first publish DONE 2026-07-12 (`quantized-lab` 0.8.1 live) | MAIN gate (was ORIGIN_GAP #41) |
| **Corpus publish licensing sign-off** — `../test-data` repo is `git init`-ed; publish gated on the licensing pass + 6 flagged public files | MAIN gate (was ORIGIN_GAP #45) |
| **Defaults-audit eyeball** — rule on the taste calls in `plans/design/DEFAULTS_AUDIT.md` (aps preset height vs. log-decade label thinning; data-aware legend placement) | MAIN gate (was GAP_TIER3 #2) |
| **Origin corpus screenshot review** — the #55 review dashboard exposes 62 paired Origin↔Quantized screenshots (Moke 8, PNR 50, RockingCurve 4); review state is 0/353 until the owner exports gallery marks. The campaign (#56) closes only on this visual sign-off; new mismatches get booked in the decode plan | ORIGIN_FILE_DECODE #55/#56 gate |
| **Pop-out books/plots into windows** — PLAN WITH OWNER FIRST (gesture, "pop out a BOOK" semantics, bulk "window everything" command) | MAIN gate (was MULTI_PLOT #19) |
| **Worksheet view-state persistence** — decide once, with usage evidence, whether sort/widths/selection persist per-dataset in `.dwk` (default: no) | MAIN gate (was WORKSHEET #14) |
| **Apache-2.0 copyright holder line** for LICENSE/NOTICE | PORT_PLAN #1 |
| **Code-signing cert + auto-update E2E** (two consecutive signed releases to verify the updater) | MAIN gate (was PORT #47/#49 residue) |
| **GOTO owner gates** — 3-D (Q4), worksheet reshape (Q6), date-time axes (Q7), signal-processing non-goal (Q8), switch-trigger project pick + start timing (Q9; protocol in the plan's Context) | GOTO_PLAN Owner gates |
| **Undo scopes** — one unified stack vs. scoped undo (visual/data/org) + separate zoom/pan view-history; decide before building #1 | GUI_INTERACTION #1 gate |
| **Baseline: frontend channel-bind vs. backend corrections-DAG** — cross-audit contradiction; scope before starting #5 | GUI_INTERACTION #5 gate |
| **Plot Objects tree scope** — full Origin-style Object Manager vs. better-signposted gestures + undo (large bet) | GUI_INTERACTION #2 gate |
| **Shared AnalysisSelection contract timing** — when to generalize the #4 `lib/fitweights` seed into the full cross-workflow selection contract | GUI_INTERACTION gate |

## Blocked on external samples / specs

| Item | Unblocks when | Plan |
|------|---------------|------|
| `importOxford` (Oxford Instruments MagLab) — no published spec, not attempted | a real example file arrives | PORT_PLAN #15 / PORT_CHECKLIST W1 |
| Rigaku `.raw` 2-D RSM — reverse-engineered header has no ω field | a multi-range Rigaku RSM sample arrives | PORT_PLAN #10 / PORT_CHECKLIST W1 |
| Consolidated-CSV polarized-asymmetry path (shared-Q interp + ++/−− spin asymmetry) | files with ++/−− polarization metadata | PORT_PLAN #12 / PORT_CHECKLIST W1 |
| Origin graphic objects / rich annotations (#53) | controlled specimens plus Origin COM/LabTalk and rendered-output oracles establish each object record, with negative controls and a plausible corpus distribution | ORIGIN_FILE_DECODE #53 (subsumes #47) |

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
| `plans/MAIN_PLAN.md` | Active (ROOT) | owner gates + deferrals only — MAIN #9–#28 ALL shipped 2026-07-11/12 (zero open dev items) |
| `plans/PORT_PLAN.md` (+ `PORT_CHECKLIST.md` appendix) | Active | #10+#15 (blocked), #12 (partial), #47/#49 (owner cert), #50 (continuous) |
| `plans/GOTO_PLAN.md` | Active | ALL numbered items #1–#11 SHIPPED (2026-07-11); Tier 3 pending gates Q4/Q6/Q7/Q8/Q9 |
| `plans/GUI_INTERACTION_PLAN.md` | Active | Tier 1 #1,#2,#5 (all owner-gated) + Tier 2 #12 + Tier 3 #16–#17 open; #8, #11 CLOSED and #15 fully covered except the #1-gated folder-undo journey, ALL 2026-07-18 (#8: palette bridge + mini-toolbar + worksheet/window/annotation retrofits; #11: stat-mark faceting end-to-end; #15: channel-drag + annotation/shape + window-arrange journeys, e2e 33/33 across the zoom matrix); #4 SHIPPED 2026-07-12, #6 SHIPPED 2026-07-16, #3+#7+#9+#10+#13+#14 SHIPPED 2026-07-17 (#10 docking deferred, #13 undo sub-item deferred to the #1 gate), #8 core SHIPPED 2026-07-17 (registry + keyboard-complete menu + resting cue + confirm; residual = Command Palette/Plot Objects tree/mini-toolbar reuse + remaining menu retrofits), #11 core SHIPPED 2026-07-17 (residual = stat-mark faceting; arbitrary multi-panel ordering belongs to #12/#54), #15 core harness + 7 journeys SHIPPED 2026-07-17 and export round-trip SHIPPED 2026-07-18 (residual = folder undo, channel→axis drag, annotation/shape edit, window arrange); 4 owner gates (undo scopes, baseline framing, tree scope, selection contract) |
| `plans/ORIGIN_FILE_DECODE_PLAN.md` | Active | Plot Fidelity campaign: #48–#52 complete; #54 page-setup control + spatial-export residual + overlap/inset layout slice ALL SHIPPED 2026-07-17 (Codex PR #55); visual-import campaign #58–#63 ALL SHIPPED 2026-07-18 (Codex stack #56–#61 `854271c`: spatial legends, region bands, imported-view + spatial-page export parity, saved-preview window, presentation templates); open = #53 graphic objects (evidence-gated; subsumes #47), #54 generalized page/layer model + >2 Y axes; #55 tooling is complete and #55/#56 close on owner screenshot review. #27 deferred; #42 reopens only on new corpus evidence |
| `plans/archive/` | Complete | 12 plans incl. the 2026-07-10 fold-ups (MULTI_PLOT, WORKSHEET, PROJECT_ORGANIZATION, GAP_TIER3, GAP_ECOSYSTEM, ORIGIN_GAP) |
