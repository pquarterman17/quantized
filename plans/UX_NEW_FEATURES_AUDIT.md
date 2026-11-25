# UX audit: features merged 2026-11-25 (PRs #993-#1015)

Lane `ux-new`. Method: `qz --no-browser`, Chromium driven through Playwright at
1280x800 and 1024x700, small synthetic data imported through the UI (a drifting
240-row log, eight M(H) isotherms, an XRD scan, the built-in 2-D example, a
life-data table, a polar matrix). Screenshots are kept in the lane scratchpad
(`ux-new/`), not in the repo.

Severity: P0 = the feature cannot be reached or used; P1 = a user is misled,
blocked or loses content at a required size; P2 = polish or wording.
Status: FIXED (this lane, re-verified in the browser), DEFERRED (reason given).
Choices marked "provisional, owner to confirm" are the lane's own judgement.

Counts: P0 1, P1 9, P2 13 (11 fixed or partly fixed, 12 deferred).

## P0

### P0-1 Magnetometry "Isotherms" tab was clipped out of the window (FIXED)
- Steps: Analyze > Magnetometry > Magnetometry tools. The tab strip shows
  Background ... Derived and a sliver of a seventh tab; "Isotherms" cannot be
  read or clicked at the default 480 px width (both sizes).
- Fix: window width 480 to 560 (provisional, owner to confirm). Re-checked: all
  seven tabs fully visible at 1280x800 and 1024x700.
- File: `frontend/src/components/workshops/magtools/MagToolsPanel.tsx`.

## P1

### P1-1 Export animation opened as a 120 px strip (FIXED)
- Steps: File > Export > Recipe library..., then "Export animation...". The
  dialog was rendered inside the Recipe Library window, so its
  `max-height: 100%` resolved against that window (about 120 px) and the form
  was cut off below "Frames from".
- Fix: portal the dialog to the app root. Re-checked: it is 432 px tall and
  fully usable.
- File: `frontend/src/components/workshops/batchfigures/BatchFigureLauncher.tsx`.

### P1-2 Animation export, Batch figures and Find-in-folder had no palette or menu path (FIXED for the palette)
- Steps: Ctrl+K "animation", "batch figures", "gif", "folder" found nothing
  useful; the only path to Export animation is the button inside Recipe library.
- Fix: palette keywords on Recipe library, Find in project, Curve fit
  (piecewise, convolution, ODE), Magnetometry tools (isotherm, Arrott,
  entropy), Signal processing (IIR families), Design of experiments (blocking,
  D-optimal), XRD reference pattern (match phases). A first-class
  File > Export > "Export animation..." menu entry is DEFERRED (it needs the
  dialog lifted out of the recipe window's launcher and a menu-model change;
  owner decision on where it belongs).
- Files: `frontend/src/commands/analysisCommands.ts`,
  `frontend/src/commands/commandDocs.ts`.

### P1-3 Statistical tests: input rows spill past the window edge (FIXED)
- Steps: Statistical tests > Life distribution (Distribution / Interval method /
  Plotting positions), Poisson rate (six fields), Control chart > EWMA (Target
  and Sigma). The last field of each row was clipped at the window edge and the
  body scrolled sideways (472, 461 and 502 px in a 438 px body).
- Cause: field wrappers were `flex: 1; min-width: 0`, so they shrank instead of
  wrapping, and a select with a long option outgrew its wrapper.
- Fix: `flex: 1 1 110px` in the four input files and
  `.qzk-win-body .qz-select { max-width: 100% }`. Re-checked at both sizes: no
  horizontal overflow.
- Files: `statstests/LifeInputs.tsx`, `SpcInputs.tsx`, `StatsTestsInputs.tsx`,
  `StatsTestsMoreInputs.tsx`, `frontend/src/styles/components.css`.

### P1-4 Wide result tables widen the whole results window (FIXED)
- Steps: Statistical tests > Response screening, pick two Y and two X, Run test.
  The 15-column table made the result section 1,082 px wide inside a 438 px
  window; the whole body scrolled sideways, hiding the section header buttons.
- Cause: `.qz-result-book` is a grid whose single column was `auto`.
- Fix: `grid-template-columns: minmax(0, 1fr)` so the table scrolls in its own
  box. Affects every result book (all saved results), intended.
- File: `frontend/src/components/workshops/resultbook/resultBook.css`.

### P1-5 Find in project: the scope buttons did not show which was active (FIXED)
- Steps: Find in project. "In project" and "In folder..." look identical;
  `aria-pressed` was set but nothing styled it. The disabled Search button gave
  no reason, and "In folder..." carried an ellipsis though it only switches scope.
- Fix: `.qz-btn[aria-pressed="true"]` is styled (also benefits the Layer
  contents dialog); label is now "In folder"; a visible line says what is missing.
- Files: `styles/components.css`, `search/SearchPanel.tsx`,
  `search/FolderSearch.tsx`, `search/SearchPanel.folder.test.tsx`.

### P1-6 Map operations: "Use box drawn on the map" disabled with only a tooltip (FIXED)
- Steps: Map operations > Crop to a rectangle on any 2-D map. The button is
  greyed out; the reason ("draw a box with the Box tool") was in `title` only.
  Same for Match phases / Index peaks (needs the wavelength tick).
- Fix: a visible hint line under the Crop button and under the wavelength
  checkbox in the XRD reference panel.
- Files: `mapops/MapOpsPanel.tsx`, `reductions/BuiltInPhaseIndexer.tsx`.

### P1-7 Material record table overflows the Calculators window (FIXED)
- Steps: Calculators > Substrates > Si(111) > "Material record and sources". The
  source column holds long unbreakable text (a `tests/golden/...json` path) and
  the table was 673 px in a 478 px body.
- Fix: `overflow-wrap: anywhere` on the value and source cells; value no longer
  `nowrap`. Dev-facing source text (MATLAB table names, golden file paths) shown
  to users is a P2, below.
- File: `calculators/MaterialSources.tsx`.

### P1-8 American spelling in new text (FIXED)
- "hypothesised" (Poisson rate, binomial labels, refusals, result tables and the
  backend messages), "centre" (control-chart rule labels, result table, backend
  rule text), "centred" (2-D FFT help, time series decomposition note),
  "unnormalised" (image filters), "signalled", "analyse" (time series empty
  state). Changed to the American forms. Left alone on purpose: "cancelled"
  (accepted in American English; owner may want "canceled"), "coloured" /
  "colour scale" in older chart descriptions outside this release, and the
  `centre` window-layout slot id (an identifier, not text).
- Files: see `git diff` for this commit (statsTests*, mapops/FilterFields,
  timeseries/*, calc/spc_rules.py, calc/stats_nonparam_ext.py,
  calc/map_imgfilt.py).

### P1-9 Docked tool window collapses to 200 px at 1024 px (DEFERRED)
- Steps: at 1024x700 open Analyze > Transform & signal > Signal processing. The
  window docks into a 200 px column (`DOCK_MIN_WIDTH`, the stage keeps 640 px),
  so the form and the new IIR options are cut off and scroll sideways.
- Deferred: the dock policy (`store/toolDock.ts`) is a standing owner design
  ("yields only on a viewport too narrow for both"); changing the minimum or
  floating below a width threshold touches every dockable window and its
  tests. Suggested (provisional, owner to confirm): float instead of dock when
  the column would be under 340 px.

## P2

| # | Finding | Steps | File | Status |
|---|---|---|---|---|
| P2-1 | Isotherms: "1 isotherms" after the new worksheet becomes the selection | Create a delta S worksheet; the button reads "from 1 isotherms" | `magtools/MagIsothermPane.tsx` | FIXED |
| P2-2 | Isotherms: "Select at least two worksheets in the Library to compare." is the Compare tab's wording | Isotherms tab with one worksheet | `store/magSeriesCompareRun.ts` | DEFERRED (shared with Compare; needs a prop) |
| P2-3 | Isotherms: the refusal for a unit such as "emu" ("a normalized unit is required") does not say where to set the unit; the 422 shows as a console error | Import M in emu, Isotherms, Create | `store/magIsothermRun*`, route | DEFERRED |
| P2-4 | Isotherms: temperature is not read from the file name (MH_275K); "Maximum field(s)" has no default | Eight files, Isotherms | `useMagIsotherms.ts` | DEFERRED (provisional behavior, owner call) |
| P2-5 | Header editor: Tags, LSL, USL, Target had no hint (separator unknown) | Double-click a column header | `Stage/worksheet/HeaderEditor.tsx` | FIXED (placeholders) |
| P2-6 | IIR: switching Method to IIR with the default cutoff 1 on a 1-unit X grid is refused at once (Nyquist 0.5) and logs two 422 console errors | Signal processing > Filter, Method IIR | `signalprocessing/*` | DEFERRED (default cutoff should follow Nyquist; owner to confirm the fraction) |
| P2-7 | Provisional, owner-to-confirm text is shown to users (EWMA defaults note, Isotherms, Match phases FOM, quick convert, SIMS) | Open those panels | `statstests/SpcInputs.tsx`, `magtools/MagIsothermPane.tsx`, `reductions/PhaseSearchPanel.tsx`, others | DEFERRED (the owner's marker; confirm whether it belongs in the UI or the docs only) |
| P2-8 | Result tables show raw keys (`target_source`, `sigma_source`, `lambda`, `k`, `h`) and an always-empty "rules" column for EWMA/CUSUM | Control chart > EWMA, Run | `lib/statsTestsResultsSpc.ts` | DEFERRED |
| P2-9 | Results are appended below the fold; the window does not scroll to them after Run | Control chart, Run test | `statstests/*` | DEFERRED |
| P2-10 | Time series Ljung-Box and ARIMA show p = 0 for very small p; should read "< 1e-300" or similar | ACF / PACF on a drifting series | `timeseries/TsResults.tsx` | DEFERRED |
| P2-11 | DOE D-optimal: two seed fields ("Optimizer seed" 0 and "Seed (blank = new)") and the center-point paragraph about response-surface designs is irrelevant | Design of experiments > Custom: D-optimal | `doe/*` | DEFERRED |
| P2-12 | Window titles in title case ("Export Animation", "Signal Processing", "Recipe Library", "Long Name") against sentence-case menu labels | Open each | `AnimationExportDialog.tsx` (fixed), others | PARTLY FIXED (Export animation only; the others pre-date this release) |
| P2-13 | Material record "sources" expose internal text (MATLAB table names, golden file paths) | Substrates > Material record | `calc/material_record.py` data | DEFERRED |

## Checked and fine

- Statistical tests: EWMA, CUSUM, Nelson rules 5-8, Dunn-Sidak, Mood, Poisson, Wilks, response screening, interval-censored life data all open from Analyze > Statistics and Quality & reliability and from the palette ("Statistical tests", "Control chart", "Time series"); refusals are specific ("Pick at least one factor (X) column.").
- Time series workshop (ACF/PACF, stationarity, decompose, change points, ARIMA): runs, results and "Add as worksheet" (disabled with a tooltip until a run).
- DOE blocking and D-optimal: generate, confounding list, D-efficiency.
- Match phases: ranks silicon first for a 4-peak synthetic pattern, unexplained peak listed.
- Map crop / 2-D FFT / filters, polar matrix input (refuses until the row angle is chosen), Isotherms (refusal copy and result), column spec limits, Find in folder, Material record, live reports panel load, no console errors apart from the expected 422 refusals (P2-3, P2-6).

## Not covered

Fit Model extras, Reopen ("Open in") for the five tools, Live reports refresh and the spectroscopy extras were only checked for load and console errors, not driven end to end. Animation export frames were not rendered (no saved figure with a By column was built).
