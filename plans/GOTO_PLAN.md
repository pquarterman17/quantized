# GOTO Plan — make quantized the go-to plotting & analysis tool

The owner-decided capability gaps that would still send a normal research
day back to OriginPro, distilled from the 2026-07-10 Origin 2026b install
survey (`plans/design/ORIGIN_GOTO_SURVEY.md` — survey evidence, the
"already beats Origin" calibration list, non-goals, and the still-open
questions). Deliberately not a parity checklist: these are the workflow
gaps the owner confirmed they want.

**Status:** Active
**Created:** 2026-07-10
**Updated:** 2026-07-10

---

## Context

### How the pieces fit together
Four decided themes: (a) **custom fit models** ride the existing no-eval
equation parser (`calc/fit_equation.py`) + fit workshop
(`frontend/src/components/workshops/fit*`); (b) **baselines** extend
`calc/baseline.py` + the corrections step executor with interactive
anchors, Shirley, and domain backgrounds; (c) **figure pages** compose N
existing plot windows into one exported page via `routes/export` /
`calc/figure.py` (matplotlib, vector-first); (d) **rich text** must render
identically in uPlot (on-screen) and matplotlib (export) — one label AST,
two renderers.

### Data / control flow
equation text → parse_equation → named model (persisted) → fit engine →
same fit-stats path as registry models. Anchor clicks → (x, y) list →
interp baseline → step-executor subtract (recalc DAG). Page spec (grid +
panel refs + labels) → server-side matplotlib page → one PDF/SVG.

### Dependency map
- Items 1, 2, 3, 4 are independent (parallelizable)
- Item 5 (rich text) touches every label surface — schedule alone
- Item 6 requires item 1 (scan set includes saved custom models)
- Items 7, 8 extend item 2's baseline-picker surface
- Item 10 (bumps): fast engines are independent; the DREAM path
  requires item 9 (job runner). Item 6 can use either engine.

### Resolved decisions
- **bumps as an optional fit engine — GO (2026-07-10).** BSD-3 →
  license-safe optional extra; an ADDITIONAL engine behind a guarded
  import, never replacing the MATLAB-parity fitters the goldens lock.
  Long DREAM runs must NOT lock the window → they submit through the
  poll-model background job runner (item 9), whose shape follows the
  PORT_PLAN #7 reference correction (polled ThreadPool store, no
  WebSocket). Fast engines (amoeba/LM/DE) stay synchronous.

### Owner gates (decide before/while building)
- Survey questions still open: 3-D (Q4), worksheet reshape (Q6),
  date-time axes (Q7), signal-processing non-goal (Q8), and the
  switch-trigger acceptance project (Q9).

---

## Tier 1 — High Impact

1. **Custom fit equation builder** — type `y = f(x, p…)` in the fit
   workshop; validate via `parse_equation`, fit, save as a named
   reusable model alongside registry models
   - [ ] Route: validate + fit an equation model (thin, over existing calc)
   - [ ] Fit-workshop UI: equation field, param table with guesses/bounds
   - [ ] Persist named custom models (prefs or workspace) + reuse in fits

2. **Anchor-point baseline** — click N anchors on the curve, interpolated
   baseline through them (linear/pchip/spline), live preview, subtract as
   a recalc-DAG step
   - [ ] `calc/baseline.py` anchor interpolation (pure)
   - [ ] Plot gesture + preview overlay + step-executor wiring

3. **Shirley background** — iterative XPS/XAS step background in the
   baseline picker
   - [ ] `calc/baseline.py` Shirley (pure, iterate-to-tolerance)
   - [ ] Baseline UI entry + route plumbing

4. **Multi-panel figure page composer** — arrange N *different* plots
   onto one page (grid, panel labels (a)…(d), shared captions), exported
   as a single vector PDF/SVG; the "Figure 1" workflow with zero
   post-processing
   - [ ] Page spec model + server-side matplotlib composition
   - [ ] Composer UI (pick plot windows/figure docs → grid slots)
   - [ ] Export dialog integration (vector default, style presets)

5. **Rich-text labels** — sub/superscript, Greek, italics rendered
   identically on-screen (uPlot) and in vector export (matplotlib
   mathtext), plus a symbol palette in label editors
   - [ ] Label micro-syntax → shared AST → uPlot canvas renderer
   - [ ] Same AST → matplotlib mathtext at export
   - [ ] Symbol palette + docs in axis/legend/annotation editors

## Tier 2 — Medium Impact

6. **AICc model quick-scan** — "fit all plausible models, rank by AICc"
   over a candidate set (registry + saved custom models); requires #1
   (engine choice may await the bumps discussion)

7. **Domain backgrounds/corrections** — XRD low-angle background model;
   XRR/NR beam-footprint correction (geometry-based) as a corrections
   step

8. **Analytic baseline completion** — explicit linear/quadratic/poly-n
   choices surfaced in the baseline picker (BG-from-region polyfit math
   exists; this is the UI surface)

9. **Background job runner for long fits** — the poll-model store from
   the PORT_PLAN #7 audit (mirror fermiviewer `jobs.py` +
   `routes/jobs_api.py`: ThreadPool + GET-poll; cancel as a checked
   flag; no WebSocket). Progress fraction from iteration callbacks so
   the window never locks. First consumers: DREAM (#10) and the
   existing `calc/mcmc.py` posterior runs.
   - [ ] `quantized/jobs.py` Job/JobStore (package root — threading is
     barred from calc/io by the pure-layer guard)
   - [ ] `routes/jobs_api.py` submit/status/result/cancel (thin)
   - [ ] `lib/jobs.ts` poll client + progress/cancel UI in the fit
     workshop (poll only while a job is live)

10. **bumps optional fit engine** — `quantized[bumps]` extra (BSD-3,
    pin a floor version), `calc/fit_bumps.py` adapter (registry + saved
    custom models → `Curve`/`FitProblem`; popt / uncertainties / χ²
    back), "Engine" dropdown in the fit workshop with the MATLAB-parity
    engine as default. Fast engines (amoeba/LM/DE) synchronous; **DREAM
    submits through #9** with iteration progress + cancel, posterior +
    corner-plot handoff on completion; uncertainties labeled by origin
    (posterior vs Hessian).

## Tier 3 — Nice-to-Have

*(intentionally empty until the open survey questions are answered —
worksheet reshape, 3-D, and date-time axes land here if confirmed)*

## Completed

*(none yet)*
