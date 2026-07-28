# JMP Gap Plan — full JMP + OriginPro daily-driver replacement

**Status:** Active
**Parent:** `plans/MAIN_PLAN.md`
**Created:** 2026-07-28
**Updated:** 2026-07-28 (initial gap analysis; both code inventories run
against the working tree at `457cdae`)

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

3. **[ ] J3 — Fit Y by X workbench.** One Analyze command; dispatch on
   (X, Y) modeling types like JMP:
   - [ ] categorical X × continuous Y → oneway: grouped points +
     box/mean-CI display, one-way ANOVA (Welch option), post-hoc
     (Tukey/Dunnett, reusing `stats_anova2`), nonparametric fallback
     per `recommend_test`; results as a `#36` report sheet.
   - [ ] continuous × continuous → bivariate: scatter + linear/poly fit
     (existing engines) + confidence/prediction bands (`fit_stats`).
   - [ ] categorical × categorical → contingency table + mosaic-style
     plot; **new backend**: chi-square test of independence + Fisher
     exact in `calc/stats_tests.py` (scipy delegation), route + tests.
   - [ ] Honors the row-state chokepoint and the data filter (reads via
     `rowstate.analysisData` — guard #11).

4. **[ ] J4 — Live Group split for xy marks** (= PRIMARY P1.5; JMP
   acceptance): durable grouped series with stable identity/legend from
   the Group well, editable after Send, parity across
   Stage/export/reopen.

5. **[ ] J5 — Grouped-plot mark completion:** jitter/strip mark
   (categorical family), optional raw-point overlay + mean-diamond/CI
   marks on box plots, connect-group-means line (interaction plot for
   two factors). Screen (uPlot/StatStage canvas) + matplotlib export
   parity, same-calc rule.

6. **[ ] J6 — Tabulate v2:** ≥2 nested row grouping columns, optional
   column grouping, multiple value columns, per-cell stat set chosen
   from the existing `AGG_KEYS` + sum/sem/quantiles; drag wells reuse
   `ZoneWell`; export as dataset AND report sheet; TSV copies **category
   labels** (also clears the archived `payloadToTSV` ordinal residual).

## Tier 2 — Medium Impact

7. **[ ] J7 — "By" grouping on analysis platforms.** Run Distribution,
   Fit Y by X, curve fit, and Tabulate once per level of a By column;
   results concatenate into one report sheet keyed by level (the
   `datasetsplit` machinery already partitions rows — reuse it without
   minting datasets).

8. **[ ] J8 — Variability chart + variance components.** Backend:
   nested/crossed variance-component estimation (REML or EMS for the
   balanced case first) + nested ANOVA in a new `calc/stats_varcomp.py`;
   frontend: the classic variability chart (nested factor axis, cell
   points, connect cell means, group mean lines) as a Stat Stage mode or
   workshop; the owner's lot/wafer/type case is the acceptance fixture
   (`grouped_factors_boxplot` baseline fixture already encodes it).

9. **[ ] J9 — Outlier screening.** `calc/stats_outliers.py`: Grubbs,
   Dixon, Rosner (generalized ESD), robust MAD-based flagging; route;
   UI action that *selects* flagged rows (feeding the existing
   exclude/keep-only row actions — never auto-deletes).

10. **[ ] J10 — Multivariate workbench.** Correlation matrix heatmap
    (existing `correlation_matrix`), SPLOM (small-multiples reuse of the
    facet grid), PCA UI: scree, scores/loadings plots, biplot
    (existing `pca_analysis`); export parity via a
    `figure_multivar` renderer.

11. **[ ] J11 — Formula language v2.** Comparison + logical operators,
    `if(cond, a, b)`, aggregate references (`mean(A)`, `sd(A)`, …
    computed over the analysis view), `row()`, `lag(A, k)`/`diff(A)`,
    NaN-propagation rules documented; same no-eval parser discipline +
    fuzz tests; help tab updated.

12. **[ ] J12 — Distribution platform depth.** Fit-all candidate
    distributions with AICc ranking (engines exist:
    `fit_distributions` + `fit_compare` pattern), overlay the winner,
    tolerance/prediction interval readout; capability indices only if
    Gate J books J14.

13. **[ ] J17 — JSL → quantized mapping doc.** One help page: each JMP
    daily idiom (formula, recode script, By-group, saved script to
    table) → the quantized equivalent (formula column, recode recipe,
    By role, pipeline/recipe). Closes the "muscle memory" gap cheaply;
    feeds P3.1 help search.

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
