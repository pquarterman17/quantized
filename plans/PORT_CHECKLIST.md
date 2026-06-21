# quantized — Port Checklist

Exhaustive feature inventory derived from `quantized_matlab` (main @
`95e1994`, 2026-06-21). Each line maps a MATLAB feature to its source so
the port is traceable. **Check an item only when it is ported AND
golden-verified against the MATLAB output** (per `CLAUDE.md`).

Grouped by the `PORT_PLAN.md` workstreams. Source paths are relative to
`../quantized_matlab/`.

---

## W1 — Parsers & I/O (`io/`)

### Parsers (each returns `DataStruct`)
- [x] Quantum Design VSM — `+parser/importQDVSM.m` — golden `fb3efe2`
- [x] Quantum Design PPMS — `+parser/importPPMS.m` — golden `a1960b5` (synthetic fixture)
- [x] MPMS — `+parser/importMPMS.m` — golden `58cd15c` (delegates to QD VSM)
- [x] Column shorthands (`field/moment/temp/time/stderr/all`) — `io/base.resolve_column` (used by QD/MPMS)
- [~] Rigaku `.raw` — `+parser/importRigaku_raw.m` — **1D binary golden `488cf4b`**; 2D RSM still TODO
- ~~Bruker — `+parser/importBruker.m`~~ — **out of scope → fermiviewer** (image data)
- [~] PANalytical XRDML — `+parser/importXRDML.m` — **1D golden `5d7f1e7`**; **2D area-detector (RSM)** + `computeQSpace` IN SCOPE, still TODO
- [x] NCNR neutron PNR — `+parser/importNCNRPNR.m` — golden `58cd15c`
- [x] NCNR reflectometry — `+parser/importNCNRRefl.m` — golden `8f9e4f8`
- [x] NCNR `.dat` — `+parser/importNCNRDat.m` — golden `58cd15c`
- [x] refl1d `.dat` — `+parser/importRefl1dDat.m` — golden `58cd15c`
- [x] Lake Shore VSM — `+parser/importLakeShore.m` — golden `41dfef9` (synthetic fixture)
- [x] SIMS depth profile — `+parser/importSIMS.m` — golden `2a7a538` (shared exact + paired interp 1e-9)
- ~~AFM — `+parser/importAFM.m`~~ — **out of scope → fermiviewer** (AFM topography/phase images)
- [x] Generic CSV — `+parser/importCSV.m` → `io/delimited.py` — golden `a0a8929`
- [x] Excel — `+parser/importExcel.m` → `io/excel.py` (openpyxl) — golden `ce228ba`
- [ ] Header parsing / auto-detect — `+parser/parseColHeader.m`
- [ ] Auto-dispatch + registry — `+parser/importAuto.m`, `+parser/resolveParser.m` → `io/registry.py` (single map + sniffers)
- [ ] DataStruct contract — `+parser/createDataStruct.m` → `datastruct.py`

### Export writers
- [ ] XRD CSV — `+utilities/writeXRDcsv.m`
- [ ] HDF5 — `+utilities/exportHDF5.m`
- [ ] Origin-ASCII + `.ogs` LabTalk script — `+utilities/exportOriginScript.m`
- [ ] Reflectivity/neutron consolidated CSV (role-based columns) — BosonPlotter CSV path

### Origin live bridge — Windows-only OS-gated optional (W1 #14)
- [ ] COM connect/send — `+utilities/connectOrigin.m`, `+utilities/toOrigin.m` (mock-tested only)

### Paused (awaiting example files)
- [ ] `importOxford`, `importOpus`, `importSPC`

---

## W2 — Corrections & processing (`calc/`)

### Corrections pipeline
- [x] Offsets / BG (slope/intercept/poly) / trim / units / smooth / norm / derivative — `bosonPlotter.applyCorrections` + `correctionParams` → `calc/corrections.py` — golden (XRD trim+bg+smooth+norm; derivative; magnetometry field-convert+emu/g). Pure 8-step pipeline composed from ported helpers. `applyParserAnalysisConfig.m` is GUI relabeling only (no math, not ported).
- [ ] Magnetometry mass/dimension normalization — `+utilities/convertMagUnits.m`
- [ ] Magnetic background subtraction — `+utilities/subtractMagBackground.m`
- [ ] BG-from-file / fit-BG-from-region — BosonPlotter + `+utilities/estimateBackground.m`

### Baselines
- [x] ALS — `+utilities/baselineALS.m` → `calc/baseline.py` — golden (scipy.sparse)
- [x] Rolling ball — `+utilities/baselineRollingBall.m` → `calc/baseline.py` — golden; grayscale morphological opening (ball erosion/dilation) + boxcar smooth replicated
- [x] ModPoly — `+utilities/baselineModPoly.m` → `calc/baseline.py` — golden; iterative polynomial clipping (Lieber) replicated
- [x] Generic estimate — `+utilities/estimateBackground.m` → `calc/baseline.py` — golden (snip/polynomial/iterative); SNIP clip + boxcar smooth + robust poly + peak-dilation refine replicated

### Processing utilities
- [x] Smooth — `+utilities/smoothData.m` → `calc/processing.py` — golden (moving/gaussian/savgol); line-for-line port (reflect-pad conv + SG interior kernel + per-point polynomial edge fits)
- [x] FFT filter — `+utilities/fftFilter.m` → `calc/spectral.py` — golden (lowpass + bandpass); Butterworth transfer, freq-axis wrap, window normalization
- [x] Spectral FFT — `+utilities/fftSpectral.m` → `calc/spectral.py` — golden (psd/magnitude one-sided, two-sided, Welch); windows + nextpow2 + fftshift replicated
- [x] Normalize — `+utilities/normalize.m` — golden `bbb504b`
- [x] Unit convert — `+utilities/convertUnits.m` → `calc/units.py` — golden (field/moment/temp/angle/length + same-unit + cross-family raise); makeValidName keying replicated via regex
- [x] Resample — `+utilities/resampleData.m` → `calc/resample.py` — golden (linear/pchip/spline=not-a-knot/makima + step colon grid); scipy interpolators match MATLAB interp1 to 1e-9
- [x] Derivative / log-derivative / cumulative integral — `+utilities/{derivative,logDerivative,cumulativeIntegral}.m` → `calc/processing.py` — all golden
- [x] Dataset algebra — `+utilities/datasetAlgebra.m` → `calc/aggregate.py` — golden (A+B/A-B/A*B/A/B/asymmetry; pchip interp + NaN guards + labels/units). **MATLAB bug #3:** datasetAlgebra calls `createDataStruct('Time',..,'Values',..)` with name-value but createDataStruct is positional → uncallable; golden frozen via inline algebra, port assembles DataStruct correctly. See memory project_matlab_bugs_from_golden.
- [x] Robust peak find — `+utilities/findPeaksRobust.m` → `calc/peaks.py` — golden (peaks + bg); local-maxima + prominence/slope/width/SNR/min-sep filters replicated; compare_calc extended for list-of-dicts
- [x] Cross-correlation — `+utilities/crossCorrelation.m` → `calc/spectral.py` — golden (coeff + none); FFT-based, lag reassembly + peak-by-magnitude replicated
- [x] 2D regrid / interpolate — `+utilities/regrid2D.m`, `+utilities/interpolate2D.m` → `calc/interp2d.py` — golden: linear/idw/thinplate exact, regrid(idw) exact. CAVEATS: `nearest` parity is Voronoi-boundary tie-break-dependent (structural test only); `natural` (MATLAB DEFAULT) + `cubic` use scipy Clough-Tocher fallback — scipy has NO Sibson natural-neighbour, so these two are NOT bit-for-bit MATLAB-equal (needs user decision: accept fallback, add `naturalneighbor` dep, or change default)
- [x] Peak shapes — `+utilities/{pseudoVoigt,splitPearsonVII,tchPseudoVoigt}.m` → `calc/peakshapes.py` — golden

### Magnetometry analysis
- [x] Hysteresis analysis — `+utilities/hysteresisAnalysis.m` → `calc/magnetometry.py` — golden (whole struct @1e-7: Hc/Mr/Ms/squareness/loopArea/SFD/dM-dH/warnings); branch-split + zero-crossing interp + gaussian-presmooth derivative replicated. Added `pre_smooth` to calc/processing.derivative. NOTE: MATLAB PreSmooth>0 path is broken (calls smoothData(H,M,..) positionally — uncallable); default 0, port does the intended savgol.
- [x] Relaxation comparison — `+utilities/compareRelaxation.m` → `calc/relaxation.py` — golden (whole struct @1e-4); Arrhenius closed-form exact, VFT Nelder-Mead matched MATLAB fminsearch to ~1e-5 (same minimum); AIC/BIC model selection
- [x] Subtract mag background — `+utilities/subtractMagBackground.m` → `calc/magnetometry.py` — golden (auto + explicit FitRange); linear high-T fit
- [x] Convert mag units — `+utilities/convertMagUnits.m` → `calc/magnetometry.py` — golden (field Oe/T/mT/A/m + sample-aware moment emu→emu/g/cm³/A·m²); warning paths tested structurally

### Statistics (no toolbox)
- [x] Descriptive stats — `+utilities/descriptiveStats.m` — golden `bbb504b`
- [x] Linear regression — `+utilities/linRegress.m` — golden; betainc t/F p-values match MATLAB exactly. confBand/predBand fn-handles not ported (recompute at call site)
- [x] t-test / ANOVA — `+utilities/tTest.m`, `+utilities/anova1.m` — golden (one-sample + Welch two-sample + 3-group ANOVA); CI uses replicated norminv+Newton tinv for exact parity
- [x] PCA — `+utilities/pcaAnalysis.m` — golden; SVD + largest-loading sign convention → deterministic across MATLAB/numpy
- [x] Confidence band — `+utilities/confidenceBand.m` → `calc/aggregate.py` — golden (mean + median); pchip + Hazen prctile match MATLAB. **MATLAB bug found:** `NPoints {mustBePositive} = 0` is uncallable in R2025b (defaults are validated); port keeps `n_points=0` as the intended "use maxLen" default. Surfaced for user — not fixed (sibling repo, out of autonomous scope).

### Error propagation
- [~] add/mul/div/func — `calc/errors.py` — add/mul/div golden, func unit-tested; `errorProp` (fn-handle/MC) TODO

---

## W3 — Fitting (`calc/fitting/`)

### Engine
- [x] Curve fit driver — `+fitting/curveFit.m` → `calc/fitting.py` — golden (params/R2/chiSqRed/RMSE/AIC/errors all match MATLAB ~1e-8..1e-16); bounded NLLS via scipy Nelder-Mead + logit/log bound-transform + numerical-Hessian covariance. Supports Lower/Upper/Weights/Fixed; Constraints/ParamNames deferred (need parseEquation/applyConstraints).
- [x] Model registry — `+fitting/models.m` → `calc/fit_models.py` + `calc/fit_models_special.py` — ALL 29 models golden @1e-9 (23 closed-form + 6 helper-based: Langevin/Brillouin/Stoner-Wohlfarth/Debye/Einstein/Debye+Einstein). scipy.quad matches MATLAB integral() to ~1e-15 for Debye/Einstein; reuses peakshapes.pseudo_voigt
- [x] Equation parser (no eval) — `+fitting/parseEquation.m` → `calc/fit_equation.py` — golden (5 equations: funcs/powers/unary-minus/multi-param; param-name order + values). Shunting-yard → RPN, interpreted on a stack (NO eval/exec — safer than MATLAB's str2func)
- [x] Auto-guess — `+fitting/autoGuess.m` → `calc/fit_autoguess.py` — golden (all 29 models' initial-param guesses @1e-9). **MATLAB bug #4 found+fixed** (agent fd11792): autoGuess used Statistics-Toolbox `range()` → uncallable on base MATLAB; replaced with max-min. Port uses np.ptp.
- [ ] Constraints — `+fitting/applyConstraints.m`
- [ ] ODR (orthogonal distance regression) — `+fitting/odrFit.m`

### Batch / global
- [ ] Batch fit — `+fitting/batchFit.m`
- [ ] Global / shared-parameter fit — `+fitting/globalFit.m`, `+fitting/globalCurveFit.m`
- [ ] Peak tracking — `+fitting/trackPeak.m`

### Diagnostics / comparison / Bayesian
- [x] Fit comparison (AIC/BIC/F) — `+fitting/fitCompare.m` → `calc/fit_stats.py` — golden (R2/adjR2/AIC/AICc/BIC/F-test; betainc F p-value)
- [x] Residual diagnostics — `+fitting/residualDiagnostics.m` → `calc/fit_stats.py` — golden (QQ/Durbin-Watson/runs/skew/kurtosis)
- [x] Confidence/prediction bands — `+fitting/fitBands.m` → `calc/fit_stats.py` — golden (numerical-Jacobian CI/PI bands; Cornish-Fisher+bisection t-quantile replicated)
- [ ] MCMC sampling — `+fitting/mcmcSample.m`

### Reflectivity fitting
- [x] Parratt recursion — `+fitting/parrattRefl.m` → `calc/reflectivity.py` — golden (R(Q) for 3-layer stack, with + without Gaussian resolution smearing @1e-9); Névot-Croce roughness, complex Fresnel internally, real |r|² output
- [x] SLD profile / spline SLD / profile→layers — `+fitting/{sldProfile,splineSLD,profileToLayers}.m` → `calc/sld.py` — golden (erf-interface profile; pchip knot spline; midpoint discretization)
- [x] SLD presets — `+fitting/reflSLDPresets.m` → `calc/sld.py` (+ `refl_sld_presets.json`) — 30-material table dumped verbatim to JSON for exact data parity; loader exposes refl_sld_presets()

### XRD / RSM / surface
- [ ] RSM analyze / strain — `+fitting/rsmAnalyze.m`, `+fitting/rsmStrain.m`
- [ ] Pawley refinement — `+fitting/pawleyRefine.m`
- [ ] Surface (2D) fit / models / auto-guess — `+fitting/{surfaceFit,surfaceModels,surfaceAutoGuess}.m`

### Peak fitting (BosonPlotter Peak workshop)
- [ ] Lorentzian peak fit, auto-find, multi-peak, constrained widths — `+bosonPlotter/+peak/`

### Hysteresis (BosonPlotter Hysteresis workshop)
- [ ] Hysteresis models — `+fitting/hysteresisModels.m`

---

## W4 — Calculators (`calc/`, DiraCulator parity)

### Calculator domains (panels) — `DiraCulator.m` build*Tab
> DEFERRED (autonomous): formulas are embedded in DiraCulator GUI build*Tab functions, not standalone +calc files. Porting requires extracting each formula into a clean `calc/<domain>.py` and freezing via inline MATLAB computation. Backend `+calc/*.m` helpers (below) are ported first.
- [ ] Unit Converter — `buildUnitConverterTab`
- [ ] Crystal — `buildCrystalTab`
- [ ] Electrical / transport — `buildElectricalTab`
- [ ] Semiconductor — `buildSemiconductorTab`
- [ ] Thin Film — `buildThinFilmTab`
- [ ] Periodic Table — `buildPeriodicTableTab`
- [ ] X-ray & Neutron (d-spacing, Q↔2θ, SLD) — `buildXrayNeutronTab`
- [ ] Superconductor — `buildSuperconductorTab`
- [ ] Magnetic — `buildMagneticTab`
- [ ] Optics — `buildOpticsTab`
- [ ] Vacuum — `buildVacuumTab`
- [ ] Electrochemistry — `buildElectrochemistryTab`
- [ ] Thermal — `buildThermalTab`
- [ ] Diffusion — `buildDiffusionTab`
- [ ] Substrates — `buildSubstratesTab`
- [ ] Reflectivity builder — `buildReflectivityTab`

### Backend data / helpers (`calc/`)
- [x] Physical constants — `+calc/constants.m` → `calc/constants.py` — golden (CODATA 2018, all 14 constants)
- [x] Element data — `+calc/elementData.m` → `calc/element_data.py` (+ `element_data.json`) — golden (bySymbol/byZ/getProperty); 118-element table dumped verbatim from MATLAB to JSON for exact data parity, loader exposes element_data/by_symbol/by_z/get_property
- [~] Crystal cache — `+calc/crystalCache.m` — DEFERRED: stateful .mat-backed persistence (not a pure function); revisit if the workspace/session layer needs it
- [x] Unit conversion — `+calc/unitConvert.m` → `calc/unit_convert.py` — golden (dimensional/temperature-offset/Ang-nm/energy-wavelength/Oe-T/energy-freq); full expression parser (tokenize+prefix+dims vector) + bridges replicated
- [x] CIF import — `+calc/importCIF.m` → `io/cif.py` — golden (cellParams/atomSites/blockName/spaceGroup/formula vs SrTiO3 fixture); full CIF tokenizer (comments/quotes/loops/uncertainty). Returns crystal dict, NOT registered in DataStruct registry (structural data, not a series).

### Meta panels (frontend, W7)
- [ ] History — `buildHistoryTab` · Favorites — `buildFavoritesTab` · Home — `buildHomeTab`
- [ ] Cross-panel hooks (d→Q, molar-mass→cell-vol, SLD→reflectivity)
- [ ] Headless API equivalent

---

## W5 — DataWorkspace (`calc/` + `routes/workspace`)
Source: `+dataWorkspace/`, `DataWorkspace.m`
- [ ] WorkspaceModel (datasets, columns, roles)
- [ ] Column roles
- [ ] Formula engine (no eval) + computed-column snapshots + recompute
- [ ] Sort / filter / descriptive stats / masking
- [ ] Workspace file format (`.dwk`) + autosave

---

## W6 — Plotting & render
- [ ] Plot state model (axes/limits/scales/dual-Y/per-dataset/tick-format)
- [ ] Interactive render (uPlot 1D; Canvas2D for 2D maps)
- [ ] Publication export — matplotlib → vector PDF/SVG, PNG/TIFF dpi
- [ ] Styles/templates (`aps`, report, web) — `+styles/`, `+plotting/`
- [ ] Waterfall · overlays/unified legend · reference lines · insets ·
      annotations · polar · multi-panel / figure builder

---

## W7 — Frontend (React revamp — reference, not 1:1 port)
- [ ] App scaffold + Zustand stores · theme (Dark/Light/Auto)
- [ ] Library (dataset list/import/groups/search)
- [ ] Stage (uPlot + 2D viewer)
- [ ] Inspector (corrections/axes/appearance)
- [ ] Workshops: curve fit · peak · hysteresis · reflectivity · graph digitizer
- [ ] DataWorkspace UI · DiraCulator UI
- [ ] Macro record/export (action log → reproducible script)

---

## Notes on scope
- **In scope, confirmed:** macro recorder (W7), graph digitizer (W7),
  Origin COM optional (W1).
- **Out of scope:** EM tooling (→ fermiviewer), watch-file auto-reload,
  in-app bug reporting.
- **Bruker (.brml/.raw) + AFM (.spm) → fermiviewer:** image data (Bruker
  area-detector files; AFM topography/phase images) belong with the imaging
  tooling in `fermiviewer`, not quantized. Removed from W1.
- **XRDML + Rigaku 2D (RSM) stay IN quantized:** reciprocal-space-map data
  feeds the RSM analysis (`rsmAnalyze`/`rsmStrain`) — it's XRD line/map data,
  not microscopy imaging. Port the 2D extensions here.
- The BosonPlotter "workshops" (Peak, Curve Fit, Hysteresis, Reflectivity)
  map to React `workshops/`; their *math* lives in `calc/`, their *state*
  in a hook, their *view* in components under the size ceiling.
