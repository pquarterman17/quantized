# What's missing to make quantized my go-to (vs OriginPro)

A curated, workflow-centric view of the capability gaps that would still
send the owner back to OriginPro on a normal research day — plus the
decision questions that turn this draft into a prioritized plan. This is
deliberately NOT a feature-parity checklist; parity work lives in
`PORT_CHECKLIST.md` and the GAP_* plans.

**Status:** Survey reference — owner answered questions 1, 2, 3, 5 on
2026-07-10; the decided work is tracked in `plans/GOTO_PLAN.md` (this file
stays as the survey evidence + the open questions). Still open: questions
4 (3-D), 6 (reshape), 7 (date-time axes), 8 (signal-processing non-goal),
9 (switch-trigger project), plus the **bumps engine discussion** (below).
**Created:** 2026-07-10
**Updated:** 2026-07-10

---

## 1. How I surveyed

Static inspection (no GUI launch, no COM) of **OriginPro 2026b**
(registry `Origin 10.3b`, `C:\Program Files\OriginLab\Origin2026b`):
305 built-in `.fdf` fit functions (categories per `NLSF.ini`), 799
X-Functions across 16 category folders (Data Manipulation 154,
Statistics 96, Import/Export 71, Plotting 59, Graph Manipulation 51,
Fitting 40, Mathematics 39, Signal Processing 30, Spectroscopy 18…),
Themes/Templates/Samples trees, and the user-files dir. Cross-checked
against quantized's `PORT_CHECKLIST.md`, `BACKLOG.md`, the GAP_* plans'
Completed sections, and the frontend command registry.

**Highest-signal finding: the owner runs Origin essentially stock.**
`User Files` has zero custom fit functions, zero custom templates, zero
installed Apps, an untouched `Custom.ogs`. Real projects in the history:
`Magnetometry_YIG-Co-Py.opj`, `PNR.opj`, `XRD.opj` (+ `XAS.opju` in the
test corpus) — exactly quantized's domain. The go-to bar is therefore
**core workflows done extremely well**, not Origin's long tail.

## 2. Where quantized already beats Origin

- **Reproducibility**: macro → editable pipeline → templates → batch
  with summary sheet; recalc DAG + staleness; every analysis emits a
  diffable script. Origin's recalc locks are opaque binary state.
- **Linked exploration**: JMP-class row-state (select/exclude/filter
  linked across plot/worksheet/fits/stats). Origin has nothing here.
- **Domain depth**: Parratt reflectivity, RSM strain/line-cuts,
  hysteresis analysis, Langevin/Brillouin/Stoner-Wohlfarth/VFT models,
  16 materials calculator domains. Origin can plot PPMS data; it
  doesn't understand it.
- **Instrument import**: QD VSM/PPMS/MPMS, NCNR, Lake Shore, XRDML RSM
  (beyond MATLAB), Bruker, JCAMP, NetCDF + a guided import wizard with
  saved filters.
- **Origin's own files**: reads `.opj`/`.opju` (data + figures) and
  writes `.opj` that real Origin loads — cross-platform, GPL-free.
- **Modern statistics**: bootstrap CIs, MCMC posteriors + corner plots,
  guided test chooser, GLM/survival/ROC; report sheets → LaTeX/docx/pptx.
- **Free, cross-platform, headless API, plugin-extensible.**

## 3. Gap themes

### T1 — Custom fit functions with no code (S–M)
- **Origin:** 305 built-ins + the Fitting Function Builder — type
  `y = f(x, p…)`, save it, reuse it forever. This is why stock-Origin
  users never feel a model gap.
- **quantized:** 29 golden registry models + hysteresis/surface
  specials. The no-eval equation parser (`calc/fit_equation.py`) and
  constraints engine already exist in the pure layer — but **no UI or
  route lets you type, fit, save, and reuse a custom equation**. The
  Python plugin API covers coders, not the no-code path.
- **Daily pain:** the first time a needed model isn't in the registry
  (Cole-Cole, BWF, Doniach-Šunjić, a diode IV, tomorrow's paper's toy
  model), the daily-driver story breaks and Origin wins by default.
- **Note:** most of Origin's 305 are life-science (enzyme kinetics,
  pharmacology, dose-response) — breadth itself is NOT the gap; the
  builder is. A "fit all plausible models, rank by AICc" quick-scan
  (Origin's `funcRank`) would piggyback on the same work.

### T2 — Spectroscopy baseline gestures: anchor points + Shirley (S–M)
- **Origin:** Peak Analyzer's user-picked **anchor points** with an
  interpolated baseline through them (the single most-used PA gesture),
  plus XPS-specific backgrounds (`pa_xpsbase` — Shirley/Tougaard).
- **quantized:** ALS, rolling-ball, ModPoly, SNIP, fit-from-region —
  strong *automatic* baselines, but no click-N-anchors → spline/pchip
  baseline, and no Shirley.
- **Daily pain:** XAS/XPS/Raman work (`XAS.opju` is in the corpus).
  Auto baselines are great until they aren't; the anchor gesture is the
  manual override every spectroscopist reaches for.

### T3 — Composed multi-graph figure pages (M–L)
- **Origin:** Merge Graphs / layout pages — arrange N independent
  graphs into one exported page: the actual "Figure 1(a)–(d)" workflow.
- **quantized:** MDI plot windows on screen; facet export and stacked
  panels of ONE dataset's channels; figure docs export one plot each.
  No way to compose *different* plots (an M-H loop + an XRD scan + an
  R(Q) fit) onto one publication page.
- **Daily pain:** at paper-writing time this pushes the final
  assembly into Illustrator/Inkscape — exactly the "post-process the
  export" outcome the W3 pillar forbids.

### T4 — Publication typography: sub/superscript + math in labels (S–M)
- **Origin:** rich-text escapes everywhere — `\+(2)`, Greek, italics —
  in axis titles, legends, annotations.
- **quantized:** plain strings on-screen (uPlot) and in export.
  matplotlib would render `$\mu_0H$` mathtext in exports, but nothing
  surfaces, documents, or previews that; no symbol palette; on-screen
  and export don't match.
- **Daily pain:** every magnetometry/transport axis is µ₀H (T),
  M (10⁵ A m⁻¹), χ″, Å⁻¹. Unicode gets partway today (undocumented);
  "journal-ready with zero post-processing" needs this to be a
  first-class, WYSIWYG-consistent feature.

### T5 — Worksheet reshape operations (M)
- **Origin:** 154 Data Manipulation X-Functions; the ones that matter
  here: stack/unstack (wide↔long), split by column values, join
  worksheets by key, dedup.
- **quantized:** sort, filter, formula columns, Tabulate (pivot),
  extract, merge selected, dataset math. No long↔wide reshape, no
  join-by-key.
- **Daily pain:** moderate — temperature-series and multi-sample
  spreadsheets occasionally need reshaping before plotting; today
  that's a round-trip through Excel/pandas.

### T6 — Interactive 3-D (deferred; decision needed) (L)
- **Origin:** rotatable 3-D surface/scatter, pole-figure 3-D views.
- **quantized:** 2-D map stage + line cuts + static matplotlib 3-D
  export (surface/scatter/waterfall). WebGL 3-D is a deliberate
  deferral (ORIGIN_GAP #22) pending demand.
- **Daily pain:** likely low for RSM (2-D map + cuts is arguably the
  better tool), but only the owner knows if rotate-to-inspect ever
  earns its keep.

### T7 — Signal-processing long tail (S each, likely non-goal)
- **Origin:** wavelets (denoise/smooth), Hilbert/envelope, STFT,
  deconvolution, coherence, 2-D FFT.
- **quantized:** FFT/PSD/Welch, Butterworth FFT filter, smoothing
  family, cross-correlation, ROI FFT gadget.
- **Daily pain:** probably near zero for magnetometry/XRD/PNR — flagged
  only because the category looks big on paper. Candidate non-goal.

## 4. Owner decision questions

1. **Custom fit models:** ✅ ANSWERED 2026-07-10 — build the in-app
   equation builder AND the AICc quick-scan (→ GOTO_PLAN #1, #6).
   ALSO RAISED: how hard would pulling fit engines/models from **bumps**
   be, if installed? **Discuss before implementing** — owner-gated
   discussion item (BSD-3, so license-compatible as an optional extra;
   would be an *additional* engine, never replacing the MATLAB-parity
   fitters the goldens lock).
2. **Baselines:** ✅ ANSWERED 2026-07-10 — anchor-point AND Shirley,
   plus explicit analytic backgrounds (linear, quadratic, …) and
   domain-specific ones: XRD low-angle background and XRR/NR footprint
   correction (→ GOTO_PLAN #2, #3, #7, #8).
3. **Paper figures:** ✅ ANSWERED 2026-07-10 — quantized owns the
   page-composition step end-to-end (→ GOTO_PLAN #4).
4. **3-D:** have you used Origin's rotatable 3-D surface/scatter for
   real work in the last year (RSM, pole figures), or is the 2-D map +
   line cuts + static 3-D export enough?
5. **Typography:** ✅ ANSWERED 2026-07-10 — true rich text, rendered
   identically on-screen and in export (→ GOTO_PLAN #5).
6. **Worksheet reshape:** how often do you stack/unstack (wide↔long),
   split, or join worksheets by a key column in Origin? Which one
   would you actually miss?
7. **Timestamps:** do you ever plot against real clock time (date-time
   axes for long PPMS/MPMS runs), or always elapsed time / derived
   quantities?
8. **Signal processing:** any real use of wavelets, Hilbert envelope,
   STFT, or deconvolution? If not, T7 becomes a declared non-goal.
9. **The switch trigger:** what's the first project you'd commit to
   doing 100% in quantized, Origin closed — e.g. re-doing the YIG
   magnetometry + PNR + XRD figures end-to-end? (That project's
   friction list becomes the acceptance test for "go-to".)

## 5. Explicit non-goals

- **Origin Apps ecosystem parity** — owner has zero Apps installed;
  quantized's plugin API is the analogue when needed.
- **The life-science fit library** (~100+ of the 305: enzyme kinetics,
  pharmacology, dose-response, chromatography) — wrong domain; T1's
  builder covers the rare need.
- **Vision/Image X-Functions** (57 + 54) — imaging is out of scope by
  charter (→ fermiviewer).
- **Electrophysiology/pClamp/HEKA, GIS, sound, Excel-embedded books,
  Lotus/dBase legacy import** — not this researcher's data.
- **LabTalk / Origin C scripting emulation** — pipeline scripts +
  Python plugins + the headless API are the deliberate replacement.
- **Origin COM automation-server parity** — one-way "Send to Origin"
  exists; being an automation *server* for other apps is not the goal.
- **Statistics beyond what shipped** (discriminant/PLS/cluster
  platforms) — the W5 suite already exceeds this user's usage.
- **Interactive WebGL 3-D** stays a deferred gate (question 4 decides
  whether it ever opens).
