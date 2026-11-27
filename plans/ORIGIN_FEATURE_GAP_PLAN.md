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
**Contracts:** `ROW_RANGE_CONTRACT.md` (items 31, 34) and `PRESET_BAR_CONTRACT.md` (item 40), both accepted 2026-11-26
**Related:** `SCIENTIFIC_WORKBENCH_REPLACEMENT_PLAN.md` (cross-product journeys and acceptance criteria; its criteria for items 31, 34, 43, 44 and 47 are booked on those items)
**Created:** 2026-11-25
**Updated:** 2026-11-26 (wave 6 checkpoint: #1089–#1101 merged; item 25 complete; contracts for items 31, 34 and 40 accepted; the v9 forward-compat rung added)
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
- Items 6 and 11 are open (OG6, OG4); their Origin fixtures come first
  (item 1). Item 14 is per project (OG5) and item 46 is out (OG8). Items 30
  and 36 wait on specimen files (OG7).
- Items 31 and 34 share one contract (row ranges, named ranges and mirror
  columns all touch the row-state model and the recalculation graph); write
  it before either is built.
- Item 9 (fit library) should follow item 1, so each ported function is
  checked against Origin's own fit.
- Item 33 follows item 28, which fixes the contract for non-row-local
  formula functions.
- Item 39 (gallery presets) follows item 20 for the new statistical types;
  presets of existing types can ship first.
- Item 40 touches every workshop. Its store and file-format contract comes
  first; roll it out one workshop at a time, after the smaller W4 items.
  Item 41 is not scheduled (OG13).

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
- **Wave 5 additions:** run every test that pins a registry or a menu you extend, not only your
  own: the gadget-mode list (#1077) and the 12-item Plot > Layout menu ratchet (#1079) both
  failed CI. Run full-`src` eslint as the very last step after the final edit; two lanes changed
  code after their last full run (#1080, #1081). Before starting the oracle lane, check that no
  other Origin is running (`Get-Process Origin64`); another agent's open project paused it once.
- **Plans from other agents arrive as PRs.** A Codex roadmap (#1074) landed with no parent; bring
  such a doc into the tree on arrival (parent, MAIN_PLAN, BACKLOG, owners per item).
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

- **Wave 6 additions:**
  - **Forward-compat after a release.** v0.45.0 reads the top rung (v8), so 28 fields gated since it were
    silently dropped by it until #1092 added v9. Once a release that reads the top rung ships, a new gated field
    needs a new rung (`RELEASE.md` says so now). The type check covers only top-level keys: a new nested key or
    kind value needs a check against the released code (`git show v0.45.0:<path>`). #1098 would have made v0.45.0
    drop the whole 3D view.
  - **Origin safety incident.** The oracle lane force-killed an Origin (PID 33392) it had not recorded starting,
    after a probe outside the harness hung. No other session was running and no autosave was written, so it was
    probably the lane's own. Every Origin probe goes through the harness, which records the PIDs it starts; never
    stop an Origin by name or by a PID the harness did not record.
  - **Check `main`'s E2E at the end of every wave.** E2E is not required, so it had failed silently since wave 5
    (four specs, fixed in #1099). The File menu root is at 353 of 360 px with no unit ratchet.
  - **Two lanes extending one registry conflict predictably** (the statistics catalog, `app.py` routers,
    `openapi.json`). The second to land merges `main`, keeps both sides, regenerates the API files and reruns every
    test that iterates the registry.
  - **Multi-term models need term-swap-aware recovery tests** (`Dhyperbl` swapped its terms on Python 3.13).
  - **Run the tests that render what you changed, wherever they live.** Grep the component's name in
    `frontend/src` for tests: #1101 changed the Multivariate review card, and its CI failed in
    `analysisselection/statsInputReview.test.tsx`, a directory the lane never ran.
  - **Clustering and the power panel sit in the 13-row menu ratchet's headroom.** Plot and Analyze roots are 12
    rows each after #1099, so the next new root-level flyout must go into an existing one.
  - **An acceptance lane may be unable to write its report file**; the orchestrator saves it.

**Next wave candidates (ungated):** the acceptance pass over wave 6 (item 47), then the cross-cutting table
above. No owner gate is open.

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
  surface, waterfall, scatter, bars and vectors is out of scope (set 2026-11-15;
  the owner brought scatter, bars and vectors back on 2026-11-26 as item 48);
  watched-folder auto-import is out of scope.
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

- **2026-11-26 (owner), OG1–OG13 answered:**
  - **OG1:** the scope list stays out, except 3D scatter, bars and vectors, which come back as item 48.
    Venn / UpSet and the rest of the list stay out.
  - **OG2:** port the general families now (item 9's first sub-task); implicit and surface families only
    on demand.
  - **OG3:** no domain families for now; items 15 and 36 wait for a project that needs one.
  - **OG4:** clustering goes ahead (item 11), SciPy only. This lifts GAP_AUDIT_9 D1 and JMP Gate J for
    J13 only; SPC, MSA and DOE keep their gates.
  - **OG5:** advanced statistics per project: a method is built only when a real project names it, on
    the existing statsmodels `[stats]` extra. scikit-learn stays a test oracle (item 14).
  - **OG6:** PyWavelets (MIT) as an optional, import-guarded dependency for item 6.
  - **OG7:** no specimen files on hand; item 30 waits for a real file of each format.
  - **OG8:** automation surfaces stay out, and so does the MAIN in-app scripting console gate (neither a
    DSL nor a kernel for now). Scripting stays headless: `qz run`, exported scripts, `quantized.client`.
  - **OG9:** PDF and SVG are enough; item 26 is closed.
  - **OG10:** only ternary vector and line plots (item 25). Radar, polar bar / wind rose, Smith chart,
    skewed axes, isosurface and Voronoi join item 27's record.
  - **OG11:** row-range views go ahead (item 31), contract first.
  - **OG12:** named ranges, cell notes and mirror columns go ahead (item 34); graphs or images in cells
    stay out.
  - **OG13:** the preset bar goes ahead (item 40); the properties navigator (item 41) is not scheduled.
- **2026-11-26 (owner):** the desktop installer stays lean while the app is in development, so dev speed
  comes first. No optional extra is bundled until the final product, which takes every analysis extra
  (item 49).

### Owner gates

The only place open questions for this plan live. Each names the items it
blocks.

None open. OG1–OG13 were answered on 2026-11-26 and OG14 earlier the same
day; the answers are under Resolved decisions, and item text that says
"OGn" means that answer.

---

## Cross-cutting priorities

The "start here" view: the open work worth doing next, ungated. Items 3, 4, 5,
17, 18, 25, 28, 29, 32, 37 and 38 are complete; the others shipped their main part
and keep the sub-tasks listed under each item.

| # | Item | Workstream | Why first | Model |
|---|------|------------|-----------|-------|
| 47 | The acceptance pass over wave 6 (#1089–#1101), on the replacement plan's journey | W2 | Every pass so far found a wrong value behind a green suite | Sonnet 5.5 |
| 31, 34 | Row-range contract slices R1 (row ranges in inputs and fits) and R5 (mirror columns), then R0 and the gated slices | W3 | Contract accepted; R1 and R5 need no persisted state | Sonnet 5.5 |
| 40 | Preset bar slice P1 (core, bar, Resample), then P2 (Curve Fit over fit templates) | W4 | Contract accepted | Sonnet 5.5 |
| 1, 9 | Origin's own fit of the 140 ported functions, and an `.opju` fit-name mapping | W1 | #1096 has recovery tests only; imported fits cannot find the functions yet | Sonnet 5.5 on the Origin PC |
| 48 | 3D scatter extras: colour and size by column, groups, 3D error bars, wall projections | W2 | Bars and vectors shipped (#1098) | Sonnet 5.5 |
| 8 | CI panel in Distribution, and the power and row-test remainders | W1 | The rest of item 8 shipped (#1091, #1093) | Sonnet 5.5 |
| 2, 20, 22, 24 | Polish: gadget settings and Commit, the statistical-plot remainder, browser-graph Pick markers and log scroller, centroid hull or ellipse | W1, W2 | Main parts shipped | Sonnet 5.5 |
| 47 | Import inference: a CSV date column with blank cells imports as text | W3 | Found by the third pass; changes inference, so its own PR | Sonnet 5.5 |
| 33 | Complex-number formula design | W3 | Needs a paired-column design before code | Sonnet 5.5 |

---

## W1 — Analysis & fitting

### Tier 1 — High Impact

1. **Analysis oracle harness** — freeze Origin's answers for the analysis gaps as fixtures, so each lane codes against a known result.
   - Model: **Claude Sonnet 5.5 in a local session on the Origin PC** (a local Codex session on Terra also works). Size M.
   - Source: appendix "Origin Student as an oracle" and "Reproduce".
   - [x] Generalise `tools/plot_corpus/origin_session.py` into a runner that takes seeded input plus one X-Function call and writes the result as JSON (#1036, `tools/origin_oracle/`)
   - [x] Ship a `.truth.json` beside each seeded input; inputs come from quantized's own generators, not a copy
   - [ ] Fixtures for items 2–8, 10, 11, 13 and 32; treemap calls run in their own session. Covered: items 2, 3, 5, 7, 8 (row-wise t-test), 10, 13 and 32 (#1036, #1060, #1088). Items 6 and 11 and the power and sample-size engines were added in #1094 (19 fixtures; Mann-Kendall, Steel-Dwass, eta and omega squared and a probability calculator are absent from this install). Still to add: proportion power (menu-only, no `ocmath_*` engine), and `interp3` (a 3-D gridder whose signature does not match quantized's scattered query). Item 4 has no oracle (an App), and this install has no Zoom FFT X-Function
   - [x] Store under the private `test-data/origin/` corpus with a `realdata`-style marker
   - [x] Force the timeout-and-respawn path with a real hang (#1060: the 60 s deadline killed only the harness's own Origin; the next case ran on a fresh one)
   - [ ] Known convention differences stay as strict xfails, not defects: Renka gridding at the hull edge (Clough-Tocher, up to 0.52 off along the edge); Origin's `fir` decimation keeps an aliased tone; `corr2` does not subtract means (quantized does); Origin's trace `spline` is a natural cubic on chord length (no quantized equivalent); scattered linear / nearest are not scaled to the unit box in Origin; `marea` splits a cell into 2 triangles (quantized 4, 0.02% apart); Origin's NAG Shepard is unstable on the test data; Origin's Ward, centroid and median linkage apply Lance-Williams to unsquared distances; Origin's Welch confidence limits are the pooled interval; Origin's default k-means starting rows are unidentified (Lloyd from given centres reproduces it exactly). Revisit only when a user needs Origin's exact numbers (#1060, #1088, #1094)

2. **Curve measurements on raw data** — intersection of two curves, level crossings and rise / fall time, as tools and as ROI gadget kinds.
   - Model: **Claude Sonnet 5.5** (alt ChatGPT Terra medium). Size M. Oracle: yes (`intersect`, `levelcrossing`).
   - Source: A4, A5, B2 (gadget kinds).
   - [x] calc + route for the three measurements (#1038)
   - [x] Gadget kinds: intersect, interpolate, rise time (#1077; the gadget sends exactly the panel's request)
   - [ ] Gadget polish: a second curve from another worksheet, rise-time settings, markers at crossings and levels, Commit / Report for these kinds, units in the chip

### Tier 2 — Medium Impact

6. **Wavelets** — continuous and discrete transforms, wavelet denoise and smooth, in the Signal Processing workbench. *Opened 2026-11-26 (OG6): PyWavelets.*
   - Model: **Claude Sonnet 5.5**. Size M. Oracle: yes (`cwt`, `dwt`, `wtdenoise`).
   - Source: A4; GAP_AUDIT_9 G10 residue.
   - [x] PyWavelets as an optional, import-guarded `[wavelets]` extra (#1095)
   - [x] CWT, DWT, reconstruct from levels, wavelet smooth and denoise (#1095). DWT with zero padding, IDWT and CWT (`gaus2` exactly, `mexh` within 3%) agree with Origin (#1094); Origin's `periodic` mode is a rolled periodization, so only level 1 and Haar match `wavedec`
   - [x] Installer decision (owner, 2026-11-26): the installer stays lean while the app is in development; bundling `[wavelets]` and the other extras is item 49, much later
   - [ ] Origin's `wtdenoise` (sqtwolog) and `wtsmooth` were not reproduced, and the CWT normalisation is not pinned
   - [ ] 2-D wavelet on maps (GAP_AUDIT_9 G22 residue)

7. **Signal extras** — coherence, phase unwrap, anti-alias decimation, local-extrema envelope, percentile and binomial smoothing, Zoom FFT, power-spectral-density options.
   - Model: **Claude Haiku 5.5** (alt ChatGPT Luna), following the existing `run_signal_op` dispatch; Sonnet review. Size M. Oracle: yes for most.
   - Source: A4, F, G.
   - [x] Coherence, phase unwrap, anti-alias decimation, envelope, percentile and binomial smoothing, Zoom FFT (#1048)
   - [x] PSD power ("spectrum") scaling (#1062)
   - [x] Power scaling on the plot's FFT gadget (#1076); quantized's density and spectrum scalings match Origin's TISA and MSA to 1e-12 (#1088)
   - [ ] Older releases ignore the new nested recipe fields (`psdScaling`, and item 3's integrate-only baseline), so such a recipe re-runs with the old default there; nested recipe fields have no forward-compat map yet

8. **Statistics completions** — power and sample size, a probability calculator, row-wise t-tests, Steel-Dwass, ANOVA effect sizes, Mann-Kendall trend, and a confidence-interval panel in Distribution.
   - Model: **Claude Sonnet 5.5**. Size L. Oracle: yes for row tests; power needs syntax work.
   - Source: A6, E, F, G.
   - [x] Power and sample size for t-tests, one-way ANOVA, proportions and variance, with a power curve (#1091; statsmodels agrees to 1e-6, and Origin's `PSS_*` engines are exactly noncentral t and F, #1094)
   - [x] Probability calculator on the formula language's distribution table (#1091)
   - [x] Row-wise t-tests, pooled and Welch with Welch the default; the pooled form matches Origin's `rowttest2` to 1e-12, and results name their source rows (#1093)
   - [x] Steel-Dwass, ANOVA effect sizes, Mann-Kendall with Sen's slope (#1093; Origin has none of these, #1094)
   - [ ] CI panel in the Distribution workshop
   - [ ] Remainders: exact binomial power, Cohen's w and correlation power, power against effect size; a p-value adjustment of the per-row column; reopen entries for the committed worksheets; seasonal Mann-Kendall; effect sizes for repeated-measures and Welch ANOVA

9. **Fit-function library port** — bring Origin's remaining general built-in models into the registry from the install's FDF definitions. *Opened 2026-11-26 (OG2): general families first.*
   - Model: contract and generator by **Claude Sonnet 5.5**; bulk conversion and per-function tests by **Claude Haiku 5.5** (alt ChatGPT Luna). Size L. Oracle: yes (Origin's own fit per function).
   - Source: A2 (about 33 of 305 shipped before #1096).
   - [x] General families: 140 functions under Origin's names and parameter order, with automatic guesses and recovery tests (#1096). PFW is not a category in this install
   - [ ] Origin's own fit of each ported function (the list is in #1096's body; an oracle lane on the Origin PC)
   - [ ] Map an imported `.opju` fit's function name to the registry (no importer reads fit-function names today)
   - [ ] Registry mismatches with Origin: `Sine` orders its parameters (xc, w, A, y0) against Origin's (y0, xc, w, A); `ExpGrow2` lacks Origin's t1, t2 > 0 bounds
   - [ ] Implicit (diode, solar cell) and surface families, on demand only (OG2)

10. **General 2D map analysis** — peak finding and 2D peak fitting on any map (today RSM only), plus volume integration over a drawn ROI.
    - Model: **Claude Sonnet 5.5**. Size M. Oracle: yes (`integ2`).
    - Source: A5, F (`calc/rsm_analyze.py` is Partial).
    - [x] 2D peak fits and ROI volume on any map (#1052)
    - [ ] Polygon ROI in the UI (the calc and route accept polygons; the ROI store holds rectangles only)
    - [x] Draw the box on maps other than RSM (#1064; it cannot drive box cuts or be saved as a named ROI, whose file format knows only the two RSM spaces)
    - [x] Compare volumes with Origin's `integ2` (#1060: the pixel-cell default is 3.6% above `integ2`'s trapezoid rule; #1065 added the trapezoid rule as an option, which matches to 1e-12)

11. **Clustering** — k-means and hierarchical clustering with a dendrogram. *Opened 2026-11-26 (OG4).*
    - Model: **Claude Sonnet 5.5** for the backend, **ChatGPT Terra high** for the dendrogram view. Size M. Oracle: yes (`kmeans`, `hcluster`).
    - Source: A6; JMP_GAP_PLAN J13.
    - [x] Origin fixtures for `kmeans` and `hcluster` (#1094)
    - [x] k-means and hierarchical clustering with stated scaling, seed and cutoff; labels commit linked to the source rows; 20 Origin comparisons pass (#1089)
    - [x] A dendrogram view, matched on screen and in export (#1089)
    - [ ] Remainders: user-specified initial centres in the UI, variable clustering, squared-Euclidean and cosine distances, a result-book section; the k = 5 default-start case misses Origin because Origin's default starting rows are unidentified

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
    - [x] Scattered-interpolation query points from another worksheet's columns (#1076)
    - [x] Surface area checked against Origin's `marea` (#1088: a 2- versus 4-triangle split, 0.02% apart)
    - [ ] Local or masked normalisation for the map correlation, and an option without mean subtraction to match Origin's `corr2`
    - [ ] Systems of equations and constraints beyond bounds in the solver
    - [x] Math extras in the "Open in tool" registry and the window-layout catalog, with reopen and Replace (#1076)

14. **Advanced statistics** — MANOVA, mixed models, factor analysis, Gaussian mixtures, ICA, canonical correlation, NMDS, GAM, trees and forests, neural-net regression, probit. *Per project (OG5, 2026-11-26): a method is built only when a real project names it, on the statsmodels `[stats]` extra.*
    - Model: scope and contracts by **Claude Opus 5.5** (alt ChatGPT Sol high); implementation by Sonnet 5.5. Size L.
    - Source: A6, E, F, G; GAP_AUDIT_9 G12, G14.

15. **Domain analysis families** — electrochemistry (impedance / Nyquist, Tafel, cyclic voltammetry), rheology (time-temperature superposition, Redlich-Kister, rheology fits) and the chromatography, electrophysiology, pharmacology and enzyme fit sets. *Not scheduled (OG3, 2026-11-26): none wanted for now.*
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
    - [x] Label the line-width and marker-size fields "pt" and document that the canvas previews at screen scale (#1073; owner decision 2026-11-26, was OG14: widths stay points in the export). Rug length, "every N" and leader distance keep their own units; the font-size preference stays px because it styles screen text only
    - [x] Text columns as point labels (#1075; persisted, remap-safe, exported)
    - [x] Follow-ups: `min_snr` and a follow-the-peak window in Align to peak (#1076), the map-peaks minimum label and `n_merged` (#1076), jitter-tolerant cell labels with an Inspector note (#1080)
    - [ ] Point-label font sizes still differ between screen and export, so a crowded label can land one slot apart
    - [ ] Not yet exercised: the map formula and extraction jobs (#32) and the Curve measurements panel's own modes, including intersection (#2). The third pass covered the clipboard, conditional formats, ROI volume, the tangent baseline, the derivative finder, Change Worksheet and repeat; all work
    - [x] The same pass over wave 4 (2026-11-26, on `10091c0e3`): 15 work, 3 cosmetic, 1 wrong (an Align to peak false peak on a sloped baseline), with the earlier fixes re-verified in the app; fixed in #1082 and #1084
    - [x] The same pass over wave 5 (2026-11-26, on `f3a93abe2`, scripted by the replacement plan's journey): 38 work, 14 cosmetic, 1 wrong (Curve Fit ignored its range under the window layout's auto-pin, fixed in #1100); the cosmetics fixed in #1101, including the unreachable stack-total and X-error controls
    - [ ] The same pass over wave 6 (#1089–#1101)
    - [ ] Third-pass leftovers: a CSV date column with blank cells imports as text (an import-inference change, its own PR); Plot > Export figure with a map window open exports the sibling line plot
    - [x] Re-verify the replacement plan's GUI audit findings on current main: 8 of 10 still reproduced and are fixed in #1083 (one import entry, named quick-export target), #1085 (stale-result recovery), #1086 (one worksheet-open intent that never retargets a running tool) and #1087 (exact method launchers, Classic layout terms, shortcuts through the launcher)
    - [x] Replacement plan residue (#1097): a durable "How this was imported" card, Freeze without retargeting, Publication Preview exports and names the previewed revision, Import as sheets and Import & append through the shared picker, and the stale-result note names the failing column. Gauge R&R stays with JMP J15 (gated)
    - [x] Adopt the replacement plan's journey as the next pass's script (used by the third pass): import, plot, fit a named range, edit an input, reopen, go to source, rerun and export, plus missing-source and canceled-edit variants
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
    - [x] Half and split violin (#1078)
    - [ ] Marginal plots with per-point colour, size or group split; ridgeline with per-ridge normalisation and facets; free numeric overlap and bandwidth
    - [x] Paired before-after, lollipop, stacked histogram (#1078)
    - [ ] A half violin on either side with inner marks; paired lines coloured by direction; a horizontal lollipop (dot chart); a stacked histogram split by a group column
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
    - [x] Browse a graph through columns and sheets, pick points into a worksheet, an axis scroller, a filter from the graph (#1079; Plot > Browse)
    - [ ] A Pick toolbar button and on-plot markers for picked points; give the Pick tool its own click hand-off instead of reusing the lasso as a one-vertex outline
    - [ ] The scroller on log axes, a drag-a-rectangle data slicer, and browsing several curves at once

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
    - [x] Text or letter symbols, equal-aspect XY axes, XY error rectangles, stack totals (#1081; all opt-in)
    - [ ] Subset centroid with a hull or confidence ellipse for grouped scatter
    - [ ] Text symbols from a column, incremental letters or row numbers, and the legend swatch showing the text symbol
    - [ ] Anchor ticks and subgroup increments (#1081 skipped them: tick placement is split between uPlot and matplotlib locators, and the style cycle has no group concept)

48. **3D bars and vectors, and 3D scatter extras** — 3D bar and 3D vector plots, plus what Origin's 3D scatter has that the 3D map stage's `scatter3d` lacks. *Back in scope 2026-11-26 (OG1).*
    - Model: **Claude Sonnet 5.5**. Size M.
    - Source: B1, G, H1.
    - [x] Inventory of the 3D map stage against Origin (in #1098's body)
    - [x] 3D bars and 3D vectors on the same renderer and camera, on screen and in export, gated at v9 (#1098; v0.45.0 would have dropped the whole 3D view)
    - [ ] Scatter extras: colour and size by column, groups with a legend, 3D error bars, wall projections
    - [ ] Vector colour by length; bars with absolute widths or a per-bar colour column

### Tier 3 — Nice-to-Have

26. ~~**EMF export and printing**~~ **Not planned** — closed 2026-11-26 (owner, OG9): PDF and SVG export are enough; current Office inserts SVG as vectors.
    - Source: B2, H1.

27. **Families not scheduled** — the OG1 list (confirmed out 2026-11-26, except 3D scatter, bars and vectors, now item 48); the specialised types OG10 did not pick (radar, polar bar / wind rose, Smith chart, skewed axes, isosurface, Voronoi; item 25 had booked a symmetric-log axis check for them, since `symlog` appears only in `calc/axis_cross.py`); and the remaining gallery types (Scatter Central, point-segment lines, variable-radius pie, kite, ribbon, circular packing, cluster and correlation plots, heatmap with dendrogram). Kept for the record; no work unless the owner reopens one.
    - Source: B1, F, G, H1.

---

## W3 — Data, worksheet & import

### Tier 1 — High Impact

### Tier 2 — Medium Impact

30. **Imports by specimen** — JSON tables, NI TDMS, Princeton SPE, Tektronix ISF / WFM, LeCroy, WAV, Igor `.pxp`, HTML and PDF tables, NASA CDF, MDF4. *Waits for a real file of each format (OG7, 2026-11-26: none on hand).*
    - Model: **Claude Sonnet 5.5** per parser, with the `data-format-detective` agent; Opus 5.5 or ChatGPT Sol only for an undocumented binary. Size M each. Oracle: yes (Origin imports most of them).
    - Source: C1, F, G; GAP_AUDIT_9 G17.

31. **Row-range views** — plot or fit a row window without masking rows. *Opened 2026-11-26 (OG11); contract accepted.*
    - Model: contract by **Claude Opus 5.5** (alt ChatGPT Sol high), because the row-state model is the single source of truth; implementation by Sonnet 5.5. Size L.
    - Source: H1; H2 idea 12.
    - [x] Contract, shared with item 34: `ROW_RANGE_CONTRACT.md` (accepted 2026-11-26)
    - [ ] Slice R1: row ranges in analysis inputs, fits and the worksheet action (no persisted state)
    - [ ] Slice R0 (the metadata-key gate), then R2 (plot row range, export, wire fixture) and R3 (subset identity and Go to Source rows)

33. **Formula functions, wave 2** — special functions (shared with the fit-equation language), complex numbers, lookup and reference, engineering, signal and data-manipulation functions.
    - Model: **Claude Haiku 5.5** (alt ChatGPT Luna), on the wave 1 contract. Size M.
    - Source: C3.
    - [x] Special, engineering, data and lookup functions (#1063: 33 element-wise names mirrored in the headless exporter against one shared fixture; lookups are app-only)
    - [ ] Complex numbers: a cell holds one real value, so this needs a paired real / imaginary column design first
    - [ ] Signal-processing functions in formulas
    - [ ] `beta` / `lbeta` for negative non-integer arguments (NaN today; scipy continues them)
    - [ ] Reopening a `let` formula with a row range in Set Column Values shows the expanded text

### Tier 3 — Nice-to-Have

34. **Worksheet structure** — mirror columns, named ranges, cell notes, graphs or images in cells, sheet protection, a column list view, a show-formulas toggle, time-series pivot, inserting a column into every similar sheet. *Opened 2026-11-26 (OG12): named ranges, cell notes and mirror columns; graphs or images in cells stay out.*
    - Model: mirror columns and named ranges need a contract from **Claude Opus 5.5** (alt ChatGPT Sol high), because they touch the recalculation graph; the rest by Sonnet 5.5 or ChatGPT Terra medium. Size L.
    - Source: C3, E, F, G, H1.
    - [ ] Slice R5: mirror columns (a `sheet()` formula column recognised by shape; no persisted field)
    - [ ] Slices R6 and R6x: cell notes, `.xlsx` comments, and proof that no export path leaks the private sidecar key
    - [ ] Slices R4a–c: named ranges (model, `rng()` binding, manager UI)
    - [ ] The rest needs no decision: sheet protection without a password (OG1 keeps password protection out), a column list view, a show-formulas toggle, time-series pivot, inserting a column into every similar sheet

35. **Export writers** — worksheet to PDF or image, XML, SQLite and NetCDF map output, on the converter's writer pattern.
    - Model: **Claude Haiku 5.5** (alt ChatGPT Luna). Size S each.
    - Source: C2.
    - [ ] Verify worksheet-to-PDF is absent before building

36. **Other-software and domain imports** — Prism, Minitab, SAS, SigmaPlot; battery cyclers (BioLogic, Neware, Ivium, Metrohm); ChemStation and NMR; ODBC / SQL servers; Google Sheets. *Not scheduled (OG3, OG7, 2026-11-26): no domain family wanted and no specimen files yet.*
    - Model: **Claude Sonnet 5.5** per format. Size M each.
    - Source: C1, E, F, G.

---

## W4 — Workflow & usability (ideas borrowed from Origin)

### Tier 1 — High Impact

39. **Plot-gallery variant presets** — preset tiles such as "violin with box" or "histogram with rug", so options are found without a dialog.
    - Model: **ChatGPT Terra high**, ChatGPT Sol for visual acceptance (alt Claude Sonnet 5.5). Size M.
    - Source: H2 idea 1.
    - [x] Presets of existing types first (#1035, 10 presets)
    - [x] Presets of the item 20 types so far (#1066: CDF with and without the band, CDF + rug, marginal box and rug, overlapping ridgeline)
    - [x] Presets of the wave 5 item 20 types (#1078: split violin, paired + mean ± 95% CI, sorted lollipop, stacked histogram)
    - [ ] Presets of later item 20 types as they land (the preset test caps the gallery at 20, which it now holds)

### Tier 2 — Medium Impact

40. **Preset bar on every tool** — named settings plus last-used values on each analysis workshop, generalising recipes and fit templates. *Opened 2026-11-26 (OG13).*
    - Model: contract by **Claude Opus 5.5** (alt ChatGPT Sol high): store, project-file persistence, versioning; rollout per workshop by Haiku 5.5, ChatGPT Luna or Terra. Size L.
    - Source: H2 idea 2.
    - [x] Contract: `PRESET_BAR_CONTRACT.md` (accepted 2026-11-26)
    - [ ] Slice P1: core, bar and the Resample adapter; then P2: Curve Fit over fit templates, fixing the silent skip of a missing manual-error column
    - [ ] Slices P3–P6: Peaks and Baseline, the statistics family, the remaining workshops with Export and Import, the Recipe Library listing

41. **Properties navigator** — one properties surface with a graph › layer › plot tree, several axes edited together, "Apply to…" other layers and graphs, and previous / next in column properties. *Not scheduled (OG13, 2026-11-26).*
    - Model: interaction design by **ChatGPT Sol high**, implementation by **ChatGPT Terra high**; Claude Sonnet 5.5 reviews the canonical-state writes. Size L.
    - Source: H2 idea 4.

42. **Format by parts** — copy and paste only fonts, colours, symbols or scales, and save a format as a theme by category.
    - Model: **ChatGPT Terra high** (alt Claude Sonnet 5.5). Size M.
    - Source: H2 idea 6.

43. **Role grid at plot time** — choose X, Y, error and label columns when plotting, independent of column designations; a plot list showing each plot's range.
    - Model: **ChatGPT Terra high**. Size M.
    - Source: E (Plot Setup is Partial), H2 idea 11.
    - [ ] Compare with Quick Plot and Graph Builder first; build only the difference
    - [ ] Y alone with one unambiguous designated X plots directly; competing matches get an explicit role picker (replacement plan)

### Tier 3 — Nice-to-Have

44. **Staged edits in layout dialogs** — a live preview, Apply to preview, OK to commit, with the dialog's own undo.
    - Model: **Claude Sonnet 5.5** (alt ChatGPT Terra high). Size M.
    - Source: H2 idea 3.
    - [ ] Choose and document per surface what Cancel commits after Apply (Origin's Plot Details keeps applied changes), and test edits made after the last Apply and Undo after closing (replacement plan)

45. **Learning aids** — a reviewable hint log, an in-app gallery of sample graphs with their data, tips.
    - Model: **ChatGPT Terra medium**, with Claude Haiku 5.5 for content. Size M.
    - Source: D, E, H2 idea 10.

46. **Automation surfaces** — an in-app console, event scripts, custom menus and toolbars, user key chords, an app gallery. *Out of scope (OG8, 2026-11-26): scripting stays headless.*
    - Model: security contract by **Claude Opus 5.5** if approved; then Sonnet 5.5. Size L.
    - Source: D, E, G; GAP_AUDIT_9 G18.

49. **Desktop installer extras** — bundle the optional extras in the desktop installer, so the methods behind them work in the installed app. *At the final product (owner, 2026-11-26): roll every analysis extra in then. Until then the installer stays lean, so development stays fast.*
    - Model: **Claude Sonnet 5.5**. Size S.
    - Source: item 6's installer sub-task (wave 6 checkpoint).
    - Today `release.yml` builds the sidecar after `uv sync --group bundle`, and that group holds only PyInstaller. So no extra is in the installed app: `[stats]` (GLM, survival, ARIMA, ADF), `[wavelets]`, `[bumps]` (bumps fit engine, DREAM) and `[office]` (Word and PowerPoint report export). Installed users cannot add one later. Each method refuses with a reason, so nothing fails silently.
    - [ ] Add every analysis extra (`stats`, `wavelets`, `bumps`, `office`) as `--extra` flags on that `uv sync` line. `desktop` (pywebview) and `origin-com` (pywin32) are not for the Tauri sidecar
    - [ ] Check the PyInstaller spec (`tools/bundle/qz-server.spec`) collects them (hidden imports, statsmodels and lifelines data files), and extend the sidecar smoke test to run one method from each
    - [ ] Measure the installer size and sidecar start-up time before and after
    - [ ] The refusal text names a pip command (`pip install quantized-lab[stats]` and similar, in `calc/stats_glm.py`, `stats_survival.py`, `ts_arima.py`, `ts_stationarity.py`, `wavelets.py`, `fit_bumps.py`, `refl_dream.py`) that an installed-app user cannot follow. Any extra left out of the installer needs desktop wording that says so

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
- ~~**#29 Worksheet clipboard and cleanup**~~ (2026-11-26, #1044, #1061, #1080) — clipboard formats, text to columns, label-row sort, conditional formats, and number and date fill series with the unit read from two cells.
- ~~**#37 Quick wins**~~ (2026-11-26, #1045, #1061, #1080) — selection stats, repeat last (single and multi-input, and with inputs reversed), reopen last dialog, menu recents.
- ~~**#2 gadget kinds**~~ (2026-11-26, #1077) — intersect, interpolate and rise time on the plot's ROI chip, sending the panel's own requests.
- ~~**#13 rest: math extras reopen and checks**~~ (2026-11-26, #1076, #1088) — reopen and Replace, query points from a worksheet, surface area within 0.02% of Origin's `marea`.
- ~~**#20 wave 5 types**~~ (2026-11-26, #1078) — half and split violin, paired before-after, lollipop, stacked histogram.
- ~~**#22 main part: browser graph and graph tools**~~ (2026-11-26, #1079) — browse through columns and sheets, pick points into a worksheet with provenance, an axis scroller, a filter from the graph.
- ~~**#24 main part: Plot Details residue**~~ (2026-11-26, #1081) — text symbols, equal-aspect axes, XY error rectangles, stack totals.
- ~~**#1 oracle cases, part 3**~~ (2026-11-26, #1088) — 12 more Origin fixtures (map correlation, interpolation, B-spline, `marea`, NAG gridders, PSD, curve averaging, block mean, row-wise t-test), 18 agreements and 7 recorded conventions.
- ~~**#47 second pass and the workbench findings**~~ (2026-11-26, #1082–#1087) — the wave 4 pass plus the replacement plan's GUI audit re-checked on current main; the sloped-baseline false peak and 8 GUI findings fixed.
- ~~**#6 main part: wavelets**~~ (2026-11-26, #1095) — CWT, DWT, reconstruct, wavelet smooth and denoise behind an optional `[wavelets]` extra; DWT, IDWT and CWT agree with Origin. 2-D wavelets stay open; the installer extras are deferred to item 49.
- ~~**#8 main part: statistics completions**~~ (2026-11-26, #1091, #1093) — power and sample size, a probability calculator, row-wise t-tests (pooled and Welch), Steel-Dwass, ANOVA effect sizes, Mann-Kendall with Sen's slope. The CI panel stays open.
- ~~**#9 general families**~~ (2026-11-26, #1096) — 140 of Origin's general functions with recovery tests; Origin's own fits and an import mapping stay open.
- ~~**#11 main part: clustering**~~ (2026-11-26, #1089, #1094) — k-means and hierarchical clustering with a dendrogram, checked against 20 Origin answers.
- ~~**#25 Ternary vector and line plots**~~ (2026-11-26, #1090) — line plots with series and gaps, vector plots between compositions, screen and export pinned by a wire fixture. Not booked: a start-plus-delta vector input, series by a text column, a colour-bar range.
- ~~**#48 main part: 3D bars and vectors**~~ (2026-11-26, #1098) — on the 3D map stage and in export from one camera, gated at v9.
- ~~**#47 wave 5 pass and its fixes**~~ (2026-11-26, #1097, #1099, #1100, #1101) — 38 work, 14 cosmetic, 1 wrong; the replacement plan's GUI residue and `main`'s E2E fixed too.
- ~~**Forward-compat v9 rung**~~ (2026-11-26, #1092) — 28 fields v0.45.0 would drop now write v9, measured against v0.45.0's own loader.
- ~~**#31, #34, #40 contracts**~~ (2026-11-26) — `ROW_RANGE_CONTRACT.md` and `PRESET_BAR_CONTRACT.md` accepted with two amendments.
