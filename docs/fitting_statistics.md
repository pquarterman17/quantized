# Curve-fit statistics: definitions and MATLAB departures

This page records how the curve fitter reports uncertainty and goodness of
fit, and where it deliberately departs from the `quantized_matlab` golden
values. Each departure came out of the fitting audit (Origin-replacement
sprint, 2026-11). Each one is pinned by a test that names the audit finding.

## Parameter errors (`covariance`)

`calc.fitting.curve_fit` (and `batch_fit`, `global_fit`, `global_curve_fit`)
takes `covariance="jtj" | "hessian"`:

| method | covariance | matches |
|--------|------------|---------|
| `jtj` (default) | `(JᵀWJ)⁻¹ · s²`, with `J` the model Jacobian in the bounded parameters | Origin, scipy `curve_fit` `pcov`, statsmodels |
| `hessian` | `(H/2)⁻¹ · s²` from a numerical Hessian of the weighted SSR in the transformed (free) parameters, mapped back through the bound transform | MATLAB `fitting.curveFit` |

The two agree when residuals are small. They differ for poor fits, because the
Hessian keeps the residual-curvature term that Gauss-Newton drops. Every
result returns both, as `errorsJtj` and `errorsHessian`, and names the one it
selected in `covariance`. The unselected Hessian is computed only when the fit
has 20 or fewer free parameters, because its cost is O(k²). The MATLAB golden
tests pass `covariance="hessian"` explicitly.

## Error scaling and weighting

* **Instrumental weighting:** `dy` holds 1σ error bars, and each weight is `1/dy²`.
* **Direct weighting:** `weights` is a weight column, used as `w` exactly as given.
* `scale_errors` (default on) is Origin's "Scale Error with sqrt(Reduced
  Chi-Sqr)". When it is on, `s²` is the reduced χ². When it is off, `s² = 1`
  and the weights are read as absolute `1/σ²`, like scipy's
  `absolute_sigma=True`. An unweighted fit always scales, because it has no
  other estimate of the variance.

## Metrics (`calc.fit_metrics`): one definition each

* `SSR = Σ r²` and `RMSE = √(SSR/n)` are unweighted and in the units of y.
  Before this change, `RMSE` was the unitless `√(Σ w r²/n)` for weighted fits.
* `chiSq = Σ w r²` is the minimised objective, and `chiSqRed = chiSq/(n − k)`.
* `logLik = −n/2 · (ln(2π · chiSq/n) + 1) + ½ Σ ln w`, as in statsmodels
  `OLS`/`WLS.llf`.
* `AIC = 2k − 2 logLik`, `AICc = AIC + 2k(k+1)/(n−k−1)`,
  `BIC = k ln n − 2 logLik`.
* `MSE` is the variance of one observation at a typical point, in y units
  squared. For an unweighted fit it is `chiSqRed`. For a weighted fit it is
  `s² · mean(1/w)`.

**Departure: `fit_compare` AIC/AICc/BIC.** MATLAB `fitCompare` uses
`n · ln(RSS/n) + 2k` on the unweighted RSS. That is a constant `n(1 + ln 2π)`
lower than the fit's own AIC, so the Diagnostics panel and the fit summary
showed different AICs for the same fit. `fit_compare` now uses the definition
above, on the weighted χ² when it is passed the fit's `weights`. Differences
such as ΔAIC between models are unchanged. The golden test freezes the
intended values as the MATLAB golden plus that constant.

## Confidence and prediction bands (`fit_bands`)

The bands are `ŷ ± t · √var`, where `var_ci = g Σ gᵀ` (with `g` the numerical
model gradient and `Σ` the parameter covariance) and `var_pi = var_ci + MSE`.
The quantile `t` is `scipy.stats.t.ppf` at the residual dof `n − k`. If the
fit's MSE is unknown, the prediction limits are returned as NaN instead of a
wrong band.

**MATLAB bug #7 (prediction band too narrow).** `fitBands.m` adds
`Σ var_ci / tr(JᵀJ)` as the residual variance. That is an average of the
curve's own variance, not the scatter of the data. On the golden Gaussian the
band came out 4.6× too narrow, and on the audit's data about 7× too narrow.

**MATLAB bug #8 (t quantile at the wrong dof).** `fitBands.m` evaluates the
Student-t quantile at `nFree` degrees of freedom instead of `nPoints − nFree`.
On the golden Gaussian that is 3 dof instead of 77, which made the confidence
band about 1.6× too wide.

MATLAB's Cornish-Fisher t-quantile, built on a normal quantile accurate only
to 4.5e-4, is replaced by scipy's exact quantile. The CI and PI now match
statsmodels `get_prediction` for linear models, and the delta method on scipy's
`pcov` for nonlinear ones (`tests/test_calc_fit_bands_reference.py`). The
golden test keeps the fitted curve golden and freezes the intended band values
inline, with the replaced MATLAB values next to them. Neither bug has been
fixed on the MATLAB side. That repository is fixed only deliberately, never
silently.

## Optimizer start-up and stopping (`calc.fit_simplex`)

* A start exactly one unit inside a one-sided bound maps to ≈2e-16 in the
  transformed space. Nelder-Mead's default 5 % simplex step was therefore
  ≈1e-17, and the parameter stayed frozen. Near-zero transformed coordinates
  now step by an absolute 0.05. Every other coordinate keeps scipy's and
  fminsearch's default, so golden parity is unchanged.
* `stalled_parameters` is a separate safety net. A free parameter that sits at
  its exact start, strictly inside its bounds, where a 0.1 % move would still
  lower the cost, is reported in `warnings`, and the fit gets `exitFlag` 0.
* `fatol` gets fminsearch's `10·eps(f)` floor. scipy's purely absolute
  `fatol = 1e-12` cannot be met once the cost is in the thousands, so good
  fits used to exhaust their evaluation budget and report `exitFlag` 0.
