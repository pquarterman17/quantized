# JMP Gap Plan — full JMP + OriginPro daily-driver replacement

**Status:** Active
**Parent:** `plans/MAIN_PLAN.md`
**Created:** 2026-07-28
**Updated:** 2026-07-29 latest (#14 module-size follow-ups SHIPPED —
three splits plus the `MODULE_PINS` ratchet that now guards non-store
`.ts`, the gap that let `lib/api.ts` reach 2,282 lines unseen; see
Completed. Prior same day: pre-merge adversarial review of PR #94,
four defects fixed on the branch — chi-square Yates convention,
By-level cap, box CI domain, dead vitest 3 pool config. Campaign
complete: J3, J5, J6, J7, J9, J10, J11, J12, J17 and J8's backend
SHIPPED — every census-independent item is closed or reduced to a
named residual. Open: J1/J2 (ride P1.4), J4 (= P1.5), J8 UI half,
small residuals below, Tier 3 census-gated. Prior: 2026-07-28 initial
gap analysis against `457cdae`)

## Purpose

The owner's directive (2026-07-28): **"I want quantized to fully replace
JMP and OriginPro as my daily plotting and analysis software."**

The OriginPro half of that goal is already owned by
`PRIMARY_SOFTWARE_AUDIT_PLAN.md` (P0–P4 + Gates A–E) and is NOT
re-analyzed here — a fresh Origin sweep three days after the 2026-07-25
readiness audit would only duplicate it. This plan owns the **JMP half**:
a code-grounded feature gap analysis against the owner's JMP daily-driver
surface, and the tiered work to close it. Where a JMP gap lands on a
foundation the PRIMARY plan already books (P1.4 categorical channels,
P1.5 live grouping, P2.6 categorical workbench), this plan adds the JMP
acceptance criteria to that item rather than duplicating it.

## Scope change this plan records (supersedes two standing clauses)

The owner's directive is itself the demand signal two existing documents
were explicitly waiting for. Recorded here so neither clause is applied
stale:

1. `GOTO_PLAN.md` §Out of scope declared "stats platforms beyond the
   shipped W5 suite" a non-goal. **Superseded 2026-07-28** for the
   platforms this plan books; GOTO_PLAN carries a dated pointer.
2. `PRIMARY_SOFTWARE_AUDIT_PLAN.md` P2.6 parked "ANOVA/post-hoc, PCA,
   regression/correlation, GLM, survival, and ROC … lower priority until
   demand is shown." **Demand is now shown** for the analysis platforms
   the owner actually uses; the J-census gate below decides which those
   are before anything speculative (DOE, control charts) is built.

The repo's operating rule ("measure before expanding; real switch-back
friction outranks parity lists") still governs: Tier 1 items are the
structural blockers that fail *any* JMP-shaped workflow; census-gated
platforms stay gated.

## Method / evidence

- Backend inventory (2026-07-28): every `calc/`, `io/`, `routes/` module
  enumerated; each candidate JMP capability confirmed present/absent by
  function name and file path.
- Frontend inventory (2026-07-28): command registry, Graph Builder
  zones, Stat Stage modes, worksheet ops, data filter, row-state
  chokepoint, tabulate, column metadata — all confirmed against source.
- Cross-checked against `PORT_CHECKLIST.md`, the archived
  `ORIGIN_GAP_PLAN.md` W5 section, `GOTO_PLAN.md`, and
  `PRIMARY_SOFTWARE_AUDIT_PLAN.md` so nothing already booked is
  re-booked.

### What already replaces JMP today (do not rebuild)

Verified in code — reopen only on a reproduced defect:

- **Statistics engines (the W5 suite), backend-complete and tested:**
  descriptive stats, t-tests (1-sample/paired/Welch, tails, CI), one-way
  ANOVA (`calc/stats.py`), balanced + unbalanced (Type II/III) two-way
  ANOVA, repeated measures with GG/HF sphericity
  (`calc/stats_anova2.py`, `calc/stats_anova_ext.py`), Tukey HSD,
  Dunnett, Holm/Bonferroni/BH adjustment, the nonparametric family
  (Mann-Whitney, Wilcoxon, Kruskal-Wallis, Friedman, sign, KS ×2),
  normality (Shapiro, Anderson-Darling, KS) + Levene/Brown-Forsythe,
  guided test chooser (`calc/stats_tests.py`), correlation/partial
  correlation matrices, multiple + stepwise regression
  (`calc/stats_multivar.py`), PCA (`calc/stats.py`), distribution
  fitting + power/required-N (`calc/stats_dist.py`), GLM
  logistic/Poisson (`calc/stats_glm.py`), Kaplan-Meier/log-rank/Cox
  (`calc/stats_survival.py`), ROC/AUC (`calc/stats_roc.py`), bootstrap +
  MCMC with corner plots. All exposed at `/api/stats*`.
- **Stat plots:** box / violin / Q-Q / histogram / bar (grouped +
  stacked) with one-factor grouping AND one-factor faceting, backed by
  `calc/statplots.py` + client fallback; matplotlib export parity via
  `calc/figure_statplots.py`.
- **Graph Builder** with X/Y/Group/Facet wells, categorical-X mark
  family switching, saved named specs round-tripping `.dwk`.
- **Modeling types** continuous/ordinal/nominal with conservative
  inference + per-channel override (`lib/modeling.ts`) — JMP's
  C/O/N concept is already the native column model.
- **Local data filter** (range + level-set per column, AND-combined,
  saved on the dataset) feeding the guarded row-state chokepoint
  (`lib/rowstate.ts`) that every analysis reads — the JMP
  local-data-filter + exclude-rows semantics, already linked app-wide.
- **Linked selection both directions** (plot brush → worksheet rows;
  histogram bins → rows; worksheet selection → plot highlight) with
  exclude/keep-only actions.
- **Worksheet ops:** formula columns (safe parser), inner/left/right/full
  key join, transpose/stack/unstack(pivot with aggregate), split-by-
  column-value (gap clustering), block copy/cut/paste/fill, sort,
  per-column stats footer, Tabulate v1 (one group × one value × six
  aggregates, `lib/tabulate.ts`), read-only SQL source.
- **Reproducibility** (where quantized already beats JMP+JSL for this
  owner): recorded pipelines with re-run, recalc modes, session undo,
  provenance on derived data, headless `quantized.api`.

## Gap register — JMP daily-driver surface

IDs are `J#`. "Foundation" names the PRIMARY/GOTO item the gap layers
on, when one exists.

| ID | Gap (JMP capability → quantized state) | Foundation |
|----|----------------------------------------|------------|
| J1 | String categorical data: JMP columns hold text levels with value ordering/labels; quantized `DataStruct.values` is numeric-only — text columns are read-only sidecars, unusable as Group/Facet/Filter/Tabulate/legend inputs | PRIMARY P1.4 |
| J2 | Recode (JMP's workhorse cleanup: merge/rename levels, find-replace): absent entirely | P1.4/J1 |
| J3 | Fit Y by X platform (auto-dispatch on modeling types: oneway ANOVA w/ graphical means comparison, bivariate fit, contingency): no UI; backend also lacks chi-square independence + Fisher exact | P2.6 |
| J4 | Live Group split for scatter/line: Graph Builder Group well is preview-only ("series-split by group is preview-only in v1", `useGraphBuilder.ts:248`) | PRIMARY P1.5 |
| J5 | Jitter/strip mark, raw points over box, mean-with-CI marks, connect-means (interaction plot): none of these marks exist | P2.6 |
| J6 | Tabulate: JMP nests multiple row/column grouping levels with many simultaneous stats; v1 is one group × one value × fixed six | — |
| J7 | "By" role: JMP runs any platform once per level of a By column; quantized analyses run on one dataset only (manual split first) | — |
| J8 | Variability/gauge chart (nested lot/wafer/site factors, connect cell means, group means) + variance components / nested ANOVA: absent (front AND back) | P2.6 |
| J9 | Outlier screening (Grubbs, Dixon, Rosner, robust MAD): absent | — |
| J10 | Multivariate platform UI: correlation heatmap, scatterplot matrix (SPLOM), PCA scores/loadings/biplot/scree — engines exist (`stats_multivar`, `pca_analysis`) with zero UI | — |
| J11 | Formula language: row-scoped arithmetic only — no comparisons, conditionals, aggregate refs (mean(A)), row()/lag/diff, missing-value handling (JMP formula editor covers all) | — |
| J12 | Distribution platform depth: one column at a time; no fit-all-with-AICc comparison, no capability indices | — |
| J13 | Clustering (k-means, hierarchical + dendrogram): absent | census |
| J14 | Control charts (IMR, X-bar/R, EWMA/CUSUM, run rules) + process capability (Cp/Cpk): absent | census |
| J15 | Gauge R&R / MSA: absent | census |
| J16 | DOE (design generation + analysis): absent | census |
| J17 | JSL scripting parity: not a gap to fill by emulation — map to pipelines/recipes/headless API and document the mapping | P1.3/P3.5 |

Origin-side reconciliation: this pass found **no Origin gap not already
booked** in `PRIMARY_SOFTWARE_AUDIT_PLAN.md` / `ORIGIN_FILE_DECODE_PLAN.md`
(expected — that audit is 3 days old). The two campaigns share Tier-1
foundations: P1.4 is the single highest-leverage item for BOTH
replacements and its priority case is now stronger, not different.

## Dependencies & sequencing

- **J1/J2 ride P1.4** (first-class categorical/metadata channels). P1.4
  is sequencing-gated by PRIMARY Gate A; this plan does not reorder that
  — it widens P1.4's acceptance criteria so the contract is designed
  once for both campaigns (string levels in, not retrofitted).
- **J4 = P1.5** exactly; booked there, JMP acceptance added here.
- **J3/J5/J8 backend halves are pure `calc/` additions** with no
  categorical-contract dependency (groups arrive as arrays, like the
  existing ANOVA API) — actionable now under the small-vertical-PR rule.
  Their *workbench* halves want J1 for text factors but degrade to
  today's numeric-coded levels.
- **J6/J7/J9/J10/J11/J12** are independent of each other; J7 wants J6's
  grouped-iteration plumbing first.
- **J13–J16 are census-gated** (Gate J below): JMP's quality/DOE tools
  are exactly where "parity lists" diverge from "what the owner opens" —
  do not build until the census says which are real.

## Tier 1 — High Impact (fails any JMP-shaped workflow)

1. **[ ] J1 — String categorical levels end-to-end** (with P1.4; design
   the contract once). Acceptance beyond P1.4's own boxes:
   - [ ] A text column imports as a first-class categorical column
     (string levels preserved, not numeric-coded), visible in the
     worksheet, editable type C/O/N.
   - [ ] Categorical columns drive Graph Builder X/Group/Facet, Stat
     Stage group/facet, Data Filter level-sets, Tabulate wells, legend
     labels, and `facet-by-column` — with their **string** labels on
     axes/legends everywhere including matplotlib export.
   - [ ] Level *ordering* is user-settable (ordinal value order) and
     survives `.dwk` round-trip and export.
   - [ ] Existing numeric-coded workflows migrate unchanged.

2. **[ ] J2 — Recode workshop.** Merge/rename/bin levels of a
   categorical column with live preview (old → new mapping table),
   producing a derived column (raw immutable), one undo entry,
   provenance recorded; mapping saveable/reapplicable. Includes plain
   find-replace over text cells.

3. **[x] J3 — Fit Y by X workbench.** SHIPPED 2026-07-28/29 (see
   Completed). One Analyze command; dispatch on (X, Y) modeling types:
   - [x] categorical X × continuous Y → oneway: grouped points +
     stats, one-way ANOVA + Levene warning (no Welch endpoint exists —
     documented fallback), Tukey when >2 levels, `recommend_test`
     hint; report-sheet emission.
   - [x] continuous × continuous → bivariate: scatter + linear/poly
     fit (order 1–3), R²/F/p table. Residual: confidence/prediction
     band (needs a new backend return — booked below).
   - [x] categorical × categorical → contingency cross-tab +
     chi-square independence + Fisher exact (2×2) — new backend
     `calc/stats_contingency.py` + routes, pinned to Fisher's 1935
     lady-tasting-tea reference values; `low_expected` warning honest.
   - [x] Honors the row-state chokepoint (guard #11 verified).
   - [x] ~~Residual: bivariate confidence bands~~ SHIPPED 2026-07-29
     (residual sweep): opt-in `band_x` on `/api/stats/regression`
     (byte-identical response when omitted — pinned by test;
     cross-checked vs statsmodels to 1e-8), SVG ribbon in the
     bivariate view. Prediction bands + mosaic plot remain open.
   - [ ] Residual: mosaic plot proper (cross-tab table shipped).

4. **[ ] J4 — Live Group split for xy marks** (= PRIMARY P1.5; JMP
   acceptance): durable grouped series with stable identity/legend from
   the Group well, editable after Send, parity across
   Stage/export/reopen.

5. **[x] J5 — Grouped-plot mark completion.** COMPLETE 2026-07-29:
   items 1–3 (deterministic-jitter raw points, mean ± 95% t-CI marker,
   `strip` StatMode) plus the connect-means line (residual sweep) —
   all with matplotlib export parity on shared fixtures. Noted scope
   reading: connect-means gates on the stage's one grouping axis
   (`groupCol`), the JMP oneway reading.

6. **[x] J6 — Tabulate v2.** SHIPPED 2026-07-29 (see Completed): up to
   3 nested group columns, multiple value columns, 10-stat catalog
   (count/mean/sd/sem/min/max/median/sum/q1/q3), grand-total toggle,
   label-true TSV (resolves Origin text labels, never ordinal codes);
   dataset export + report emission kept. Noted deviations recorded in
   Completed (grand-total excluded from dataset export; q1/q3 use
   linear interpolation, exact JMP quantile parity deferred to J12).

## Tier 2 — Medium Impact

7. **[x] J7 — "By" grouping on analysis platforms.** SHIPPED
   2026-07-29 (see Completed): Distribution + Fit Y by X gain a By
   column (shared `lib/byPartition.ts` — index partitioning after the
   guard-#11 view, no dataset minting); per-level sections, honest
   small-n lines, per-level report concatenation. Tabulate's By is its
   own nested grouping (J6). Residual: By on the curve-fit workshop.

8. **[~] J8 — Variability chart + variance components.** Backend
   SHIPPED 2026-07-29 (see Completed): `calc/stats_varcomp.py`
   (nested ANOVA, EMS variance components with n0/Satterthwaite
   unbalanced handling + clamping flags, `variability_summary` chart
   contract) + `/api/stats/{nested-anova,variance-components,
   variability-summary}`. **Residual: the variability-chart UI** (the
   `variability_summary` payload is its data contract; the owner's
   lot/wafer/type `grouped_factors_boxplot` fixture is the acceptance
   case). Note: pinned to a hand-derived EMS fixture, not Montgomery's
   table (unreachable without web access — disclosed in the module).

9. **[x] J9 — Outlier screening.** COMPLETE 2026-07-29: backend
   (Grubbs, Dixon Q n=3–30, Rosner ESD pinned to the NIST n=54
   example, MAD) + the Outlier screening workshop ("Select flagged
   rows" writes the shared row selection; never auto-excludes; maps
   flagged indices back through the analysis view's pruning).
   Standing caveat: Dixon critical table above n≈20 transcribed
   without web access — re-verify vs Rorabacher (1991) (docstring
   flags it).

10. **[~] J10 — Multivariate workbench.** SHIPPED 2026-07-29 (see
    Completed): correlation heatmap (pearson/spearman, r+p), SPLOM
    canvas with per-panel downsampling, PCA (scree/scores/loadings),
    TSV copy; standalone `store/multivar.ts` after the first attempt
    tripped the useApp store-size ratchet. **Residual: matplotlib
    export parity (`figure_multivar` renderer).**

11. **[x] J11 — Formula language v2.** SHIPPED 2026-07-29 (see
    Completed): comparisons, word-style logicals (`and`/`or`/`not`,
    1/0, NaN-safe), `if(cond,a,b)`, column aggregates (`mean(A)` etc.;
    `min`/`max` keep 2-arg row behavior), `row()` (1-based, matches
    the grid), `lag(A,k)`/`diff(A)`; parser split into sibling
    modules; v1 corpus green unchanged; help updated.

12. **[x] J12 — Distribution platform depth.** SHIPPED 2026-07-29
    (see Completed): compare-distributions mode (fit-all + ranked
    table, honest ranking label, winner highlighted), generalized PDF
    overlay, percentile readout for the fitted winner. Capability
    indices remain Gate-J-gated (J14).

13. **[x] J17 — JSL → quantized mapping doc.** SHIPPED 2026-07-28 (see
    Completed): "From JMP" Help tab with 11 idiom mappings
    (`lib/jmpTips.ts`, reuses the Origin-tips architecture — no
    parallel catalog), JMP keywords on 10 commands, vocabulary guard
    extended so "jmp"/"jsl"/"local data filter"/"by group"/"tabulate"
    cannot regress; help stays in the lazy chunk.

14. **[x] Module-size follow-ups** — SHIPPED 2026-07-29 (see Completed).
    All three splits landed plus the guard that was missing under them:
    a new `MODULE_PINS` ratchet in `architecture.test.ts` now covers
    non-store `.ts`, closing the gap that let both files grow unseen.

## Tier 3 — Census-gated (do NOT build speculatively)

- **[ ] J13 — Clustering** (k-means + hierarchical/dendrogram).
- **[ ] J14 — Control charts + capability** (IMR, X-bar/R, EWMA/CUSUM,
  Western Electric rules; Cp/Cpk).
- **[ ] J15 — Gauge R&R / MSA.**
- **[ ] J16 — DOE** (screening/factorial design generation + analysis).

Each opens only if Gate J shows real recent use, mirroring the
specimen-gate discipline (PRIMARY P2.9/P4.4).

## Gate J — JMP usage census + switch trial (owner)

1. [ ] **Census:** list the JMP platforms actually opened in the last
   ~6 months (Distribution / Fit Y by X / Fit Model / Graph Builder /
   Tabulate / Variability / Control Chart / MSA / DOE / Multivariate /
   Clustering / other), each with frequency + a one-line example. This
   ranks Tier 2 and decides Tier 3. (Analogue of GOTO Q9's role for
   Origin.)
2. [ ] **JMP switch-trigger trial:** one real JMP-shaped deliverable
   (e.g. grouped lot/wafer/type analysis: import → recode → variability
   or grouped box → ANOVA + post-hoc → tabulated summary → figure into
   slides) run 100% in quantized under the P0.1 protocol, JMP closed,
   friction logged to the same taxonomy.
3. [ ] Re-rank this plan's tiers from the census + friction log.

Gate J does not block Tier 1 (structural blockers are census-independent)
and does not reorder PRIMARY Gate A; the two owner trials can share a
session.

## Definition of done (extends PRIMARY's "Definition of primary software")

- [ ] Three representative real projects finish with **neither** Origin
  **nor JMP** opened (the PRIMARY definition's first box, JMP half now
  first-class).
- [ ] A grouped categorical analysis (text factors) goes from file to
  publication figure + summary table without code or level-recoding
  detours.
- [ ] Every census-listed JMP platform has a validated quantized
  equivalent or an explicit, owner-accepted deferral.

## PR discipline

Inherits PRIMARY's rules (small vertical PRs; contract changes carry
migrations + characterization tests; never mix refactors with new
scientific behavior). Backend engines land with reference-value tests
(NIST StRD / textbook cases — the W5 convention); new UI platforms land
with the same screen-vs-export same-calc parity the stat stage already
enforces. New deps must stay permissive (statsmodels/scipy patterns;
**no pingouin — GPL**).

## Completed

- ~~**#14 Module-size follow-ups**~~ (2026-07-29) — all three splits,
  plus the guard whose absence was the actual defect. `routes/
  export_figures.py` 493→323: the statplot + categorical models and
  endpoints moved to `routes/export_statplots.py` (214), cut along the
  same `_figure_series` seam `export_figures_aux.py` used — a route
  stays only if it takes a `dataset` + channel picks, and these take
  pre-aggregated arrays. `frontend/src/lib/api.ts` 2,282→1,895: shared
  transport to `lib/api/http.ts` (90, so a domain module can reach the
  helpers without a cycle back through `api.ts`) and the `/api/stats/*`
  wrappers to `lib/api/stats.ts` (342), both re-exported so all 21
  consumers and their `vi.mock`s are untouched; api.ts is the
  aggregator now, the `appCommands.ts`/`commands/` shape. J8's
  variability-chart wrappers are the next ones due and belong in
  `api/stats.ts`, not `api.ts`. `useDistribution.ts` 583→492: the J7
  By-level half to `distribution/useDistributionByLevels.ts` (165),
  which also owns the per-level analysis primitives (`colValues`/
  `numArr`/`HistBins`/`Normality`) — the un-partitioned view is the
  n=1 case of the same computation, so a shared `normalityNote()` also
  removed a duplicated wording branch. **The guard was the real
  finding:** `.tsx` had a ceiling and the store slices had pins, but
  non-store `.ts` had neither, which is exactly how both files reached
  those sizes unseen — a `MODULE_PINS` ratchet (shrink-only, with a
  graduation check at the 400 `.tsx` ceiling) now covers them, and
  BOTH its branches were verified by planting violations. Gate green:
  backend 3,104 passed / ruff / mypy; frontend tsc + eslint clean,
  eager bundle byte-identical at 894.8 kB (`export *` tree-shakes
  fine). Frontend vitest is 176-failing on this machine BEFORE and
  AFTER, identically — local Node v26 leaves `localStorage` undefined
  without `--localstorage-file`; open PR #93 (pin Node 22) is the fix.

- ~~**PR #94 adversarial review + fixes**~~ (2026-07-29) — pre-merge
  review of the whole campaign PR (guards + backend-stats + frontend
  agents; NIST worked examples, bit-for-bit jitter parity, formula
  semantics all independently verified). Four defects fixed on the
  branch: chi-square 2x2 was Yates-corrected while claiming JMP's
  default (now `correction=False`, the uncorrected JMP/SAS headline
  convention — tea-tasting pins 0.5→2.0, V 0.25→0.5); By partitioning
  had no level cap (now BY_MAX_LEVELS=30 + honest truncation note);
  box-mode value domain ignored mean-CI extents (small-n CI whiskers
  overdrew the axes). Fifth, root-caused the "worker OOM with all tests
  passing" that had dogged the PR's CI: NOT memory pressure but a
  render↔effect loop — `SplomTabView` stored a fresh `[drawn, total]`
  array per report and passed a fresh `onSampleInfo` arrow per render
  while `SplomView` keyed its report effect on the callback identity;
  the loop allocated to ANY heap ceiling (4→6→12 GB reproduced) while
  never yielding to timers, so no test timeout could fire, and it would
  burn CPU in production browsers too. The review localized it via
  vitest 4's removal of `poolOptions` (the PR's memory knobs were dead
  config) + `--logHeapUsage` (fork dies mid-MultivarPanel; real
  heaviest file ~1.1 GB, GridViewport.perf); the cloud session
  independently converged on the same root cause and shipped the fix
  (`2ea1abb`: stable `useCallback` + same-value bail) plus the
  principled revert of ALL memory band-aids (vite.config knobs, ci.yml
  NODE_OPTIONS) — default limits were never the problem. Size
  follow-ups booked as #14.

- ~~**Second implementation wave — J7, J8 backend, J10, J12, and the
  J5/J9/J3 residual sweep**~~ (2026-07-29) — same parallel-worktree
  method as the first wave.
  - **J8 backend** (`549a32b`): `calc/stats_varcomp.py` + routes —
    nested ANOVA, EMS variance components (n0/Satterthwaite for
    unbalanced, clamped-negative flags), `variability_summary` (the
    future chart's data contract). Honest substitution: hand-derived
    EMS fixture instead of memory-reproduced Montgomery data (web
    unreachable), disclosed in module + tests.
  - **Residual sweep** (`094b913`): J5 connect-means (screen + export
    parity), J9 outlier-screening workshop (select-flagged-rows via
    the shared selection; original-index mapping through the pruned
    analysis view), J3 opt-in regression confidence band
    (byte-identical default response pinned by test).
  - **J12** (`d63e66e`): distribution compare mode + generalized PDF
    overlay + percentile readout.
  - **J10** (`7a32165` + repair `5266f61`): multivariate workbench
    (correlation heatmap / SPLOM / PCA). Two lessons: (a) it tripped
    the useApp store-size ratchet — state moved to standalone
    `store/multivar.ts` (the fityx/help precedent); (b) the
    orchestrator's scripted union conflict-resolution TRUNCATED
    `lib/api.ts` at the file tail — caught by the post-merge gate,
    repaired via a proper `git merge-file` three-way re-merge. Lesson:
    resolve merge conflicts with git's own 3-way machinery, never a
    regex.
  - **J7** (`fb10514`): By-column grouped analysis for Distribution +
    Fit Y by X over shared `lib/byPartition.ts`.
  - Final tip gates: backend **2,783 passed** (+90 over the campaign
    baseline), frontend full suite + build re-run on the tip after the
    last merge (numbers in the closing session log), bundle 894.7 kB
    eager (24.5 kB under budget).

- ~~**First implementation campaign — J3 (both halves), J5 items 1–3,
  J6, J9 backend, J11, J17**~~ (2026-07-28/29) — seven parallel
  worktree agents (Sonnet for features, Haiku for J17 docs), each
  merged only after its gate ran green on the orchestrator's side too.
  - **J3 backend** (`15bdb92`): `calc/stats_contingency.py`
    (chi-square independence + Cramér's V + `low_expected`, Fisher
    exact 2×2, chi-square GoF; scipy delegation) + 3 routes in
    `stats_design.py`; pinned to Fisher's lady-tasting-tea values and
    a hand-verified 2×3 table (1e-12).
  - **J9 backend** (`b647bfc`): `calc/stats_outliers.py` +
    `routes/stats_outliers.py` (Grubbs, Rosner ESD — NIST n=54
    example reproduced: 6.01/5.42/5.34; Dixon Q with Rorabacher
    tables, MAD modified z-score). Known caveat: Dixon table n>20
    transcribed without web access, re-verify (docstring flags it).
  - **J17** (`2a8a0ef`): "From JMP" Help tab, 11 idiom mappings,
    JMP keywords on 10 commands + vocabulary-guard extension.
  - **J6** (`a8123ef`): Tabulate v2 — `tabulateNested` (≤3 group
    levels), multi-value, 10-stat catalog, grand total, label-true
    TSV; ZoneWell multi-slot UI; panel split into sub-components.
    Deviations: grand total is TSV/report/preview-only; dataset
    export uses ordinal index + group-code channels (not `time`);
    q1/q3 linear interpolation ≠ JMP's method (J12 owns parity);
    empty cells persist as count-0/NaN rows so one value column's
    gaps can't hide another's data.
  - **J3 frontend** (`45ef39c`): Fit Y by X workbench
    (`workshops/fityx/`, lazy panel, own `store/fitYByX.ts` because
    `useApp.ts` sits at its ratchet pin) — oneway (ANOVA + Levene +
    Tukey + recommend hint), bivariate (order 1–3), contingency
    (cross-tab + new endpoints); guard #11 respected; report emission
    via the existing `stats_table` kind.
  - **J5 items 1–3** (`aaa6158`): deterministic-jitter point overlay
    (`lib/jitter.ts`, same hash mirrored in Python), mean ± 95% t-CI
    (`lib/tdist.ts`; calc + client fallback share fixtures), `strip`
    StatMode; export parity in `figure_statplots.py`; renderer split
    (`statRenderBox.ts`, `useStatStageCompute.ts`). Residual:
    connect-means.
  - **J11** (`3510c4e`): formula v2 — comparisons, `and/or/not`,
    `if()`, column aggregates, `row()` 1-based, `lag`/`diff`; split
    into `formulaTypes/formulaAggregates/formulaRowFns`.
  - Gates on the branch tip after each merge: backend ruff + mypy +
    pytest (2,697 passed at J5's merge), frontend vitest full
    (4,806–4,812 passed across merges), build + bundle ratchet
    (881→891.7 kB eager, ≥27.5 kB headroom held). One recurring
    `GridViewport.perf` timing flake under 6-way concurrent vitest
    load never reproduced on any clean re-run.
  - Process note for future campaigns: EVERY feature agent idle-
    stopped at least once waiting on a backgrounded test run —
    resume with "run the gate synchronously, commit, report", or
    gate+commit their worktree from the orchestrator (J5/J11 were
    finished that way).

- ~~**Initial gap analysis**~~ (2026-07-28) — two very-thorough code
  inventories (backend calc/io/routes; frontend commands/Graph
  Builder/worksheet/filter/selection/tabulate) diffed against the JMP
  daily-driver surface; 17 gaps booked (J1–J17), 4 census-gated; scope
  change vs GOTO non-goal + P2.6 demand clause recorded; sibling plans
  (`MAIN_PLAN`, `GOTO_PLAN`, `PRIMARY_SOFTWARE_AUDIT_PLAN`, `BACKLOG`)
  reconciled in the same commit. Verified absent-not-overlooked for
  every "absent" claim above (clustering, SPC, capability, MSA, DOE,
  outlier tests, chi-square independence, recode, jitter, SPLOM/PCA UI:
  zero hits in `src/`, `frontend/src`, active plans).
