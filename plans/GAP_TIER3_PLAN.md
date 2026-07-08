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
**Updated:** 2026-07-08

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


1. *(SHIPPED 2026-07-07 — built exactly as recommended, (a). Detection
   in `io/_xrdml_scan.py` runs before the mesh/cloud classifiers: shared
   2Theta `commonPosition` + Phi swept within every scan + a tilt axis
   ("Psi" or "Chi", both handled) fixed per scan but stepped across
   scans. Output labels `[Phi, Psi, Intensity]` (tilt axis normalized to
   "Psi"); 2Theta is scalar metadata, not a column. Renders in the Map
   tab via the existing generic path; the RSM-specific cut/projection
   tools stay gated to literal "2Theta"/"Qx" columns (frontend,
   untouched) — stereographic/polar projection remains the later view.
   See the Completed entry for full detail.)* **Pole-figure
   representation (#46)** — (a) gridded 2-D map
   (chi/psi × phi) with `mesh_kind="pole"`, rendered through the
   existing Map tab (levels, cuts, contour export all apply);
   stereographic/polar projection as a later view; (b) multi-column
   dataset (one column per chi/psi step, x = phi) for the normal plot;
   (c) both. *Recommendation: (a) — it reuses the whole 2-D pipeline
   and keeps one representation; (b) falls out for free later via the
   existing map line-cut tools.*
2. *(SHIPPED 2026-07-07 — tools/audit_defaults.py 32-render contact
   sheet + plans/design/DEFAULTS_AUDIT.md. Verdict: preset VALUES are
   journal-grade; the bugs were declared-but-dead fields — per-preset
   dpi/legend_location/marker_size now honored, mirrored box ticks added.
   TASTE calls left for the owner in the audit doc: aps height vs
   log-decade label thinning. Follow-ups booked: same dpi/tick gaps in
   figure_map/figure_statplots; frontend DPI field doesn't sync to
   preset.)* **GLM/survival dependency shape (#30)** — (a) statsmodels +
   lifelines in a new optional `stats` extra with guarded imports (the
   `office` extra pattern; clean core install); (b) runtime deps for
   everyone; (c) hand-roll logistic/Poisson IRLS + Kaplan-Meier in
   numpy (no deps, more code to validate). *Recommendation: (a) —
   optional extra, guarded imports, clear "install quantized[stats]"
   error; ROC is hand-rolled numpy regardless.*
3. *(SHIPPED 2026-07-07 after one rejected round — the first agent
   never installed the extras and shipped untested code; the repair pass
   with statsmodels 0.14.6 + lifelines 0.30.3 actually running found the
   real bugs: numpy-2 trapz, ndarray-vs-Series results, a SILENT
   pseudo-R² saturation to 1.0, missing discrete-model deviance, Cox
   p-value double-transform. Reference tests now use Spector&Mazzeo
   (logistic), RAND HIE (Poisson), and Rossi recidivism (KM/log-rank/
   Cox). `stats` optional extra; ROC is pure numpy. +59 tests.)* **Ternary rendering (#23)** — (a) hand-rolled barycentric
   transform on plain matplotlib axes (small, no dep); (b) add
   python-ternary (MIT). *Recommendation: (a) — the transform is a
   few lines of pure math; a dep for one export kind isn't worth it.*
4. **WebGL 3-D (#22)** — stays deferred? (a) keep deferred until the
   static 3-D exports (#19, shipped) show demand; (b) green-light a
   three.js (MIT) surface/scatter stage now. *Recommendation: (a) —
   nothing in the corpus workflow demands rotation yet; revisit on
   user pull.*
5. *(SHIPPED 2026-07-07 — the recommended opt-in flag: `return_samples`
   on `bootstrap_fit`/`BootstrapRequest`, default `False`.)*
   **Bootstrap corner source (#29)** — expose the bootstrap replicate
   matrix (opt-in flag on `/api/fitting/bootstrap`) so corner plots
   work for bootstrap too, or posterior-only? *Recommendation: opt-in
   flag — one-line calc change, bounded response, and it makes the
   corner panel uniform across both uncertainty engines.*

---

## Tier 1 — High Impact

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
   - [x] Dependency shape per open question 2: statsmodels (BSD-3) +
         lifelines (MIT) in a new optional `stats` extra in
         `pyproject.toml` (mirroring the `office` extra + guarded
         imports of `io/report_export.py`), added to the dev group so
         CI exercises them; the GPL guard in
         `tests/test_repo_integrity.py` already scans extras
   - [x] New pure modules beside `calc/stats.py` (each <500 lines):
         `calc/stats_glm.py` (logistic/Poisson via statsmodels GLM,
         result dict shaped like `stats_multivar.multiple_regression`),
         `calc/stats_survival.py` (KM curve, log-rank, Cox PH via
         lifelines), `calc/stats_roc.py` (pure-numpy ROC/AUC +
         Youden J — no sklearn)
   - [x] Thin routes in `src/quantized/routes/stats_design.py` (138
         lines — room; `routes/stats.py` is at 418, leave it);
         graceful 501-style error naming the extra when deps are
         absent
   - [x] Report-sheet endings through the generic `from_stats_table`
         emitter (`calc/report_emit.py`); optional: surface in the
         Test-chooser workshop as a later follow-up, not this item
   - [x] Reference-value tests: a textbook logistic worked example
         reproduced to published coefficients, lifelines' documented
         KM/log-rank example, and a hand-computed small-N ROC/AUC
   - Acceptance: all three modules reproduce their published
     reference values exactly; a clean install without the extra
     fails with an actionable message, never an ImportError traceback.

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

- ~~**#5 Structured clipboard paste + multi-file append import (gap #47)**~~
  (2026-07-08) — built simpler than the item's original sketch, per the
  dispatching agent's concrete direction: an Edit-menu / palette command
  instead of an in-worksheet `onPaste` handler (no cell-level paste-in-place;
  every paste creates a new dataset), and a File-menu / palette command for
  append instead of a Library multi-select toggle. Investigation found the
  backend needed ZERO changes — `io/import_preview.py`'s `guess_settings` /
  `parse_import` and their `/api/import/guess` + `/api/import/parse` routes
  (`routes/import_wizard.py`) already take raw `text` directly (shipped with
  GAP_ECOSYSTEM #1's import wizard); paste just needed a frontend consumer.
  Frontend: `lib/api.ts` gained `guessImportSettings()` / `parseImportText()`
  (thin `postJSON` wrappers, matching the wizard's own contract — no second
  parser). `store/useApp.ts` gained two actions: `pasteDataFromClipboard()`
  (`navigator.clipboard.readText()` → guess → parse → `addDataset("pasted
  data N")`; sets status + toasts on an empty clipboard, a denied read, or a
  parse failure) and `importFilesAppended(files)` (uploads every file via the
  existing `uploadFile`, then row-concatenates them with the existing
  `lib/merge.ts` `mergeDatasets` — reused as-is, it already threw on a
  column-count mismatch and already recorded `merged_from`/`merged_count`;
  no new pure helper needed). An Origin multi-workbook file (`data.books`) or
  a `mergeDatasets` mismatch degrades to `importFiles(files)` — N separate
  datasets plus a toast — never a dead import. `App.tsx`: "Paste data" (⌘V,
  Edit group — the shortcut only fires when no field is focused, so native
  paste in rename/tag/formula inputs is untouched) and "Import & append as
  one dataset…" (File group) commands, both auto-surfaced in the MenuBar and
  ⌘K palette via the existing `Action` registry (no new UI component).
  Tests: 12 new cases in `store/useApp.test.ts` (append: ≥2-file guard, the
  3-file concat + `merged_from`/`merged_count`, column-mismatch degrade,
  Origin-multi-book degrade, per-file upload-failure degrade; paste: guess/
  parse round-trip, successive `pasted data N` naming, empty clipboard,
  denied clipboard read, backend parse-error surfacing). Uncovered en route:
  this project's Vitest/Rolldown toolchain corrupts a hoisted `vi.mock()`
  function's subsequently-assigned `.mockImplementation()` if a local
  `beforeEach` calls `.mockReset()`/`.mockClear()` on it directly first
  (`.mockResolvedValue()` is unaffected) — worked around by relying on the
  file's existing top-level `vi.clearAllMocks()` and keying per-call mock
  behavior off the argument instead of call order. Backend unchanged (1953
  passed, 3 skipped); frontend 1437 passed (was 1425); `npm run typecheck`
  and `npm run build` clean; `ruff`/`mypy`/`test_repo_integrity.py` clean.

- ~~**#4 Ternary + quiver/streamline export (gap #23)**~~ (2026-07-08) — two new pure
  modules: `calc/figure_ternary.py` (170 lines, hand-rolled barycentric transform,
  scatter with optional colorbar, 10% gridlines, corner labels), `calc/figure_field.py`
  (126 lines, quiver + streamline over gridded (x, y, u, v), shared dpi/preset
  conventions). Two thin routes in `routes/export_figures.py` (added 82 lines, still
  379 total, under 500-line ceiling): `POST /api/export/ternary-figure` and
  `POST /api/export/field-figure`, both with pydantic request models, format/kind
  validation, 422 error handling. Frontend: `TernaryFigureSpec` / `FieldFigureSpec`
  interfaces + `exportTernaryFigure()` / `exportFieldFigure()` helpers in `lib/api.ts`.
  Tests: `tests/test_calc_figure_ternary_field.py` (43 cases — ternary 3/2/1 points,
  corner cases, normalization warnings, colorbar, dpi presets, marker size, format/shape
  errors; field quiver/streamline in each format, grid shape validation, axis/title labels,
  dpi handling; 9 integration tests via TestClient for both routes, happy-path + 4×422s).
  Ternary barycentric formula documented in docstring; row normalization with warning on
  denormalized input; non-positive components rejected. Backend: 1838 passed (was 1795);
  ruff + mypy clean.
- ~~**#6 Pole-figure representation + import (gap #46 residual)**~~
  (2026-07-07) — representation decision was already owner-resolved (a)
  gridded 2-D map. Parser: `io/_xrdml_scan.py` gained `_classify_pole` +
  `_build_pole` (a new classifier run BEFORE `_is_2d`/`_classify_cloud` in
  `io/xrdml.py`, since a Chi-named pole tilt axis alone already satisfies
  the generic "snapshot" cloud pattern and would otherwise silently drop
  the Phi sweep). Detection: one shared 2Theta `commonPosition` (the fixed
  Bragg reflection) + Phi swept WITHIN every scan (azimuthal) + a tilt axis
  — "Psi" (texture cradles) or "Chi" (older Eulerian cradles), both
  handled, checked in that order — fixed within each scan but stepped
  ACROSS scans. `xrdml.py`'s `_SECONDARY_AXES` gained "Psi" so it's
  captured into each scan's `sec_ranges` at all. Output: `mesh_kind="pole"`,
  `labels=["Phi","Psi","Intensity"]` (tilt axis normalized to "Psi" in the
  output regardless of source naming; original name kept as
  `tilt_axis_source`), 2Theta recorded as scalar `two_theta_deg` metadata
  (not a column — it doesn't vary point-to-point, unlike the RSM kinds).
  `is2D`+3 labeled channels alone makes it render in the Map tab via the
  existing generic first-three-columns path and the generic regrid/export
  pipeline; the RSM-specific angular/Q cut+projection tools stay gated to
  literal "2Theta"/"Qx" columns (unchanged, out of scope here) —
  polar/stereographic display remains a later view. Fixtures: 6 synthetic
  cases in `tests/test_io_xrdml.py` (Psi naming, Chi naming, Phi-not-swept
  non-match, single-scan non-match, plus an explicit regression test
  re-proving mesh/snapshot/coupled classify identically); a real corpus
  anchor exists (`../test-data/panalytical/xrd/xrayutilities_polefig_point.xrdml`,
  91 Psi steps × 1199 Phi points, GPL-2.0-flagged in the corpus MANIFEST —
  kept local-only/never redistributed, used only as a private realdata
  oracle) — `tests/test_realdata_corpus.py`'s known-limitation note flipped
  to a positive reference. `io/xrdml.py` 394 lines / `io/_xrdml_scan.py`
  291 lines (both well under the 500-line ceiling — no split needed).
  Backend 1874 passed (was 1795); ruff + mypy clean.

- ~~**#1 Corner-plot posterior panels (gap #29 residual)**~~ (2026-07-07) —
  new pure `calc/figure_corner.py` (226 lines, `figure_statplots.py`
  template): k×k grid, marginal histograms on the diagonal, 2-D density
  histogram panels below the diagonal, upper triangle blank, dashed
  truth-value overlays, tick/label thinning so k up to ~6 stays readable;
  `figure_style` presets + `calc/figure`'s `resolved_dpi` convention
  (`dpi=None` -> the preset's calibrated dpi — this endpoint threads it
  through correctly end-to-end, unlike its `statplot-figure`/`map-figure`
  siblings, which is the pre-existing, separately-tracked gap noted in
  open question 2's follow-ups). `bootstrap_fit` gained an opt-in
  `return_samples` flag (default `False`) that adds `boot_samples` (the
  full replicate matrix) to the result, threaded through
  `BootstrapRequest.return_samples` in `routes/fitting.py`; `fit_posterior`
  already returned its chain, so it needed no change. New stateless
  `POST /api/export/corner-figure` in `routes/export_figures.py` (297
  lines) takes posted samples + names (never re-runs a fit). Frontend:
  `exportCornerFigure` + `CornerFigureSpec` wrapper only in `lib/api.ts` —
  ~~**the Curve Fit workshop "Corner plot…" action is NOT built**~~ CLOSED
  2026-07-08: bootstrap/posterior had no frontend consumer at all yet, so
  the minimal wiring landed straight in the Curve Fit workshop rather than
  a separate uncertainty surface — `lib/api.ts` gained `bootstrapFit()` +
  `BootstrapRequest`/`BootstrapResult`; `useCurveFit.ts` gained
  `runCornerPlot()` (bootstraps the just-completed fit with
  `return_samples: true`, then calls `exportCornerFigure` with the
  replicate matrix, the model's param names, and the fit's own params as
  the dashed truth overlay) + `cornerBusy`; `CurveFitPanel.tsx` gained a
  "Corner plot…" button next to "→ Report", enabled only after a completed
  (non-guess) fit. 4 new tests in `useCurveFit.test.ts` (no-op with no fit,
  no-op after guess-only, happy path asserting the bootstrap request shape
  + corner export payload, and a bootstrap-failure error path). Frontend
  1559 passed, build green. Tests: `tests/test_calc_figure_corner.py` (16 cases —
  k=2/4 renders in pdf/svg/png, Gaussian marginal-peak sanity, k=1 and
  truths-overlay, dpi-preset resolution, shape/finite-sample error
  paths), `tests/test_calc_bootstrap_integrate.py` (+2, flag off/on),
  `tests/test_api_export.py` (+4, route round-trip/truths/bad-format/
  shape-mismatch-422), `tests/test_api_fitting.py` (+1, bootstrap route
  pass-through). Backend 1795 passed (was 1772); ruff + mypy clean.
