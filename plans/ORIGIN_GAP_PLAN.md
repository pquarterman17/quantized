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
**Updated:** 2026-07-07 (SEVENTEEN items closed today: #36, #26, #31,
#32, #6, #7, #2, #3, #1, #4, #5, #11, #12, #15, #13, #14, #16. **W1, W2
Tier 1, W3 (all), W5 Tier 1, W6 headline, and W7 are complete.**)

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

Status key: ✅ done · 🟡 backend done, frontend/UI remains · ⬜ open.

| # | Item | Workstream | Status / why |
|---|------|------------|-----------|
| 31 | Peak Analyzer wizard | W6 | ✅ COMPLETE 2026-07-07 — 5-step workshop + recipes + #36 report ending (and #32's integrate-only UI path) |
| 24–26 | ANOVA/post-hoc + nonparametric + assumption tests | W5 | ✅ COMPLETE — backend 2026-07-03; #26 Test chooser workshop UI 2026-07-07 |
| 6–7 | Pipeline view + expression steps | W2 | ✅ COMPLETE 2026-07-07 — typed step contract + editable/runnable workshop + validated expression steps |
| 1–5 | Recalc engine + templates + batch (W1) | W1 | ✅ COMPLETE 2026-07-07 — recalc DAG + staleness + workspace v3 + templates + batch ALL shipped; W1 done |
| 36–37 | Report sheets + docx/pptx export | W7 | ✅ COMPLETE — schema + emitters + exports 2026-07-03; viewer + Library section + .dwk round-trip 2026-07-07 |
| 11–15 | Property panels + figure docs + direct manipulation | W3 | ✅ **W3 COMPLETE 2026-07-07** — #11/#12/#13/#14/#15 all shipped (defaults audit = eyeball residual) |
| 40 | Generic import wizard + saved filters | W8 | 🟡 preview/parse engine + `/api/import/*` landed 2026-07-03; filter persistence + wizard UI remain |
| 41 | Packaging & installers | W8 | ⬜ zero-friction first run gates all OSS adoption |
| 46–47 | Test-data corpus + PIXcel3D audit | W8 | ✅ mostly done; only pole-figure representation open |
| 49–50 | Drag-to-axis + row states | W9 | 🟡 #50 row-state model SHIPPED in full (foundation + cross-view + selection + guard #11, 2026-07-03; index-staleness fixes 2026-07-05 `4113104`) — #49 drag-to-axis still open |

Also landed 2026-07-03 (beyond the table): #16 statistical-plot math + export,
#17 contour export, #19 3-D export, #35 batch peak integration, #9 headless
public API, **#42 Bruker `.raw`/`.brml` parsers**, and **#43 JCAMP-DX + NetCDF
import** (both formats done). The #50 row-state stack cores also shipped
2026-07-03: **#52 Distribution**, **#53 local data filter**, **#55 Tabulate**
(each keeps a "Remaining" note in its W9 item body — those notes, not this
table, are the live status). The parser workstream (W8 #42/#43) is now
complete for the targeted formats — remaining open work is overwhelmingly
frontend (needs UX direction).

---

## W1 — Recalculation engine & analysis templates

### Tier 1 — High Impact

~~1. **Recalc dependency graph**~~ **CLOSED 2026-07-07** — see
Completed. (Scope notes booked deliberately: figure documents join the
graph as `fig:` nodes when #12 lands; reports are immutable artifacts
by design and never recalc; the graph is DERIVED from live state on
every query, never persisted — so it cannot drift.)

~~2. **Analysis templates**~~ **CLOSED 2026-07-07** — see Completed.

~~3. **Batch-run templates with summary sheet**~~ **CLOSED 2026-07-07**
— see Completed. (Deliberate deviation from the item's pickup note: the
batch runs CLIENT-SIDE through the shared step executor — pipeline
steps replay store actions, which live in the frontend; the routes/jobs
queue stays the home for pure-calc batches like `calc/batch_fit`.)

### Tier 2 — Medium Impact

~~4. **Staleness indicators**~~ **CLOSED 2026-07-07** — see Completed
(amber dot on DatasetRow, click-to-recalc, command palette entries).

~~5. **Workspace format v2**~~ **CLOSED 2026-07-07** — shipped as .dwk
**v3** (v2 was already taken by the folder tree): typed pipeline steps,
recalc mode, and per-dataset fit specs round-trip with v1/v2 migration.
Figure documents extend it when #12 lands. See Completed.

---

## W2 — Pipelines, custom steps & plugin API

### Tier 1 — High Impact

~~6. **Editable pipeline view**~~ **CLOSED 2026-07-07** — see Completed.
(The one caveat found during the build: the plan's pickup line was
optimistic — `macroSteps` were {label, code} STRINGS, not structured;
the typed contract had to be built first, and now lives in
`lib/pipeline.ts`. "Run against a picked file" = activate it first;
file-slot binding lands with #2 templates.)

~~7. **No-code expression steps**~~ **CLOSED 2026-07-07** — see
Completed. (The cross-file template replay half of the acceptance runs
when #2 lands; the step type, author-time validation, and replay on the
active dataset all shipped.)

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

~~11. **Complete property panels**~~ **CLOSED 2026-07-07** — see
Completed. (Residual booked deliberately, NOT a gap in the mechanics:
the beautiful-defaults audit — reviewing un-tweaked first renders of
real M-H / XRD / R(Q) / RSM figures against published APS/Nature
figures — needs a human eyeball + the visual harness; the panels,
overrides object, and preset plumbing are all in place for it.)

~~12. **Figures as live documents**~~ **CLOSED 2026-07-07** — see
Completed. (The Library "Figures" acceptance criterion — open / rename
/ duplicate / delete / export — shipped with rename available through
the store action; the row UI exposes open/duplicate/delete, export
happens in the re-opened builder.)

### Tier 2 — Medium Impact

~~13. **Click-to-select on the preview**~~ **CLOSED 2026-07-07** — see
Completed.

~~14. **In-place editing**~~ **CLOSED 2026-07-07** — see Completed.
(Inline text editing + legend/annotation drag shipped; every commit
routes through #11's config object, never a parallel path.)

~~15. **User graph templates**~~ **CLOSED 2026-07-07** — see Completed
(save/apply/delete in the builder; persisted like peak recipes).

---

## W4 — Plot types

### Tier 1 — High Impact

~~16. **Statistical plots**~~ **CLOSED 2026-07-07** — see Completed
(box/whisker, grouped box, violin, Q-Q, histogram+fit; interactive
`StatStage.tsx` Canvas2D stage + matplotlib export, both off
`calc/statplots.py`).

17. **Filled + labeled contour** — proper contourf/contour with labels,
    including tri-contour on scattered (RSM) data; interactive + export
    *Model: sonnet. EXPORT SHIPPED 2026-07-03 (see Completed):
    `figure_map.render_map_figure` contourf/contour (inline labels,
    lin/log/explicit levels) + `/api/export/map-figure`. Remaining: the
    INTERACTIVE contour layer (d3-contour over gridded MapData in
    `MapStage.tsx`, level controls in the Inspector 2-D card) and
    tri-contour on raw scattered points (export currently contours the
    regridded MapData).*

### Tier 2 — Medium Impact

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
    - [x] Unbalanced designs (Type II/III sums, pure-numpy effect-coded
          nested-model regression — no statsmodels dep;
          `stats_anova_ext.anova2_unbalanced` + `/api/stats/anova2-unbalanced`;
          balanced-equivalence anchored on the golden closed form) (2026-07-03)
    - [x] Bonferroni / Holm / Benjamini-Hochberg p-adjustment helper
          (`stats_anova2.adjust_pvalues` + `/api/stats/adjust-p`,
          textbook-case tested) (2026-07-02)
    - [x] Repeated-measures ANOVA (`stats_anova_ext.repeated_measures_anova`
          + `/api/stats/anova-rm`; Greenhouse-Geisser/Huynh-Feldt sphericity;
          cross-checked exactly vs the two-way-n=1 identity) (2026-07-03)
    - [x] Long-format *input* helpers (`long_to_groups`/`long_to_cells`
          reshape value+factor worksheet columns) (2026-07-03); report-sheet
          *output* still pending #36

~~26. **Assumption tests + guided chooser**~~ **CLOSED 2026-07-07** —
see Completed. Wrappers + decision tree (2026-07-01) and the Test
chooser workshop front door (2026-07-07) all shipped.

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

~~31. **Peak Analyzer wizard**~~ **CLOSED 2026-07-07** — see Completed.
All five stepper pages, recipe save/re-run, and the #36 report ending
shipped. (Known limitation, booked deliberately: step ② adds/removes
peaks via the table + an "add at x" field — direct click-on-plot marker
editing waits for the #33 gadget's plot-interaction plumbing.)

~~32. **Integrate-only workflow**~~ **CLOSED 2026-07-07** — backend
2026-07-02; the UI half shipped as wizard page ⑤'s alternate path
(regions auto-derived from found/fitted peaks at ×FWHM width,
`/api/peaks/integrate`, → #36 integrate report). See Completed.

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

---

## W7 — Reporting & office integration

### Tier 1 — High Impact

~~36. **Structured report sheets**~~ **CLOSED 2026-07-07** — see
Completed. Schema + emitters (2026-07-03) and the frontend viewer +
`.dwk` round-trip (2026-07-07) all shipped.

*(Remaining W7 follow-on, tracked on the consuming items: wiring
`calc/figure.render_figure` output into report emitters as embedded
figure blocks — lands naturally with the #31 wizard's report page.)*

---

## W8 — Import, ecosystem & distribution

### Tier 1 — High Impact

40. **Generic import wizard + saved filters** — interactive
    delimiter/skip/header/units mapping with live preview for arbitrary
    instrument ASCII; save as a named import filter bound to an
    extension/pattern (persisted like registry sniffers)
    *Model: sonnet. Pickup: `io/delimited.py` + `io/base.py`
    (parse_col_header/resolve_column) do the detection.*
    - [x] Preview engine + routes (`io/import_preview.py`: `guess_settings`
          / `preview_import` / `parse_import` over absolute line indices,
          reusing the `delimited` detectors; `/api/import/{guess,preview,
          parse}`) — re-previews under adjustable `ImportSettings`
          (delimiter / header / units / data-start / names) (2026-07-03)
    - [x] Column mapping: name, unit, role (x/y/error/label/ignore —
          `ImportSettings.roles`, x→axis, y/error→channels, label/ignore
          dropped) (2026-07-03)
    - [ ] ImportFilter persistence (name, glob pattern, all settings);
          registry consults saved filters before content sniffers
          (`ImportSettings` IS the serializable filter shape; the
          persistence store + registry hook + the wizard UI remain)
    - [x] Acceptance (backend): a messy 3-comment-line, header+units-row
          instrument ASCII imports correctly through `guess→preview→parse`
          (test_io_import_preview); the saved-filter one-click needs the
          persistence half above

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
    *FOUNDATION SHIPPED 2026-07-03: the persistent EXCLUSION dimension —
    `Dataset.excludedRows` + pure `lib/rowstate` (excludedSet /
    toggleExcluded / activeRowIndices / pruneExcluded / analysisData /
    sanitizeExcluded) + store actions (toggle/set/clear) + worksheet wired
    to it (durable, dataset-scoped, replaces the transient local mask) +
    .dwk round-trip. Consumers honoring it: Tabulate (#55), Distribution
    (#52), the local filter (#53) — all via analysisData.*
    *CROSS-VIEW SHIPPED 2026-07-03: the plot + curve fit now honor exclusion
    (and the filter). Preferences ▸ Plot ▸ "Excluded rows" toggles Hide
    (default — dropped rows nulled to gaps) vs Grey (drawn as muted
    companion markers); `excludedDisplay` pref, persisted. The plot x stays
    full-length (`maskExcludedPayload` nulls/ghosts rows) so overlays/
    error-bars/waterfall stay aligned; CurveFit fits `analysisData` and
    expands its overlay via `expandToFull`. Peaks (detect/fit on analysisData,
    marker overlay on full time) and hysteresis (scalar Hc/Mr/Ms on
    analysisData) now honor exclusion too (2026-07-03). Remaining: (a) the
    SELECTION dimension is SHIPPED (2026-07-03): worksheet row selection
    (row-number click / shift-range, tinted rows) + bulk actions (Exclude /
    Keep only / Deselect) AND the plot rubber-band (a "select" tool drags an
    x-band → rowsInXRange maps to the shared store `selection` {datasetId,
    rows} → same rows light up in the worksheet + selected points glow on the
    plot). (b) baseline (a full-curve correction — needs
    estimate-on-subset / evaluate-at-full) and RSM (2-D) intentionally still
    fit the full data; (c) the universal-linking architecture guard/test is
    SHIPPED (2026-07-03, guard #11 + `frontend/src/architecture.test.ts`).*
    - [x] **Universal-linking rule** (SHIPPED 2026-07-03) — architecture
          guard #11 in `architecture-guards.md` + `frontend/src/architecture.test.ts`:
          `Dataset.excludedRows` is touched only by `lib/rowstate` /
          `lib/workspace` / `store/useApp`, `filteredOutRows` only by the
          sanctioned modules, and any new analysis view must read rows via
          `rowstate.analysisData`. Extending the allowlist is the review
          checkpoint. Every later view (#51–55, gadgets) complies from birth.

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
    *CORE SHIPPED 2026-07-03: Distribution ToolWindow
    (`workshops/distribution`) — pick a column → DOM-bar histogram +
    descriptive stats + Shapiro-Wilk normality verdict, composed over
    `/api/statplots/histogram` + `/api/stats/descriptive` +
    `/api/stats/shapiro` via `Promise.allSettled` (Shapiro n-range failure
    degrades gracefully). Honors row exclusion (#50) via
    `rowstate.analysisData`. Remaining: box/quantile strip, optional
    distribution-fit overlay (#28), and #50 selection-brushing to
    highlight rows from a histogram-bar pick.*

53. **Local data filter** — sidebar widget: per-column checkboxes
    (nominal) or range sliders (continuous) that live-filter every
    linked view without mutating the dataset
    *Model: sonnet. Pickup: emits a derived row mask through #50's
    row-state model; filter definition is serializable (a future
    pipeline step, #6).*
    *CORE SHIPPED 2026-07-03: Data Filter ToolWindow
    (`workshops/datafilter`) — a min/max range per continuous column and a
    level checklist per categorical column. The filter is a serializable
    `Dataset.filter` (pure `lib/datafilter`) folded into
    `rowstate.analysisData` alongside manual exclusions (#50), so every
    analysisData consumer (Tabulate + Distribution today) honors it through
    the single chokepoint. Round-trips .dwk with column validation.
    Remaining: dual-thumb range sliders (min/max NumberFields today); the
    WORKSHEET doesn't reflect the global filter (it greys exclusions only —
    the plot DOES mask/ghost filter-failed rows: `rowstate.droppedRows` =
    exclusion ∪ filter, applied via `maskExcludedPayload` in PlotStage
    since the #50 cross-view pass; reconciled 2026-07-07).*

### Tier 3 — Nice-to-Have

55. **Tabulate (drag-drop pivot)** — drag columns into row/column/value
    wells to build group summary tables (mean/sd/count by category),
    exportable as a dataset or report block (#36)
    *Model: sonnet. Pickup: group-by math is `descriptive_stats` per
    partition (pure calc); the well UI reuses #51's drop-zone
    components.*
    *CORE SHIPPED 2026-07-03: Tabulate ToolWindow (`workshops/tabulate`) —
    pure `lib/tabulate` group-by (count/mean/sd/min/max/median), select-
    based group/value column pickers (defaults to the first categorical
    column via `lib/modeling`), a summary table, and export → new dataset
    + copy TSV. Honors row exclusion (#50) via `rowstate.analysisData`.
    Remaining: drag-drop wells (needs #51's drop zones) and report-block
    export (#36).*

---

## Completed

- ~~**#16 Statistical plots**~~ (2026-07-07) — the interactive half
  (calc + export shipped 2026-07-03): `Stage/StatStage.tsx` Canvas2D
  stage (the `PolarStage.tsx` precedent) over box/violin/Q-Q/
  histogram+fit, entered via a `statMode` store boolean + `▦` toolbar
  toggle (mirrors `polarMode`/`stackMode`) — see
  `plans/GAP_PLOTTYPES_PLAN.md` item 2's Completed entry for the full
  breakdown (grouping reuse, offline fallbacks, export wiring). All 4
  modes render on one Canvas2D stage (a deliberate scope call, not the
  originally-sketched uPlot split for Q-Q/histogram).
- ~~**#13 Click-to-select + #14 in-place editing**~~ (2026-07-07) —
  `calc/figure.render_figure_map` + `/api/export/figure-hitmap`: the
  preview PNG plus per-artist pixel boxes (title/labels/legend/series/
  annotations; window extents flipped to top-left image coords) and
  the axes rect with data limits. The builder preview became
  `PreviewOverlay` (percentage-positioned hit boxes — scale-free):
  hover outline, click focuses the matching #11 panel group,
  double-click edits title/axis labels inline (Enter/blur commit,
  Esc cancels), drag the legend → new `custom` legend loc with a
  figure-fraction anchor (transFigure bbox), drag an annotation → new
  data coords (`lib/previewmap.pxToData`, log-aware). All commits ride
  the ONE overrides object. jsdom pointer-capture guarded; the real
  drag gesture needs the usual visual-harness eyeball. Backend 49
  figure/export tests + frontend 1072 green.
- ~~**#12 Figures as live documents + #15 user graph templates**~~
  (2026-07-07) — `lib/figuredoc.ts`: FigureDoc = id/name + dataset ref
  (by id, clamped on load like reports) + the FULL builder config
  (channels/scales/labels, #11 overrides, preset/fmt/dpi) + live-vs-
  frozen flag (frozen docs carry a data snapshot and render without
  their dataset). Store slice (add/remove/rename/duplicate/open) with
  dataset-removal ref-nulling; opening activates the dataset and seeds
  the builder via `figureDocSeed` — the builder restores the config
  WITHOUT touching live plot state, renders current data for live docs
  (recalc-fresh, the #1 acceptance path) or the snapshot for frozen.
  Library "Saved figures" section (◉ live / ❄ frozen). Round-trips
  .dwk v3. #15: GraphTemplate = the style half (preset + overrides +
  series styles), save/apply/delete in the builder, localStorage like
  peak recipes. Frontend 1062 green.
- ~~**#11 Complete property panels**~~ (2026-07-07) —
  `calc/figure.render_figure` gained the ONE `overrides` config object
  (validated in calc, pydantic-free, unknown keys ignored): fonts
  (base/title size + family), legend (show/frame/position incl.
  `outside right`/`outside top` via bbox anchors), ticks
  (dir/len/minor), spines, half-open x/y limits, margins (figure
  fractions; replace tight_layout when set), grid, and text
  annotations — passed through `/api/export/figure`. The figure
  builder grew collapsible panels (Text & fonts · Axes & ticks ·
  Legend · Canvas · Annotations; per-series was already the WYSIWYG
  series_styles passthrough) writing that one object
  (`lib/figureOverrides.compactOverrides` strips untouched values so
  presets rule by default); the live preview re-renders on every edit.
  Acceptance mechanics hold (every override kwarg panel-reachable and
  every panel field lands as a kwarg); the beautiful-defaults EYEBALL
  audit vs published figures is the booked residual on the item.
  Backend 47 figure/export tests + frontend suite green.
- ~~**#1 Recalc dependency graph + #4 staleness + #5 workspace v3**~~
  (2026-07-07) — `lib/recalc.ts` derives the DAG from live state (bgRef
  chains → dependent-correction nodes, breadth-first + cycle-safe;
  `Dataset.fitSpec` → fit nodes; computed columns already recompute
  inline). All five data mutators feed `touchDataset`; auto mode
  debounces bursts into one topological pass (corrections re-derive
  before fits; the shown fit overlay refreshes in place); manual mode
  flips staleness only — the #4 amber dot on DatasetRow (click =
  recalc now) + command palette "Recalculate now" / mode cycler; off
  mode is inert. An in-progress guard keeps the recalc's own writes
  from re-marking (no feedback loops). CurveFit records the durable
  fitSpec (cleared on Clear). #5 shipped as **.dwk v3**: typed pipeline
  steps (sanitized on load, fresh ids), recalcMode, and fitSpec
  round-trip; v1/v2 docs migrate with safe defaults. Acceptance held in
  store tests: cell-edit burst → ONE debounced dependent-fit re-run
  (auto) / staleness only (manual); failing fits stay stale. Frontend
  1050 green.
- ~~**#2 Analysis templates + #3 batch-run with summary sheet**~~
  (2026-07-07) — `lib/template.ts`: a template = version tag + the
  ordered typed steps + declared outputs (auto-derived: last fit step's
  registry param names + R2); pretty key-stable JSON (diffs cleanly),
  localStorage persistence (upsert by name) + standalone .qzt.json
  export/import. Pipeline workshop grew a Templates section:
  save-current / load-into-pipeline / batch-run over N picked files.
  The batch (shared `executeSteps`, extracted from the #6 runner)
  imports each file, replays the steps with per-step failure isolation,
  emits a per-file #36 curve-fit report, and lands ONE summary
  worksheet — row per file, columns = declared outputs, corrupt files
  flagged in metadata.failures as NaN rows (never a dead batch) — as a
  normal plottable library dataset. Acceptance held in tests: 3-file
  batch with a deliberately corrupt file → 2 reports + flagged summary
  row. Client-side-runner deviation documented on the item. Frontend
  1038 green.
- ~~**#6 Editable pipeline view + #7 expression steps**~~ (2026-07-07) —
  the typed step contract (`lib/pipeline.ts`: `PipelineStep` = kind +
  params + regenerable `code`; kinds ui / import / expression /
  correction / reset / fit) upgraded `macroSteps` in place — the SAME
  list drives the script export (MacroCard → `pipelineToScript`,
  disabled steps commented out) and the new `workshops/pipeline/`
  view: toggle / ↑↓ reorder / schema-driven param edit (fit model,
  expression name+expr with inline parse errors) / delete / insert /
  run-on-active with per-step ok/skip/fail markers and failure
  isolation; `pipelineRunning` suppresses self-recording during
  replay. Typed recording added at import / addFormula / corrections /
  reset sites, and the CurveFit workshop now records `fit` steps — so
  the acceptance holds: record corrections+fit, edit the model in the
  pipeline, re-run reproduces the edited analysis. Expression steps
  (#7) validate through the no-eval formula parser at author AND run
  time; the worksheet formula bar has recorded (now-typed) steps since
  it already routed through `addFormula`. Frontend 1030 green.
- ~~**#31 Peak Analyzer wizard + #32 integrate-only UI (complete)**~~
  (2026-07-07) — `workshops/peakwizard/` (command palette ▸ Analyze ▸
  "Peak Analyzer"): ① range & baseline (none/ALS/rolling-ball/modpoly,
  live subtract preview through the baseline overlay, mapped back to
  full plot rows via kept-index expansion) → ② find peaks (SNR/max
  knobs, include/exclude + remove per row, manual add-at-x; markers
  overlay) → ③ model & constraints (5 shapes, shared-FWHM linking, bg
  degree, window constraint) → ④ simultaneous fit + GOF verdict +
  per-peak table → ⑤ report: `multipeak_fit` report OR the #32
  integrate-only path (regions = center ± k·FWHM from found/fitted
  peaks → `/api/peaks/integrate` → `integrate` report). The whole
  configuration is a `PeakRecipe` (pure `lib/peakwizard`, localStorage
  persistence, upsert-by-name) that re-applies on any dataset —
  deliberately shaped as the future #6 pipeline step's params. Reads
  `rowstate.analysisData` (guard #11); every component <400 lines;
  frontend 1018 green. Deferred nicety: click-on-plot marker editing
  (waits for #33's plot-interaction plumbing).
- ~~**#26 Assumption tests + guided chooser (complete)**~~ (2026-07-07) —
  the UI front door: `workshops/statschooser/` ToolWindow (command
  palette ▸ Analyze ▸ "Test chooser"). Groups from picked columns or
  value-partitioned-by-category (pure `lib/statschooser`, reads
  `rowstate.analysisData` per guard #11), paired toggle (gated on 2
  equal-length groups), `/api/stats/recommend` verdict + plain-language
  reasons, one-click run of the recommended test (allowlisted endpoint
  dispatch — ttest/wilcoxon/mann-whitney/anova/kruskal), scalar result
  table, and "→ Report" through the #36 stats_table emitter with the
  reasons as the caption. Frontend 1005 green.
- ~~**#36 Structured report sheets (complete)**~~ (2026-07-07) — the
  frontend half: `/api/report/emit` (thin route over the pure
  `calc/report_emit` emitters — one emission source of truth, the
  frontend never re-shapes results), `lib/report.ts` (TS schema types +
  sanitizers), a `reports` store slice (add opens the viewer;
  dataset-ref pruning mirrors Origin figures; removeAll clears),
  `.dwk` round-trip via `lib/workspace` with validating load, a Library
  "Reports" section, and the block-rendering viewer ToolWindow
  (`workshops/report/ReportPanel` — text/table/params/figure blocks,
  collapsible sections, HTML/LaTeX/docx/pptx export buttons). Producers:
  "→ Report" in the Curve Fit + Peaks workshops. Acceptance held: the
  SAME schema renders in the viewer and through the #37/#38 exporters
  with no per-renderer special cases. Backend 1738 + frontend 994 green.
- ~~**#44 `.opj` reader as an isolated dev-time CLI converter**~~
  (2026-07-03) — superseded by the owner's decision to build a
  clean-room, GPL-free **in-app** Origin reader instead (no external
  liborigin tool). M1 (`.opj` worksheet data) shipped `e520298`; the
  full effort (names/units, `.opju`, figures) is now its own plan:
  `plans/ORIGIN_FILE_DECODE_PLAN.md`. No separate converter will be
  built.
- ~~**#42 Bruker XRD 1-D parsers**~~ (2026-07-03) — `io/bruker_raw.py`
  (Diffrac-AT RAW1.01 binary; byte layout reverse-engineered + cross-checked
  against xylib's UXD export — the variable supplementary-header offset is the
  trap a one-file test misses) and `io/bruker_brml.py` (ZIP-of-XML; 1-D line
  scans decode, multi-scan RSMs raise cleanly). Both appended to the single
  registry (`.raw` magic `RAW1.01` vs Rigaku `FI` — no collision; `.brml`
  direct). Sample files sourced into `../test-data/bruker/xrd/` (Apache-2.0
  `.brml`, LGPL-2.1 `.raw`). Synthetic-builder CI tests + realdata golden
  values (BT86 n=2374 first5=[187,183,178,174,193]).
- ~~**#43 JCAMP-DX and NetCDF import**~~ (2026-07-03) — **JCAMP-DX:**
  `io/jcamp.py` + `io/_jcamp_asdf.py` (the SQZ/DIF/DUP ASDF decoder, incl.
  DUP-after-DIF difference re-application and cross-line Y-value checks); reads
  `(X++(Y..Y))` XYDATA and `(XY..XY)` XYPOINTS/PEAK TABLE; `.jdx`/`.dx`
  registered. 10-file MIT corpus in `../test-data/jcamp/` (Coblentz IR + the
  Lancashire compression-form suite); tests hand-encode each form to known
  values and use JCAMP's own NPOINTS/FIRSTY fields as the realdata oracle.
  **NetCDF:** `io/netcdf.py` — a scipy(NetCDF-3)/h5py(NetCDF-4) reader (no new
  deps) + an interpreter recognizing ANDI/AIA chromatography (TIC or single
  detector) with a generic "monotonic coordinate = x" fallback; `.nc`/`.cdf`
  registered. Synthetic ANDI/AIA fixtures generated into
  `../test-data/synthetic/netcdf/`. CI builds NetCDF files in tmp_path (both
  formats), realdata decodes the corpus.
- ~~**#9 Documented headless public API**~~ (2026-07-03) — `quantized/api.py`
  is the blessed, frozen surface (`import quantized.api as qz`): ~65 curated
  pure functions (load, fitting, peaks, baseline, corrections, the full W5
  stats suite, statplots, reporting, and matplotlib export) with a worked
  docstring example. `__init__` stays light (no matplotlib at package import;
  the server never imports the surface). `tests/test_public_api.py` freezes
  the name set (rename/removal fails on purpose) and runs an end-to-end
  headless pipeline (detect → integrate → fit → report → LaTeX/HTML/PDF).
- ~~**#35 Batch peak integration**~~ (2026-07-03) — `calc/peak_batch.py`
  `batch_integrate_peaks` loops `integrate_peaks` over a spectra series on a
  shared x-axis, with optional cross-correlation alignment
  (`calc/spectral.cross_correlation` sample lag → edge-filled shift, verified
  to recover a known shift). Emits per-spectrum results + area/centroid/FWHM
  matrices (spectrum × region) for trend plotting; a failing spectrum yields a
  flagged NaN row, never a dead batch. `/api/peaks/integrate-batch` route.
- ~~**#19 3-D static export**~~ (2026-07-03) — `calc/figure_map.py`
  `render_map_figure` adds mplot3d surface / 3-D scatter / waterfall over the
  gridded MapData (plus 2-D heatmap), sharing `render_figure`'s style/format
  presets; `/api/export/map-figure` route (PDF/SVG/PNG/TIFF). Interactive 3-D
  stays deferred to #22.
- ~~**#17 (export) Filled + labeled contour**~~ (2026-07-03) —
  `render_map_figure` contourf + line contour with inline `clabel` labels;
  `_contour_levels` gives count / explicit / lin / log spacing (log floors a
  non-positive z-min off z-max). Same `/api/export/map-figure` route. The
  interactive d3-contour layer + tri-contour on raw scattered points remain
  open on #17.
- ~~**#37 Word + PowerPoint export**~~ (2026-07-03) — `io/report_export.py`
  `to`-renderers over the #36 schema; `.docx` (python-docx) with real tables
  + `.pptx` (python-pptx) one-slide-per-section, both embedding raster figure
  blocks via `add_picture` (SVG/other → text placeholder). MIT deps are an
  optional `office` extra (guarded imports; core install stays lean, LaTeX/
  HTML always work) + in the dev group so CI exercises them. Thin
  `/api/report/export` route (format param → attachment).
- ~~**#38 LaTeX table export**~~ (2026-07-03) — `report_export.to_latex`:
  booktabs tables for params + stats, `value ± error` rounded to the
  uncertainty's 2 sig figs (`format_value_error`), science-glyph→macro map so
  it compiles under plain pdfLaTeX (no inputenc). Same renderer-over-schema
  path as #37/#39.
- ~~**#39 HTML report export**~~ (2026-07-03) — `report_export.to_html`:
  self-contained styled page (inline CSS, escaped, data-URI figure images);
  the third renderer proving one #36 schema → many formats, no special cases.
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
