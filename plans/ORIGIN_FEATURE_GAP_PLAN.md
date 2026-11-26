# Origin Feature Gap Plan

Turns the 2026-11-25 Origin audit into prioritised work. The audit compared
quantized with the locally installed OriginPro 2026b (Learning Edition) four
ways: the install's own feature inventory, a COM probe, OriginLab's online
documentation, and a walk through the live menus and dialogs. This plan books
what is worth building, in what order, and which model should build it. The
evidence stays in the appendix `ORIGIN_STUDENT_GAP_FINDINGS.md`.

**Status:** Active
**Parent:** `MAIN_PLAN.md`
**Appendix:** `ORIGIN_STUDENT_GAP_FINDINGS.md` (evidence tables, sections A–H)
**Created:** 2026-11-25
**Updated:** 2026-11-26 (waves 1–3 checkpoint: 13 lane PRs merged; items 4, 5, 17 and 18 complete; item 47 booked; 4 lane PRs in flight)
**Baseline:** `origin/main` at `0f4b7bac0` (v0.45.0 + #1032)

---

## Context

### How the pieces fit together

- **Evidence.** The appendix holds one row per Origin feature with its
  quantized status (Have / Partial / Missing / Out) and the file that proves
  it. Sections A–D come from the install (383 rows), E–G from the online docs
  (200 rows), H from the GUI pass (44 rows plus 16 usability ideas). Every
  item below names the appendix sections it closes.
- **Where the code goes.** New analysis is a pure `calc/` module, a thin
  `routes/` adapter and a `components/workshops/` panel. New plot types need
  the screen renderer (uPlot) and the export renderer (matplotlib) to agree,
  pinned by a shared wire fixture. New parsers register once in
  `io/registry.py`.
- **Sibling plans. This plan does not duplicate them:**
  - `ORIGIN_PLOT_TYPE_PARITY_PLAN.md` owns the *import* mapping of Origin plot
    types. A plot type created here books its import mapping there.
  - `GAP_AUDIT_9.md` owns gaps G1–G27 and owner decisions D1–D8. Items here
    cite those IDs and inherit those decisions.
  - `JMP_GAP_PLAN.md` owns the census gate for clustering (J13).
  - `FIGURE_AUTHORING_WORKFLOW_PLAN.md` and `GUI_INTERACTION_PLAN.md` own the
    figure-document and object-editing contracts that W2 and W4 build on.
- **The oracle.** The local Origin runs with Pro features unlocked and no
  export watermark, so it can produce reference answers for most analysis
  items. Only a session on the Origin PC can run it (item 1).

### Data / control flow

```
Origin install + COM probe + online docs + GUI pass
        │
        ▼
ORIGIN_STUDENT_GAP_FINDINGS.md   (appendix: one row per feature, with evidence)
        │  grouped and ranked
        ▼
this plan: numbered items, tier, size, model
        │  one lane per item: claude/<lane> or codex/<lane> branch + PR
        ▼
lane codes against the item's oracle fixture (item 1) or a cited reference
        │
        ▼
merge → appendix row flips to Have → item struck into ## Completed
```

### How priority was set

1. **General before specialised** (owner rule): tools that work on any curve
   or any worksheet come before domain families.
2. **Daily friction first:** things a lab user hits weekly (curve readouts,
   peak labels, formula functions) outrank things hit yearly.
3. **Cheap and verifiable first:** small items with an Origin oracle rank
   above large items without one.
4. **Nothing speculative:** anything that needs an owner decision, a real
   specimen file or a census is listed but gated, not scheduled.
5. **New behaviour is a UI option, and it fails closed** (owner rule). No
   item changes a default silently.

### Model routing

Checked 2026-11-25; recheck in later sessions. Claude names are the current
5.5 family. OpenAI's lineup moved after the July routing table in
`PRIMARY_SOFTWARE_AUDIT_PLAN.md`. Its release notes list GPT-6.2 Astra and
GPT-6.2 Sol (2026-11-17) and GPT-6.1 Terra (2026-10-26), with Luna as the
efficient tier. Secondary guides disagree on the exact version numbers, so
this plan names ChatGPT *tiers*; use the current version of each.

| Work | Claude | ChatGPT |
|---|---|---|
| Mechanical work from a written spec: registry entries, thin wrappers, test expansion, docs | Haiku 5.5 | Luna |
| Bounded multi-file feature: calc + route + panel | Sonnet 5.5 | Terra medium |
| Complex UI or state on a settled architecture | Sonnet 5.5 | Terra high |
| New contracts: schemas, persistence, row-state or security design; review of large PRs | Opus 5.5 | Sol high |
| Unscheduled; only for a tightly scoped problem that defeats the tier above | Fable 5.2 | Astra |

Rules of thumb carried over from earlier plans:

- **Cheapest model that can own the decision**, not the cheapest that
  compiles. Where an item says "contract first", the stronger model writes
  the contract and reviews; the cheaper one fills it in.
- **Claude Sonnet is the default for numerics, parsers, persistence and
  canonical-state writes.** ChatGPT Terra / Sol give the best return on
  interaction design, spatial UI and visual acceptance.
- **Oracle runs need the Origin PC.** A cloud lane cannot start Origin. It
  codes against fixtures a local session has frozen.

Sizes: **S** under a day, **M** one focused PR, **L** several PRs or
design-heavy.

### Dependency map

- Item 1 (oracle harness) feeds every item marked "Oracle: yes". Lanes may
  start without it but cannot close without a reference answer.
- Items 2–5, 17, 18, 28, 29 and 37–39 are independent of each other
  (parallelisable).
- Item 6 waits on GAP_AUDIT_9 D8. Item 11 waits on D1. Items 14 and 46 wait
  on D2 and D3. Items 30 and 36 wait on specimen files (D5).
- Item 9 (fit library) should follow item 1, so each ported function is
  checked against Origin's own fit.
- Item 33 follows item 28, which fixes the contract for non-row-local
  formula functions.
- Item 39 (gallery presets) follows item 20 for the new statistical types;
  presets of existing types can ship first.
- Items 40 and 41 touch every workshop and the Inspector. Do them one at a
  time, and after the smaller W4 items.

### Hand-off: in-flight PRs (2026-11-26; delete this block once every PR below is merged)

Waves 1–3 ran as Sonnet worker lanes, one git worktree each under
`.claude/worktrees/<lane>` on branch `claude/<lane>`. Thirteen lane PRs have
merged and are struck below. These are still open, all with auto-merge armed:

| Item | PR | Lane | Left open after the PR (copy into the item when striking it) |
|---|---|---|---|
| 20 (CDF / ECDF and rug) | #1053 | stat-cdf-rug | Rugs on marginal and faceted panels; break and inset panels; CDF offline fallback |
| 21 | #1051 | ternary-contour | Z-limits in the UI; Append Project does not carry ternary settings |
| 23 | #1055 | annotation-tools | Significance marks (need a p-value column choice); scale bar on the map stage; an arc on the angle measure |
| 32 | #1049 | gridding | Origin oracle comparison; click to pick the extraction point; Shepard and Kriging options in the map card |
| — | #1056 | ci-cancel-main | Cancels superseded CI and e2e runs on `main` |
| — | #1057 | e2e-restore-dedupe | Fixes `main`'s red undock-resize spec |

**How to land them.** `main` is not strict: three required checks
(`frontend`, `backend (windows-latest, 3.11)`, `backend (windows-latest,
3.13)`), and auto-merge fires once they are green. A PR shown as DIRTY has a
conflict: merge `origin/main` into its branch, keep both sides of additive
conflicts (registries, unions, menus, the forward-compat field maps),
regenerate `frontend/api/openapi.json` and `frontend/src/lib/api/schema.d.ts`
(see `frontend/CLAUDE.md`; never trust their text merge), commit, push. #1053
and #1055 both add fields to `lib/workspaceForwardCompat.ts`, so whichever
lands second needs one more merge. E2E is not required, so check `main`'s E2E
run after a burst of merges: two parallel fixes of one spec (#1037, #1054)
merged into a duplicate that kept `main` red until #1057.

**When a PR merges:** strike its item (or its sub-task) into `## Completed`
with the PR number, copy its "left open" note into the item as new
sub-tasks, then `git worktree remove .claude/worktrees/<lane>` and delete the
branch.

**Known local-only failures on the Origin PC** (CI passes them; not caused by
these lanes): `tests/test_axis_scales.py::test_fixture_matches_the_live_export`
and six Origin realdata tests (`test_io_origin_figures_opju` ×3,
`test_io_origin_fidelity` ×1, `test_origin_migration_corpus` ×2).
`fileCommands.test.ts` and `test_fit_robust::test_routes` flake under heavy
load and pass alone.

**Lessons for the next wave.**
- Create worktrees serially before launching agents (parallel
  `git worktree add` contends on git's lock).
- Agents must write logs to lane-unique paths (`/tmp/<lane>-*.log`); shared
  `/tmp` names were overwritten between lanes.
- Lanes run targeted tests plus `tsc -b --force`,
  `npx eslint --max-warnings=0 src` and `npm run build`; CI runs the full
  gate. Twelve concurrent full gates thrash the machine. CI's frontend static
  job runs eslint, and #1041 failed CI on a lint error its lane never ran.
- Never get under a line pin by joining statements onto one line; extract a
  module. The ternary lane did this to `store/useApp.ts`; it was replaced by
  `store/persistedViewState.ts`.
- Only the oracle lane may start Origin. Origin facts measured this wave
  (formula semantics for `normcdf` tail, `weeknum` n2, the name options; York
  error columns are sigmas; `FitLRXErr` is menu-only, so it goes through Origin
  C) are pinned in the lanes' tests.

**Next wave candidates (ungated):** item 47 (nothing from waves 1–3 has been
looked at in a running app), the open sub-tasks of items 1, 2, 3, 7, 10, 28,
29, 37 and 38, then Tier 2 items 13, 22, 24 and 33 and the rest of item 20.
Items 6, 8, 9, 11 and 14 need their owner gates first.

### Resolved decisions

- **2026-11-25 (owner):** the audit is exhaustive; ranking comes afterwards.
  Evidence lives in `plans/`, committed.
- **2026-11-25 (owner):** agents on this work are "cheap but capable": Sonnet
  or below unless an item says otherwise.
- **2026-11-25 (owner):** borrow Origin's good usability ideas without
  cloning its interface (W4).
- **Standing (2026-11-21):** general before specialised; fail closed;
  permissive dependencies only; MATLAB is not a gate.
- **Standing:** EM and imaging stay in `fermiviewer`; 3D plotting beyond
  surface and waterfall was set out of scope on 2026-11-15; watched-folder
  auto-import is out of scope.
- **Settled by code reading, 2026-11-25:** ternary contour is Missing;
  custom ticks with labels, full-precision copy, a worksheet table on a plot
  and EPS export already exist; "Change X / Y" exists only through Layer
  Contents; the X-and-Y-error line fit exists as Deming, without per-point
  weights.

### Owner gates

The only place open questions for this plan live. Each names the items it
blocks.

- **OG1. Scope confirmations.** Confirm these stay out: 3D scatter / bars /
  vectors, hydrochemistry plots, Sankey / chord / network, treemap /
  sunburst, finance charts, geographic maps, Venn / UpSet, Taylor and
  chromaticity diagrams, cloud file storage, UI localisation, R / MATLAB /
  Mathematica consoles, password protection. (Item 27.)
- **OG2. Fit library.** Port every remaining Origin built-in so imported
  fits keep their function, or port on demand? (Item 9.)
- **OG3. Domain families.** Which of these does the lab want: electrochemistry
  (impedance, Tafel, cyclic voltammetry, cycler files), rheology
  (time-temperature superposition, Redlich-Kister), chromatography,
  electrophysiology, pharmacology, enzyme kinetics? (Items 15, 36.)
- **OG4. Clustering.** GAP_AUDIT_9 D1 keeps k-means and hierarchical
  clustering census-gated. An Origin oracle now exists; lift the gate?
  (Item 11.)
- **OG5. Advanced statistics.** GAP_AUDIT_9 D2: none, a minimal set, or
  breadth? Adds scikit-learn or statsmodels. (Item 14.)
- **OG6. Wavelet dependency.** GAP_AUDIT_9 D8: PyWavelets (MIT) or
  scipy-only? (Item 6.)
- **OG7. Import specimens.** GAP_AUDIT_9 D5: a parser is built only from a
  real file. Which of JSON, TDMS, SPE, ISF / WFM, LeCroy, WAV, Igor `.pxp`
  turn up, and can a sample of each be supplied? (Item 30.)
- **OG8. Automation surfaces.** GAP_AUDIT_9 D3 and the BACKLOG "in-app
  scripting console" gate. Also: event scripts, custom menus, user key
  chords, an app gallery. (Item 46.)
- **OG9. EMF and printing.** Is PDF / SVG enough, or are EMF (Office vector
  paste) and direct printing wanted? (Item 26.)
- **OG10. Specialised plot types.** Which of radar, polar bar / wind rose,
  Smith chart, ternary vector, skewed axes, isosurface, Voronoi are wanted
  for creation? (Item 25.)
- **OG11. Row-range views.** Should a plot or fit be able to use a row
  window without masking rows, or do filters and fit ranges already cover
  the need? (Item 31.)
- **OG12. Worksheet structure.** Are mirror columns, named ranges, cell
  notes or graphs inside cells wanted? `sheet()` formulas already reference
  other sheets. (Item 34.)
- **OG13. Usability adoption.** W4 Tier 2 and 3 change how every tool feels.
  Confirm items 40 (preset bar) and 41 (properties navigator) before work
  starts.

---

## Cross-cutting priorities

The "start here" view: the open Tier 1 work, ungated and independent.
Items 4, 5, 17 and 18 are complete; the others shipped their main part on
2026-11-26 and keep the sub-tasks listed under each item.

| # | Item | Workstream | Why first | Model |
|---|------|------------|-----------|-------|
| 47 | Browser and export acceptance of waves 1–3 | W2 | Thirteen merged features nobody has looked at in a running app | ChatGPT Sol |
| 1 | Oracle cases for the remaining items | W1 | Gives the Tier 2 lanes (7, 8, 10, 13, 32) known answers | Sonnet 5.5 on the Origin PC |
| 28 | Formula `LET` | W3 | The last wave 1 formula gap; `formula.ts` needs a split first | Sonnet 5.5 |
| 2 | Curve-measure gadget kinds | W1 | Brings the new measurements to the plot's gadget | Sonnet 5.5 |
| 3 | Peak-tool residue | W1 | Two small gaps in the shipped peak tools | Sonnet 5.5 |
| 29 | Date and number fill patterns | W3 | The last worksheet clipboard gap | ChatGPT Terra medium |
| 38 | "Show all" restores the earlier hidden set | W4 | Small fix to a shipped menu | Sonnet 5.5 |
| 37 | Quick-win limits | W4 | Extends repeat and reopen to the remaining cases | ChatGPT Terra medium |
| 39 | Presets of the item 20 types | W4 | Waits on item 20 | ChatGPT Terra high |

---

## W1 — Analysis & fitting

### Tier 1 — High Impact

1. **Analysis oracle harness** — freeze Origin's answers for the analysis gaps as fixtures, so each lane codes against a known result.
   - Model: **Claude Sonnet 5.5 in a local session on the Origin PC** (a local Codex session on Terra also works). Size M.
   - Source: appendix "Origin Student as an oracle" and "Reproduce".
   - [x] Generalise `tools/plot_corpus/origin_session.py` into a runner that takes seeded input plus one X-Function call and writes the result as JSON (#1036, `tools/origin_oracle/`)
   - [x] Ship a `.truth.json` beside each seeded input; inputs come from quantized's own generators, not a copy
   - [ ] Fixtures for items 2–8, 10, 11, 13 and 32; treemap calls run in their own session. Items 2, 3 and 5 are covered; still to add: items 4, 6, 7, 8, 10, 11, 13 and 32 (new cases go in `tools/origin_oracle/oracle_cases.py`)
   - [x] Store under the private `test-data/origin/` corpus with a `realdata`-style marker
   - [ ] Force the timeout-and-respawn path with a real hang (never exercised)

2. **Curve measurements on raw data** — intersection of two curves, level crossings and rise / fall time, as tools and as ROI gadget kinds.
   - Model: **Claude Sonnet 5.5** (alt ChatGPT Terra medium). Size M. Oracle: yes (`intersect`, `levelcrossing`).
   - Source: A4, A5, B2 (gadget kinds).
   - [x] calc + route for the three measurements (#1038)
   - [ ] Gadget kinds: intersect, interpolate, rise time. Needs a new gadget mode in `store/gadget.ts` and a second-curve source

3. **Peak-tool completions** — tangential baseline, peak alignment (zero-shift correction) and derivative-based peak finding in the Peak Analyzer.
   - Model: **Claude Sonnet 5.5**, Opus 5.5 review if the peak recipe schema changes. Size M. Oracle: partial (`pkFind`; the two Apps are not installed).
   - Source: A3, F, G. Also settles whether the residual finder alone is enough.
   - [x] First / second derivative find modes beside the residual finder (#1040)
   - [x] Tangential baseline for integration (#1040)
   - [x] Align several spectra to a common peak (#1040)
   - [ ] Offer the tangent baseline on the wizard's integrate-only path
   - [ ] Reopen aligned outputs from the Library

### Tier 2 — Medium Impact

6. **Wavelets** — continuous and discrete transforms, wavelet denoise and smooth, in the Signal Processing workbench. *Gated: OG6.*
   - Model: **Claude Sonnet 5.5**. Size M. Oracle: yes (`cwt`, `dwt`, `wtdenoise`).
   - Source: A4; GAP_AUDIT_9 G10 residue.

7. **Signal extras** — coherence, phase unwrap, anti-alias decimation, local-extrema envelope, percentile and binomial smoothing, Zoom FFT, power-spectral-density options.
   - Model: **Claude Haiku 5.5** (alt ChatGPT Luna), following the existing `run_signal_op` dispatch; Sonnet review. Size M. Oracle: yes for most.
   - Source: A4, F, G.
   - [x] Coherence, phase unwrap, anti-alias decimation, envelope, percentile and binomial smoothing, Zoom FFT (#1048)
   - [ ] PSD power ("spectrum") scaling. Welch and periodogram density scaling exist; power scaling needs the spectral recipe plumbing

8. **Statistics completions** — power and sample size, a probability calculator, row-wise t-tests, Steel-Dwass, ANOVA effect sizes, Mann-Kendall trend, and a confidence-interval panel in Distribution.
   - Model: **Claude Sonnet 5.5**. Size L. Oracle: yes for row tests; power needs syntax work.
   - Source: A6, E, F, G.
   - [ ] Power and sample size (t, ANOVA, proportion, variance)
   - [ ] Probability calculator (pdf, cdf, inverse)
   - [ ] Row-wise t-tests
   - [ ] Steel-Dwass, effect sizes, Mann-Kendall
   - [ ] CI panel in the Distribution workshop

9. **Fit-function library port** — bring Origin's remaining general built-in models into the registry from the install's FDF definitions. *Gated: OG2.*
   - Model: contract and generator by **Claude Sonnet 5.5**; bulk conversion and per-function tests by **Claude Haiku 5.5** (alt ChatGPT Luna). Size L. Oracle: yes (Origin's own fit per function).
   - Source: A2 (about 33 of 305 shipped).
   - [ ] General families: Exponential, Growth / Sigmoidal, Hyperbola, Logarithm, Peak, PFW, Power, Rational, Waveform
   - [ ] Implicit (diode, solar cell) and surface families
   - [ ] Auto-initialisation policy for ported functions

10. **General 2D map analysis** — peak finding and 2D peak fitting on any map (today RSM only), plus volume integration over a drawn ROI.
    - Model: **Claude Sonnet 5.5**. Size M. Oracle: yes (`integ2`).
    - Source: A5, F (`calc/rsm_analyze.py` is Partial).
    - [x] 2D peak fits and ROI volume on any map (#1052)
    - [ ] Polygon ROI in the UI (the calc and route accept polygons; the ROI store holds rectangles only)
    - [ ] Draw the box on maps other than RSM (the bounds are typed in today)
    - [ ] Compare volumes with Origin's `integ2` (checked against analytic surfaces only)

11. **Clustering** — k-means and hierarchical clustering with a dendrogram. *Gated: OG4.*
    - Model: **Claude Sonnet 5.5** for the backend, **ChatGPT Terra high** for the dendrogram view. Size M. Oracle: yes (`kmeans`, `hcluster`).
    - Source: A6; JMP_GAP_PLAN J13.

### Tier 3 — Nice-to-Have

12. **Fit residue** — multi-output models, rank-all-models, per-pixel fit through a map stack, a guided standard-curve tool, pulse fit.
    - Model: **Claude Sonnet 5.5**; the first sub-task is a read-only check for Haiku 5.5. Size M.
    - Source: A1, F.
    - [ ] Verify whether Global Fit and Surface Fit already cover the multi-output and matrix cases
    - [ ] Build only what the check leaves open

13. **Math extras** — polygon and surface area, trace and 3D interpolation, B-spline resampling, 2D correlation of two maps, an equation / optimisation solver.
    - Model: **Claude Haiku 5.5** (alt ChatGPT Luna) for the closed-form ones; Sonnet 5.5 for the solver. Size S each. Oracle: yes for most.
    - Source: A5, F, G.

14. **Advanced statistics** — MANOVA, mixed models, factor analysis, Gaussian mixtures, ICA, canonical correlation, NMDS, GAM, trees and forests, neural-net regression, probit. *Gated: OG5.*
    - Model: scope and contracts by **Claude Opus 5.5** (alt ChatGPT Sol high); implementation by Sonnet 5.5. Size L.
    - Source: A6, E, F, G; GAP_AUDIT_9 G12, G14.

15. **Domain analysis families** — electrochemistry (impedance / Nyquist, Tafel, cyclic voltammetry), rheology (time-temperature superposition, Redlich-Kister, rheology fits) and the chromatography, electrophysiology, pharmacology and enzyme fit sets. *Gated: OG3.*
    - Model: **Claude Sonnet 5.5** with the `materials-science-expert` agent for formulas. Size M per family.
    - Source: A2, F, G.

16. **Niche signal Apps** — empirical mode decomposition, dynamic time warping, rainflow counting, Hurst exponent, ridge extraction, comb filter. Build on request only.
    - Model: **Claude Sonnet 5.5**. Size S each.
    - Source: F, G.

---

## W2 — Graphs & figure styling

### Tier 1 — High Impact

47. **Browser and export acceptance of waves 1–3** — no lane looked at its feature in a running app; check each on screen and, for figure features, against the export.
    - Model: **ChatGPT Sol** for visual acceptance (alt Claude Sonnet 5.5 driving the browser). Size M.
    - Source: the "Not done" sections of #1039, #1041, #1042, #1044, #1045, #1046, #1048 and #1052, and of the in-flight #1049, #1051, #1053 and #1055.
    - [ ] Screen against export: line and symbol polish (#17), overlap-avoiding labels (#18), CDF and rug (#20), ternary (#21), annotations (#23)
    - [ ] In a browser: sequential and York fits (#4, #5), signal extras (#7), 2D map analysis (#10), gridding (#32), quick wins (#37), Change X / Y (#38)
    - [ ] The HTML clipboard copy pasted into a real Word document (#29; tested against mocks only)

### Tier 2 — Medium Impact

20. **Statistical plot types** — CDF / ECDF, rug marks, marginal plots, ridgeline, half and split violin, paired before-after, lollipop / dot, stacked histogram, P-P plots for more distributions.
    - Model: first type by **Claude Sonnet 5.5** to set the render pattern; the rest by **ChatGPT Terra high** or Sonnet 5.5; ChatGPT Sol for visual acceptance. Size L. Oracle: yes for the templates that build over COM.
    - Source: B1, E, F, G, H1.
    - [ ] CDF / ECDF and rug
    - [ ] Marginal plots
    - [ ] Ridgeline, half / split violin
    - [ ] Before-after, lollipop, stacked histogram
    - [ ] Book each type's Origin import mapping in `ORIGIN_PLOT_TYPE_PARITY_PLAN.md`

21. **Ternary contour and heatmap** — composition maps on the triangle.
    - Model: **Claude Sonnet 5.5**. Size M.
    - Source: B1; GAP_AUDIT_9 G15 residue (settled Missing 2026-11-25).

22. **Browser graph and graph tools** — step one graph through columns or sheets, pick points from a plot into a sheet, Hide Others, an axis scroller, and filtering plotted data from the graph.
    - Model: **ChatGPT Terra high** (alt Claude Sonnet 5.5, which should also review the state writes). Size L.
    - Source: B1 (stack browser), B2, G, H1.

23. **Annotation tools** — slope annotation, angle and distance measures, scale-bar objects, heatmap cell labels and significance marks.
    - Model: **ChatGPT Terra high** (alt Claude Sonnet 5.5). Size M.
    - Source: E, G, H1.

24. **Plot Details residue** — text or letter symbols, subset centroid with hull or ellipse, subgroup increments, equal-aspect XY layers, total labels on stacks, anchor ticks, XY errors drawn as rectangles.
    - Model: **Claude Sonnet 5.5**. Size M.
    - Source: G, H1.

### Tier 3 — Nice-to-Have

25. **Specialised plot types** — radar, polar bar / wind rose, Smith chart, ternary vector and line, skewed axes, isosurface, Voronoi. *Gated: OG10.*
    - Model: **Claude Sonnet 5.5** or ChatGPT Terra high per type. Size M each. Oracle: yes for wind rose and Smith chart.
    - Source: B1, G, H1.
    - [ ] Verify symmetric-log axes first (`symlog` appears only in `calc/axis_cross.py`)

26. **EMF export and printing** — an Office vector paste path and direct printing. *Gated: OG9.*
    - Model: short design spike by **Claude Opus 5.5** (alt ChatGPT Sol high), since matplotlib has no EMF backend; then Sonnet 5.5. Size M.
    - Source: B2, H1.

27. **Families not scheduled** — the OG1 list, plus the remaining gallery types (Scatter Central, point-segment lines, variable-radius pie, kite, ribbon, circular packing, cluster and correlation plots, heatmap with dendrogram). Kept for the record; no work until OG1 says otherwise.
    - Source: B1, F, G, H1.

---

## W3 — Data, worksheet & import

### Tier 1 — High Impact

28. **Formula functions, wave 1** — distributions (pdf, cdf, inverse), moving-window statistics, column statistics (correlation, slope, percentile, skew, geometric mean), conditional aggregates (`sumif`, `countif`), date extras and `LET`.
    - Model: contract by **Claude Sonnet 5.5** (which functions are row-local, how the exported Python script reproduces them); the function table and tests by **Claude Haiku 5.5** (alt ChatGPT Luna). Size L. Oracle: yes (Set Column Values over COM).
    - Source: C3, G (about 100 of about 400 functions today).
    - [x] Contract: non-row-local functions and incremental recalculation (#1043)
    - [x] Distributions (#1047)
    - [x] Moving-window and column statistics (#1043)
    - [x] Conditional aggregates and date extras (#1043, #1047)
    - [ ] `LET`. The parser's reference tracking has no hook for a name bound inside a call, and `formula.ts` is at 496 of 500 lines, so split it first

29. **Worksheet clipboard and cleanup** — copy as displayed and as an HTML table, paste with trimmed spaces, text to columns, sort columns by a label row, date and number fill patterns, and more conditional-format rule kinds (duplicates, outliers, top / bottom).
    - Model: **ChatGPT Terra medium** (alt Claude Sonnet 5.5). Size M.
    - Source: C3, E, H1.
    - [x] Clipboard formats, trimmed paste, text to columns, label-row sort, more conditional-format rules (#1044)
    - [ ] Date and number fill patterns

### Tier 2 — Medium Impact

30. **Imports by specimen** — JSON tables, NI TDMS, Princeton SPE, Tektronix ISF / WFM, LeCroy, WAV, Igor `.pxp`, HTML and PDF tables, NASA CDF, MDF4. *Gated: OG7; each needs a real file.*
    - Model: **Claude Sonnet 5.5** per parser, with the `data-format-detective` agent; Opus 5.5 or ChatGPT Sol only for an undocumented binary. Size M each. Oracle: yes (Origin imports most of them).
    - Source: C1, F, G; GAP_AUDIT_9 G17.

31. **Row-range views** — plot or fit a row window without masking rows. *Gated: OG11.*
    - Model: contract by **Claude Opus 5.5** (alt ChatGPT Sol high), because the row-state model is the single source of truth; implementation by Sonnet 5.5. Size L.
    - Source: H1; H2 idea 12.

32. **Gridding and map formulas** — Renka-Cline, modified Shepard and Kriging gridding, log-spaced grids, map values from a formula, pixel extraction across maps.
    - Model: **Claude Sonnet 5.5**. Size M. Oracle: yes (`xyz_renka`, `xyz_shep`, `xyz_tps`).
    - Source: C4.

33. **Formula functions, wave 2** — special functions (shared with the fit-equation language), complex numbers, lookup and reference, engineering, signal and data-manipulation functions.
    - Model: **Claude Haiku 5.5** (alt ChatGPT Luna), on the wave 1 contract. Size M.
    - Source: C3.

### Tier 3 — Nice-to-Have

34. **Worksheet structure** — mirror columns, named ranges, cell notes, graphs or images in cells, sheet protection, a column list view, a show-formulas toggle, time-series pivot, inserting a column into every similar sheet. *Gated: OG12.*
    - Model: mirror columns and named ranges need a contract from **Claude Opus 5.5** (alt ChatGPT Sol high), because they touch the recalculation graph; the rest by Sonnet 5.5 or ChatGPT Terra medium. Size L.
    - Source: C3, E, F, G, H1.

35. **Export writers** — worksheet to PDF or image, XML, SQLite and NetCDF map output, on the converter's writer pattern.
    - Model: **Claude Haiku 5.5** (alt ChatGPT Luna). Size S each.
    - Source: C2.
    - [ ] Verify worksheet-to-PDF is absent before building

36. **Other-software and domain imports** — Prism, Minitab, SAS, SigmaPlot; battery cyclers (BioLogic, Neware, Ivium, Metrohm); ChemStation and NMR; ODBC / SQL servers; Google Sheets. *Gated: OG3, OG7.*
    - Model: **Claude Sonnet 5.5** per format. Size M each.
    - Source: C1, E, F, G.

---

## W4 — Workflow & usability (ideas borrowed from Origin)

### Tier 1 — High Impact

37. **Quick wins** — sum / mean / count of the selected cells in the status bar; "repeat last action" and "reopen last dialog" shortcuts; recent commands at the bottom of each menu.
    - Model: **ChatGPT Terra medium** (alt Claude Sonnet 5.5). Size S each.
    - Source: E (verified Partial / Missing), H2 ideas 7 and 9.
    - [x] Selection stats, repeat last action, reopen last dialog, menu recents (#1045; recents are off by default)
    - [ ] Repeat last for multi-input transforms, and reopen for dialogs not opened by a command

38. **Change X / Y / Worksheet on a curve** — right-click a plotted curve to re-point it at another column, or the whole plot at a same-shaped sheet, plus Hide Others.
    - Model: **Claude Sonnet 5.5** for the figure-binding writes; ChatGPT Terra high for the menu interaction. Size M.
    - Source: H1 (today only through Layer Contents); H2 idea 5.
    - [x] Change X, Y and worksheet, and Hide Others, on a curve's right-click menu (#1042)
    - [ ] "Show all" restores the earlier hidden set (today it reveals every curve); match on short column names too

39. **Plot-gallery variant presets** — preset tiles such as "violin with box" or "histogram with rug", so options are found without a dialog.
    - Model: **ChatGPT Terra high**, ChatGPT Sol for visual acceptance (alt Claude Sonnet 5.5). Size M.
    - Source: H2 idea 1.
    - [x] Presets of existing types first (#1035, 10 presets)
    - [ ] Presets of the item 20 types as they land

### Tier 2 — Medium Impact

40. **Preset bar on every tool** — named settings plus last-used values on each analysis workshop, generalising recipes and fit templates. *Gated: OG13.*
    - Model: contract by **Claude Opus 5.5** (alt ChatGPT Sol high): store, project-file persistence, versioning; rollout per workshop by Haiku 5.5, ChatGPT Luna or Terra. Size L.
    - Source: H2 idea 2.

41. **Properties navigator** — one properties surface with a graph › layer › plot tree, several axes edited together, "Apply to…" other layers and graphs, and previous / next in column properties. *Gated: OG13.*
    - Model: interaction design by **ChatGPT Sol high**, implementation by **ChatGPT Terra high**; Claude Sonnet 5.5 reviews the canonical-state writes. Size L.
    - Source: H2 idea 4.

42. **Format by parts** — copy and paste only fonts, colours, symbols or scales, and save a format as a theme by category.
    - Model: **ChatGPT Terra high** (alt Claude Sonnet 5.5). Size M.
    - Source: H2 idea 6.

43. **Role grid at plot time** — choose X, Y, error and label columns when plotting, independent of column designations; a plot list showing each plot's range.
    - Model: **ChatGPT Terra high**. Size M.
    - Source: E (Plot Setup is Partial), H2 idea 11.
    - [ ] Compare with Quick Plot and Graph Builder first; build only the difference

### Tier 3 — Nice-to-Have

44. **Staged edits in layout dialogs** — a live preview, Apply to preview, OK to commit, with the dialog's own undo.
    - Model: **Claude Sonnet 5.5** (alt ChatGPT Terra high). Size M.
    - Source: H2 idea 3.

45. **Learning aids** — a reviewable hint log, an in-app gallery of sample graphs with their data, tips.
    - Model: **ChatGPT Terra medium**, with Claude Haiku 5.5 for content. Size M.
    - Source: D, E, H2 idea 10.

46. **Automation surfaces** — an in-app console, event scripts, custom menus and toolbars, user key chords, an app gallery. *Gated: OG8.*
    - Model: security contract by **Claude Opus 5.5** if approved; then Sonnet 5.5. Size L.
    - Source: D, E, G; GAP_AUDIT_9 G18.

---

## Completed

- ~~**Origin audit**~~ (2026-11-25) — install inventory, COM probe, three online-docs sweeps and the GUI pass; 627 feature rows and 16 usability ideas in the appendix.
- ~~**Status checks folded into this plan**~~ (2026-11-25) — ternary contour settled Missing; custom ticks with labels, full-precision copy and a worksheet table on a plot settled Have; "Change X / Y" settled Partial; text to columns and Hide Others settled Missing.
- ~~**#19 EPS export**~~ (2026-11-25) — already existed: `eps` is in every figure renderer's format list (`calc/figure.py`), in Preferences › Export and in batch export (`batchFigureBuilderOptions.ts`). The audit row was wrong. No work required.
- ~~**#39 first sub-task: presets of existing types**~~ (2026-11-26, #1035) — 10 variant tiles (step line, line + error band, spline + symbol, scatter + drop lines, 100% stacked column, box + points, box + mean ± SD, violin + points, violin + median, histogram + normal fit). The item stays open for the item 20 types.
- ~~**#1 main part: oracle harness and six cases**~~ (2026-11-26, #1036) — `tools/origin_oracle/` runs each case in its own `Origin.Application` under a 60 s deadline. Cases: intersect, levelcrossing, a nonlinear Gaussian fit, `integ1`, `pkFind` and the York line fit (through Origin C, since `FitLRXErr` is menu-only). Fixtures live in the private corpus. The item stays open for the remaining cases.
- ~~**#2 main part: curve measurements**~~ (2026-11-26, #1038) — intersection of two curves, level crossings and rise / fall time. The item stays open for the gadget kinds.
- ~~**#3 main part: peak-tool completions**~~ (2026-11-26, #1040) — derivative find modes, tangent baseline and alignment to a common peak; the recipe schema gained two optional fields. Two small sub-tasks stay open.
- ~~**#4 Sequential fit**~~ (2026-11-26, #1046) — batch fit can start each dataset from the previous fit's parameters.
- ~~**#5 Per-point (York) weights**~~ (2026-11-26, #1046) — York regression in Curve Fit; it matches Origin's `fitlrxerr` oracle to about 1e-15.
- ~~**#7 main part: signal extras**~~ (2026-11-26, #1048) — coherence, phase unwrap, anti-alias decimation, envelope, percentile and binomial smoothing, Zoom FFT. PSD power scaling stays open.
- ~~**#10 main part: general 2D map analysis**~~ (2026-11-26, #1052) — 2D peak fits and ROI volume on any map. Three sub-tasks stay open.
- ~~**#17 Line and symbol polish**~~ (2026-11-26, #1041) — gap to symbol, line over or under the symbols, double line per series; display-time skip points already existed as `markerEvery`. The visual check moved to item 47.
- ~~**#18 Point labels that avoid overlap**~~ (2026-11-26, #1039) — opt-in overlap avoidance and leader lines. The visual check moved to item 47.
- ~~**#28 main part: formula functions, wave 1**~~ (2026-11-26, #1047, #1043) — distributions and date extras, then moving-window, column-statistic and conditional-aggregate functions. `LET` stays open.
- ~~**#29 main part: worksheet clipboard and cleanup**~~ (2026-11-26, #1044) — clipboard formats, text to columns, label-row sort and more conditional-format rules. Fill patterns stay open.
- ~~**#37 main part: quick wins**~~ (2026-11-26, #1045) — selection stats, repeat last action, reopen last dialog and menu recents. The shipped limits stay open as a sub-task.
- ~~**#38 main part: Change X / Y / Worksheet**~~ (2026-11-26, #1042) — on a curve's right-click menu, plus Hide Others. "Show all" semantics stay open.
