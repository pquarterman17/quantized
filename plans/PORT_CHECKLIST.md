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
- [~] Rigaku `.raw` — `+parser/importRigaku_raw.m` — **1D binary golden `488cf4b`** (+ synthetic-fixture guard-rail tests: multi-range / Bruker-reject / malformed). **2D RSM BLOCKED** (not merely deferred): the reverse-engineered header (bytes 2959–3158) carries only counting-time + 2θ start/end/step + num-points — **no ω field**, so a reciprocal-space map can't be reconstructed; the MATLAB reference errors on multi-range; and the corpus has **no** Rigaku multi-range/RSM `.raw` (all 3 `+test_datasets/rigaku/*.raw` are single-range 1D; the only RSM samples are XRDML [done] + Bruker `.brml` [→ fermiviewer]). **Unblock:** a real multi-range Rigaku RSM `.raw` to locate the ω offset + confirm the inter-range layout.
- ~~Bruker — `+parser/importBruker.m`~~ — **out of scope → fermiviewer** (image data)
- [~] PANalytical XRDML — `+parser/importXRDML.m` — **1D golden `5d7f1e7`**; **2D area-detector (RSM) + Q-space ported** (`io/xrdml._build_2d` auto-detects an RSM mesh — shared 2θ range + a stepping Omega/Chi/Phi — and returns a scattered multi-column DataStruct `[2Theta, axis1, Intensity, Qx, Qz]` with `is2D`/`map_shape` metadata; `calc/qspace.compute_qspace` ports `Qx=(4π/λ)sinθ·sin(ω−θ)`, `Qz=…cos(…)`). Verified vs the formula + real data (`synthetic_rsm` fixture committed; FAIRmat 25k-pt mesh renders a correct sheared Q-space parallelogram through `/api/plot/map`). **Q-space golden-verified vs MATLAB `parser.computeQSpace`** — `calc_qspace.json` (5×7 omega×2θ grid, N≠M to catch an axis swap; **bit-exact**, max_abs 0.0; `qspFreeze`). **Still pending for `[x]`:** golden-freeze the 2D `_build_2d` mesh-detection/`map2D` matrix vs `importXRDML` itself (needs a committed `.xrdml` + MATLAB run); beam-attenuation correction not yet ported (1D path unaffected).
- [x] NCNR neutron PNR — `+parser/importNCNRPNR.m` — golden `58cd15c`
- [x] NCNR reflectometry — `+parser/importNCNRRefl.m` — golden `8f9e4f8`
- [x] NCNR `.dat` — `+parser/importNCNRDat.m` — golden `58cd15c`
- [x] refl1d `.dat` — `+parser/importRefl1dDat.m` — golden `58cd15c`
- [x] Lake Shore VSM — `+parser/importLakeShore.m` — golden `41dfef9` (synthetic fixture)
- [x] SIMS depth profile — `+parser/importSIMS.m` — golden `2a7a538` (shared exact + paired interp 1e-9)
- ~~AFM — `+parser/importAFM.m`~~ — **out of scope → fermiviewer** (AFM topography/phase images)
- [x] Generic CSV — `+parser/importCSV.m` → `io/delimited.py` — golden `a0a8929`
- [x] Excel — `+parser/importExcel.m` → `io/excel.py` (openpyxl) — golden `ce228ba`
- [x] Header parsing / auto-detect — `+parser/parseColHeader.m` → `io/base.parse_col_header`/`resolve_column`
- [x] Auto-dispatch + registry — `+parser/importAuto.m`, `+parser/resolveParser.m` → `io/registry.py` (single map + sniffers; `import_auto` drives `/api/parsers/import`)
- [x] DataStruct contract — `+parser/createDataStruct.m` → `datastruct.py` (frozen dataclass; `from_dict`/`to_json`)

### Export writers
- [x] XRD CSV — `+utilities/writeXRDcsv.m` → `io/xrd_csv.py` (golden: xrdcsv_standard_{both,counts,cps}, xrdcsv_origin_both)
- [x] HDF5 — `+utilities/exportHDF5.m` → `io/hdf5.py` (+ `io/_hdf5_layout.py`); golden: hdf5_synth_default
- [x] Origin-ASCII + `.ogs` LabTalk script — `+utilities/exportOriginScript.m` → `io/origin.py` (golden: origin_export; CSV byte-exact, .ogs minus Date line). Route `/api/export/origin` zips `.ogs`+CSV.
- [~] Reflectivity/neutron consolidated CSV (role-based columns) — `+bosonPlotter/saveConsolidatedNeutronCSV.m` → `io/consolidated.py` (golden: consolidated_csv_{standard,origin}; per-dataset-block role-based writer). Route `/api/export/consolidated`. **Polarized-asymmetry path (shared-Q interp + ++/-- spin asymmetry) still TODO** — needs ++/-- polarization metadata.

### Origin live bridge — Windows-only OS-gated optional (W1 #14)
- [ ] COM connect/send — `+utilities/connectOrigin.m`, `+utilities/toOrigin.m` (mock-tested only)

### Paused (awaiting example files)
- [ ] `importOxford`, `importOpus`, `importSPC`

---

## W2 — Corrections & processing (`calc/`)

### Corrections pipeline
- [x] Offsets / BG (slope/intercept/poly) / trim / units / smooth / norm / derivative — `bosonPlotter.applyCorrections` + `correctionParams` → `calc/corrections.py` — golden (XRD trim+bg+smooth+norm; derivative; magnetometry field-convert+emu/g). Pure 8-step pipeline composed from ported helpers. `applyParserAnalysisConfig.m` is GUI relabeling only (no math, not ported).
- [x] Magnetometry mass/dimension normalization — `+utilities/convertMagUnits.m` — golden `calc/magnetometry.py`; route `/api/magnetometry/convert-units` + **UI** (`workshops/magtools/` Units tab: Oe↔T↔mT↔A/m field, emu→emu/g·cm³·A·m²·kA/m moment, sample-aware)
- [x] Magnetic background subtraction — `+utilities/subtractMagBackground.m` — golden `calc/magnetometry.py`; route `/api/magnetometry/subtract-background` + **UI** (`workshops/magtools/` Background tab: high-T linear fit + subtract → new dataset)
- [~] BG-from-file / fit-BG-from-region — BosonPlotter `onBGMouseUp` + `+utilities/estimateBackground.m`. **fit-BG-from-region done (backend + UI):** `calc/baseline.fit_region_background` (box-mask → raw-x `polyfit` → full-range background + region stats) + `POST /api/baseline/region`; golden `calc_bgregion.json` (linear/quadratic/cubic, coeffs ~1e-12; `bgrFreeze`). Wired into the baseline workshop as the **"Fit from region"** method (x-min/x-max default to the data range, poly order; overlays + subtracts like the other methods; `useBaseline.test.ts`). **BG-from-file backend golden-verified:** `applyCorrections` step 4 (`calc/corrections.apply_corrections` `bg_dataset=`/`bg_interp=`) subtracts `interp1(bgX, bgY, x, method, 0)` from every channel; route already exposes `bg_dataset`/`bg_interp`; golden `calc_bgfromfile.json` (linear/pchip/spline over an active range that overhangs the bg range — exercises the 0-fill extrapolation; all 3 match ~1e-14 abs; `bgfFreeze`). **Rubber-band region pick done (frontend):** the baseline panel's "⬚ Pick range on plot" button arms a `region` plot tool (`PlotTool` += `region`); a drag fires uPlot's `setSelect` → `posToVal` → pure `lib/regionSelect.normalizeRange` (orders + clamps to the data x-extent + drops a zero-span click; `regionSelect.test.ts`) → `store.regionPicked` → `useBaseline` consumes it into the x-min/x-max box edges (`useBaseline.test.ts`). x-only (matches the existing x-centric region UI; a 2-D y-box like MATLAB `onBGMouseUp` is a future extension). Standing caveat: jsdom can't render the drag, so the interaction is logic-tested only (the pure range math + the store-consume path are covered; the actual canvas drag needs a human eyeball). **Remaining (frontend only):** a corrections-UI control to pick a loaded dataset as the BG-from-file source (no corrections workshop exists yet; backend + API are ready); optional 2-D y-box for the region pick.

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
- [x] Dataset algebra — `+utilities/datasetAlgebra.m` → `calc/aggregate.py` — golden (A+B/A-B/A*B/A/B/asymmetry; pchip interp + NaN guards + labels/units). **MATLAB bug #3:** datasetAlgebra calls `createDataStruct('Time',..,'Values',..)` with name-value but createDataStruct is positional → uncallable; golden frozen via inline algebra, port assembles DataStruct correctly. See memory project_matlab_bugs_from_golden. **UI shipped (2026-06-27):** `/api/aggregate/algebra` + "Dataset Math" workshop (pick A/op/B/interp → new dataset), commit `14006ff`.
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
- [x] Constraints — `+fitting/applyConstraints.m` → `calc/fit_constraints.py` — golden
      `calc_constraints.json` (5 cases @1e-12: positional/named refs, math fns, error
      paths). Faithfully reproduces MATLAB's two-pass rewrite incl. the reindexed
      double-replacement quirk (uses the no-eval parse_equation, appearance-order pN)
- [x] ODR (orthogonal distance regression) — `+fitting/odrFit.m` → `calc/fit_odr.py`
      (closed-form Deming + jackknife SEs; λ explicit or from X/Y errors); golden
      `calc_odr.json` (3 cases @1e-12, exact ~1e-14)

### Batch / global
- [x] Batch fit — `+fitting/batchFit.m` → `calc/batch_fit.py` (same model across a
      dataset series; per-dataset auto-guess, bounds, weights, x-range, metadata
      trend extraction); golden `calc_batchfit.json` (4 datasets @rtol 1e-6, ~1e-9)
- [x] Global / shared-parameter fit — `+fitting/globalFit.m` → `calc/global_fit.py`
      (super-param packing: shared once + per-dataset free blocks; joint curve_fit);
      golden `calc_globalfit.json` (3 datasets @rtol 1e-6, ~1e-9)
- [x] Global fit (richer variant) — `+fitting/globalCurveFit.m` → `calc/global_curve_fit.py`
      (per-dataset models + named per-group shared-parameter constraints with subset
      sharing + Greek-alias resolution; fminsearch over the curveFit bound transform,
      numerical-Hessian errors); golden `calc_globalcurvefit.json` (4 cases:
      Gaussian shared-σ / no-constraint / subset / Exp shared-τ @rtol 1e-6, ~3e-9)
- [x] Peak tracking — `+fitting/trackPeak.m` → `calc/peak_track.py` (follow a drifting
      peak across a dataset series; Gaussian/Lorentzian via bounded curve_fit, R²>0.5
      gate); golden `calc_trackpeak.json` (2 shapes @rtol 1e-6, ~1e-9)

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
- [x] RSM analyze / strain — `+fitting/rsmAnalyze.m`, `+fitting/rsmStrain.m` — **both ported + golden.** `calc/rsm.rsm_strain` (strain via Q ratios, nominal lattices `a~2π/|Q|`, relaxation R; `POST /api/rsm/strain`). `calc/rsm_analyze.rsm_analyze` (separable Gaussian smooth → 3×3 local maxima + greedy min-sep → per-peak `surface_fit` in angle 2θ/ω **and** Q-space → centres/FWHM/substrate-film classification; `rsm_grids_from_datastruct` bridges the scattered RSM `DataStruct` → grids; `POST /api/rsm/analyze`). Full chain reachable: import RSM → `/api/rsm/analyze` → peaks → `/api/rsm/strain`. Golden `calc_rsm.json` (deterministic synthetic 2-Gaussian map: peak detection exact, per-peak fits centres ~1e-12/fwhm ~1e-9, strain chain + 3 closed-form cases @rtol 1e-6; `rsmFreeze`). Also `test_calc_rsm_analyze.py`, `test_api_rsm.py`.
- [ ] Pawley refinement — `+fitting/pawleyRefine.m`
- [x] Surface (2D) fit / models / auto-guess — `+fitting/{surfaceFit,surfaceModels,surfaceAutoGuess}.m` — **all three ported + golden.** `calc/surface_models` (Plane/Paraboloid/2D Gaussian/Lorentzian/Pseudo-Voigt/Polynomial 2D/Exponential Decay 2D — pure `z=f(p,x,y)` registry). `calc/surface_fit.surface_fit` replicates MATLAB's idiosyncratic method (bounded→unbounded param transform + Nelder-Mead `fminsearch` + numerical-Hessian errors); `surface_auto_guess` (linear models → normal equations; peak models → z-range amplitude + weighted centroid + range/4 widths) supplies a default `p0`. Golden `calc_surfacefit.json` (7 model evals exact ~1e-16, 7 auto-guesses ~1e-15, 4 full fits params ~1e-9/errors ~7e-9 @rtol 1e-6; `sfFreeze`). **Remaining (separate line):** `rsmAnalyze`/`rsmStrain` golden freeze.

### Peak fitting (BosonPlotter Peak workshop)
- [x] Single-peak fit (Lorentzian/Gaussian/Pseudo-Voigt/Split-Pearson-VII/TCH-pV)
      + peak de-duplication — `+bosonPlotter/+peak/{fitSinglePeak,deduplicatePeaks}.m`
      → `calc/peak_fit.py` + `/api/peaks/fit`; golden `calc_peakfit.json` (rtol 1e-5)
- [x] Auto-find peaks — `utilities.findPeaksRobust` → `calc/peaks.py` (golden)
- [x] Multi-peak evaluators (Lorentzian/Gaussian/pseudo-Voigt sum + linear bg) —
      `+bosonPlotter/+peak/{evalMultiPeak,evalMultiPeakPV}.m` → `calc/peak_fit.py`;
      golden `calc_multipeak.json` (exact, rtol 1e-12)
- [x] Multi-peak *simultaneous* fit + constrained/linked widths — `peakAnalysis.m`
      `onFitSimultaneous` (composite peaks+poly-bg, center-drift penalty) +
      `+bosonPlotter/buildLinkedPacker.m` (Shared FWHM / Shared FWHM+eta freeToFull
      mapping) → `calc/peak_multifit.py` + `/api/peaks/fit-multi`; golden
      `calc_multipeakfit.json` (5 fit cases bit-exact to ~7e-9 by replicating
      fminsearch's eval-limited 200·nFree budget; linked packer exact, rtol 1e-6)
- [x] **UI** — peaks workshop (`workshops/peaks/`): auto-find + markers, then fit
      controls (model/bg-degree/linked-width/constrain) driving **Fit all together**
      (`/api/peaks/fit-multi`) and **Fit each** (loops `/api/peaks/fit` per peak);
      fitted params + R²/RMSE table + overlay (`usePeaks.test.ts`, 4 hook tests)

### Hysteresis (BosonPlotter Hysteresis workshop)
- [x] Hysteresis models — `+fitting/hysteresisModels.m` → `calc/fit_models_special.py`
      ("Hysteresis" category: tanh, F+P, linear BG, approach-to-saturation,
      Langevin+BG); golden `calc_hysteresis_models.json` (rtol 1e-9)

---

## W4 — Calculators (`calc/`, DiraCulator parity)

### Calculator domains (panels) — `DiraCulator.m` build*Tab
> DEFERRED (autonomous): formulas are embedded in DiraCulator GUI build*Tab functions, not standalone +calc files. Porting requires extracting each formula into a clean `calc/<domain>.py` and freezing via inline MATLAB computation. Backend `+calc/*.m` helpers (below) are ported first.
- [~] Unit Converter — `buildUnitConverterTab` — **UI shipped** (`workshops/calculators/` Units tab, backed by golden `calc/unit_convert.py`: dimensional + temperature-offset + energy↔wavelength / H↔B bridges, quick-pick chips). Constants reference (golden `calc/constants.py`) also surfaced in the same window's Constants tab.
- [~] Crystal — `buildCrystalTab` — **partial**: d-spacing from lattice params + Miller indices (cubic/tetragonal/orthorhombic/hexagonal) shipped (`calc/crystallography.py`, `/api/crystallography/dspacing`, calculators "Crystal" tab; reference-value tested, commit `e23d90b`). Remaining: cell volume, density, bond angles, rhombohedral/monoclinic/triclinic systems.
- [ ] Electrical / transport — `buildElectricalTab`
- [ ] Semiconductor — `buildSemiconductorTab`
- [ ] Thin Film — `buildThinFilmTab`
- [x] Periodic Table — `buildPeriodicTableTab` — Elements tab in the calculators workshop over the golden `element_data` (`GET /api/reference/elements`): search by symbol/name/Z + per-element details (mass, category, group/period, config, density, electronegativity, melting/boiling, neutron b_coh). Self-contained `ElementsTab.tsx`; commit `9ea8cee`.
- [ ] X-ray & Neutron (d-spacing, Q↔2θ, SLD) — `buildXrayNeutronTab` — **partial**: d-spacing (Bragg) + Q↔2θ done (`calc/xray.py`, `/api/xray/calc`, calculators "X-ray" tab; reference-value tested, commit `ad72c6c`). **SLD-from-formula still TODO** (needs a chemical-formula→SLD calc; `calc/sld.py` is reflectivity-profile only).
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
- [x] Column roles — **X-role, Y-error (error bars), and label/ignore all shipped**: ChannelsCard "X axis" picker surfaces the already-routed `PlotState.x_key` so any value channel can be the plot x-axis (e.g. M-vs-H not M-vs-time; chosen x excluded from the Y series via `lib/plotdata.effectiveChannels`, used by PlotStage + MultiPanelStage; `/api/plot/series` x_key route tests; commit `ad6b460`). **Error-bar role**: per-row "± <channel>" picker pairs a y-channel with an error channel → `lib/errorbars.buildErrorColumns` + `uplotPlugins.errorBarsPlugin` draw y±e whiskers (frontend-only; reads displayed y so waterfall offsets cancel; store `errKeys` resets with the dataset; commit `7da9a21`). **Label / ignore roles** (`de2a3db`): per-channel Data/Label/Ignore select in ChannelsCard; a roled channel is excluded from the plot (`effectiveChannels` filters label+ignore), `ignore` also drops from the worksheet Σ Stats (label stays — a tabulated descriptor); worksheet header tags roled columns; guard keeps ≥1 plottable data channel; store `channelRoles` (reset per dataset); `types.ChannelRole`.
- [ ] Formula engine (no eval) + computed-column snapshots + recompute
- [x] Sort / filter / descriptive stats / masking — Stage `Worksheet`: header-click sort, structured row filter (col/op/value + Extract), per-column golden `descriptive_stats` footer, click-to-mask rows (excluded from stats/extract). Commits `e8834aa`/`b412725`/`61e479e`.
- [~] Workspace file format (`.dwk`) + autosave — **save/load shipped**: pure `lib/workspace.ts` (`serializeWorkspace`/`parseWorkspace`, JSON = format tag + version + datasets, defensive DataStruct validation at the file boundary), store `loadWorkspace` (hard-replace library + reset per-dataset view/overlays/markers), command-palette "Save/Open workspace (.dwk)…" (`saveBlob` / `openFilePicker`). Round-trip + validation unit-tested. Commit `97bd483`. **Autosave still TODO** (overlaps a future session/prefs layer).

---

## W6 — Plotting & render
- [x] Plot state model (axes/limits/scales/dual-Y/per-dataset/tick-format) — **dual-Y** (`PlotState.y2_keys` + `PlotSeries.axis`; Channels-card "Y2" pill → secondary uPlot scale) **+ explicit limits** (Axes-card X/Y min-max → static uPlot scale range; `store.xLim/yLim`) **+ per-series styling** (Series-style card: per-channel color [palette token or custom hex] / width / line style / markers [show + size] → `store.seriesStyles` keyed by channel index, mapped to display order in `PlotStage`; `uplotOpts.seriesColor`) **+ tick format** (Axes-card X/Y Auto/Fixed/Sci + digits → `store.xFmt/yFmt`; `uplotOpts.tickFormatter` → axes[].values, yFmt also drives y2) — all shipped. Log/linear scales + per-dataset state via the dataset list.
- [~] Interactive render (uPlot 1D; Canvas2D for 2D maps) — uPlot 1D done (Stage: zoom/pan/cursor, **two-point measurement ruler** [∡ tool: drag A→B → Δx/Δy/slope readout, `lib/measure.ts` pure + tested, `measurePlugin` draws a data-pinned dashed segment], **copy plotted data to clipboard as TSV** [⧉ tool-dock button → `lib/clipboard.payloadToTSV` of the display payload (honors x-channel/waterfall/overlays), commit `c3780c0`], **interactive legend** [click a legend entry to show/hide that series — `store.hiddenChannels` + uPlot `show:false`; hidden entry stays greyed/struck to toggle back; keeps ≥1 visible; commit `8ac41f3`; **legend rename** — double-click an entry to rename the series, override flows into the uPlot series label so legend/readout/solo-axis all show it, store `seriesLabels` reset per dataset, legend extracted to `Stage/PlotLegend.tsx`, commit `00cab7d`], **multi-series cursor readout** [the cursor chip lists every visible series' y at the shared nearest-x index, not just the first; commit `be38edf`], **legend series reorder** [▲▼ per legend entry → `store.seriesOrder` permutation applied in `effectiveChannels`; overlaid + multi-panel; commit `34b58ae`], overlays, ref lines (**draggable** — grab a line on the plot in zoom/cursor tool and drag it; live value held plugin-locally + `u.redraw()`, committed once on release via `store.updateRefLine`; pure `pickRefLine` hit-test; commit `400e0b9`), annotations, waterfall, per-series styling, grid/legend toggles). **2D backend done** (`calc/map.py` `MapData`/`MapState`/`build_map`/`map_from_datastruct` over the parity-tested `regrid2d`; thin `POST /api/plot/map`; tests in `test_calc_map.py` + `test_api_plot.py`). **2D Canvas2D viewer done (minimal)** — `Stage/MapStage.tsx` heatmap (offscreen `nx×ny` → scaled blit, NaN = transparent gap), viridis/magma/gray colormaps + colorbar, **lin/log intensity scale** (`colormap.normalize`; log floors at the min positive cell — essential for RSM's ~6-decade range), axes, x/y/z channel pickers, cursor readout; `lib/colormap.ts` + `lib/mapdata.ts` (backend fetch + client nearest-regrid fallback); nice round **axis ticks** (`lib/ticks.niceTicks`); **gridding controls** (method natural/linear/nearest/idw + resolution 100/200/400, wired to `fetchMap`); **angular⇄Q-space toggle** for RSM datasets (`hasQSpace`/`rsmAxisKeys` switch the x/y/z picks between 2θ/ω and Qx/Qz); "Map" stage tab. View decomposed: `Stage/mapRender.ts` (pure canvas render, unit-tested `hitTest`/`fmt`/`minPositive`) keeps `MapStage.tsx` at 185 lines. **Verified on real RSM data** (`+test_datasets/XRDML/{synthetic_rsm,FAIRmat_rsm_mesh}.xrdml` → `/api/plot/map`, 25k scattered pts; Bragg peak + truncation rod render correctly in log; Q-space view via the native 2D parser shows the correct sheared parallelogram). **2-D area-detector parser done for XRDML** (see XRDML line). **Remaining polish:** Rigaku `.raw` 2D RSM parser is **BLOCKED** (see W1 Rigaku line — no ω field in the reverse-engineered header + no multi-range RSM sample); gridding controls could move into the Inspector later.
- [x] Publication export — matplotlib → vector PDF/SVG, PNG/TIFF dpi — PDF/SVG (vector) + PNG/TIFF (raster) shipped (`routes/export/figure`, `calc/figure.render_figure`). User-selectable DPI for raster (clamped 50–1200, default 300) via the "Export figure…" dialog (`askParams`); vector formats ignore DPI. Dialog also sets the style preset, an optional figure title, and X/Y axis-label overrides (blank = derive from the data column). **WYSIWYG:** per-series color/width/line/marker carry from the on-screen plot into the matplotlib export (`render_figure(series_styles=…)`); OKLCH palette tokens resolved to hex client-side via a 1×1-canvas pixel readback (`lib/color.resolveToHex`).
- [x] Styles/templates (`aps`, report, web) — `+styles/template.m` → `calc/figure_styles.py` (named presets: default/aps/aps_double/nature/nature_double/thesis/presentation/poster/report/web — font/size/line-width/figure-geometry/grid/box/legend transcribed verbatim; applied in `render_figure` via rc_context). Selectable in the "Export figure…" dialog. **User-defined save/load templates** (`+plotting/plotTemplate.m`, prefdir `.mat` persistence) deferred → overlaps W5 workspace state.
- [~] Waterfall ✓ · overlays/unified legend ✓ (fit/peak/baseline overlays + legend) · reference lines ✓ (uPlot `refLinePlugin` + Inspector card) · annotations ✓ (uPlot `annotationPlugin` dot+label at data coords + Inspector card) · **multi-panel ✓** (`Stage/MultiPanelStage.tsx` — one stacked uPlot per channel sharing x, synced zoom [setScale hook] + cursor [uPlot sync group], bottom-only x labels; `lib/multipanel` `splitPayload`/`panelHeights` tested; "▤" toggle + `store.stackMode`) · **insets ✓** (`Stage/InsetPlot.tsx` — corner magnifier of the same series, seeded to a central magnified range via `setScale` [stays box-zoomable], `lib/inset.centralRange` tested; "⊕" toggle + `store.insetMode`) · **polar ✓** (`Stage/PolarStage.tsx` — Canvas2D angle-vs-radius for angular-dependence data; radial rings + 45° spokes + per-series curves on a shared radial scale; `lib/polar` `polarToXY`/`radiusNorm` tested; "✺" toggle + `store.polarMode`). **Figure builder ✓** (`workshops/figurebuilder/` — a draggable ToolWindow composing format/style-preset/DPI/title/axis-labels with a **debounced server-rendered PNG preview** that mirrors the on-screen plot [channels, log scales, per-series styles], then exports at the chosen format; reuses the matplotlib export route + a blob-returning `renderFigureBlob`; "Figure builder (live preview)…" in the File command group; commit `970474b`).

---

## W7 — Frontend (React revamp — reference, not 1:1 port)
- [ ] App scaffold + Zustand stores · theme (Dark/Light/Auto)
- [~] Library (dataset list/import/groups/search) — `Library/Library.tsx`: dataset list with sparklines, file import (picker + drag-drop), name filter/search, click-to-activate, double-click rename, remove, **duplicate** (⧉ → deep-copy incl. raw/corrections/bgRef as an independent "(copy)"; `lib/dataset.cloneDataStruct` + store `duplicateDataset`, commit `adc7ec4`), **reorder** (▲▼ → store `moveDataset(id,dir)` swaps adjacent; drives list + consolidated-export order; hidden while filtering; commit `3eb8586`). **Tags + groups shipped**: per-dataset tag chips (add/remove inline; name-or-tag search filter; commit `5d6a990`) and a group assignment with collapsible group sections (`lib/grouping.ts` first-appearance order, ungrouped last; row markup extracted to `DatasetRow.tsx`; both round-trip through `.dwk`; commit `7dabe3b`).
- [ ] Stage (uPlot + 2D viewer)
- [~] Inspector (corrections/axes/appearance) — `Inspector/`: scan-summary, **Metadata card** (read-only `.metadata` key/values + copy-as-TSV; `lib/metadata.ts` + `MetadataCard.tsx`, commit `4b4108f`), **Notes card** (free-text per-dataset notes, draft committed on blur, lives on the `Dataset` so it round-trips through `.dwk`; `NotesCard.tsx` + store `setDatasetNotes`, commit `12cc961`), Channels (x-role/y/y2/error-bars/**label-ignore roles**), Corrections, Stats, Axes (log/grid/legend/limits/tick-format), RefLines, Annotations, SeriesStyle cards.
- [~] Workshops: curve fit ✓ · peak ✓ · hysteresis ✓ · reflectivity ✓ (Parratt R(Q) model builder, `routes/reflectivity.py` + `workshops/reflectivity/`) · RSM analysis ✓ (`workshops/rsm/` — find peaks → substrate/film → strain/relaxation via `/api/rsm/{analyze,strain}`; "Analyze ▸ RSM analysis…") · **graph digitizer ✓** (`workshops/digitizer/` — load/paste a plot image → click 2 X + 2 Y axis refs → trace the curve → DataStruct to the library; pure `lib/digitizer` calibration, tested; full-screen overlay; "Analyze ▸ Graph digitizer…")
- [~] DataWorkspace UI (worksheet: **sortable columns + computed-column formula bar** — `Stage/Worksheet.tsx` + safe `lib/formula` evaluator [recursive-descent, no eval, tested]; `2*A+sqrt(B)` over `x`/`A`/`B`… → derived dataset; filter/mask/stats done [#209]; **copy visible rows → clipboard TSV** [⧉ Copy → `lib/clipboard.tableToTSV`, full table at full precision, commit `1ad6152`]; **column roles** [label/ignore via ChannelsCard — ignore drops from the Σ Stats footer, roled columns tagged in the header; commit `de2a3db`]; **editable grid** [double-click any cell → edit in place (Enter/blur commits, Esc cancels); the edit rebuilds the active dataset's arrays immutably so the plot + stats recompute live and the change is captured by the macro recorder; `setCellValue` store action; Worksheet decomposed into `WorksheetTable` + `WorksheetToolbar` (394→288); commit `10e4a34`]) · DiraCulator UI
- [x] Macro record/export (action log → reproducible script) — **shipped**: store macro slice (`macroRecording` + `macroSteps`; a single gated `recordMacro` entry so call sites stay unconditional) captures curated reproducible actions (import, corrections/reset, channel roles, x/y/y2 channel selection, key figure toggles, **cell edits**) as `qz.*(…)` script lines; pure `lib/macro.ts` serializer (`lit` + `macroToScript`) + Inspector `MacroCard` (Record/Pause/Clear, live step list, Copy script / Download `.qzm`). Commit `446cad7`.

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
