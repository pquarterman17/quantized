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
- [ ] Rigaku `.raw` — `+parser/importRigaku_raw.m`
- [ ] Bruker — `+parser/importBruker.m`
- [~] PANalytical XRDML — `+parser/importXRDML.m` — **1D golden `5d7f1e7`**; 2D area-detector (RSM) + `computeQSpace` still TODO
- [x] NCNR neutron PNR — `+parser/importNCNRPNR.m` — golden `58cd15c`
- [x] NCNR reflectometry — `+parser/importNCNRRefl.m` — golden `8f9e4f8`
- [x] NCNR `.dat` — `+parser/importNCNRDat.m` — golden `58cd15c`
- [x] refl1d `.dat` — `+parser/importRefl1dDat.m` — golden `58cd15c`
- [x] Lake Shore VSM — `+parser/importLakeShore.m` — golden `41dfef9` (synthetic fixture)
- [x] SIMS depth profile — `+parser/importSIMS.m` — golden `2a7a538` (shared exact + paired interp 1e-9)
- [ ] AFM — `+parser/importAFM.m`
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
- [ ] Offsets / BG (slope/intercept/poly) / trim / units / counts-per-sec — BosonPlotter corrections + `applyParserAnalysisConfig.m`
- [ ] Magnetometry mass/dimension normalization — `+utilities/convertMagUnits.m`
- [ ] Magnetic background subtraction — `+utilities/subtractMagBackground.m`
- [ ] BG-from-file / fit-BG-from-region — BosonPlotter + `+utilities/estimateBackground.m`

### Baselines
- [ ] ALS — `+utilities/baselineALS.m`
- [ ] Rolling ball — `+utilities/baselineRollingBall.m`
- [ ] ModPoly — `+utilities/baselineModPoly.m`
- [ ] Generic estimate — `+utilities/estimateBackground.m`

### Processing utilities
- [ ] Smooth — `+utilities/smoothData.m`
- [ ] FFT filter — `+utilities/fftFilter.m`
- [ ] Spectral FFT — `+utilities/fftSpectral.m`
- [ ] Normalize — `+utilities/normalize.m`
- [ ] Unit convert — `+utilities/convertUnits.m`
- [ ] Resample — `+utilities/resampleData.m`
- [ ] Derivative / log-derivative / cumulative integral — `+utilities/{derivative,logDerivative,cumulativeIntegral}.m`
- [ ] Dataset algebra — `+utilities/datasetAlgebra.m`
- [ ] Robust peak find — `+utilities/findPeaksRobust.m`
- [ ] Cross-correlation — `+utilities/crossCorrelation.m`
- [ ] 2D regrid / interpolate — `+utilities/regrid2D.m`, `+utilities/interpolate2D.m`
- [ ] Peak shapes — `+utilities/{pseudoVoigt,splitPearsonVII,tchPseudoVoigt}.m`

### Magnetometry analysis
- [ ] Hysteresis analysis — `+utilities/hysteresisAnalysis.m`
- [ ] Relaxation comparison — `+utilities/compareRelaxation.m`

### Statistics (no toolbox)
- [ ] Descriptive stats — `+utilities/descriptiveStats.m`
- [ ] Linear regression — `+utilities/linRegress.m`
- [ ] t-test / ANOVA — `+utilities/tTest.m`, `+utilities/anova1.m`
- [ ] PCA — `+utilities/pcaAnalysis.m`
- [ ] Confidence band — `+utilities/confidenceBand.m`

### Error propagation
- [ ] Core + add/mul/div/func — `+utilities/{errorProp,errorAdd,errorMul,errorDiv,errorFunc}.m`

---

## W3 — Fitting (`calc/fitting/`)

### Engine
- [ ] Curve fit driver — `+fitting/curveFit.m`
- [ ] Model registry — `+fitting/models.m`
- [ ] Equation parser (no eval) — `+fitting/parseEquation.m`
- [ ] Auto-guess — `+fitting/autoGuess.m`
- [ ] Constraints — `+fitting/applyConstraints.m`
- [ ] ODR (orthogonal distance regression) — `+fitting/odrFit.m`

### Batch / global
- [ ] Batch fit — `+fitting/batchFit.m`
- [ ] Global / shared-parameter fit — `+fitting/globalFit.m`, `+fitting/globalCurveFit.m`
- [ ] Peak tracking — `+fitting/trackPeak.m`

### Diagnostics / comparison / Bayesian
- [ ] Fit comparison (AIC/BIC/F) — `+fitting/fitCompare.m`
- [ ] Residual diagnostics — `+fitting/residualDiagnostics.m`
- [ ] Confidence/prediction bands — `+fitting/fitBands.m`
- [ ] MCMC sampling — `+fitting/mcmcSample.m`

### Reflectivity fitting
- [ ] Parratt recursion — `+fitting/parrattRefl.m`
- [ ] SLD profile / spline SLD / profile→layers — `+fitting/{sldProfile,splineSLD,profileToLayers}.m`
- [ ] SLD presets — `+fitting/reflSLDPresets.m`

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
- [ ] Physical constants — `+calc/constants.m`
- [ ] Element data — `+calc/elementData.m`
- [ ] Crystal cache — `+calc/crystalCache.m`
- [ ] Unit conversion — `+calc/unitConvert.m`
- [ ] CIF import — `+calc/importCIF.m`

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
- The BosonPlotter "workshops" (Peak, Curve Fit, Hysteresis, Reflectivity)
  map to React `workshops/`; their *math* lives in `calc/`, their *state*
  in a hook, their *view* in components under the size ceiling.
