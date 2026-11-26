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
**Updated:** 2026-11-26 (wave 1/2 hand-off; #39 first sub-task merged)
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

### Hand-off: Tier 1 waves 1–2 (2026-11-26; delete this block once every PR below is merged)

Every ungated Tier 1 item was built by Sonnet worker lanes, one git worktree
each under `.claude/worktrees/<lane>` on branch `claude/<lane>`. All PRs have
GitHub auto-merge armed. Nothing else is running.

| Item | PR | Lane | Left open after the PR (keep in the item when striking it) |
|---|---|---|---|
| 1 | #1036 | origin-oracle (branch `claude/origin-oracle-harness`) | Timeout/respawn path never forced |
| 2 | #1038 | curve-measure | ROI gadget kinds (needs a `store/gadget.ts` mode + second-curve source) |
| 3 | #1040 | peak-tools | Tangent baseline on the wizard's integrate-only path; reopen for aligned outputs |
| 4, 5 | #1046 | fit-seq-york | — (York matches the Origin `fitlrxerr` oracle to ~1e-15) |
| 17 | #1041 | line-symbol | — (17.4 skip-points already existed as `markerEvery`) |
| 18 | #1039 | label-overlap | Visual check of screen vs export |
| 28 (element-wise) | #1047 | formula-elementwise | — |
| 28 (aggregates) | #1043 | formula-aggregates | `let()` deferred (`formula.ts` is at 496/500 lines; needs a parser hook) |
| 29 | #1044 | worksheet-clip | Date and number fill patterns |
| 37 | #1045 | quick-wins | Repeat-last covers single-input transforms only; menu recents are off by default |
| 38 | #1042 | change-xy | "Show all" restores all curves, not the earlier hidden set |
| 39 (first sub-task) | #1035 merged | gallery-presets | Struck below |

**How to land them.** `main` is strict ("require branches to be up to date"),
so each merge leaves the other PRs BEHIND. Run `gh pr update-branch <n>` on
each BEHIND PR; its CI then re-runs and auto-merge fires on green. Conflicts
are expected in the generated `frontend/api/openapi.json` and
`frontend/src/lib/api/schema.d.ts` (#1038, #1040, #1041, #1046 all regenerate
them): merge `origin/main` into the branch, regenerate both (see
`frontend/CLAUDE.md`), commit, push. Additive conflicts in
`frontend/src/commands/*.ts` resolve by keeping both sides.

**When a PR merges:** strike its item into `## Completed` with the PR number,
copy its "left open" note into a new sub-task where the table says so, then
`git worktree remove .claude/worktrees/<lane>` and delete the branch.

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
- Lanes run targeted tests plus `tsc -b --force` and `npm run build`; CI runs
  the full gate. Twelve concurrent full gates thrash the machine.
- Only the oracle lane may start Origin. Origin facts measured this wave
  (formula semantics for `normcdf` tail, `weeknum` n2, the name options; York
  error columns are sigmas; `FitLRXErr` is menu-only, so it goes through Origin
  C) are pinned in the lanes' tests.

**Next wave candidates (ungated):** the left-open notes above, then Tier 2
items 7, 10, 13 (math extras), 20, 21, 22, 23, 24, 32 and 33. Items 6, 8, 9,
11 and 14 need their owner gates first.

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

The "start here" view. All are Tier 1, ungated and independent.

| # | Item | Workstream | Why first | Model |
|---|------|------------|-----------|-------|
| 1 | Analysis oracle harness | W1 | Gives every later lane a known answer, so cheap models can do the work | Sonnet 5.5 on the Origin PC |
| 37 | Quick wins: selection stats, repeat last action, reopen last dialog | W4 | Smallest effort, used every day | ChatGPT Terra medium |
| 2 | Curve measurements on raw data | W1 | General, small, oracle exists | Sonnet 5.5 |
| 17 | Line and symbol polish | W2 | Publication quality on every line + symbol figure | Sonnet 5.5 |
| 3 | Peak-tool completions | W1 | Core XRD and spectroscopy workflow | Sonnet 5.5 |
| 28 | Formula functions, wave 1 | W3 | Biggest breadth gap; mostly mechanical once the contract is set | Sonnet 5.5, then Haiku 5.5 |
| 38 | Change X / Y / Worksheet on a curve | W4 | "Same figure, next sample" without rebuilding | Sonnet 5.5 |
| 18 | Point labels that avoid overlap | W2 | Peak labels on crowded patterns | Sonnet 5.5 |
| 4 | Sequential fit | W1 | Temperature and field series are the lab's daily data | Sonnet 5.5 |
| 5 | Per-point (York) weights for the X-and-Y-error line fit | W1 | Textbook method, oracle exists, small | Sonnet 5.5 |
| 29 | Worksheet clipboard and cleanup | W3 | Removes daily paste friction | ChatGPT Terra medium |
| 39 | Plot-gallery variant presets | W4 | Makes existing options discoverable | ChatGPT Terra high |

---

## W1 — Analysis & fitting

### Tier 1 — High Impact

1. **Analysis oracle harness** — freeze Origin's answers for the analysis gaps as fixtures, so each lane codes against a known result.
   - Model: **Claude Sonnet 5.5 in a local session on the Origin PC** (a local Codex session on Terra also works). Size M.
   - Source: appendix "Origin Student as an oracle" and "Reproduce".
   - [ ] Generalise `tools/plot_corpus/origin_session.py` into a runner that takes seeded input plus one X-Function call and writes the result as JSON
   - [ ] Ship a `.truth.json` beside each seeded input; inputs come from quantized's own generators, not a copy
   - [ ] Fixtures for items 2–8, 10, 11, 13 and 32; treemap calls run in their own session
   - [ ] Store under the private `test-data/origin/` corpus with a `realdata`-style marker

2. **Curve measurements on raw data** — intersection of two curves, level crossings and rise / fall time, as tools and as ROI gadget kinds.
   - Model: **Claude Sonnet 5.5** (alt ChatGPT Terra medium). Size M. Oracle: yes (`intersect`, `levelcrossing`).
   - Source: A4, A5, B2 (gadget kinds).
   - [ ] calc + route for the three measurements
   - [ ] Gadget kinds: intersect, interpolate, rise time

3. **Peak-tool completions** — tangential baseline, peak alignment (zero-shift correction) and derivative-based peak finding in the Peak Analyzer.
   - Model: **Claude Sonnet 5.5**, Opus 5.5 review if the peak recipe schema changes. Size M. Oracle: partial (`pkFind`; the two Apps are not installed).
   - Source: A3, F, G. Also settles whether the residual finder alone is enough.
   - [ ] First / second derivative find modes beside the residual finder
   - [ ] Tangential baseline for integration
   - [ ] Align several spectra to a common peak

4. **Sequential fit** — in batch fit, optionally start each dataset from the previous fit's parameters.
   - Model: **Claude Sonnet 5.5**. Size S. Oracle: no (App); test on a synthetic drifting series.
   - Source: F (`calc/batch_fit.py` is Partial).

5. **Per-point (York) weights for the X-and-Y-error line fit** — the Deming fit in Curve Fit uses one variance ratio from the mean errors; add York weighting from each point's own X and Y errors.
   - Model: **Claude Sonnet 5.5** (alt ChatGPT Terra medium). Size S. Oracle: yes (`FitLRXErr`); published benchmark: Pearson's data with York's weights.
   - Source: A1 (`calc/fit_odr.py` and `OdrSection.tsx` are Partial).

### Tier 2 — Medium Impact

6. **Wavelets** — continuous and discrete transforms, wavelet denoise and smooth, in the Signal Processing workbench. *Gated: OG6.*
   - Model: **Claude Sonnet 5.5**. Size M. Oracle: yes (`cwt`, `dwt`, `wtdenoise`).
   - Source: A4; GAP_AUDIT_9 G10 residue.

7. **Signal extras** — coherence, phase unwrap, anti-alias decimation, local-extrema envelope, percentile and binomial smoothing, Zoom FFT, power-spectral-density options.
   - Model: **Claude Haiku 5.5** (alt ChatGPT Luna), following the existing `run_signal_op` dispatch; Sonnet review. Size M. Oracle: yes for most.
   - Source: A4, F, G.

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

17. **Line and symbol polish** — gap between line and marker, line drawn in front of or behind symbols, compound (double) lines, (display-time skip points already existed as `markerEvery`, so not needed).
    - Model: **Claude Sonnet 5.5** (alt ChatGPT Terra high). Size M. Screen and export must match through a wire fixture.
    - Source: H1 (Plot Details › Line, Display); H2 idea 13.

18. **Point labels that avoid overlap** — automatic repositioning and leader lines for data and peak labels.
    - Model: **Claude Sonnet 5.5**. Size M.
    - Source: H1 (Plot Details › Label); H2 idea 15.

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
    - [ ] Contract: non-row-local functions and incremental recalculation
    - [ ] Distributions
    - [ ] Moving-window and column statistics
    - [ ] Conditional aggregates, date extras, `LET`

29. **Worksheet clipboard and cleanup** — copy as displayed and as an HTML table, paste with trimmed spaces, text to columns, sort columns by a label row, date and number fill patterns, and more conditional-format rule kinds (duplicates, outliers, top / bottom).
    - Model: **ChatGPT Terra medium** (alt Claude Sonnet 5.5). Size M.
    - Source: C3, E, H1.

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

38. **Change X / Y / Worksheet on a curve** — right-click a plotted curve to re-point it at another column, or the whole plot at a same-shaped sheet, plus Hide Others.
    - Model: **Claude Sonnet 5.5** for the figure-binding writes; ChatGPT Terra high for the menu interaction. Size M.
    - Source: H1 (today only through Layer Contents); H2 idea 5.

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
