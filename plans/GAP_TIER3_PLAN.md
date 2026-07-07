# Gap Tier-3 Plan — the long-tail sweep

Implementation plan for the remaining long-tail `plans/ORIGIN_GAP_PLAN.md`
items: corner-plot posterior panels (#29 residual), the
beautiful-defaults audit (#11 residual), GLM/survival/ROC (#30),
ternary + quiver/streamline export (#23), structured clipboard paste +
multi-file append import (#47, connectors stay deferred), the
pole-figure representation decision + import (#46 residual), and
interactive WebGL 3-D (#22 — listed, deferred pending an owner
decision). These are individually small; the value of this plan is
naming the exact seams so each can be dispatched as a self-contained
cheap-model task.

**Status:** Active
**Created:** 2026-07-07
**Updated:** 2026-07-07

---

## Context

### How the pieces fit together

Uncertainty machinery is fully backend-shipped:
`src/quantized/calc/fit_bootstrap.py` (`bootstrap_fit` — summary only,
builds but does not return its replicate matrix; `fit_posterior` —
returns the full samples array) over `calc/mcmc.py`'s `mcmc_sample`,
exposed at `/api/fitting/{bootstrap,posterior}`
(`routes/fitting.py`) with **no frontend consumer** — the posterior
samples are already on the wire, so a corner plot is pure figure/export
work. New export figure kinds follow one proven template:
`calc/figure_statplots.py` (pure module, `figure_style(name)` presets
from `calc/figure_styles.py`, returns image bytes) + an endpoint in the
export routes — which are at 526 lines / over the 500-line guard, so
new endpoints land in the split module
(`routes/export_figures.py`, GAP_PLOTTYPES item 1). The visual harness
(`tools/visual/` — puppeteer over the `?harness` store seam) shoots
the REAL uPlot/Canvas2D surfaces only, NOT the matplotlib export path;
the defaults audit therefore needs a small headless export-side script
too. Stats presets: `calc/figure_styles.py` defines default / aps /
aps_double / nature / nature_double / thesis / presentation / poster /
report / web. XRDML mesh handling lives in `src/quantized/io/xrdml.py`
+ `io/_xrdml_scan.py` (`mesh_kind` ∈ mesh / snapshot / coupled);
pole figures (Phi scans × Chi/Psi steps at fixed 2θ) match none of
those detectors and import flat today (documented in
`tests/test_realdata_corpus.py`). Clipboard is copy-only
(`frontend/src/lib/clipboard.ts`); no onPaste handler exists anywhere.
`frontend/src/lib/openFilePicker.ts` already returns multiple files;
`frontend/src/lib/merge.ts` `mergeDatasets` is the row-concat
primitive an append import reuses. No three.js/regl/WebGL code exists
(#22 genuinely greenfield). GLM/survival need a new dependency —
statsmodels (BSD-3) / lifelines (MIT), both absent today and both
clear of the GPL guard; ROC needs only numpy.

### Data / control flow

```
#29: /api/fitting/posterior samples → calc/figure_corner render
     → /api/export/corner-figure → curvefit workshop <img> + vector DL
#11: frozen sample datasets → render_figure per preset (headless)
     + tools/visual shots → contact sheet → owner eyeball → preset fixes
#30: worksheet columns → calc/stats_{glm,survival,roc} (optional deps)
     → thin routes → stats chooser / report sheets
#47: clipboard text → /api/import/guess+parse → dataset  |  N files
     → mergeDatasets → one appended dataset
#46: pole-figure XRDML → mesh_kind="pole" grid → Map tab / export
```

### Dependency map

- Items 1 and 4 add export endpoints — they want GAP_PLOTTYPES item 1
  (the export-route split) landed first; if it isn't, they create
  `routes/export_figures.py` themselves and the split item shrinks.
- Item 2 (defaults audit) is independent but best run AFTER
  GAP_PLOTTYPES items 2–4 exist, so new plot kinds get audited too;
  don't block on them — audit the four core figure types now.
- Item 3 blocks on the optional-dependency decision (open question 2);
  everything else in it is parallel-safe.
- Item 5's paste half reuses the #40 import engine (GAP_ECOSYSTEM item
  1's backend already exists — no dependency, `/api/import/*` is
  shipped).
- Item 6's parser work waits on its representation decision (open
  question 1) — decide first, then it's one focused io/ change.
- Item 7 is a decision gate, not work.
- No item here touches `frontend/src/store/useApp.ts` except item 5
  (paste actions) — this plan is broadly parallel-safe with the other
  three gap plans.

### Architecture constraints (binding — state, don't debate)

Pure calc/io (no fastapi imports; new stats/figure modules are pure);
500-line backend module ceiling (new figure/stats modules are new
files, never grow `routes/export.py` — it is over the ceiling today);
~400-line component convention; single parser registry (pole-figure
support extends the existing `.xrdml` parser, no new registration);
no eval; **no GPL runtime deps** — statsmodels is BSD-3, lifelines is
MIT, both pass `tests/test_repo_integrity.py`'s GPL scan; verify any
new dep's license before adding; DataStruct contract (paste/append
produce DataStructs; pole figures land as a normal mapped DataStruct);
new analysis views read rows via `rowstate.analysisData` (guard #11 —
applies to item 5's paste-into-analysis surfaces and any #30 UI);
vector export by default (corner/ternary/quiver default to PDF/SVG).

### Open questions

**RESOLVED 2026-07-07 (owner):** import filters persist in the SERVER
config dir (platformdirs); plugins are TRUSTED installs (no sandboxing);
pole figures import as a 2-D map (`mesh_kind="pole"`); WebGL 3-D (#22)
STAYS DEFERRED. Adopted planner defaults (owner may override later):
#41 closes with PyPI-only (installers already shipped); Graph Builder
v1 zones = X/Y/Group + typed-inert Facet; quick-fit ends in a chip with
EXPLICIT commit; GLM/survival ship as an optional `stats` extra; axis
breaks render as panels with break glyphs; plus the minor calls as
written below.


1. **Pole-figure representation (#46)** — (a) gridded 2-D map
   (chi/psi × phi) with `mesh_kind="pole"`, rendered through the
   existing Map tab (levels, cuts, contour export all apply);
   stereographic/polar projection as a later view; (b) multi-column
   dataset (one column per chi/psi step, x = phi) for the normal plot;
   (c) both. *Recommendation: (a) — it reuses the whole 2-D pipeline
   and keeps one representation; (b) falls out for free later via the
   existing map line-cut tools.*
2. **GLM/survival dependency shape (#30)** — (a) statsmodels +
   lifelines in a new optional `stats` extra with guarded imports (the
   `office` extra pattern; clean core install); (b) runtime deps for
   everyone; (c) hand-roll logistic/Poisson IRLS + Kaplan-Meier in
   numpy (no deps, more code to validate). *Recommendation: (a) —
   optional extra, guarded imports, clear "install quantized[stats]"
   error; ROC is hand-rolled numpy regardless.*
3. **Ternary rendering (#23)** — (a) hand-rolled barycentric
   transform on plain matplotlib axes (small, no dep); (b) add
   python-ternary (MIT). *Recommendation: (a) — the transform is a
   few lines of pure math; a dep for one export kind isn't worth it.*
4. **WebGL 3-D (#22)** — stays deferred? (a) keep deferred until the
   static 3-D exports (#19, shipped) show demand; (b) green-light a
   three.js (MIT) surface/scatter stage now. *Recommendation: (a) —
   nothing in the corpus workflow demands rotation yet; revisit on
   user pull.*
5. **Bootstrap corner source (#29)** — expose the bootstrap replicate
   matrix (opt-in flag on `/api/fitting/bootstrap`) so corner plots
   work for bootstrap too, or posterior-only? *Recommendation: opt-in
   flag — one-line calc change, bounded response, and it makes the
   corner panel uniform across both uncertainty engines.*

---

## Tier 1 — High Impact

1. **Corner-plot posterior panels (gap #29 residual)** — pairwise
   posterior/bootstrap parameter panels through the export path,
   surfaced in the Curve Fit workshop.
   *Model: sonnet.* *Agent: peak-fitting-expert.*
   - [ ] New pure `src/quantized/calc/figure_corner.py` on the
         `figure_statplots.py` template: histogram diagonals, 2-D
         density/scatter off-diagonals, truth lines at the fitted
         params, `figure_style` presets; matplotlib only
   - [ ] `/api/export/corner-figure` endpoint in
         `routes/export_figures.py` (create it per GAP_PLOTTYPES item
         1 if not yet split — never grow `routes/export.py`)
   - [ ] Opt-in samples flag on `bootstrap_fit` in
         `calc/fit_bootstrap.py` (per open question 5) + pass-through
         in `routes/fitting.py`, so bootstrap corners work like
         posterior corners (`fit_posterior` already returns samples)
   - [ ] Curve Fit workshop
         (`frontend/src/components/workshops/curvefit/`): after a
         posterior/bootstrap run, a "Corner plot…" action renders the
         export into an img preview with a vector download (PDF
         default)
   - [ ] Tests: figure bytes render for 2–4 param synthetic
         posteriors; marginal histograms consistent with the reported
         ci68 intervals; route round-trip
   - Acceptance: a 3-parameter Gaussian fit posterior renders a 3×3
     corner panel whose marginals match the reported 68% intervals;
     export is vector by default.

2. **Beautiful-defaults audit (gap #11 residual)** — the booked
   eyeball pass over un-tweaked first renders vs. published journal
   figures, with a written procedure so it's repeatable per preset.
   *Model: sonnet (harnessing + fixes; the eyeball verdicts are the
   owner's).* *Agent: materials-science-expert.*
   - [ ] Build the four reference cases with ZERO overrides: M-H
         hysteresis loop, XRD θ–2θ (log y), R(Q) reflectivity
         (log-log), RSM map — from corpus/realdata via the figure
         builder
   - [ ] Export-side contact sheet: a small headless script (new
         `tools/figure_audit/`) driving `calc/figure.render_figure` /
         `figure_map.render_map_figure` across every
         `calc/figure_styles.py` preset (default/aps/nature/thesis/
         presentation at minimum) into a PNG grid — the `tools/visual`
         harness cannot see the matplotlib path, so this script is the
         export-side eye
   - [ ] Interactive-side shots of the same four datasets via
         `tools/visual/` (the `?harness` seam + spec file)
   - [ ] Owner eyeball vs. published APS/Nature figures → a concrete
         defect list (tick density, minor ticks, legend framing,
         margins, marker sizes, math-text rendering, colorbar
         defaults)
   - [ ] Fix each accepted defect as a `figure_styles.py` /
         `render_figure` default change (annotate intentional values
         as do-not-"fix"), regenerate the sheet, keep before/after in
         the item's close-out note
   - Acceptance: a written defect list with before/after renders;
     every accepted defect fixed as a preset/default change; the four
     reference figures reach journal-grade with zero per-figure
     overrides.

---

## Tier 2 — Medium Impact

3. **GLM, survival analysis, ROC (gap #30)** — logistic/Poisson GLM,
   Kaplan-Meier + log-rank + Cox PH, and ROC/AUC, all with
   published-reference-value tests (the calculator-domain pattern).
   *Model: haiku (wrappers + tests per the master plan's routing);
   sonnet only if the optional-dep gating gets designy.* *Agent:
   code-implementer.*
   - [ ] Dependency shape per open question 2: statsmodels (BSD-3) +
         lifelines (MIT) in a new optional `stats` extra in
         `pyproject.toml` (mirroring the `office` extra + guarded
         imports of `io/report_export.py`), added to the dev group so
         CI exercises them; the GPL guard in
         `tests/test_repo_integrity.py` already scans extras
   - [ ] New pure modules beside `calc/stats.py` (each <500 lines):
         `calc/stats_glm.py` (logistic/Poisson via statsmodels GLM,
         result dict shaped like `stats_multivar.multiple_regression`),
         `calc/stats_survival.py` (KM curve, log-rank, Cox PH via
         lifelines), `calc/stats_roc.py` (pure-numpy ROC/AUC +
         Youden J — no sklearn)
   - [ ] Thin routes in `src/quantized/routes/stats_design.py` (138
         lines — room; `routes/stats.py` is at 418, leave it);
         graceful 501-style error naming the extra when deps are
         absent
   - [ ] Report-sheet endings through the generic `from_stats_table`
         emitter (`calc/report_emit.py`); optional: surface in the
         Test-chooser workshop as a later follow-up, not this item
   - [ ] Reference-value tests: a textbook logistic worked example
         reproduced to published coefficients, lifelines' documented
         KM/log-rank example, and a hand-computed small-N ROC/AUC
   - Acceptance: all three modules reproduce their published
     reference values exactly; a clean install without the extra
     fails with an actionable message, never an ImportError traceback.

4. **Ternary + quiver/streamline export (gap #23)** — export-only
   figure kinds via matplotlib, no interactive stage.
   *Model: haiku (the figure_statplots template is the in-repo
   pattern).* *Agent: code-implementer.*
   - [ ] New pure `calc/figure_ternary.py`: hand-rolled barycentric
         transform (per open question 3) on plain axes, scatter +
         optional composition gridlines, `figure_style` presets
   - [ ] New pure `calc/figure_field.py`: quiver + streamplot over
         gridded (x, y, u, v) input, shared level/scale conventions
         with `calc/figure_map.py`
   - [ ] Two endpoints in `routes/export_figures.py`; client
         postDownload helpers in `frontend/src/lib/api.ts`; minimal
         UI surface — export dialog entries, full builder integration
         deferred to Graph Builder
   - [ ] Tests: known 3-component compositions land at the correct
         barycentric points; a synthetic vortex field renders both
         kinds; vector formats default
   - Acceptance: a 3-component composition table exports a ternary
     PDF with correctly placed points; a gridded vector field exports
     quiver and streamline PDFs.

5. **Structured clipboard paste + multi-file append import (gap #47,
   connectors stay deferred)** — inbound paste and one-step append
   import; database connectors remain out of scope.
   *Model: haiku per the master plan; escalate to sonnet if the paste
   UX grows modes.* *Agent: ux-frontend-expert.*
   - [ ] Paste: an onPaste handler in
         `frontend/src/components/Stage/Worksheet.tsx` (which already
         owns the copy handlers) — pasted text routes through the
         SHIPPED import engine (`/api/import/guess` + `/parse` in
         `routes/import_wizard.py`, which takes raw text by design)
         into a new dataset; small single-cell/range pastes edit
         cells in place instead (size heuristic in a pure, unit-tested
         `frontend/src/lib/pasteparse.ts`)
   - [ ] Append import: an "append to one dataset" toggle in the
         multi-file import flow (`frontend/src/lib/openFilePicker.ts`
         already returns multiple files) — same-schema results
         concatenate via `frontend/src/lib/merge.ts` `mergeDatasets`
         (metadata `merged_from` already recorded); schema mismatch
         degrades to separate datasets with a toast, never a dead
         import
   - [ ] Tests: TSV/CSV paste with header+units detection; the
         3-same-schema-files append case; the mismatch degrade path
   - Acceptance: pasting a TSV block from a spreadsheet creates a
     correctly-parsed dataset (headers/units detected); importing 3
     same-schema CSVs with Append checked lands one concatenated
     dataset flagged `merged_from`.

6. **Pole-figure representation + import (gap #46 residual)** —
   decide the representation, then make pole-figure XRDML import as
   something better than a flat trace.
   *Model: sonnet.* *Agent: materials-science-expert.*
   - [ ] Representation decision per open question 1 (owner sign-off;
         gridded chi/psi × phi map recommended)
   - [ ] Parser: extend the dispatch in `src/quantized/io/xrdml.py` +
         `io/_xrdml_scan.py` to detect the pole-figure layout (fixed
         2θ `commonPosition`, Phi array within scans, Chi/Psi
         stepping across scans — today it falls through to the 1-D
         path and degenerates) → `mesh_kind="pole"` gridded output
         with proper axis names/units
   - [ ] Fixtures: synthetic pole-figure XML in
         `tests/test_io_xrdml.py`; a realdata corpus anchor (acquire
         a redistributable PANalytical pole-figure file into
         `../test-data/` with a MANIFEST row if none exists); flip
         the known-limitation note in `tests/test_realdata_corpus.py`
         to a positive assertion
   - Acceptance: a pole-figure XRDML imports as a chi × phi map that
     renders in the Map tab (and inherits contour/export support);
     the realdata suite asserts it.

---

## Tier 3 — Nice-to-Have

7. **Interactive WebGL 3-D (gap #22) — listed, deferred.** No
   three.js/regl/WebGL code exists; static 3-D export (#19) shipped
   2026-07-03. Awaiting the owner's call per open question 4.
   *Model: defer (opus if ever green-lit — a new rendering
   subsystem).* *Agent: — (decision gate only).*
   - [ ] Decision gate: revisit when users ask to rotate
         surface/scatter views that the static `/api/export/map-figure`
         3-D kinds can't satisfy; if green-lit, scope a three.js (MIT)
         stage as its own plan item with the PolarStage-style gating

---

## Completed

(empty — nothing shipped against this plan yet)
