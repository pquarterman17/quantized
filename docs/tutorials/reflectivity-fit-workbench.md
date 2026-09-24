# Reflectivity fit workbench — fit XRR/PNR data and estimate its uncertainty

The **Reflectivity** workshop (Analyze ▸ XRD & reflectivity ▸ *Reflectivity
model…*) has two modes that share one layer model:

- **Model** builds a layer stack from SLD presets and simulates R(Q) and the
  SLD depth profile into the library.
- **Fit** fits that same stack to measured X-ray (XRR) or polarised neutron
  (PNR) data, keeps every fit as a durable record, and can estimate each
  fit's posterior uncertainty with DREAM.

Units throughout: thickness and roughness in Å, SLD in Å⁻², Q in Å⁻¹.

---

## 1. Bind the data

Pick the dataset and its columns: **R**, and optionally **dR** (1-sigma
error) and **dQ** (resolution; tick *FWHM* if the column is a FWHM rather
than a 1-sigma width). An NCNR `.refl` or `.pnr` file is recognised and
bound for you. If the x column is 2θ, choose *2θ* and give the wavelength λ
(read from the file's metadata when it has one).

- **Q window** — fit only Q in [min, max].
- **Channels** — up to four curves fitted jointly. A PNR ++/−− pair is two
  channels with spin `+` and `−`; they share every layer parameter, and each
  layer's magnetic SLD `msld` adds for `+` and subtracts for `−`.
- **Weighting** — *dR* minimises χ² = Σ((R_model − R)/dR)² and needs a dR
  column; *log* minimises the sum of squared log₁₀ residuals, the usual
  choice for XRR data with no error column. Only dR weighting is a
  chi-square, so only it reports χ² — and only it can be sampled with DREAM.
- **Resolution dQ/Q** — a constant relative resolution, used when there is
  no dQ column.

## 2. Set up the parameters

Each layer field (`L1.thickness`, `L1.sld`, `L1.isld`, `L1.roughness`,
`L1.msld` …) plus `scale` and `background` has a value, a **vary** box,
**min**/**max** bounds and an optional **tie** to another parameter (a tied
parameter always equals its target). Values edit the layer model itself.
Layer 0 is the incident medium and the last layer the substrate; their
thicknesses mean nothing and cannot be varied.

The fitter is a *local* least-squares method (bounded trust-region
reflective): start close to the answer, or it can settle in a neighbouring
fringe minimum. Keep bounds physical — they are also DREAM's prior.

## 3. Run the fit and read the result

**Run fit** (30 s limit) reports the objective under its honest label, the
evaluation count, the fitted value ± standard error of every varied
parameter, and warnings. A standard error of "—" means none is reported:
the parameter ended **on a bound** (widen it or fix it), or the data do not
determine it independently (two layers of the same material, say — fix or
tie one of them). The fitted curve of channel 1 is overlaid on its data.

Follow-ups: **Apply to model** writes the fitted values into the layer
model; **Add fit curves** adds each channel's R and model and each SLD
profile to the library (named "… refl fit #n", with provenance in
`metadata.reflFit`); **Open log-Y plot**; **Add to report**.

## 4. Saved fits

Every finished fit is stored on its datasets (the last 10; the newest 3
keep their curves) and saved with the project. The **History** picker shows
them again after the workshop closes. A saved fit can be applied (guarded
against a changed layer stack or radiation), **restored** as a setup
(model, parameters, bindings and settings), overlaid, re-added as curves,
or added to a report. It warns when a dataset it used is gone or its data
changed since the fit.

## 5. Estimate uncertainty (DREAM)

A least-squares standard error assumes the model is locally linear.
Reflectivity is not: fringes alias, and thickness trades off against
roughness and SLD. **Estimate uncertainty (DREAM)**, under a live or saved
fit, samples the posterior instead and reports what the draws say.

- **What it samples** — the fit's free parameters inside their bounds
  (uniform prior), likelihood exp(−χ²/2) on exactly the points the fit used,
  starting around the fitted values. It needs dR weighting; a log-weighted
  fit says why it cannot be sampled. If the data changed since the fit, it
  refuses — run the fit again first.
- **Settings** — *samples* (draws kept, default 10,000), *burn-in*
  (generations discarded first, default 200), *chains/param* (default 4), and
  *seed* (default 1; the same seed reproduces a run exactly on the same
  install; blank for a fresh one). A typical 9-parameter XRR fit on a
  500-point smeared scan takes about a minute; a run stops at 5 minutes and
  reports what it has, marked provisional. Progress shows while it runs;
  **Cancel** stops it.
- **What you get** — beside each least-squares value ± stderr: the 68%
  interval (with the median and best draw on hover), the 95% interval, and
  **R-hat**. The line under the table gives the draws, chains, burn-in,
  thinning and worst R-hat.

Reading it:

- **R-hat** (Gelman–Rubin) compares the chains. Above **1.2** (shown in
  amber, with a warning) the chains have not mixed and those intervals are
  not trustworthy — raise samples or burn-in and re-estimate.
- **⇤ on a 95% interval** — the bounds, not the data, limit it: it ends at a
  bound, or spans most of the range (a parameter the data cannot pin down).
  Widen the bound if it is not physical, or fix or tie the parameter.
- When the intervals are roughly ±1σ and ±2σ of least squares, the model is
  close to linear there and both agree. When they are much wider or
  lopsided, trust the posterior.

**Add uncertainty bands** adds, per channel, R(Q) with the model's median
and 2.5/16/84/97.5 percentile columns (over 200 posterior draws, on the
fitted points), and per spin state the SLD(z) band; **Open band plot** shows
the R band on a log axis with the 95% and 68% ranges filled.

The estimate is stored with the fit record — intervals, R-hat and draw
counts, never the chains — so it survives closing the workshop and saving
the project, and **Add to report** includes the 68%/95% interval columns
and the R-hat verdict. The bands are not stored: re-estimate to plot them
again. One undo step removes an estimate.

### How it was checked

On the committed synthetic XRR bilayer (`tests/fixtures/baselines/
xrr_bilayer_kiessig.refl`) a converged run gives 95% intervals 0.93–1.04×
the least-squares ±1.96σ; across 20 fresh noise realisations of the same
sample the 95% intervals held the true thickness or SLD in 77 of 80 cases.
Two adjacent layers of the same material get intervals spanning most of
their bounds, a correlation of −1 and the bound flag. Validation on real
instrument data is still to come.
