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
**Updated:** 2026-11-26 (acceptance fixes #1067–#1072 merged: every broken and wrong item 47 defect is fixed; OG14 resolved: export widths stay in points)
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

### Running a lane wave

Waves 1–3 (2026-11-26) ran as Sonnet worker lanes: one git worktree each under
`.claude/worktrees/<lane>` on branch `claude/<lane>`, one PR each with
auto-merge armed. 18 lane PRs merged; every item they touched is struck below
or keeps its unfinished parts as sub-tasks. What the next wave should repeat or
avoid:

- **Check the shared budgets before launching.** Every lane draws on the same
  eager-bundle headroom. Two lanes can each fit alone and together go over, and
  because `main` is not strict both merge green into an over-budget `main`.
  Measure `main`'s headroom first; if the wave needs more, land a headroom slice
  first (`BUNDLE_HEADROOM.md`; slice 35 freed 9,975 B for this wave) or pause
  auto-merge on the later PR until the earlier one lands.
- **Create worktrees serially** (parallel `git worktree add` contends on git's
  lock), and never share or junction `node_modules` between worktrees: removing
  one deleted another's.
- **Every lane runs** its targeted tests, `npx tsc -b --force`,
  `npx eslint --max-warnings=0 src`, `npm run build`, the 13 frontend repo-wide
  guard files, and the backend guards `tests/test_heavy_import_guard.py` and
  `tests/test_repo_integrity.py`. Skipping eslint (#1041) and the heavy-import
  guard (#1053) each cost a failed CI round. CI runs the full gate; twelve
  concurrent full gates thrash the machine. Logs go to lane-unique paths
  (`/tmp/<lane>-*.log`).
- **Never get under a line pin by joining statements onto one line**; extract
  a module. The ternary lane did it to `store/useApp.ts`; it was replaced by
  `store/persistedViewState.ts`.
- **Landing.** Three required checks (`frontend`, `backend (windows-latest,
  3.11)`, `backend (windows-latest, 3.13)`), not strict. For a DIRTY PR: merge
  `origin/main`, keep both sides of additive conflicts (registries, unions,
  menus, the forward-compat field maps), regenerate `frontend/api/openapi.json`
  and `frontend/src/lib/api/schema.d.ts` (see `frontend/CLAUDE.md`; never trust
  their text merge), rerun the checks above, push. Semantic collisions do not
  show as conflicts: two lanes claimed the same glyph (#1051), and two parallel
  fixes of one spec merged into a duplicate (#1037, #1054; fixed by #1057).
  E2E is not required, so look at `main`'s E2E run after a burst of merges.
- **Wave 4 additions to the checks every lane runs:** `tests/test_routes_malformed_dataset.py`
  (every dataset-bearing route needs a sweep case) and `src/lib/api/endpoints.test.ts` (every
  `/api/` literal must name a real route) failed #1059; a parametrised "every kind renders"
  test failed #1066, so extending a registry means running every test that iterates it; and
  computed floats are compared with a tolerance, never `==` (Windows CI differs in the last
  digit).
- **An acceptance pass belongs in every wave.** The waves 1–3 pass (item 47) found two broken
  and three wrong features with every unit and CI check green.
- **Docs pushed straight to `main` run `tests/test_repo_integrity.py` first.**
  It checks `BUGS_AND_ISSUES.md` (every Active queue id needs its own `##`
  entry); skipping it broke every PR's backend check once (fixed in
  `644b60044`).
- **Only the oracle lane may start Origin.** Origin facts measured in wave 1
  (formula semantics for `normcdf` tail, `weeknum` n2, the name options; York
  error columns are sigmas; `FitLRXErr` is menu-only, so it goes through Origin
  C) are pinned in the lanes' tests.
- **Known local-only failures on the Origin PC** (CI passes them):
  `tests/test_axis_scales.py::test_fixture_matches_the_live_export` and six
  Origin realdata tests (`test_io_origin_figures_opju` ×3,
  `test_io_origin_fidelity` ×1, `test_origin_migration_corpus` ×2).
  `fileCommands.test.ts` and `test_fit_robust::test_routes` flake under heavy
  load and pass alone.

**Next wave candidates (ungated):** the same acceptance pass over wave 4 (item
47), then the cross-cutting table above. Items 6, 8, 9, 11 and 14 need their owner gates first.

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
- **2026-11-26 (owner), was OG14:** line widths and marker sizes stay in points in the export
  (the figure wire's screen-pixels-read-as-points rule is kept). Published figures are specified
  in points, and matching the canvas's relative weight would make absolute widths depend on the
  export size. The fields are labelled "pt" and the canvas is documented as a screen-scale
  preview, so the number means what lands in the PDF.

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

The "start here" view: the open work worth doing next, ungated. Items 3, 4, 5,
17, 18, 28, 32 and 38 are complete; the others shipped their main part and
keep the sub-tasks listed under each item.

| # | Item | Workstream | Why first | Model |
|---|------|------------|-----------|-------|
| 47 | The same acceptance pass over wave 4, then the fix follow-ups | W2 | The waves 1–3 pass found two broken and three wrong features behind a green suite; all fixed in #1067–#1072 | Sonnet 5.5, ChatGPT Sol for the visual pass |
| 1 | Oracle cases for items 4, 6, 8, 11 and the remaining X-Functions | W1 | Known answers for the next lanes | Sonnet 5.5 on the Origin PC |
| 2 | Curve-measure gadget kinds | W1 | Brings the measurements to the plot's gadget | Sonnet 5.5 |
| 20 | Half and split violin, then before-after, lollipop, stacked histogram | W2 | The rest of the statistical plot family | Sonnet 5.5 |
| 22 | Browser graph and graph tools | W2 | Untouched Tier 2 | ChatGPT Terra high |
| 24 | Plot Details residue | W2 | Untouched Tier 2 | Sonnet 5.5 |
| 33 | Complex-number formula design | W3 | Needs a paired-column design before code | Sonnet 5.5 |
| 39 | Presets of later item 20 types | W4 | Follows item 20 | ChatGPT Terra high |

---

## W1 — Analysis & fitting

### Tier 1 — High Impact

1. **Analysis oracle harness** — freeze Origin's answers for the analysis gaps as fixtures, so each lane codes against a known result.
   - Model: **Claude Sonnet 5.5 in a local session on the Origin PC** (a local Codex session on Terra also works). Size M.
   - Source: appendix "Origin Student as an oracle" and "Reproduce".
   - [x] Generalise `tools/plot_corpus/origin_session.py` into a runner that takes seeded input plus one X-Function call and writes the result as JSON (#1036, `tools/origin_oracle/`)
   - [x] Ship a `.truth.json` beside each seeded input; inputs come from quantized's own generators, not a copy
   - [ ] Fixtures for items 2–8, 10, 11, 13 and 32; treemap calls run in their own session. Covered: items 2, 3, 5, 7, 10, 13 (polygon area, 1-D interpolation, 1-D correlation) and 32 (#1036, #1060). Still to add: items 4, 6, 8 and 11, plus `corr2`, `interp1trace`, `interp2`, `interp3`, `bspline`, the `_nag` gridders, `ave` decimation, PSD and Zoom FFT (new cases go in `tools/origin_oracle/oracle_cases.py`)
   - [x] Store under the private `test-data/origin/` corpus with a `realdata`-style marker
   - [x] Force the timeout-and-respawn path with a real hang (#1060: the 60 s deadline killed only the harness's own Origin; the next case ran on a fresh one)
   - [ ] Two known method differences stay as strict xfails, not defects: Renka gridding at the hull edge (quantized's Clough-Tocher is up to 0.52 off along the edge, interior within 0.04) and Origin's `fir` decimation, which keeps an aliased tone quantized removes. Revisit only if a user needs Origin's exact numbers

2. **Curve measurements on raw data** — intersection of two curves, level crossings and rise / fall time, as tools and as ROI gadget kinds.
   - Model: **Claude Sonnet 5.5** (alt ChatGPT Terra medium). Size M. Oracle: yes (`intersect`, `levelcrossing`).
   - Source: A4, A5, B2 (gadget kinds).
   - [x] calc + route for the three measurements (#1038)
   - [ ] Gadget kinds: intersect, interpolate, rise time. Needs a new gadget mode in `store/gadget.ts` and a second-curve source

### Tier 2 — Medium Impact

6. **Wavelets** — continuous and discrete transforms, wavelet denoise and smooth, in the Signal Processing workbench. *Gated: OG6.*
   - Model: **Claude Sonnet 5.5**. Size M. Oracle: yes (`cwt`, `dwt`, `wtdenoise`).
   - Source: A4; GAP_AUDIT_9 G10 residue.

7. **Signal extras** — coherence, phase unwrap, anti-alias decimation, local-extrema envelope, percentile and binomial smoothing, Zoom FFT, power-spectral-density options.
   - Model: **Claude Haiku 5.5** (alt ChatGPT Luna), following the existing `run_signal_op` dispatch; Sonnet review. Size M. Oracle: yes for most.
   - Source: A4, F, G.
   - [x] Coherence, phase unwrap, anti-alias decimation, envelope, percentile and binomial smoothing, Zoom FFT (#1048)
   - [x] PSD power ("spectrum") scaling (#1062)
   - [ ] Power scaling on the plot's FFT gadget (`/api/spectral/fft` still has density only)
   - [ ] Older releases ignore the new nested recipe fields (`psdScaling`, and item 3's integrate-only baseline), so such a recipe re-runs with the old default there; nested recipe fields have no forward-compat map yet

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
    - [x] Draw the box on maps other than RSM (#1064; it cannot drive box cuts or be saved as a named ROI, whose file format knows only the two RSM spaces)
    - [x] Compare volumes with Origin's `integ2` (#1060: the pixel-cell default is 3.6% above `integ2`'s trapezoid rule; #1065 added the trapezoid rule as an option, which matches to 1e-12)

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
    - [x] Areas, trace and scattered interpolation, B-spline resampling, map correlation, root and minimum solver (#1059)
    - [ ] Scattered-interpolation query points from another worksheet's columns (typed today)
    - [ ] Check the surface area against Origin's `marea`, and add local or masked normalisation to the map correlation
    - [ ] Systems of equations and constraints beyond bounds in the solver
    - [ ] List the Math extras panel in the "Open in tool" reopen registry and the window-layout tool catalog

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

47. **Browser and export acceptance** — check each shipped feature in a running app and, for figure features, against the export. The waves 1–3 pass found defects no unit test had.
    - Model: **ChatGPT Sol** for visual acceptance (alt Claude Sonnet 5.5 driving the browser). Size M.
    - Source: the "Not done" sections of #1039, #1041, #1042, #1044, #1045, #1046, #1048 and #1052, and of #1049, #1051, #1053 and #1055.
    - [x] Screen against export and in a browser, through Playwright on the built app (2026-11-26): 7 work as claimed (#1053, #1051, #1046 with York matching the published values exactly, #1048, #1038, #1044, #1035), 3 cosmetic, 3 wrong, 2 broken
    - [x] Broken (#1045): Ctrl+Backspace on a focused Library row reached the delete handler (#1072: one shared `isDeleteKey` in every delete-on-key handler; the same bug also let Ctrl+Delete remove a dataset from the global shortcuts and Ctrl+Backspace clear worksheet cells)
    - [x] Broken (#1055): heatmap cell values never drew (#1071: labels describe the measured cells, on screen and in export, pinned by the wire fixture)
    - [x] Wrong (#1039): Avoid overlaps changed nothing (#1068: grid thinning no longer runs before placement; the stray "t" and the screen offset were uPlot's leftover right text alignment; the export note is a footer)
    - [x] Wrong (#1052): the map peak fit returned a duplicate and a low volume (#1067: windows sized to the peak, overlapping peaks fitted jointly; both test peaks within 0.05, volumes within 1%)
    - [x] Wrong (#1040): Align to peak reported noise maxima as aligned (#1069: a row needs a peak 6 noise levels above the window baseline, else it fails closed with a reason)
    - [x] Cosmetic: gridding pickers (#1067), the Align window placement (#1069), line over default symbols in export, the re-bound legend label and the York fit header (#1070), measurement labels in the frame and clear of the angle's arms (#1071)
    - [ ] Label the line-width and marker-size fields "pt" and document that the canvas previews at screen scale (owner decision 2026-11-26, was OG14: widths stay points in the export)
    - [ ] Text columns as point labels: CSV import keeps text columns as a `metadata.text_columns` sidecar, but the Point labels picker lists channels only; it needs a label source carried through the saved view, the channel remap and the export wire
    - [ ] Follow-ups the fixes left: an exposed `min_snr` and a per-spectrum window that follows each peak in Align to peak; the map-peaks "Fit window" label (now a minimum) and showing `n_merged`; cell labels on jittered lattices and an Inspector note saying which grid they describe; point-label font sizes that differ between screen and export
    - [ ] Not yet exercised: real clipboard contents and conditional formats (#29), the map formula and extraction jobs (#32), ROI volume (#10), the tangent baseline and derivative finder on data (#3), Change Worksheet with a matching sheet (#38), intersection mode (#2), repeat on a real transform (#37)
    - [ ] The same pass over wave 4 (#1059–#1066)
    - [ ] The HTML clipboard copy pasted into a real Word document (#29; tested against mocks only)

### Tier 2 — Medium Impact

20. **Statistical plot types** — CDF / ECDF, rug marks, marginal plots, ridgeline, half and split violin, paired before-after, lollipop / dot, stacked histogram, P-P plots for more distributions.
    - Model: first type by **Claude Sonnet 5.5** to set the render pattern; the rest by **ChatGPT Terra high** or Sonnet 5.5; ChatGPT Sol for visual acceptance. Size L. Oracle: yes for the templates that build over COM.
    - Source: B1, E, F, G, H1.
    - [x] CDF / ECDF and rug (#1053)
    - [ ] Rug on facet, break and inset panels (they warn and drop it today; marginal rug ticks shipped in #1066)
    - [ ] A client-side CDF when the backend is offline
    - [x] Marginal plots (#1066: histogram, box or rug margins)
    - [x] Ridgeline (#1066)
    - [ ] Half and split violin
    - [ ] Marginal plots with per-point colour, size or group split; ridgeline with per-ridge normalisation and facets; free numeric overlap and bandwidth
    - [ ] Before-after, lollipop, stacked histogram
    - [ ] Book each type's Origin import mapping in `ORIGIN_PLOT_TYPE_PARITY_PLAN.md`

21. **Ternary contour and heatmap** — composition maps on the triangle.
    - Model: **Claude Sonnet 5.5**. Size M.
    - Source: B1; GAP_AUDIT_9 G15 residue (settled Missing 2026-11-25).
    - [x] Contour and heatmap composition maps (#1051)
    - [x] A Z-limits control in the workshop (#1064)
    - [x] Append Project carries ternary settings (#1064; the same PR gates them so v0.34–v0.41 refuse the file instead of dropping them, and makes every new top-level `.dwk` key fail `tsc` until classified)
    - [ ] Smooth the heatmap's hull edge (jagged at the cell resolution)

22. **Browser graph and graph tools** — step one graph through columns or sheets, pick points from a plot into a sheet, Hide Others, an axis scroller, and filtering plotted data from the graph.
    - Model: **ChatGPT Terra high** (alt Claude Sonnet 5.5, which should also review the state writes). Size L.
    - Source: B1 (stack browser), B2, G, H1.

23. **Annotation tools** — slope annotation, angle and distance measures, scale-bar objects, heatmap cell labels and significance marks.
    - Model: **ChatGPT Terra high** (alt Claude Sonnet 5.5). Size M.
    - Source: E, G, H1.
    - [x] Slope, distance, angle and scale-bar shapes; heatmap cell labels (#1055)
    - [ ] Significance marks (need a choice of p-value column)
    - [ ] A scale bar on the map stage
    - [ ] An arc on the angle measure

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

29. **Worksheet clipboard and cleanup** — copy as displayed and as an HTML table, paste with trimmed spaces, text to columns, sort columns by a label row, date and number fill patterns, and more conditional-format rule kinds (duplicates, outliers, top / bottom).
    - Model: **ChatGPT Terra medium** (alt Claude Sonnet 5.5). Size M.
    - Source: C3, E, H1.
    - [x] Clipboard formats, trimmed paste, text to columns, label-row sort, more conditional-format rules (#1044)
    - [x] Date and number fill patterns (#1061)
    - [ ] Fill dates across as well as down, and detect the step unit instead of asking

### Tier 2 — Medium Impact

30. **Imports by specimen** — JSON tables, NI TDMS, Princeton SPE, Tektronix ISF / WFM, LeCroy, WAV, Igor `.pxp`, HTML and PDF tables, NASA CDF, MDF4. *Gated: OG7; each needs a real file.*
    - Model: **Claude Sonnet 5.5** per parser, with the `data-format-detective` agent; Opus 5.5 or ChatGPT Sol only for an undocumented binary. Size M each. Oracle: yes (Origin imports most of them).
    - Source: C1, F, G; GAP_AUDIT_9 G17.

31. **Row-range views** — plot or fit a row window without masking rows. *Gated: OG11.*
    - Model: contract by **Claude Opus 5.5** (alt ChatGPT Sol high), because the row-state model is the single source of truth; implementation by Sonnet 5.5. Size L.
    - Source: H1; H2 idea 12.

33. **Formula functions, wave 2** — special functions (shared with the fit-equation language), complex numbers, lookup and reference, engineering, signal and data-manipulation functions.
    - Model: **Claude Haiku 5.5** (alt ChatGPT Luna), on the wave 1 contract. Size M.
    - Source: C3.
    - [x] Special, engineering, data and lookup functions (#1063: 33 element-wise names mirrored in the headless exporter against one shared fixture; lookups are app-only)
    - [ ] Complex numbers: a cell holds one real value, so this needs a paired real / imaginary column design first
    - [ ] Signal-processing functions in formulas
    - [ ] `beta` / `lbeta` for negative non-integer arguments (NaN today; scipy continues them)
    - [ ] Reopening a `let` formula with a row range in Set Column Values shows the expanded text

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
    - [x] Repeat last for multi-input transforms, and reopen for dialogs not opened by a command (#1061; the same PR made most transforms register a repeat at all)
    - [ ] Repeat for spectrogram, SIMS, transpose, stack and split; an input-order picker for multi-input repeats

39. **Plot-gallery variant presets** — preset tiles such as "violin with box" or "histogram with rug", so options are found without a dialog.
    - Model: **ChatGPT Terra high**, ChatGPT Sol for visual acceptance (alt Claude Sonnet 5.5). Size M.
    - Source: H2 idea 1.
    - [x] Presets of existing types first (#1035, 10 presets)
    - [x] Presets of the item 20 types so far (#1066: CDF with and without the band, CDF + rug, marginal box and rug, overlapping ridgeline)
    - [ ] Presets of later item 20 types as they land

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
- ~~**#20 first sub-task: CDF / ECDF and rug**~~ (2026-11-26, #1053) — a CDF plot with a DKW confidence band, and rug marks on screen and in export. Marginal and panel rugs and an offline CDF stay open.
- ~~**#21 main part: ternary contour and heatmap**~~ (2026-11-26, #1051) — composition maps on the triangle. Three sub-tasks stay open.
- ~~**#23 main part: annotation tools**~~ (2026-11-26, #1055) — slope (power-law exponent on log-log axes), distance, angle and scale-bar shapes, and heatmap cell-value labels, matched on screen and in export through a shared wire fixture. Significance marks, a map-stage scale bar and the angle arc stay open.
- ~~**#32 main part: gridding and map formulas**~~ (2026-11-26, #1049) — Shepard, Kriging and Renka gridding, log-spaced grids, map values from a formula and pixel extraction across maps. Three sub-tasks stay open.
- ~~**#3 Peak-tool completions**~~ (2026-11-26, #1040, #1062) — derivative finder, tangent baseline (including the integrate-only path), alignment to a common peak and reopening aligned outputs. The acceptance pass booked an alignment defect under item 47.
- ~~**#7 PSD power scaling**~~ (2026-11-26, #1062) — density or power per bin, labelled and unit-correct against scipy. The FFT gadget and older-release recipe notes stay open.
- ~~**#10 box on any map, integ2 comparison**~~ (2026-11-26, #1064, #1060, #1065) — the trapezoid volume rule matches Origin's `integ2` to 1e-12; the pixel-cell default is kept.
- ~~**#13 main part: math extras**~~ (2026-11-26, #1059) — one lazy panel with eight jobs, all checked against analytic cases.
- ~~**#20 marginal plots and ridgeline**~~ (2026-11-26, #1066) — screen and export share one vertex builder per language.
- ~~**#21 rest: Z range, append, forward-compat gate**~~ (2026-11-26, #1064) — ternary settings were being silently dropped by v0.34–v0.41 since #1051; they are now gated, and the gate is type-enforced for every top-level key.
- ~~**#28 Formula functions, wave 1**~~ (2026-11-26, #1047, #1043, #1063) — distributions, date extras, moving-window, column-statistic and conditional-aggregate functions, and `LET`.
- ~~**#29 fill patterns**~~ (2026-11-26, #1061) — number and date series, month-end clamping, one undo step.
- ~~**#32 Gridding and map formulas**~~ (2026-11-26, #1049, #1060, #1064) — Shepard, Kriging and Renka gridding, map formulas, pixel extraction with click to pick, map-card options; Shepard and thin-plate agree with Origin within explained tolerances.
- ~~**#33 main part: formula functions, wave 2**~~ (2026-11-26, #1063) — 33 element-wise functions mirrored in the exporter, plus app-only lookups.
- ~~**#37 rest: repeat and reopen coverage**~~ (2026-11-26, #1061) — multi-input repeats, and reopen for menu dialogs.
- ~~**#38 Change X / Y / Worksheet on a curve**~~ (2026-11-26, #1042, #1061) — including Hide Others and a Show all that restores the earlier hidden set.
- ~~**#1 oracle cases for items 7, 10, 13 and 32**~~ (2026-11-26, #1060, #1065) — 12 new Origin fixtures with comparison tests; the envelope's ends now match Origin to 1e-9 (a quantized defect, fixed in #1065).
- ~~**#47 first part: the waves 1–3 acceptance pass**~~ (2026-11-26) — 15 PRs checked in the built app; the defects are booked under item 47.
- ~~**#47 acceptance defects fixed**~~ (2026-11-26, #1067–#1072) — two broken, three wrong and six cosmetic defects, each reproduced by a failing test through the real UI or store path first. The export line weight was settled by the owner on 2026-11-26 (was OG14).
