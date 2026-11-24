# Open items triage (2026-11-22)

Triage of every unticked `- [ ]` box in `plans/*.md` (271 boxes in 18 files; `BACKLOG.md` has none). Each box was checked against `frontend/src`, `src/quantized`, `CHANGELOG.md`, git history (through #883) and `plans/GAP_AUDIT_8.md`.

Classes: **DONE** (feature exists, ticked), **STALE** (superseded or a per-change checklist, not a work item), **OWNER** (needs the owner, a real machine or a decision), **GATED** (deliberately deferred: census, real data, Q4, specimen), **OPEN** (real code work).

Method notes:

- Conservative: a box was ticked DONE only with positive evidence. None qualified; several umbrella boxes have shipped slices (cited in their own lines) but their remaining work is real, so they stay OPEN.
- Edits in the plan files are limited to the box state plus a prefix tag: `[owner]`, `[gated: reason]`, `[standing checklist, not a work item]`, `[x] (stale: reason)`, or `(partial: ...)` on two OPEN boxes. No plan text or decision was changed.
- Standing checklists (per-PR 'before you start / before you merge' lists, bug-entry templates, `Revisit` rules) stay unticked and are counted under STALE, since ticking a recurring template would misstate it.
- `plans/ORIGIN_FILE_DECODE_PLAN.md` and `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md` were classified only; those files and `docs/origin_re` were not edited.
- Gap-audit-8 lanes SCAT, SIG, LBL, FITANN, CLEAN, FITPRE, SEL2, RL2, STATUI, CFMT and STFT mostly shipped as #873-#883; the plan boxes they touched are the partially-done ones noted below.

## Quick converter (2026-11-24; owner answers binding, items marked OPEN are the owner's)

Spec: the owner's `quick_converter_frozen.md` (window, Explorer/Finder right-click, launcher page, all on `qz convert`'s backend). **Part 1 (backend core, branch `claude/converter-core`) is built**; the drag-and-drop window, the right-click verbs and the launcher page come next on top of it.

- [x] Writers beside csv/xlsx: `.xy`/`.txt`, HDF5/NeXus (`.h5`/`.nxs`), MATLAB `.mat`, JSON, NumPy `.npz` (`io/convert_flat.py`, `io/convert_containers.py`). NeXus layout per the NIAC2014 NXdata rules (https://manual.nexusformat.org/datarules.html: `NX_class`, `signal`, `axes`, `<axis>_indices`, `default`). No new dependency (h5py, scipy, numpy, openpyxl were already required).
- [x] Owner policies (`io/convert_plan.py`): containers one file with a sheet/group/struct per dataset, flat formats (csv, xy) one file per dataset; a 2-D map to a flat format is a lossless long table (one row per point: 2Theta, Omega, Intensity, Qx, Qz), containers keep the 2-D shape (NeXus: `signal` is `(n_frames, n_pixels)`, constant-along-the-other-dimension channels stored once as the 1-D axes); metadata is a `#` header in csv/xy, attributes/fields in h5/mat/json/npz, a `metadata` sheet in Excel (`--no-metadata` drops the flat ones).
- [x] Guessing (`io/convert_guess.py`, `qz convert --guess`): type via the registry and sniffers, technique, datasets, column names + units, suggested format and never-overwriting names; `qz convert --to auto` (the default) uses it; `--out` is optional (each output beside its input).
- [x] Errors: per-file `outcome` (`done` | `partial` | `skipped-exists` | `failed`) and a plain `reason` in the JSON report; every output through `write_guard.atomic_write` (temp file then rename), so a failure leaves no partial file and nothing is overwritten.
- [ ] **OWNER, provisional: default output format per input type** (`io/convert_defaults.py`): 1-D XRD scan -> xy; any 2-D map/RSM -> h5; magnetometry/transport -> csv; Origin project -> xlsx; reflectometry/SIMS/spectroscopy/other -> csv; a multi-dataset input whose default is flat -> xlsx. Confirm or correct.
- [ ] **OWNER, provisional: Origin projects to the new containers** are one file per project with a group per sheet, while the existing `xlsx` stays one workbook per Origin book. Confirm, or make xlsx one per project too.
- [ ] **OWNER, provisional: `.xy` column names** are `# column k: name [unit]` comment lines (numbers stay plain `X Y...`); Quantized's own re-import then names the columns Col1.. (the file is for other tools). `.xy` writes a categorical channel as its codes with the levels on a comment line; Origin text columns are not written to `.xy`.
- [ ] **OWNER, provisional: CSV/xlsx data files now carry the metadata header/sheet** by default (the Origin path's CSV is unchanged); a metadata value over 2000 characters is cut in the flat formats and reported in the book's notes (whole in containers).
- [ ] **OPEN: PANalytical `.raw`** (binary) has no parser (`.raw` is Rigaku or Bruker only); it fails with the registry's plain "no parser" reason until one is written. Origin-ready ASCII output stays deferred (owner).
- [ ] Part 2: the window, Explorer/Finder right-click and launcher page (separate lane).

## Counts per file

| File | DONE | STALE | OWNER | GATED | OPEN | Total |
|---|---:|---:|---:|---:|---:|---:|
| PRIMARY_SOFTWARE_AUDIT_PLAN.md | 0 | 0 | 43 | 12 | 2 | 57 |
| BUGS_AND_ISSUES.md | 0 | 21 | 27 | 1 | 0 | 49 |
| ANALYSIS_CAPABILITY_ROADMAP.md | 0 | 6 | 0 | 3 | 22 | 31 |
| FIGURE_AUTHORING_WORKFLOW_PLAN.md | 0 | 8 | 11 | 7 | 0 | 26 |
| ORIGIN_FILE_DECODE_PLAN.md | 0 | 0 | 0 | 3 | 18 | 21 |
| THIN_FILM_STACK_PLANNING_PLAN.md | 0 | 0 | 3 | 1 | 11 | 15 |
| ORIGIN_PLOT_TYPE_PARITY_PLAN.md | 0 | 0 | 0 | 0 | 14 | 14 |
| POST_RELEASE_PROBLEM_AUDIT.md | 0 | 4 | 9 | 0 | 0 | 13 |
| ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md | 0 | 1 | 9 | 0 | 0 | 10 |
| POST_SPRINT_INDEPENDENT_REVIEW.md | 0 | 2 | 7 | 0 | 0 | 9 |
| PRIMARY_WORKFLOW_ROADMAP.md | 0 | 6 | 2 | 0 | 0 | 8 |
| CHATGPT_SOL_TO_CLAUDE_RELEASE_HANDOFF.md | 0 | 3 | 4 | 0 | 0 | 7 |
| JMP_GAP_PLAN.md | 0 | 0 | 2 | 1 | 0 | 3 |
| GUI_INTERACTION_PLAN.md | 0 | 0 | 1 | 1 | 0 | 2 |
| MAIN_PLAN.md | 0 | 0 | 0 | 2 | 0 | 2 |
| PORT_CHECKLIST.md | 0 | 0 | 0 | 1 | 1 | 2 |
| LIBRARY_WORKBOOK_UX_PLAN.md | 0 | 0 | 0 | 1 | 0 | 1 |
| TEST_DETERMINISM_PLAN.md | 0 | 1 | 0 | 0 | 0 | 1 |
| BACKLOG.md | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total** | **0** | **52** | **118** | **33** | **68** | **271** |

## OPEN items, ranked

Order: general analysis and plotting, then domain families (XRD, reflectometry, spectroscopy, SIMS, thin-film planning), then technique-specific (magnetometry/hysteresis), then Origin import. Size: S under a day, M one focused PR, L multi-PR or design-heavy. Line numbers are in the file named.

### 1. General analysis and plotting

| # | Scope | Source | Size |
|--:|---|---|:-:|
| 1 | Finish the result-lifecycle contract for the remaining 'add as dataset' writers (Pawley, reflectivity FFT, hysteresis, MagTools background, digitizer) and reopen for Units / Internal field / Curie-Weiss / fit bands (DONE 2026-11-23, lane RO3: all four reopen, see the roadmap; FFT thickness reopen DONE in the reopen lane; the "add as dataset" writers outside the audit were listed and swept in the reopen gaps lane 2026-11-24: Worksheet Extract rows now commits through the contract, the folder template summary is deferred with its reason, the rest need no result, see part 3 of `plans/RESULT_ACCEPTANCE_AUDIT.md`) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:289` | M |
| 2 | Move magtools, Hysteresis, Baseline, the stats-chooser queue, Curve fit, Peaks and the Fit Y by X queue onto the shared `analysisInputs` resolver (one code path, not just one policy) (DONE 2026-11-23, including the Peak wizard line naming its own fit range / gap-row drop and the lean no-recount path for `selectedFitData`) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:1426` | M |
| 3 | Survival UI (Kaplan-Meier, log-rank, Cox) in Statistical tests (DONE 2026-11-22, KM curve plotting deferred); ROC/GLM/chi-square/p-adjust already shipped (#877) | `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md:5213` | M |
| 4 | Batch/By leftovers: DONE (BY4 2026-11-23): Curve fit reset was already shipped; Peak analyzer channel reset, Background estimate-only batch (all rows, matches the single fit) and Pawley batch model worksheets shipped; Units / Internal field / raw-moment Curie-Weiss batches stay deliberately unbuilt | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:1568` | M |
| 5 | One expandable result book across the statistics tools (tables and plots behave like one Origin/JMP result) (PARTIAL 2026-11-24, lane RB3: one shared lazy shell for the saved book and the tools; Variability, Outlier screening and Distribution show their results as the book with the same table actions and Open saved result; lane RB4: Fit Y by X, Multivariate and Statistical tests (Kaplan-Meier / log-rank / Cox included) too, so every statistics tool now uses it; open: the owner's calls on the provisional choices; pre-save table actions and per-figure report are fail closed, provisional, owner to confirm) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:411` | L |
| 6 | Rendered-output (visual) equivalence for the nine regression-matrix fixtures (PARTIAL 2026-11-23: the screen canvas now has a draw-call spec and a painted-pixel spec; all 9 fixtures now paint what the golden says: S4, `group` painting no series pixel, is fixed per level: another level's row is `undefined` (uPlot draws across it) and a level's own non-finite row is `null` (a break), so the screen breaks where the export's matplotlib line does; `spanGaps` removed (owner-approved recommendation 2026-11-23); not ticked, the owner's visual review remains) | `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md:10688` | L |
| 7 | A1: DONE (owner decision and owner-approved recommendation 2026-11-23: the filter operations and Spectrogram ARE inside A1's shared workbench). Audited 2026-11-23 (all five pass for the recipe operations); now median / despike / LOWESS / (de)convolution / Hilbert and Spectrogram have the same optional X range (backend `xMin` / `xMax` in the sigop `args`, inclusive, trimmed before filtering, empty or reversed range refused 422; Spectrogram already took `x_min` / `x_max`) and Save recipe (a replayable one-step `sigop` / new `spectrogram` transform recipe); the committed result's `inputs` record the range actually read. Not built: a range for Reduce XY / inverse FFT (refused by the backend); a headless `qz run` equivalent of the spectrogram step | | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:1005` | M |
| 8 | Acceptance: raw data never overwritten; commit makes a linked derived worksheet / artifact / frozen copy (verify across all writers, then tick) (DONE 2026-11-23: 37 writers audited, none overwrites raw data; `plans/RESULT_ACCEPTANCE_AUDIT.md`) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:923` | S |
| 9 | Acceptance: input dataset, channels, included rows, range, units, parameters and algorithm version recorded on every result (AUDITED 2026-11-23: 37 of 37 pass; row 35 fixed in the multi-output envelope lane, owner-approved recommendation 2026-11-23: the fit / peak / reflectivity-fit envelope POINTS at its dataset-resident record (`settingsRef` + the record's fingerprint, a changed record is withheld) and records `parameters.inputs`; `plans/RESULT_ACCEPTANCE_AUDIT.md`) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:925` | S |
| 10 | Acceptance: previews visibly provisional and Cancel leaves no scientific state (DONE 2026-11-23: all result-producing tools read; Recode, Metadata cleanup and the SIMS Process / Compare / Region previews marked; Dataset math / Average curves Cancel and Close fixed; figure previews are server images, not results, by design; see part 2 of `plans/RESULT_ACCEPTANCE_AUDIT.md`) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:927` | S |
| 11 | Acceptance: commit is one undo step and repeated clicks cannot duplicate (DONE 2026-11-23: 36 of 37 pass, 1 n/a; `plans/RESULT_ACCEPTANCE_AUDIT.md`) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:946` | S |
| 12 | Acceptance: a result can be reopened, inspected, duplicated, renamed, deleted and sent to a figure or report (AUDITED 2026-11-23, part 3 of `plans/RESULT_ACCEPTANCE_AUDIT.md`: inspect/rename/delete 38 of 38, duplicate 37 (Library duplicate fixed), figure/report 35 pass 3 partial, reopen 24 pass after the reopen lane made FFT thickness, Reflectivity FFT, Kaplan-Meier and Pawley reopen and the reopen gaps lane (2026-11-24) added Baseline batch, Spectrogram and Frequency count; 7 still disabled-with-reason (Hysteresis background, MagTools background, ROI cuts, Gadget FFT, Resample / Average, Signal worksheet, Analysis batch; reason each in the audit) and 7 worksheet-only; not ticked) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:951` | S |
| 13 | Acceptance: changed input marks a result stale; auto-recalc only when the recalculation mode permits (AUDITED 2026-11-23: 35 of 37 pass, 2 n/a; reflectivity curve/band worksheets fixed in the multi-output envelope lane, owner-approved recommendation 2026-11-23: one envelope lists every output of the computation, `outputs[0]` primary, each entry with its `part`; `plans/RESULT_ACCEPTANCE_AUDIT.md`) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:953` | S |
| 14 | Acceptance: missing inputs, unit mismatch, too few rows, non-finite data, lazy Origin previews and cancelled work fail closed with a message (DONE 2026-11-23: shared resolver covers most; fixed Surface fit / Ellipse fit / Optical gap, FFT thickness / Reflectivity FFT, Dataset math cancel, FFT batch gap check (#908), and ROI cuts / Tabulate / RSM (each of the six conditions proven or marked not applicable); part 2 of `plans/RESULT_ACCEPTANCE_AUDIT.md`) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:959` | S |
| 15 | Acceptance: cancellation for long work; determinate progress where the backend can expose it (AUDITED 2026-11-23, part 4 of `plans/RESULT_ACCEPTANCE_AUDIT.md`; residue lane 2026-11-24 (provisional, owner to confirm): DONE workspace open/append Cancel, save Cancel + k/N books, import "uploading N% / parsing…", multi-book lazy load k/N, reflectivity fit and bootstrap as job-queue jobs with Cancel + fraction; earlier fixes: ROI batch Stop + progress, Import & append Cancel + i/N, Pipeline Run k/N. OPEN: pipeline replay Cancel (owner design decision: rollback vs run-on-a-copy), `/posterior` as a job (no UI calls it), a parse fraction (the server parses in one step); not ticked) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:963` | S |
| 16 | Umbrella: result lifecycle inconsistent across tools; close when line 289 closes | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:46` | S |
| 17 | Umbrella: selection semantics differ by tool; close when line 1426 closes | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:294` | S |
| 18 | Umbrella: batch/By support inconsistent; close when line 1568 closes | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:302` | S |

### 2. Domain families

| # | Scope | Source | Size |
|--:|---|---|:-:|
| 19 | XRD: reference/phase overlays, search/match handoff, crystallite-analysis history, batch comparison (first Pawley overlay slice done; imported stick patterns, crystallite history and crystallite batch were already done; lane xrd-overlays 2026-11-24 added the design and the built-in-phase search/match hand-off, scoring provisional (owner to confirm); remaining: phase batch comparison, on-plot legend for stick groups, CIF import) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:1688` | L |
| 20 | matchPhases: peak-to-phase matching against a phase database (interim nearest-reference-stick match in `lib/peakPhaseMatch.ts`) | `plans/PORT_CHECKLIST.md:239` | M |
| 21 | Spectroscopy: peak-family presets, component area/ratio tables, batch recipe review (only against representative data; see GATED 1791) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:1789` | M |
| 22 | Reflectometry: parameter-correlation and posterior-diagnostic workspace (first slice done), linked fit families (GATED 1725) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:1716` | M |
| 23 | SIMS: multi-profile alignment, interface/junction comparison, batch region tables (DONE 2026-11-23: batch region table + junction/peak depth compared as columns (Region tab "Batch over selected worksheets") and multi-profile alignment (SIMS ▸ Align, recorded `simsalign`) shipped; the Region tab's junction from a USER-CHOSEN interface (not the species' own peak) stays open as a documented follow-up in the roadmap row 23 table) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:1787` | M |
| 24 | **Done 2026-11-23** (`calc/epitaxial_oop.py`; film ν is a user input, none stored). Wire `tetragonal_distortion` and `strain_from_poisson` into the orientation-aware mismatch card (out-of-plane strain next to in-plane) | `plans/THIN_FILM_STACK_PLANNING_PLAN.md:172` | S |
| 25 | **Done 2026-11-23** (`tests/test_calc_epitaxial_references.py`). Reference tests for published epitaxial relationships: add perovskite cube-on-cube (STO/LSAT/LAO) and Si(111) net; swap/rotation invariance and integer supercell area ratios (GaN/sapphire, Fe/MgO, identical-lattice already tested) | `plans/THIN_FILM_STACK_PLANNING_PLAN.md:91` | S |
| 26 | Add missing substrates (scandates, NdGaO3, KTaO3, YAlO3, ZnO, ...) as cited extensions (none present in `calc/substrates.py`) | `plans/THIN_FILM_STACK_PLANNING_PLAN.md:135` | S |
| 27 | **Done 2026-11-23** (`calc/substrate_orientation.py`). Orientation as Miller indices (hkl/hkil) alongside the label in the substrate table so the surface net is computed | `plans/THIN_FILM_STACK_PLANNING_PLAN.md:133` | S |
| 28 | One material record: full cell, system, centering, CTE, optional elastic constants, source/citation | `plans/THIN_FILM_STACK_PLANNING_PLAN.md:129` | M |
| 29 | **Done 2026-11-24** (provisional, owner to confirm; `calc/critical_thickness_models.py`, `POST /api/substrates/critical-thickness-model`, lazy card in Calculators ▸ Substrates; all material parameters are inputs, bracketed root find, fail closed, tests against Lambert-W closed forms; provisional, owner to confirm: ν limited to [0, 0.5], blank b defaults to a_film/√2). Further critical-thickness models as labeled extensions (People-Bean; Matthews-Blakeslee with configurable slip system) | `plans/THIN_FILM_STACK_PLANNING_PLAN.md:200` | M |
| 30 | ~~Hand-off from film stack to Reflectivity: seed a Parratt model with planned thicknesses and SLDs~~ DONE (provisional, owner to confirm; lane film-to-parratt): Film stack "→ Reflectivity" builds a new Parratt model; SLD only from per-layer formula + density via `sld_formula`, else blank and flagged; roughness 3 Å marked to fit; confirm before replacing a touched model (provisional, owner to confirm) | `plans/THIN_FILM_STACK_PLANNING_PLAN.md:211` | M |
| 31 | **Done 2026-11-24** (provisional, owner to confirm; `calc/growth_mode.py`, `POST /api/growth/bauer`, lazy card in Calculators ▸ Thin Film; γ_int scanned, nothing looked up, optional ± gives an indeterminate band; provisional, owner to confirm: Stranski-Krastanov is shown only when the user supplies a strain term, the Δ rise at large thickness). Bauer-criterion card (gamma_int as user input, verdict over a range) | `plans/THIN_FILM_STACK_PLANNING_PLAN.md:225` | M |
| 32 | **Done 2026-11-24** (provisional, owner to confirm; `calc/wulff.py` 3-D polyhedron + central 2-D section from user {hkl: gamma} and any cell, `POST /api/growth/wulff`; calc + route only, no obvious existing frontend place; provisional, owner to confirm: symmetry is cubic (48 ops), inversion or none (caller lists all planes), other point groups not generated; no surface-energy lookup, decision D2 still gates that). Wulff construction (2-D cross-section, optionally 3-D), pure `calc/` | `plans/THIN_FILM_STACK_PLANNING_PLAN.md:228` | L |
| 33 | DONE (branch claude/cif-symmetry): `calc/cif_symmetry.py` expands the asymmetric unit with the CIF operators (fail closed on unparseable ops / no op list; merge tol 1e-3 fractional, provisional, owner to confirm). Apply CIF symmetry operations to expand atom sites, with tests against known cells | `plans/THIN_FILM_STACK_PLANNING_PLAN.md:238` | M |
| 34 | DONE in calc (branch claude/cif-symmetry): `calc/terminations.py` (layers, terminations, Tasker polarity from supplied/CIF charges only; provisional, owner to confirm); route/UI wiring not done (no existing consumer). List possible terminations for a given (hkl) and flag polar stacks (needs line 238) | `plans/THIN_FILM_STACK_PLANNING_PLAN.md:240` | M |

### 3. Technique-specific

| # | Scope | Source | Size |
|--:|---|---|:-:|
| 35 | Magnetometry: unit-aware geometry normalization (first slice done), temperature/field series comparison (done 2026-11-24: Compare tab, no resampling, provisional), derived quantities (see 36) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:1727` | M |
| 36 | Magnetometry: remaining derived magnetic quantities with unit-aware provenance and uncertainty (internal-field slice done; chi = M/H and muB per f.u. done 2026-11-24 in Derived tab, provisional; left: isotherm UI, M-uncertainty into dS / Arrott Tc, reopen) | `plans/ANALYSIS_CAPABILITY_ROADMAP.md:1754` | M |

### 4. Origin import (follow the `origin-change` skill; classify-only here)

| # | Scope | Source | Size |
|--:|---|---|:-:|
| 37 | ~~27 `x_sheet_unproven`~~ STALE (lane A 2026-11-24): 0 left in the public corpus; the RSOS `Matlab2@2`/`Matlab3@2` and Degree-of-impact `Book81@3` sheets are proven now. Residue is the Text X itself: RSOS_SC_BAR 10 `x_not_imported` (row 42), RSOS_TC_BAR 9 + `Book81@3` 1 `x_not_a_column` (row 48) | `plans/ORIGIN_FILE_DECODE_PLAN.md:967` | M |
| 38 | 24 `sheet_x_not_found` (Degree-of-impact Graph4A / 10 / 10A, public): BLOCKED, needs COM `GetPlotType` + `%(i,@D)` / `%(iX,@D)` for those layers to prove the per-column (X = column position) plot type before any decode (lane A 2026-11-24) | `plans/ORIGIN_FILE_DECODE_PLAN.md:982` | M |
| 39 | ~~5 `sheet_unknown` on origin_scientific_colors~~ STALE (lane A 2026-11-24): 0 omissions, all 286 curves bind (the zero-skip Numeric forms are read by `opju_column_fixed`, #704). Unverified residue, no preview: ColorPage2 layer 4 has no curve and `Colors@108` is absent from layer 2; needs COM | `plans/ORIGIN_FILE_DECODE_PLAN.md:988` | M |
| 40 | 2 `plotted_twice` (SOP_meas): `plotted_twice` is 0 now; the row range IS decoded (F-045), so Graph12/30 `figSOPvsR_E` is left out `plot_row_range` and its two sibling plots fold into it. Remaining: draw a row sub-range (curve `rowRange` + frontend apply, lazy-loaded) and key the dedup on the range; not attempted (feature, not a decode; lane A 2026-11-24) | `plans/ORIGIN_FILE_DECODE_PLAN.md:995` | S |
| 41 | 62 `x_token_differs` + 11 `y_is_x_column` (public now 14 + 15: 2x glass Epoxy, 稳定性 FitLine3-5, rise-time, figure5, FTIR, Degree of impact): BLOCKED, needs COM `%(iX,@D)` per layer (the plan's COM run showed dropping either gate draws wrong X) or a per-layer preview adjudication (lane A 2026-11-24) | `plans/ORIGIN_FILE_DECODE_PLAN.md:1000` | L |
| 42 | `x_not_imported` Text X (public 71: Figure4 32, 生化指标非线性 18 report-sheet X, RSOS_SC 10, TEA 9, Degree 2): BLOCKED on drawing, not binding (lane A 2026-11-24): Figure4's later-sheet curves carry no decoded plot kind (row 64), RSOS_SC_BAR's 10 `column` curves need grouped columns over text categories in the frontend (F-117 NEG) | `plans/ORIGIN_FILE_DECODE_PLAN.md:1008` | M |
| 43 | `worksheet_filter` (15): decode `__STGCOLFILTER` condition and apply it | `plans/ORIGIN_FILE_DECODE_PLAN.md:1015` | M |
| 44 | ~~12 sheet-1 curves with unproduced Text X~~ named specimens resolved (lane A 2026-11-24): Figure_9/10 `Book1B` now `plot_row_range` / `error_bar_plot`, Catchment B-E draw over categories (F-088), 稳定性 `Book3` `data_not_saved` (F-010). Same shape elsewhere (28 sheet-1 curves on a non-category text X, e.g. Figure4 Graph1; 18 report-sheet X) is listed unresolved by the frontend, never skipped: folded into row 42 | `plans/ORIGIN_FILE_DECODE_PLAN.md:1022` | M |
| 45 | Function plots F13-F15 / F32: tokens decoded, not yet drawn | `plans/ORIGIN_FILE_DECODE_PLAN.md:1039` | M |
| 46 | Discretewithsum `Mid1_E@5` twice: BLOCKED, needs COM (lane A 2026-11-24 lead): in the 5 COM 'twice' layers both tokens are `0a [00] 80`-framed; in the 1 'once' layer (origin.opju Graph2 `Book3_J`) one token sits in a `28 aa 00 80` Style object (row 49's unframed form). 5 positive / 1 negative is below the bar: settle row 49's 7 unframed tokens over COM first | `plans/ORIGIN_FILE_DECODE_PLAN.md:1050` | S |
| 47 | ~~rise-time Graph66 `Book56_C`: token id 2613 has no column record~~ DONE 2026-11-24 lane A (F-121: X-error record, code `06` in its name field) | `plans/ORIGIN_FILE_DECODE_PLAN.md:1060` | S |
| 48 | Row-number / binned X, 236 `x_not_a_column` (public 87, SOP_meas 72): BLOCKED, only SOP_meas Graph72 / Graph10 are COM-proven row-number X; telling row-number from binned layers needs COM on the rest (Graph47 / fig_SOPsearchProcess / Graph46 / Graph2 / Graph5 / 6C_CC / US06_CC / Agingcycle), and drawing it needs a frontend row-index binding (lazy-loaded) (lane A 2026-11-24) | `plans/ORIGIN_FILE_DECODE_PLAN.md:1075` | L |
| 49 | 8 of 8,401 unframed curve tokens in a `Style` object | `plans/ORIGIN_FILE_DECODE_PLAN.md:1091` | S |
| 50 | ~~Token X pair `30 61` / `.opj` curve-anchor X at offset 35~~ STALE (lane A 2026-11-24): both decoded since: error-bar tokens' offset 35-36 names the decorated curve (F-061, #778), `.opj` anchor 35-38 is the recorded X (F-071) | `plans/ORIGIN_FILE_DECODE_PLAN.md:1098` | M |
| 51 | Row masks: masked cells are kept as stored 0.0; decode the mask | `plans/ORIGIN_FILE_DECODE_PLAN.md:1102` | M |
| 52 | Hc2 data Graph40 magenta 'error bars': identify what they are (not an error-bar plot) | `plans/ORIGIN_FILE_DECODE_PLAN.md:1142` | S |
| 53 | Axis record with undecoded x1e9 display factor and 16-byte literal doubles | `plans/ORIGIN_FILE_DECODE_PLAN.md:1153` | M |
| 54 | Binding: plots name ids 1773-1777 absent from the id table (Hc2 data Graph34): BLOCKED, owner corpus only (`Hc2 data.opju` is not in the public corpus). Lead from F-121: check whether those ids' records carry a name-field designation prefix other than `02`/`03`/`06` (codes 1/4/5/7/8 are not admitted) (lane A 2026-11-24) | `plans/ORIGIN_FILE_DECODE_PLAN.md:1158` | M |
| 55 | Sheet display names for `Book@N`: BLOCKED, needs the COM sheet-name / `%(i,@D)` dump of every multi-sheet book the plan names before any title change (lane A 2026-11-24) | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:250` | S |
| 56 | Loose datasets Origin plots (COM `%Z`) not recovered | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:257` | M |
| 57 | Graph layer not recovered (`graphs_not_recovered`, no axis record decoded) | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:262` | L |
| 58 | No quantized mapping for stacked area (214) / offset lines; no dash field (waterfall offsets may now exist, re-check #13) | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:326` | M |
| 59 | Scorer does not model the double-Y apply | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:330` | S |
| 60 | Residual phantom books (184 `TableN` in 10 files) | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:351` | M |
| 61 | Box / violin / strip residue (`huge_tiny` layer) | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:381` | M |
| 62 | Histogram residue | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:397` | S |
| 63 | Column / bar layers not recovered for six specimens | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:408` | M |
| 64 | Plot type residue: multi-series column layers on several X columns / multi-layer pages | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:434` | M |
| 65 | Marker residue: bubble size scale and colormap | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:472` | M |
| 66 | Map residue: colour scale not decoded | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:513` | M |
| 67 | Offset-stacked (waterfall) layers omitted (`layer_kind_not_decoded`) | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:543` | M |
| 68 | Vector XYXY (218): 14 real plots | `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md:547` | M |

**Lane B classification, rows 43-68 except lane A's (2026-11-24; provisional, owner to confirm).** Corpus available to the lane: the public corpus only (no owner corpus, no `generated/` specimens, no COM oracle, no `ground_truth_public/`).

| # | Status | Specimens / evidence |
|--:|---|---|
| 43 | **partial (applied for proven ops; owner decision 2026-11-24)**: condition decoded and stamped (F-119); a proven condition (op `02`) is drawn as a per-curve row subset (`curve.rowFilter`, ledger B-37): simulated-IFN Graph1 +5 curves, 1549 / 1600 rows = COM. Op `04` (likelihood_profile) stays omitted: **blocked: needs owner COM specimen** (a value equal to the threshold) | public (likelihood_profile, simulated-IFN); decoded conditions reproduce all 6 recorded COM counts. Applying it needs a per-curve row subset through `opju_figure_curves.py` (lane A's binding path, at its 500-line cap) and the frontend apply; `04` `<` vs `<=` needs a specimen with a value equal to the threshold |
| 45 | blocked: needs specimen + COM | SOP_meas Graph70 public, fig_SOPestimation_US06ou not in the public corpus. No record found carries the plotted ids (2354, 2539-2544) -> `F<n>`; needs a controlled specimen with known function plots (formula, range, points, log/linear X) to locate that link, plus a function-curve model |
| 49 | blocked: needs COM | Bqqbar, origin.opju, FTIR are public, but admitting a framing gate needs COM `%Z` on the 7 unproven tokens |
| 51 | **partial (owner decision 2026-11-24, ledger B-38)**: mask read and stamped (F-120); a row masked in every filled column is imported as a row exclusion (`excludedRows`). Public masks are all partial-row, so 0 rows excluded; a per-cell mask display is open (provisional, owner to confirm) | public PerceivedRisk x2 (61 columns each, 0 elsewhere), recorded COM `ismasked()`. Needs the owner decision on how imported masked points plot and Origin's mask display setting (undecoded) |
| 52 | blocked: owner corpus + COM | Hc2 data is owner-only; COM query in `docs/origin_re/hc2_open_gaps.md` |
| 53 | blocked: owner corpus + specimen | Hc2 Graph34 owner-only; the packed 16-byte literal parse is to be gated by a controlled specimen (generated/ absent here) |
| 56 | blocked: depends on lane A + COM | 迭代次数 / 30流场 / 50流场 public; the curves that plot those datasets do not bind yet (binding path); then COM `%Z` per plot |
| 57 | blocked: needs specimens | packed-token axis control byte: plan says fail closed until the rule is known; the controlled specimens are in generated/ (absent); 126 real anchors (26 files) give no oracle without COM |
| 58 | blocked: specimens + renderer | stacked area / offset lines need the #13 renderer; the dash field needs the generated specimens' planted dashes |
| 59 | blocked: needs generated corpus | scorer-only change (`tools/plot_corpus/frontend_view.py`); cannot be run or checked without generated/ |
| 60 | public part done by lane LT | public: 128 `TableN`, 124 link tables (grouped since lane LT, F-118), 4 hold numeric data (kept on purpose). The rest of the 184 are in the owner corpus: re-count there |
| 61 | blocked: specimens / COM | `huge_tiny` is generated-only; real-corpus residue needs COM (x field, user templates) |
| 62 | blocked: needs oracle | bin width / start need a by-construction oracle (no COM readback found); `huge_tiny` generated-only |
| 63 | blocked: needs specimens | all six families are generated specimens (anchor `column/clean`) |
| 64 | not attempted | renderer work (100 % stack, grouped / stacked horizontal bars, floating column) plus owner COM checks (SOP_meas Graph67, Graph_Template Graph1) |
| 65 | blocked: needs COM | Plot Details `Scale` / `ColorMap` trees must be proven per mode over COM (`l7s/qz_fmt.c` pattern) |
| 66 | blocked: needs COM / specimen | ColorMap min/max sit outside the 519-byte record; the heatmap_matrix specimen is generated-only; jiahehu2000 needs a reversed-Y map first |
| 67 | blocked: renderer + specimens | waterfall rendering (#13) missing; 8 specimens generated-only |
| 68 | not attempted | lane V draws vectors (F-116); the 14 real plots' end columns need COM `GetModifiers` on 30流场 / 50流场 (open owner check in `plot_kinds.md`) |

## OWNER items (need the owner, a real machine, or a decision)


**BUGS_AND_ISSUES.md**

- line 189: Check at least one Reductus file variant beyond the repository fixture before broadening name matching.
- line 223: Owner verifies the reported file visually on Windows.
- line 473: Test hierarchy comprehension with a project containing several books, sheets, and saved graphs with similar names. — nee
- line 502: A new user can identify folders, workbooks, worksheets, and saved graphs without trial-and-error clicking. — glyphs now 
- line 503: At least six worksheet rows are comfortably visible in a typical-height Library without scrolling past large previews. —
- line 507: The reported Origin project remains navigable with no missing or duplicated nodes. — not tested against the owner's actu
- line 508: Owner verifies the revised workflow on the reported project. — pending; required before this item can be marked complete
- line 725: Decide whether a dropped link is worth preserving as inert historical
- line 893: Owner verifies when required.
- line 1087: Owner verifies when required.
- line 1196: Reproduced through the UI on real owner data (not required for the
- line 1242: Owner verifies on real mixed data.
- line 1360: Confirmed visually on real owner data.
- line 2635: Owner verifies when required.
- line 6812: Owner verifies when required — a real Save/reopen of a project
- line 6938: Confirmed visually on owner data.
- line 7283: Owner verifies when required
- line 7676: Owner verifies when required
- line 7888: Owner verifies on the real m3learning_rsm.xrdml workflow
- line 8029: Owner verifies
- line 8276: Owner verifies on the reported VSM file
- line 8365: Owner verifies the original gapped hysteresis file in Curve Fit
- line 8526: Owner: visually confirm menu grouping, hover timing, and legibility in
- line 8788: Owner confirms, on the reported Origin project, that the eight marks
- line 8895: Owner verifies fast drag and resize behavior in the desktop app.
- line 9011: Residual: tauri://localhost is the origin of EVERY Tauri app on the
- line 9383: Owner confirms box and sector resizing feel reliable in the desktop build.

**CHATGPT_SOL_TO_CLAUDE_RELEASE_HANDOFF.md**

- line 65: Smoke-test Windows and macOS native pickers. Ubuntu is bonus coverage, not a blocker. UNMET — this lane has no Windows/m
- line 123: Record pass/fail with screenshots or concise reproduction steps.
- line 124: Copy/paste should take seconds; first production figure remains a 20-minute maximum and unfamiliar-data import a 30-minu
- line 141: Owner acceptance on the installed build — now against RC4, not RC3 (carries C5 and R2).

**FIGURE_AUTHORING_WORKFLOW_PLAN.md**

- line 106: Perform a visible, timed desktop usability session. The in-app browser
- line 1633: A1 Arbitrary data: Drop/import data, confirm inferred roles, and
- line 1650: A2 Mouse editing: Change line/scatter mode, colors, widths, errors,
- line 1669: A3 Lossless figure: Save, close, reopen, and compare the complete
- line 1679: A4 Complex 1-D: Repeat A3 with y2, asymmetric errors, hidden/reordered
- line 1702: A5 Group/facet: Build with Group/Facet, edit on Stage, save/reopen,
- line 1728: A6 Multi-panel: Build a 2×2 page, link then unlink axes, rearrange,
- line 1786: A7 Office clipboard: Copy a 300-DPI image into PowerPoint and Word in
- line 1794: A8 Vector export: Export SVG/PDF and compare limits, ticks, text,
- line 1846: A9 Time targets: First unfamiliar dataset to acceptable figure in at
- line 1849: A10 Platforms: Complete the core journey on Windows and macOS;

**GUI_INTERACTION_PLAN.md**

- line 66: Owner visual feel-check in the packaged Windows build at 100%, 125%, and

**JMP_GAP_PLAN.md**

- line 383: Three representative real projects finish with neither Origin
- line 386: A grouped categorical analysis (text factors) goes from file to

**ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md**

- line 826: Tag or record the baseline preview build and run the owner’s 20-minute
- line 828: Owner starts the real switch-trigger project/friction log and confirms
- line 879: ChatGPT-Sol reviews wording, menus, previews and recovery affordances. — SOL, still open.
- line 896: Run Windows and macOS packaged smoke tests: import, browse, quick plot,
- line 899: Owner performs a 60–90 minute real-data session and records friction.
- line 900: Verify installer/logo/desktop/taskbar behavior in the release artifact.
- line 915: Complete the four Day-6 gates above with recorded evidence. Run the
- line 920: Test an installed, packaged app rather than only its build and sidecar.
- line 1064: Schedule post-sprint triage after the owner has used the build. OPEN

**POST_RELEASE_PROBLEM_AUDIT.md**

- line 33: Install the Windows artifact and verify upgrade-in-place, icon identity,
- line 35: Install the macOS artifact and verify Gatekeeper/right-click-open,
- line 47: Run import -> Library -> worksheet -> editable figure against the owner's
- line 49: Run .refl -> Error Columns -> editable figure on Windows and record
- line 51: Time unfamiliar-file-to-acceptable-figure and figure-to-PowerPoint copy.
- line 73: Exercise the acceptance matrix in FIGURE_AUTHORING_WORKFLOW_PLAN.md
- line 76: Compare at least one saved/reopened frozen figure containing gaps with
- line 288: BUG-001 / P0: owner visual verification and a second Reductus variant
- line 290: UX-001 + UX-004 / P1: compact rows and unique marks landed, but the

**POST_SPRINT_INDEPENDENT_REVIEW.md**

- line 238: Install the Windows RC and run import → browse → Quick Plot/Quick Figure →
- line 240: Repeat the supported macOS workflow on an installed artifact.
- line 241: Exercise real native dialogs: cancel, long Unicode path, disconnected
- line 243: Verify desktop, Start menu/Dock and taskbar icons from the installer.
- line 244: Run the owner's 60–90 minute real-data session with Origin/JMP closed and
- line 246: Judge representative Origin comparison images for visual fidelity; a
- line 248: Record OS, artifact name, exact SHA, dataset/workflow and verdict.

**PRIMARY_SOFTWARE_AUDIT_PLAN.md**

- line 317: Choose the representative project required by GOTO_PLAN Q9.
- line 318: Time import-to-first-plot and import-to-production-ready-figure.
- line 319: Record every impulse to open Origin, JMP, Python, or request code changes.
- line 320: Classify friction as defect, missing feature, discoverability,
- line 322: Include source format/size, desired result, screenshot, and workaround.
- line 323: Verify raw data remain unchanged and the project survives restart.
- line 324: Verify figure copy to PowerPoint and Word takes seconds.
- line 328: Arbitrary data are plausibly plotted in under 5 minutes without code.
- line 329: Production-ready figure is reached within 20 minutes.
- line 330: Routine fit/analysis is complete within 30 minutes.
- line 331: Copy/paste takes seconds and looks correct at normal Office scale.
- line 332: Reopen preserves data, plots, styles, annotations, analysis, provenance,
- line 334: Any use of another application is documented and triaged.
- line 343: Review all 62 paired Origin/Quantized screenshots.
- line 344: Mark acceptable, ugly, scientifically wrong, layout wrong, or unknown.
- line 345: Check plot mode, errors, colors/widths, autoscale/outliers, axes, ticks,
- line 347: Export marks so decode-plan #55/#56 can close or receive concrete tasks.
- line 420: Environment/evidence gate: direct manipulation targets <100 ms —
- line 440: Failed thresholds have profiles (mechanism-level attribution exists:
- line 647: Packaged Windows/macOS E2E covers the lifecycle. Not shipped —
- line 3645: Validate on representative owner instruments/phases.
- line 3704: Validate representative XRR and PNR fits against trusted results. Open:
- line 3726: Validate on owner data before expanding.
- line 8476: Owner decision recorded above (P3.3 CVD default-palette gap).
- line 8477: Owner has ratified (or replaced) tol-bright's #999933 8th slot.
- line 8752: Windows/macOS scaling and high-DPI readability.
- line 9642: Windows/macOS vector copy and 300-DPI raster fallback. "Copy figure" /
- line 10828: Fresh-machine PyPI and packaged acceptance.
- line 10829: Windows signing and two-release updater E2E.
- line 10830: macOS signing/notarization, launch, update, uninstall.
- line 10831: Ubuntu .deb smoke test when low effort.
- line 10832: Record OS, checksum, timing, first import, upgrade, recovery.
- line 10904: Three representative real projects finish without unplanned Origin/JMP.
- line 10905: First plot <5 minutes; production figure <20 minutes.
- line 10906: Office copy takes seconds and passes Windows/macOS visual review.
- line 10907: Projects survive reopen, moved/offline sources, interrupted save, and
- line 10909: Technique-scoped recipes work on new related datasets, opt in, and never
- line 10911: Multiple metadata rows/factors drive legend/group/facet/category without
- line 10913: Representative large 2-D/long sessions meet documented targets.
- line 10914: High-priority Origin screenshot mismatches are fixed or accepted.
- line 10915: Frequent techniques have validated end-to-end workflows.
- line 10916: Fresh Windows/macOS install and upgrade pass.
- line 10917: Remaining Origin-only features are low-frequency, explicitly deferred,

**PRIMARY_WORKFLOW_ROADMAP.md**

- line 21: Manual sign-off with representative SIMS, XRD, reflectometry, magnetometry, and generic files.
- line 22: Revisit the action order and stage descriptions after several real analysis sessions.

**THIN_FILM_STACK_PLANNING_PLAN.md**

- line 122: Decide what to do with the MATLAB data issues found while porting: anatase
- line 167: Run tools/matlab/freeze_diraculator_values.m against ../quantized_matlab
- line 222: Decision D2 (below): choose the data source.

## GATED items (deliberately deferred)


**ANALYSIS_CAPABILITY_ROADMAP.md**

- line 1681 [JMP census J13-J16]: Defer clustering, control charts/capability, Gauge R&R, and DOE until the
- line 1725 [needs representative owner data]: Add linked fit families and constrained batch-series comparison after
- line 1791 [needs representative owner data]: Add only against representative owner data and trusted expected results.

**BUGS_AND_ISSUES.md**

- line 729 [only if a 'copy with dependents' scope is added]: If a "copy with dependents" scope is ever added, revisit: the link would

**FIGURE_AUTHORING_WORKFLOW_PLAN.md**

- line 203 [owner gates D-1/D-3/D-4]: F2.1 Bind the preview to FigureDocument — BLOCKED on owner gates
- line 227 [owner gates D-1/D-3/D-4]: F2.1f Open saved legacy figures canonically (BLOCKED on the
- line 235 [owner gates D-1/D-3/D-4]: F2.1g Retire legacy mode (BLOCKED on F2.1f + the archival owner
- line 1886 [revisit after owner use]: Reassess names (“Publication Preview” versus “Figure Builder”) after F2;
- line 1889 [revisit after owner use]: Reassess whether Stage and publication preview should remain separate
- line 1891 [revisit after owner use]: Reassess organization and search after real projects accumulate; keep
- line 1893 [revisit after owner use]: Reassess automatic template suggestions only after manual templates are

**GUI_INTERACTION_PLAN.md**

- line 192 [Origin recovery evidence gate; Origin import]: .opju migration edges (matrix books, some 2-D instrument data, richer

**JMP_GAP_PLAN.md**

- line 389 [JMP census]: Every census-listed JMP platform has a validated quantized

**LIBRARY_WORKBOOK_UX_PLAN.md**

- line 3442 [needs real cross-workbook use]: Revisit L0.44 after real cross-workbook work to confirm that folder-level

**MAIN_PLAN.md**

- line 471 [deferred follow-up]: Deferred follow-up, not part of the first implementation: add
- line 476 [after owner testing]: Revisit after owner testing whether density-derived volume,

**ORIGIN_FILE_DECODE_PLAN.md**

- line 776 [Origin specimen/evidence]: Native >2-Y-axes rendering. SPECIMEN-GATED: no corpus figure has a proven >=3-axis composition [Origin plan: c
- line 1112 [Origin specimen/evidence]: Absent, fail closed: long names / units on COM-covered columns (deliberate fail-closed) [Origin plan: classifi
- line 1145 [Origin specimen/evidence]: Fill-colour field of a bar record; needs a COM-built specimen that changes only the fill [Origin plan: classif

**PORT_CHECKLIST.md**

- line 94 [no Oxford samples/specification]: importOxford — still blocked, not attempted. Unlike Opus/SPC,

**PRIMARY_SOFTWARE_AUDIT_PLAN.md**

- line 348 [needs reviewed evidence]: Do not implement graphic objects or >2 Y axes without reviewed evidence.
- line 412 [P1.1 offline/deleted distinction]: Sequencing-blocked by P1.1: network/offline source transitions
- line 5465 [real need]: Add ROI statistics/export only from real need.
- line 6035 [GOTO Q4]: Interactive 3-D remains gated by GOTO Q4; static 3-D is adequate now.
- line 9619 [usage]: Search comes later if real use proves navigation insufficient.
- line 9620 [usage]: Revisit organization after usage; do not freeze it prematurely.
- line 9890 [Windows Office evidence]: Consider EMF only if Windows Office tests show material benefit.
- line 9891 [future goal]: Editable embedded figures remain a future goal, not release blocker.
- line 10839 [evidence/specimen/samples]: Origin graphic objects wait for evidence (#53).
- line 10840 [evidence/specimen/samples]: Origin >2 Y axes wait for specimen (#54).
- line 10841 [evidence/specimen/samples]: .opju matrix/2-D edges prioritize supplied real files.
- line 10842 [evidence/specimen/samples]: Rigaku variable-step, unsupported SPC, and Oxford import wait for

**THIN_FILM_STACK_PLANNING_PLAN.md**

- line 223 [decision D2]: Surface-energy lookup by material and (hkl). The value's source must be

## STALE items

Ticked with `(stale: reason)`:

- `BUGS_AND_ISSUES.md:8969`: (stale: MATLAB is not a gate (owner decision 2026-11-21); sibling repo) Decide deliberately whether MATLAB parrattRefl should change sign (sibling rep
- `BUGS_AND_ISSUES.md:9068`: (stale: recorded as not required) Owner verifies when required -- not required.
- `BUGS_AND_ISSUES.md:9326`: (stale: recorded as not required) Owner verifies when required — not required.
- `CHATGPT_SOL_TO_CLAUDE_RELEASE_HANDOFF.md:113`: ~~Perform owner testing on RC2~~ — SUPERSEDED by C6/RC3. RC2 was cut and published but never owner-tested; 19 further merges (#221-#239) landed after 
- `CHATGPT_SOL_TO_CLAUDE_RELEASE_HANDOFF.md:126`: (stale: superseded: v0.23.0 was tagged; releases continue to v0.40.1) Promote v0.23.0 only after blockers close on the exact candidate SHA and rollbac
- `ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md:895`: (stale: sprint over: v0.23.0 shipped, later releases to v0.40.1) Fix release blockers only, using one PR per root cause where practical.
- `POST_SPRINT_INDEPENDENT_REVIEW.md:636`: (stale: superseded: v0.23.0 shipped; releases continue to v0.40.1) R2 packaged and owner acceptance is recorded against the candidate.
- `POST_SPRINT_INDEPENDENT_REVIEW.md:641`: (stale: superseded: v0.23.0 shipped; releases continue to v0.40.1) Full backend, frontend, typecheck, lint policy, build, E2E, CodeQL and

Standing checklists left unticked (not work items):

- `ANALYSIS_CAPABILITY_ROADMAP.md`: lines 1819, 1820, 1821, 1823, 1825, 1827
- `BUGS_AND_ISSUES.md`: lines 8548, 8549, 8550, 8551, 8552, 8556, 8557, 8558, 8559, 8563, 8564, 8565, 8566, 8570, 8571, 8572, 8573, 8574
- `CHATGPT_SOL_TO_CLAUDE_RELEASE_HANDOFF.md`: lines 125
- `FIGURE_AUTHORING_WORKFLOW_PLAN.md`: lines 1873, 1874, 1876, 1877, 1878, 1879, 1880, 1882
- `POST_RELEASE_PROBLEM_AUDIT.md`: lines 14, 16, 18, 20
- `PRIMARY_WORKFLOW_ROADMAP.md`: lines 88, 89, 90, 91, 92, 93
- `TEST_DETERMINISM_PLAN.md`: lines 132

## UX audit 10, lane C: context menus and the palette (2026-11-24; owner-approved recommendation 2026-11-23, details provisional)

- [x] P1-5 worksheet: a right-click on a data cell opens a cell menu (Cut, Copy, Paste, Clear contents, Fill down, then the row entries); the right-clicked cell joins the range unless already inside it. The header menu's Hide / Freeze on the X column now say why ("the X column is always shown / pinned") instead of "select a column first"; a disabled Delete column is no longer red.
- [x] P1-6 plot menu: "Grid lines" checkbox; the four copy variants are one Copy submenu (Figure, Figure (vector), Image (screen), Data (TSV)); "Export figure…" added beside Save as PNG; "Peak fitting" sentence case.
- [x] P1-7 Library row menus: at most 16 top-level entries (pinned by `rowMenuGroups.test.ts`). Source (Re-import, auto-update, Reveal source), Move (folders, new folder, Move up/down), Derive and combine, and "N selected" are submenus; "Browse" is listed only where it can run. Re-import has one spelling ("Re-import ...", also the dialog). Provisional, owner to confirm: the submenu names and grouping.
- [x] P1-11 palette: whole-query aliases (`PALETTE_ALIASES`) put Preferences first for "settings / options / config", the theme toggle first for "dark / light / theme", Close window first for "close". Provisional, owner to confirm: the alias list.
- [ ] Not done (needs the menu bar, lane UX10-B): the palette-only commands (Export PDF/SVG/PNG, Log X/Y scale, Normalize · ...) still exist only in the palette; dropping them silently would remove capability, so each needs a menu home or an explicit owner decision to drop. The 40-word Auto-update tooltip (`lib/sourceWatch.ts`) and the Title Case "Quick Plot", "Freeze Copy" banner label are outside this lane's files.
