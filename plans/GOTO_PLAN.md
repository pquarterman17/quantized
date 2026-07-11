# GOTO Plan — make quantized the go-to plotting & analysis tool

The owner-decided capability gaps that would still send a normal research
day back to OriginPro, plus the acceptance protocol that decides when
"go-to" is achieved. Distilled from the 2026-07-10 Origin 2026b install
survey and two owner decision rounds. This is the single authoritative
doc for the initiative (the survey draft was absorbed and deleted per the
plan-consolidation rule; full text in git history @ `4e97e6d`).

**Status:** Active
**Created:** 2026-07-10
**Updated:** 2026-07-10

---

## Context

### Survey summary (evidence)
Static inspection of OriginPro 2026b (305 `.fdf` fit functions, 799
X-Functions, templates, user files — no GUI/COM), cross-checked against
PORT_CHECKLIST, BACKLOG, and the frontend command registry. Key
calibration: **the owner runs Origin stock** (zero custom fit functions /
templates / Apps), and the real projects in its history
(`Magnetometry_YIG-Co-Py.opj`, `PNR.opj`, `XRD.opj`, `XAS.opju`) are
squarely in quantized's domain — so the bar is core workflows done
extremely well, not Origin's long tail. quantized already leads on
reproducible pipelines, linked row-state exploration, domain analysis
depth, instrument import, reading/writing Origin's own formats, and
modern statistics.

### How the pieces fit together
Four decided themes: (a) **custom fit models** ride the existing no-eval
equation parser (`calc/fit_equation.py`) + fit workshop; (b) **baselines**
extend `calc/baseline.py` + the corrections step executor with
interactive anchors, Shirley, and domain backgrounds; (c) **figure
pages** compose N existing plots into one exported page via
`routes/export` / `calc/figure.py` (matplotlib, vector-first); (d) **rich
text** renders one label AST through two renderers — uPlot on-screen,
matplotlib mathtext at export. Long fits ride a poll-model job runner
(`quantized/jobs.py`, package root — threading is barred from calc/io).

### Data / control flow
equation text → parse_equation → named model (persisted) → fit engine →
same fit-stats path as registry models. Anchor clicks → (x, y) list →
interp baseline → step-executor subtract (recalc DAG). Page spec (grid +
panel refs + labels) → server-side matplotlib page → one PDF/SVG.
DREAM fit → job submit → GET-poll progress → posterior + corner plot.

### Dependency map
- Items 1, 2, 3, 4 are independent (parallelizable)
- Item 5 (rich text) touches every label surface — schedule alone
- Item 6 requires item 1 (scan set includes saved custom models)
- Items 7, 8 extend item 2's baseline-picker surface
- Item 10 (bumps): fast engines are independent; the DREAM path
  requires item 9 (job runner). Item 6 can use either engine.

### Resolved decisions
- **Custom fit models (2026-07-10):** build the in-app equation builder
  AND the AICc quick-scan (#1, #6).
- **Baselines (2026-07-10):** anchor-point AND Shirley, plus explicit
  analytic backgrounds and domain-specific ones — XRD low-angle, XRR/NR
  footprint (#2, #3, #7, #8).
- **Paper figures (2026-07-10):** quantized owns multi-panel page
  composition end-to-end (#4).
- **Typography (2026-07-10):** true rich text, identical on-screen and
  in export (#5).
- **bumps engine (2026-07-10):** GO as an optional extra (BSD-3, pin a
  floor version) — an ADDITIONAL engine behind a guarded import, never
  replacing the MATLAB-parity fitters the goldens lock. Long DREAM runs
  must NOT lock the window → they submit through the poll-model job
  runner (#9), whose shape follows the PORT_PLAN #7 reference
  correction (polled ThreadPool store, GET-poll, cancel flag — no
  WebSocket). Fast engines (amoeba/LM/DE) stay synchronous.

### Owner gates (open questions — answer to populate Tier 3)
- **Q4 3-D:** rotatable 3-D used for real work in the past year, or is
  2-D map + line cuts + static 3-D export enough? (Decides the WebGL
  deferral gate, ORIGIN_GAP #22.)
- **Q6 Worksheet reshape:** would you actually miss stack/unstack
  (wide↔long), split-by-values, or join-by-key?
- **Q7 Date-time axes:** ever plot against real clock time (long
  PPMS/MPMS runs), or always elapsed/derived quantities?
- **Q8 Signal processing:** any real use of wavelets / Hilbert / STFT /
  deconvolution? If no → declared non-goal.
- **Q9 Switch-trigger project:** pick the project + start date (protocol
  below; YIG-Co-Py recommended).

### Switch-trigger acceptance protocol (Q9, elaborated 2026-07-10)
Feature lists measure coverage; a committed project measures
sufficiency. One real deliverable is produced 100% in quantized:
1. Enumerate the paper's exact figure set up front — that's the finish
   line.
2. **Origin stays closed.** On a wall: log it, work around natively.
   Only a hard blocker (deliverable impossible) permits a one-artifact
   fallback — the loudest line in the log.
3. Keep a running `FRICTION_LOG.md`: what, where, workaround, minutes
   lost, S/M/L fix guess. Paper-cuts too.
4. Triage after: blockers + worst detours → the next tier here
   (re-ranking predictions with evidence); paper-cuts → one polish item.
5. **Exit = go-to:** full figure set from raw instrument files, zero
   Origin opens, zero post-processing outside quantized; repeat per
   project until the log is boring.
Timing: run the magnetometry + XRD halves now (most complete pipelines);
hold the PNR multi-panel half until #4 + #5 land, then finish the set as
their acceptance test.

### Out of scope (declared non-goals)
Origin Apps ecosystem; the life-science fit library (the builder covers
rare needs); Vision/Image (→ fermiviewer by charter);
electrophysiology/GIS/sound/legacy-import categories; LabTalk/Origin-C
emulation (pipelines + plugins + headless API are the replacement); COM
automation-*server* parity; stats platforms beyond the shipped W5 suite.
Interactive WebGL 3-D stays a deferred gate pending Q4.

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

*(intentionally empty until the Q4/Q6/Q7/Q8 owner gates are answered —
worksheet reshape, 3-D, and date-time axes land here if confirmed)*

## Completed

*(none yet)*
