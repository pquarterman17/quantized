# quantized — OriginPro Gap Plan (beyond MATLAB parity)

Expansion plan to make quantized a full OriginPro replacement for
materials-lab analysis (magnetometry / XRD / transport / reflectometry),
aimed at open-source adoption. Derived from a 2026-07-01 gap analysis of
OriginPro 2024/2025 vs the current app, scoped by the owner's decisions:
full Origin replacement; recalc engine + templates, more plot types,
deeper statistics, and batch + reporting all in scope; custom steps land
phased (no-code expressions first, then a Python plugin API);
direct-manipulation figure editing is the target; OSS investments are
plugin ecosystem, generic import wizard, and packaging/installers (docs
site deprioritized for now). W9 adds JMP-inspired interactive
exploration (Graph Builder drag-drop, linked brushing) — strengths JMP
has that Origin lacks.

**Status:** Active
**Created:** 2026-07-01
**Updated:** 2026-07-01

---

## Context

### How the pieces fit together

`plans/PORT_PLAN.md` (parity with `quantized_matlab`) is ~complete: the
golden-verified `calc/`/`io/` layers, thin `routes/`, and the React
frontend (Stage plotting, Worksheet, seven workshops, macro recorder,
matplotlib publication export) already exist. This plan builds *on top*
of that stack — nothing here re-opens parity work. The workstream
numbers below (W1–W8) are local to this plan and unrelated to
PORT_PLAN's W0–W9.

Key existing seams this plan extends:

- `frontend/src/store` formula engine — already recomputes computed
  columns on base change; W1 generalizes that into a workspace-wide
  dependency graph (dataset → correction → fit → figure → report).
- Macro recorder (`frontend/src/lib/macro.ts` + store macro slice) —
  already captures curated actions as structured steps; W2 turns
  recordings into editable, re-runnable pipelines and analysis
  templates.
- `src/quantized/io/registry.py` single-registration pattern — the
  model for the W2 plugin API and W8 import-filter persistence.
- `src/quantized/calc/figure.py` + `workshops/figurebuilder/` — the
  base for W3 figure documents and direct-manipulation editing.
- Peak/baseline/fitting calc (multi-peak, linked widths, ALS/SNIP/…) —
  complete; the W6 Peak Analyzer wizard is UX packaging over it.
- `../test-data/` (created 2026-07-01) — the seed of a public
  instrument test-data corpus (starting with PANalytical PIXcel3D
  XRDML samples); later its own repo, consumed via the `realdata`
  fixture path (#46).
- Architecture guards stay binding: pure calc/io, thin routes, 500-line
  backend / ~400-line component ceilings, **no GPL runtime deps**
  (statsmodels/scipy/PyWavelets/python-docx/python-pptx/emcee/lifelines
  are all BSD/MIT and safe; `pingouin` and `liborigin` are GPL — never
  runtime).

### Model routing (who implements what)

Cost-conscious defaults; per-item `Model:` lines below override.

- **haiku** — mechanical work where an in-repo pattern already exists:
  thin scipy/statsmodels wrappers with tests, library-backed exporters
  (python-docx/pptx, matplotlib 3-D), UI badges, serializing existing
  state. Cheap, fast; escalate to sonnet if the item starts making
  design decisions.
- **sonnet** — the default workhorse: new workshops/components, plot
  interactions, parsers, wizards, serialization formats, CI/packaging.
- **opus** — ONLY the contract-defining items others consume: #1 recalc
  DAG, #8 plugin API, #12 figure-document model, #36 report-sheet
  schema, #50 row-state model, and #51's plot-spec model. Use opus for
  the design + core; hand follow-on wiring to sonnet. Nothing here
  needs fable.

Every implementer, regardless of model, must first read: `CLAUDE.md`,
`.claude/rules/architecture-guards.md`, and this plan's Context — then
the seam files named in its item. New calc math still follows
`.claude/rules/golden-tests.md` where a MATLAB reference exists;
otherwise use published reference values (the calculator-domain pattern,
see `tests/test_calc_semiconductor.py` et al.).

### Deliberate differentiators (where Origin is weak — lean in, not parity)

- **Analysis is code, not a binary blob:** every workflow emits a
  readable, diffable, re-runnable script (macro → pipeline → template).
- **Cross-platform + headless:** pure calc/io runs on Linux/Mac/CI;
  Origin structurally can't.
- **Honest uncertainty:** ODR/AIC/BIC/bands exist; add bootstrap + MCMC
  posteriors (also closes PORT_CHECKLIST's open `mcmcSample.m` item).
- **Domain depth:** Parratt, RSM strain, hysteresis, VFT are native —
  "Origin can plot your PPMS data; quantized understands it."
- **Interactive exploration (W9):** JMP-class drag-drop plotting and
  linked brushing — Origin has neither, JMP costs a license and doesn't
  speak instrument formats. No OSS tool combines both with domain depth.
- **No-code publication figures (W3) — a headline pillar, not a
  workstream detail.** Origin's hardest-to-beat quality is that a fully
  custom, journal-ready figure never requires code; matching it means
  two things at once: *every* property reachable from the UI (#11–14)
  AND defaults good enough that the first render is already
  publication-grade (style presets do the taste, panels do the tweaks).
  The OSS Python competition fails here precisely because "just edit
  the matplotlib script" is the answer — quantized must never give that
  answer.
- **Positioning sentence** (for the eventual README): Origin can't link
  views, JMP can't read your instruments, glue doesn't know materials
  science — quantized is the only tool where you drag a PPMS column
  onto an axis, brush the outliers out of the fit, and walk away with a
  journal-ready PDF and a script that reproduces it.

### Data / control flow (target end-state)

```
N raw files → import wizard / saved filter → pipeline (recorded steps,
expression steps, plugin steps) → recalc DAG keeps fits/figures/reports
live → report sheets → summary sheet + docx/pptx/LaTeX/figures out
```

### Dependency map

- **#1 (recalc DAG) is the keystone**: #3 batch templates, #4 staleness
  badges, and live figure documents (#12) all consume it.
- #6–7 (pipeline view + expression steps) precede #2 (analysis
  templates) and #8 (plugin API); templates are saved pipelines.
- #36 (report sheets) precedes #3 (batch summary reports) and #37–38
  (document export renders report sheets).
- #12 (figure documents) precedes #13–14 (click-to-select, in-place
  editing); #11 (complete property panels) is independent and first.
- #46 (test-data corpus) feeds #47 (PIXcel3D audit) and #42 (Bruker
  parsers — both need sample files before work can start).
- W9: #48 (modeling types) precedes #49 (drag-to-axis) and #51 (Graph
  Builder); #50 (row-state model) precedes #53 (local data filter) and
  is consumed by every linked view; #51 also consumes #16 (statistical
  plots) and #21 (faceting).
- W4 (plot types), W5 (statistics), W6 (wizard/gadgets), W8 (import,
  packaging) are largely independent of each other and parallelizable.

---

## Cross-cutting priorities

| # | Item | Workstream | Why first |
|---|------|------------|-----------|
| 31 | Peak Analyzer wizard | W6 | #1 reason labs keep Origin; calc engine already exists — pure UX packaging, highest ROI |
| 24–26 | ANOVA/post-hoc + nonparametric + assumption tests | W5 | Nearly free via scipy/statsmodels (BSD); hard adoption blocker when missing |
| 6–7 | Pipeline view + expression steps | W2 | Seeds analysis templates; macro recorder already captures the steps |
| 1 | Recalc dependency graph | W1 | The architectural keystone everything "live" builds on |
| 36–37 | Report sheets + docx/pptx export | W7 | What labs hand around at group meeting; python-docx/pptx are MIT |
| 11, 12 | Complete property panels + figure documents | W3 | Headline pillar: zero-code production figures is Origin's hardest-to-beat trait; stepping stones direct manipulation requires anyway |
| 40 | Generic import wizard + saved filters | W8 | #1 onboarding blocker for outside users' data |
| 41 | Packaging & installers | W8 | Zero-friction first run gates all OSS adoption |
| 46–47 | Test-data corpus + PIXcel3D audit | W8 | Cheap now, unblocks #42/#47 and the checklist's XRDML 2-D freeze; corpus grows only if collected as found |
| 49–50 | Drag-to-axis + row states | W9 | The JMP-differentiator foundation; #50 is a small contract many views consume — design it before W4 plots and the Graph Builder (#48 modeling types shipped 2026-07-01) |

---

## W1 — Recalculation engine & analysis templates

### Tier 1 — High Impact

1. **Recalc dependency graph** — generalize the column-level formula
   recompute into a workspace-wide DAG (dataset → corrections → fits →
   figures → reports) with dirty-flag propagation and Auto/Manual/None
   recalculation modes
   *Model: opus (design + core graph), sonnet (store/UI wiring).*
   *Pickup: study how `Dataset.formulas`/`recomputeData` already chain
   recomputes in the frontend store, and how corrections re-derive from
   `Dataset.raw`; the DAG is the generalization of those two paths.*
   - [ ] Node/edge model: node kinds = dataset, computed column,
         correction config, fit result, figure document, report sheet;
         edges keyed by stable dataset/figure ids (survive `.dwk`
         round-trip)
   - [ ] Store slice: dirty-set + recalc mode (auto/manual/off) +
         topological recompute scheduler, debounced so a burst of cell
         edits triggers one downstream pass
   - [ ] Backend stays stateless — routes/calc unchanged; recompute =
         re-issuing the same API calls with fresh inputs
   - [ ] Acceptance: in auto mode, editing a worksheet cell re-runs the
         dependent fit and re-renders the dependent figure with no user
         action; in manual mode the same edit only flips staleness (#4)

2. **Analysis templates** — save an end-to-end recipe (import →
   corrections → fit → figure → report) as a named, re-runnable template
   file; seeded from a recorded pipeline (#6)
   *Model: sonnet. Pickup: a template = a serialized pipeline (#6) with
   input slots; format must be text/JSON and diffable (differentiator).*
   - [ ] Format: version tag + ordered typed steps (import / correction
         / expression / fit / figure / report) + declared inputs (file
         slot, overridable params) + declared outputs (named fit params
         for #3's summary columns)
   - [ ] Save from the pipeline view; load into it for editing; store
         alongside workspace + exportable as a standalone file
   - [ ] Acceptance: record a session on file A, save as template,
         apply to file B → same chain executes and produces the report;
         template diffs cleanly in git

3. **Batch-run templates with summary sheet** — apply a template to N
   files; produce per-file report sheets plus one summary worksheet of
   extracted parameters (Tc/Ms/peak positions/fit params per row)
   *Model: sonnet. Pickup: mirror `calc/batch_fit.py`'s per-dataset
   loop + trend extraction; run through the `routes/jobs` WebSocket
   queue.*
   - [ ] Job type: template ref + file list; per-file progress +
         failure isolation (one bad file doesn't kill the batch)
   - [ ] Summary sheet: one row per input file, columns = the
         template's declared outputs; lands in the library as a normal
         DataStruct (plottable, exportable — parameter-vs-file trends
         for free)
   - [ ] Acceptance: 20-file corpus end-to-end → 20 report sheets + 1
         summary sheet; a deliberately corrupt file yields a flagged
         row, not a crash

### Tier 2 — Medium Impact

4. **Staleness indicators** — green/amber/red recalc badges on datasets,
   computed columns, fits, and figures; "recalculate now" affordance
   *Model: haiku. Pickup: pure UI over #1's dirty flags; badge styling
   follows the design tokens (`--accent` etc.), no hardcoded colors.*

5. **Workspace format v2** — persist the dependency graph, templates,
   pipelines, and figure documents through `.dwk` (and autosave)
   *Model: sonnet. Pickup: extend `lib/workspace.ts`
   (serialize/parse + defensive validation) and `lib/autosave.ts`.*
   - [ ] Versioned migration: v1 `.dwk` files keep loading (datasets
         only, empty graph)
   - [ ] Acceptance: save → reload → recalc graph, templates, and
         figure documents all survive; autosave restores the same

---

## W2 — Pipelines, custom steps & plugin API

### Tier 1 — High Impact

6. **Editable pipeline view** — promote a macro recording to a
   first-class, editable step list (reorder, edit params, delete,
   insert); save as / load into templates (#2)
   *Model: sonnet. Pickup: steps already exist as structured
   `macroSteps` in the store (`lib/macro.ts` serializes them); build a
   workshop (state hook + view, workshop pattern) that edits the step
   list rather than the emitted script.*
   - [ ] `workshops/pipeline/` — hook (step list state, run/dry-run) +
         view + one row component per step with a schema-driven param
         form (each macro step type declares its editable params)
   - [ ] Step ops: reorder, enable/disable, delete, insert, edit params
   - [ ] Run against the active dataset or a picked file; per-step
         success/failure markers
   - [ ] Acceptance: record a correction+fit session → change the fit
         model in the pipeline view → re-run reproduces the edited
         analysis; script export still works (same steps, one source of
         truth)

7. **No-code expression steps** — dataset-level transforms authored with
   the existing safe formula engine (no eval) usable as pipeline steps
   alongside built-in corrections
   *Model: sonnet. Pickup: `lib/formula.ts` (recursive-descent, no
   eval) is the evaluator; wrap it as a step type consumable by #6.*
   - [ ] Step type `expression`: formula string(s) over `x`/`A`/`B`/…
         producing new or replaced columns; validated at author time
         (compile before save, surface parse errors inline)
   - [ ] Usable both in the pipeline view and as a one-off worksheet
         action (the current formula bar becomes a recorded step)
   - [ ] Acceptance: an expression step recorded on one dataset replays
         correctly inside a template run on another file

### Tier 2 — Medium Impact

8. **Python plugin API** — drop-in `.py` modules discovered like the
   parser registry, contributing pipeline steps, parsers, and fit
   models; stable documented contract + a template repo for publishers
   *Model: opus (API contract + discovery/versioning design), sonnet
   (template repo, examples). Pickup: `io/registry.py` is the in-repo
   discovery pattern; fit models register like `calc/fit_models.py`.*
   - [ ] Contract v1 (pure functions only): parser (path → DataStruct),
         step (DataStruct + params → DataStruct), fit model (params, x
         → y, plus an auto-guess hook); metadata (name, version,
         `api_version`) — plugins cannot reach routes or violate the
         no-eval guard
   - [ ] Discovery: plugins dir (e.g. `~/.quantized/plugins/`) +
         package entry points; a broken plugin logs + skips, never
         crashes startup
   - [ ] Plugin parsers register through `io/registry.py` (single
         registration preserved); plugin steps appear in #6's step
         palette
   - [ ] `quantized-plugin-template` repo: one worked example of each
         contribution type + CI that runs the plugin against a pinned
         quantized version

9. **Documented headless public API** — stabilize + document driving
   `quantized.calc`/`io` from scripts/notebooks/CI (the layering already
   permits it); the differentiator Origin structurally can't match
   *Model: sonnet. Pickup: the pure layers are already importable;
   work = choose the blessed surface, add docstrings/examples, freeze
   names, add an API-stability test (public names don't vanish).*

### Tier 3 — Nice-to-Have

10. **Plugin distribution conveniences** — `qz plugin list/enable`,
    community index page
    *Model: haiku. Pickup: extends `cli.py`; requires #8.*

---

## W3 — Figure documents & direct-manipulation editing

*(Headline pillar — see the differentiators note. The bar: a fully
custom, production-ready figure with zero code, ever. Two halves:
complete UI reach over every property, and defaults so good the first
render is already journal-grade. If a user ever needs to post-process
an exported figure in Illustrator or a script, that's a W3 bug.)*

### Tier 1 — High Impact

11. **Complete property panels** — every export property (fonts, sizes,
    margins, legend placement, tick/spine details, panel layout)
    editable in the figure builder with live preview; no code ever
    required to change a figure
    *Model: sonnet. Pickup: extend `workshops/figurebuilder/` and
    `calc/figure.render_figure` param-for-param; the WYSIWYG
    series-style passthrough shows the plumbing pattern.*
    - [ ] Panel groups: Text & fonts · Axes & ticks (labels, limits,
          scales, tick direction/length, minor ticks, spines) · Legend
          (position incl. outside, frame, order) · Canvas (size,
          margins, dpi) · Per-series (color/width/style/marker — exists)
          · Annotations
    - [ ] Every `render_figure` kwarg reachable from a panel; every new
          panel field lands as a `render_figure` kwarg (one config
          object, no side channels)
    - [ ] **Beautiful-defaults audit:** before adding controls, make
          the un-tweaked first render journal-grade per preset — real
          figures (M-H loop, XRD log scan, R(Q), RSM map) reviewed
          against published APS/Nature figures; fix the presets, not
          the user (ux review pass)
    - [ ] Acceptance: reproduce an APS-preset-quality figure starting
          from the `default` preset using panels only

12. **Figures as live documents** — named figure objects in the
    workspace that re-open, re-edit, and re-export at any time (never
    recreate a figure); round-trip through `.dwk`; recalc-aware (#1) so
    figures track data changes
    *Model: opus (document/state model — W3's contract item), sonnet
    (wiring). Pickup: today figure config is transient dialog state;
    promote it to a first-class store entity like `Dataset`.*
    - [ ] FigureDoc entity: id, name, dataset refs (by id, not copies),
          plot-state snapshot (channels/scales/styles/overlays), export
          config (#11's object), live-link vs frozen flag
    - [ ] Library gets a "Figures" section (open / rename / duplicate /
          delete / export)
    - [ ] Acceptance: build a figure, close the app (autosave), reopen
          → identical render from the FigureDoc; with live-link on,
          editing the source data updates the figure via #1

### Tier 2 — Medium Impact

13. **Click-to-select on the preview** — hit-test the rendered preview
    (title, axis labels, legend, series, annotations) and open the
    matching property editor; the bridge from panels to direct
    manipulation
    *Model: sonnet (gui-interaction work). Pickup: extend the export
    route so `render_figure` also returns an element map (artist id →
    pixel bounding box, from matplotlib artist extents at draw time);
    client overlays hover outlines on the preview image and focuses the
    matching #11 panel control on click.*

14. **In-place editing** — edit text inline and drag legend/annotations
    directly on the preview canvas (Origin-style double-click-anything)
    *Model: sonnet. Pickup: builds directly on #13's hit-boxes; commit
    edits back through #11's config object, never a parallel path;
    drag = update position property + re-render (debounced).*

15. **User graph templates** — save any figure's full style as a named,
    shareable template file (extends the 10 built-in presets); apply to
    other figures / use in batch plotting
    *Model: haiku. Pickup: `calc/figure_styles.py` presets define the
    schema; a user template is the same dict, user-authored, persisted
    like saved import filters (#40).*

---

## W4 — Plot types

### Tier 1 — High Impact

16. **Statistical plots** — box/whisker, grouped box, violin, Q-Q,
    probability plot, histogram with distribution-fit overlay
    (interactive + matplotlib export)
    *Model: sonnet. Pickup: stats math is pure calc; interactive
    rendering follows the `PolarStage` Canvas2D precedent where uPlot
    can't express the mark.*
    - [ ] New pure module (e.g. `calc/statplots.py`): box stats
          (quartiles + whisker rule Tukey-1.5·IQR / min-max, outliers),
          KDE for violins, theoretical quantiles for Q-Q/probability,
          histogram binning rules (FD/Sturges/fixed) — validated against
          published worked examples (NIST/textbook)
    - [ ] Interactive: box/violin stage over grouped columns (group by
          a label column or by dataset); Q-Q/histogram fit through the
          normal uPlot path
    - [ ] Export: same figures server-side via matplotlib for
          publication output
    - [ ] Acceptance: grouped box + violin of a multi-sample worksheet
          render interactively and export vector-identical stats

17. **Filled + labeled contour** — proper contourf/contour with labels,
    including tri-contour on scattered (RSM) data; interactive + export
    *Model: sonnet. Pickup: `calc/map.py` + `MapStage.tsx` are the 2-D
    substrate; export via matplotlib contourf/tricontourf; interactive
    contour polygons via d3-contour (ISC) over the gridded MapData,
    level count/spacing (lin/log) in the Inspector 2-D card.*

### Tier 2 — Medium Impact

19. **3D static export** — matplotlib 3-D surface / scatter / waterfall
    in the publication export path (defer interactive 3-D to #22)
    *Model: haiku. Pickup: new branch in `calc/figure.py` over the
    existing gridded MapData; mplot3d is stock matplotlib.*

20. **Categorical plots** — grouped/stacked bar & column with error
    bars, categorical axes
    *Model: sonnet. Pickup: needs a categorical x-axis concept in
    `lib/plotdata.ts` — small but touches the shared payload shape.*

21. **Axis break + faceting** — automatic/manual axis breaks; a
    trellis/faceted multi-panel generator
    *Model: sonnet. Pickup: extends `MultiPanelStage.tsx` +
    `lib/multipanel.ts` (facet by group/tag from the library); export-
    side breaks via twinned matplotlib axes.*

### Tier 3 — Nice-to-Have

22. **Interactive WebGL 3-D** — rotatable surface/scatter (three.js or
    regl, MIT); only after #19 proves demand
    *Model: opus if built (new rendering subsystem); defer.*

23. **Ternary diagrams; quiver/streamline plots**
    *Model: haiku (export-only via matplotlib/python-ternary MIT).*

---

## W5 — Statistics depth

*(All Tier 1–2 items: scipy/statsmodels (BSD) — never `pingouin` (GPL).
New stats calc goes in new pure modules beside `calc/stats.py` (500-line
ceiling), with published reference-value tests — NIST StRD datasets and
textbook worked examples — the calculator-domain pattern. Every test
emits a report-sheet object once #36 lands; until then, plain dicts with
the same field names.)*

### Tier 1 — High Impact

24. **Two-way + repeated-measures ANOVA with post-hoc** — Tukey,
    Bonferroni, Dunnett; formatted report-sheet output (#36)
    *Model: sonnet. CORE SHIPPED 2026-07-01 (see Completed): balanced
    two-way + Tukey HSD + Dunnett, scipy-only. Remaining below.*
    - [x] Balanced two-way with interaction (Montgomery battery-life
          table reproduced exactly); Tukey + Dunnett post-hoc (2026-07-01)
    - [ ] Unbalanced designs (Type II/III sums — regression approach
          over `multiple_regression` with dummy coding, or statsmodels)
    - [ ] Repeated-measures ANOVA; Bonferroni correction helper
    - [ ] Long-format input from worksheet columns (value + factor
          columns) + report-sheet output (needs #36)

26. **Assumption tests + guided chooser** — Shapiro-Wilk, Levene,
    Anderson-Darling, KS; a small "which test?" helper that gates
    parametric vs nonparametric
    *Model: sonnet (chooser UX), haiku (the wrappers). The wrappers
    shipped 2026-07-01 with #25; the chooser DECISION TREE also shipped
    2026-07-01 (`stats_tests.recommend_test` + `/api/stats/recommend` —
    Shapiro + Brown-Forsythe gates -> recommendation + endpoint +
    plain-language reasons). Remaining: the stats-workshop UI front
    door that renders it and one-click-runs the recommended test.*

### Tier 2 — Medium Impact

29. **Bootstrap + MCMC uncertainty** — CORE SHIPPED 2026-07-02 (see
    Completed): bootstrap CIs (residual/pairs) + MCMC fit posteriors
    over the ported `calc/mcmc.py` sampler (no emcee dep needed).
    *Remaining: corner-style posterior panels through the export path
    (UI/figure work — pairs naturally with the fitting workshop).*

### Tier 3 — Nice-to-Have

30. **GLM (logistic/Poisson), survival analysis (lifelines, MIT), ROC**
    *Model: haiku.*

---

## W6 — Peak Analyzer wizard & gadgets

### Tier 1 — High Impact

31. **Peak Analyzer wizard** — guided multi-step flow (baseline →
    detect → fit → integrate → report) over the existing calc engine;
    the recipe saves as a re-runnable theme (feeds #2 templates); ends
    in a formatted report sheet (#36). *The single most cited reason
    labs keep an Origin license.*
    *Model: sonnet (large frontend workshop; take a ux review pass
    before shipping). Pickup: zero new math — compose
    `workshops/peaks/`, `useBaseline`, `calc/peak_fit.py` /
    `peak_multifit.py` / `baseline.py` behind a stepper; workshop
    pattern, every component <400 lines.*
    - [ ] Stepper pages: ① Range & baseline (method + live subtract
          preview) → ② Find peaks (auto-find params + click to
          add/remove markers) → ③ Model & constraints (per-peak or
          linked widths) → ④ Fit & review (overlay, residuals, per-peak
          table) → ⑤ Report (report sheet + optional integrate-only
          #32 path)
    - [ ] Each page = existing hook state; Back/Next never loses edits
    - [ ] The completed run saves as a recipe (a pipeline fragment,
          #6-compatible) that re-runs on another dataset
    - [ ] Acceptance: XRD fixture from load to report in ≤5 clicks with
          defaults; recipe re-run on a second scan reproduces the flow

32. **Integrate-only workflow** — BACKEND SHIPPED 2026-07-02 (see
    Completed): per-region trapezoid areas/centroid/FWHM/%-area over a
    shoulder-to-shoulder linear baseline, `/api/peaks/integrate`.
    *Remaining: surface it in the UI — wizard page ⑤'s alternate path
    (or a region-tool action on the plot before the wizard exists).*

33. **Quick-fit gadget** — drag an ROI rectangle on the live plot →
    fit of that region recomputes live as the ROI moves
    *Model: sonnet (gui-interaction work). Pickup: the draggable
    ref-line plugin + region-select tool (`lib/regionSelect.ts`) are
    the primitives; debounce ROI-move → `/api/fitting` → overlay +
    floating result chip (model picker: linear/gaussian/exp).*

### Tier 2 — Medium Impact

34. **More gadgets** — integrate, statistics, FFT, differentiate within
    an ROI; paired cursors with Δx/Δy/slope readout
    *Model: haiku once #33 lands (same ROI pattern, different calc
    call — the gadget frame generalizes).*

35. **Batch peak integration** across a spectra series with alignment
    *Model: sonnet. Pickup: cross-correlation alignment already exists
    in `calc/spectral.py`; loop pattern from `calc/batch_fit.py`.*

---

## W7 — Reporting & office integration

### Tier 1 — High Impact

36. **Structured report sheets** — fit/stat/wizard outputs land as
    hierarchical report objects (params + stats tables + embedded figure
    thumbnails) in the workspace; the substrate for #3 and #37
    *Model: opus (schema design — W7's contract item; W1 batch, W5
    stats, and W6 wizard all emit it), sonnet (viewer component).*
    - [ ] Schema: plain serializable data (like DataStruct), never
          markup — title, source refs (dataset/fit ids), ordered
          sections of typed blocks (param table / stats table / figure
          ref / text note)
    - [ ] Emitters: curve fit, multi-peak fit, W5 stats, #31 wizard,
          #3 batch runs
    - [ ] Viewer: collapsible report component in the workspace;
          reports round-trip `.dwk`
    - [ ] Acceptance: one schema renders in the viewer AND through
          #37/#38 with no per-renderer special cases

37. **Word + PowerPoint export** — one-click report → `.docx`
    (python-docx, MIT) and graphs → `.pptx` one-per-slide (python-pptx,
    MIT), embedding the existing vector figure export
    *Model: haiku once #36 exists. Pickup: pure renderers over the
    report schema in new `io/` writers + one thin route (format param),
    like `io/origin.py`; figures embed via the existing `render_figure`
    output (SVG/PNG per format capability).*

38. **LaTeX table export** — booktabs-formatted fit & stats tables
    *Model: haiku. Pickup: same renderer-over-schema pattern;
    significant-digit handling follows the report schema's stated
    uncertainties (value ± error formatting).*

### Tier 2 — Medium Impact

39. **HTML report export** — self-contained shareable report page
    *Model: haiku.*

---

## W8 — Import, ecosystem & distribution

### Tier 1 — High Impact

40. **Generic import wizard + saved filters** — interactive
    delimiter/skip/header/units mapping with live preview for arbitrary
    instrument ASCII; save as a named import filter bound to an
    extension/pattern (persisted like registry sniffers)
    *Model: sonnet. Pickup: `io/delimited.py` + `io/base.py`
    (parse_col_header/resolve_column) do the detection.*
    - [ ] Preview route: first N raw lines + current guess (delimiter,
          skip rows, header row, column names/units) + parsed table
          under those settings; wizard re-previews on every tweak
    - [ ] Column mapping: name, unit, role (x/y/error/label/ignore —
          reuses the channel-role vocabulary)
    - [ ] ImportFilter persistence (name, glob pattern, all settings);
          registry consults saved filters before content sniffers
    - [ ] Acceptance: a messy multi-header instrument ASCII imports
          correctly through the wizard, and the saved filter makes the
          second file one-click

41. **Packaging & installers** — pip/uv install, standalone installers,
    versioned GitHub releases with CI-built artifacts; zero-friction
    first run for outside users
    *Model: sonnet. Pickup: mirror fermiviewer's run/packaging model
    (`qz` serves API + SPA); CI matrix already builds on
    ubuntu/win/mac.*
    - [ ] PyPI publish workflow (built SPA bundled in the wheel);
          `pipx install quantized` → `qz` works
    - [ ] Standalone installers (PyInstaller or Tauri-wrapped) for
          win/mac, built + attached by a tag-triggered release workflow
    - [ ] First-run experience: sample dataset + a "try this" pointer
    - [ ] Acceptance: fresh machine, no dev tools → install → open →
          import a CSV within 2 minutes

### Tier 2 — Medium Impact

42. **Bruker XRD 1-D parsers** (`.raw`/`.brml` line scans) — closes the
    third XRD vendor (PANalytical + Rigaku covered). *Scope note:*
    PORT_CHECKLIST routed "Bruker" to fermiviewer for **area-detector
    image** data; 1-D diffractograms are line data and belong here.
    *Model: sonnet (binary reverse-engineering; data-format-detective
    territory). Pickup: `io/rigaku.py` shows the binary-parser +
    fixture + guard-rail-test pattern; blocked on sample files — source
    them into the #46 corpus first (`.brml` is a zip of XMLs — start
    there; `.raw` v1/v4 layouts differ).*

43. **JCAMP-DX and NetCDF import** (jcamp MIT / xarray BSD)
    *Model: haiku. Pickup: standard formats, library-backed; register
    once in `io/registry.py`, return DataStruct.*

44. **`.opj` reader as an isolated dev-time CLI converter** — the
    migration lever for labs with legacy Origin projects; GPL
    `liborigin` stays a separate tool, never a runtime dep
    *Model: sonnet. Pickup: separate script/repo emitting CSV/.dwk;
    must not enter `[project.dependencies]` (no-GPL guard).*

45. **Public test-data corpus repo** — grow `../test-data/` (seeded
    2026-07-01 with PANalytical XRDML samples, PIXcel3D priority) into
    a standalone public repo of instrument files for parser development
    and `realdata`-marker testing
    *Model: haiku. Pickup: every file needs a MANIFEST row (source URL,
    license, instrument/detector, scan type) — provenance is the whole
    point of the repo; only redistributable-licensed files.*
    - [x] Vendor/technique subfolders + top-level README + per-vendor
          MANIFESTs (2026-07-01; corpus seeded from the XRDML hunt +
          the quantized_matlab copy, filenames/metadata anonymized)
    - [ ] `git init` done 2026-07-01; **publish** still gated on the
          licensing pass (owner sign-off + 6 flagged public files)
    - [x] `corpus_dir` fixture in `tests/conftest.py` + realdata smoke
          test (`test_realdata_corpus.py`, one file per vendor) (2026-07-01)

46. **PIXcel3D XRDML coverage audit** — run every corpus PANalytical
    file through `io/xrdml.py`; classify what the PIXcel3D detector
    actually emits (1-D receiving-slit-equivalent scans, scanning-line
    1-D, RSM mesh, area frames) and extend the parser for whatever
    fails
    *Model: sonnet. Pickup: `io/xrdml.py` handles 1-D +
    `_build_2d` RSM-mesh detection today; the checklist's pending
    items — the 2-D mesh golden freeze and the beam-attenuation
    correction (`<beamAttenuationFactors>`) — fold into this audit.
    Requires #45's corpus. Output: per-file pass/fail table + parser
    fixes + new committed fixtures for each newly covered variant.*
    - [x] **Audit sweep run (2026-07-01):** 18/18 corpus files parse
          after fixing the one hard failure — a **UTF-8 BOM** broke 2
          files (`read_text(latin-1)` → "ï»¿" → XML error; stripped in
          `import_xrdml`, CI-regression-tested via a BOM'd fixture in
          `test_io_xrdml.py`); full-sweep realdata test added
          (`test_corpus_xrdml_full_sweep`)
    - [x] **Schema-1.0 coupled RSMs** (2026-07-01) — `_classify_cloud`
          detects the coupled Omega-2Theta layout (ω sweeps within each
          scan, stepped offset across scans) → `mesh_kind="coupled"`
          with true per-pixel ω; synthetic-XML + realdata tested
    - [x] **Schema-2.x area RSMs** (2026-07-01) — snapshot layout
          (ω fixed per frame, 2θ window also stepping) →
          `mesh_kind="snapshot"` scattered cloud; the PIXcel3D
          m3learning file now imports [1827×255] with Qx/Qz and renders
          through `/api/plot/map`. NOTE: goes BEYOND MATLAB — the
          reference's `ttSame` check rejects both of these layouts
    - [ ] Pole figures (Phi scans × Psi steps) import flat; decide a
          representation (2-D map vs multi-column)
    - [x] 2-D golden freeze vs MATLAB (2026-07-01) — after back-porting
          the cloud support to MATLAB (`aee70d1`), ALL THREE mesh kinds
          frozen (`xrdml_map2d.json`, `freeze_xrdml_map2d.m`, headless
          R2025b) and golden-tested incl. Qx/Qz grids. Beam-attenuation
          port still tracked on PORT_CHECKLIST (separate session)

### Tier 3 — Nice-to-Have

47. **Structured clipboard paste; multi-file append import; database
    connectors**
    *Model: haiku (paste/append); defer connectors.*

---

## W9 — JMP-inspired interactive exploration

*(What JMP does well that Origin doesn't: build plots by dragging
columns, and every view stays linked. Scoped 2026-07-01 with defaults
chosen autonomously — phased Graph Builder, brushing as core priority,
auto-detected modeling types; re-tier if the owner disagrees.)*

### Tier 1 — High Impact

49. **Drag-to-axis (Graph Builder phase 1)** — drag a channel chip from
    the Channels card / legend onto the plot's X, Y, or Y2 axis region
    to re-plot instantly; nominal chips dropped on X produce a
    categorical axis
    *Model: sonnet (gui-interaction work). Pickup: axis picks already
    exist as store state (`x_key`/`y2_keys`, ChannelsCard) — this adds
    HTML5 drag + axis-region drop targets on the Stage that call the
    same actions; no new plot machinery.*

50. **Row-state model + linked brushing** — one shared per-row state
    (selected / excluded / labeled) on the active dataset, consumed by
    every view: rubber-band or click-select points in the plot →
    same rows highlight in the worksheet (and vice versa); excluded
    rows drop from stats/fits everywhere
    *Model: opus (the row-state contract — worksheet masking, plot
    selection, stats, and the local filter all consume it), sonnet
    (view wiring). Pickup: the worksheet's mask + the plot's region
    tool are the two existing halves; the design unifies them on the
    `Dataset` so `.dwk` round-trips and the macro recorder captures
    state changes.*
    - [ ] **Universal-linking rule:** linking is threshold-shaped —
          80% linked feels broken, not innovative. When this lands, add
          an architecture guard (`architecture-guards.md` + a grep-able
          convention or test): no view may read/derive row
          selection/exclusion outside the row-state model. Every
          later view (#51–55, distribution platform, gadgets) complies
          from birth.

51. **Graph Builder workshop (phase 2)** — a drop-zone canvas (X, Y,
    Group/Color, Facet) that morphs the mark as columns land: two
    continuous → scatter/line; nominal X + continuous Y → box → violin
    → bar (cycle); Facet → small multiples; live preview, one-click
    "send to Stage / export"
    *Model: opus (the plot-spec model — a small grammar mapping zone
    contents + modeling types → mark + scales; #49/#16/#21 all feed
    it), sonnet (the workshop UI). Pickup: workshop pattern
    (state hook + view + zone components <400 lines); marks reuse #16's
    statistical-plot renderers and #21's faceting; spec serializes so
    figures/templates/macros can replay it.*

### Tier 2 — Medium Impact

52. **Distribution platform** — click a column → histogram +
    box/quantiles + normality verdict + optional distribution fit in
    one linked panel, one panel per selected column
    *Model: sonnet. Pickup: pure composition of #16 statplots math,
    the shipped `calc/stats_tests.py` wrappers (Shapiro/AD), and #28
    distribution fitting; brushing (#50) makes its histogram selection
    highlight rows everywhere.*

53. **Local data filter** — sidebar widget: per-column checkboxes
    (nominal) or range sliders (continuous) that live-filter every
    linked view without mutating the dataset
    *Model: sonnet. Pickup: emits a derived row mask through #50's
    row-state model; filter definition is serializable (a future
    pipeline step, #6).*

### Tier 3 — Nice-to-Have

55. **Tabulate (drag-drop pivot)** — drag columns into row/column/value
    wells to build group summary tables (mean/sd/count by category),
    exportable as a dataset or report block (#36)
    *Model: sonnet. Pickup: group-by math is `descriptive_stats` per
    partition (pure calc); the well UI reuses #51's drop-zone
    components.*

---

## Completed

- ~~**#29 (core) Bootstrap + MCMC fit uncertainty**~~ (2026-07-02) —
  `calc/fit_bootstrap.py`: residual/pairs bootstrap over `curve_fit`
  (deterministic seed, failed-refit accounting, percentile CIs vs the
  asymptotic SEs; verified against analytic OLS SEs) + `fit_posterior`
  bridging fits into the ported `calc/mcmc.py` RW-Metropolis sampler
  (Gaussian likelihood at fit RMSE, flat priors in bounds, 68%
  intervals). `/api/fitting/{bootstrap,posterior}`. Corner-plot UI
  panel remains on the open item.
- ~~**#32 (backend) Integrate-only peak analysis**~~ (2026-07-02) —
  `calc/peak_integrate.py`: per-region net area (linear/none baseline),
  intensity-weighted centroid, height/position, interpolated FWHM,
  %-area deconvolution table; Gaussian-analytic verified (A·σ·√2π,
  FWHM 2.3548σ). `/api/peaks/integrate`. Wizard UI remains.
- ~~**#24 (core) Balanced two-way ANOVA + Tukey/Dunnett**~~
  (2026-07-01) — `calc/stats_anova2.py`: balanced factorial closed form
  (interaction dropped into error when n=1; unbalanced raises) verified
  against Montgomery's battery-life table (SS/df/F/p exact); Tukey HSD
  + Dunnett wrap scipy's exact implementations with CI rows.
  `routes/stats_design.py` (new router — routes/stats.py was at the
  ceiling): `/api/stats/{anova2,tukey,dunnett,recommend}`.
- ~~**#26 (logic) Test chooser decision tree**~~ (2026-07-01) —
  `stats_tests.recommend_test`: per-group Shapiro (differences for
  paired) + Brown-Forsythe -> parametric/nonparametric recommendation
  with endpoint + reasons; UI front door remains open on #26.
- ~~**#27 (complete) Stepwise model selection**~~ (2026-07-01) —
  `stats_multivar.stepwise_regression`: forward/backward/both over
  `multiple_regression`, AIC/BIC (RSS form), full search history,
  refitted final model; `/api/stats/stepwise`. With the 2026-07-01 core
  (MLR + correlations), #27 is now fully closed.
- ~~**#28 Distribution fitting + power analysis**~~ (2026-07-01) —
  `calc/stats_dist.py`: MLE fits for normal/lognormal/weibull/gamma/
  exponential (positive families loc=0, 2-param convention) + KS GOF
  (approximate-p flagged) + AIC ranking with explicit `skipped` reasons;
  exact noncentral-t power + required-n solver (no statsmodels needed) —
  verified against Cohen/G*Power published values (two-sample d=0.5 →
  n=64, power 0.8015; one-sample → n=34). `/api/stats/{fit-distribution,
  power}` routes.
- ~~**#18 RSM line cuts (full linescan layer)**~~ (2026-07-01) —
  `calc/linecut.py` ports + extends MATLAB `extract2DLineCut.m`:
  H/V cuts (width=0 = MATLAB's nearest-line; width>0 averages a swath),
  arbitrary segment cuts (any angle, distance-parametrized, optional
  perpendicular averaging), integrated projections (Σframes matches
  MATLAB's integrated fallback), all in angular OR Q space, all
  returning library-ready 1-D DataStructs. 3 thin `/api/rsm/*` routes.
  UI: map-toolbar cut tools (─ │ ∕ Σx Σy + width field, drag preview
  line) via `Stage/useMapCuts` + pure `lib/mapcuts` (unit-tested);
  jsdom can't drive the canvas, so the gesture math is logic-tested and
  the interaction needs a human eyeball (same caveat as the region
  tool). E2E verified on the real PIXcel3D area file through the API.
- ~~**#27 (core) Multiple regression + correlation matrices**~~
  (2026-07-01) — `calc/stats_multivar.py`: `multiple_regression`
  (intercept + k predictors, SE/t/p/CI/R²/F, listwise NaN deletion;
  single-predictor case verified against the golden `lin_regress`),
  `correlation_matrix` (Pearson/Spearman + t-transform p, matches
  scipy.stats oracles), `partial_correlation` (precision-matrix,
  matches the 3-var closed form). 3 thin `/api/stats/*` routes +
  tests. Model-selection remainder re-scoped as the open #27.
- ~~**#48 Column modeling types**~~ (2026-07-01) — `lib/modeling.ts`
  (conservative inference: nominal only for few-distinct level-like
  columns, ordinal manual-only; `channelModelingType` = override ??
  inference) + `Dataset.channelTypes` overrides (persist, `.dwk`
  round-trip with validation, survive duplicate, macro-recorded) +
  Channels-card per-channel type select showing the inferred value as
  `auto·C/O/N`. Substrate for #20/#49/#51.
- ~~**#54 Column switcher**~~ (2026-07-01) — `workshops/switcher/`
  ToolWindow (◀ ▶ wrap-stepping + dropdown + Show all) over a new
  store `soloChannel` action (hides all other *plotted* channels via
  the legend's `hiddenChannels`; respects x-key/roles/order;
  store-tested). Command palette: "Column switcher…" (View).
- ~~**#25 Nonparametric family**~~ (2026-07-01) — `calc/stats_tests.py`
  (Mann-Whitney U, Wilcoxon signed-rank, Kruskal-Wallis, Friedman, sign
  test — plus the #26 wrappers: Shapiro-Wilk, Anderson-Darling,
  Levene/Brown-Forsythe, KS one-/two-sample) + 10 thin
  `/api/stats/*` endpoints + hand-derived exact-value tests
  (`test_calc_stats_tests.py`) + API round-trips. scipy only (BSD).
