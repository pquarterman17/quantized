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
fitter returns both and names the one it selected in `covariance`:

| fitter | both estimates |
|--------|----------------|
| `curve_fit` | `errorsJtj`, `errorsHessian` |
| `batch_fit` | `errorsJtj`, `errorsHessian` (N×M) |
| `global_fit` | `sharedErrorsJtj`/`sharedErrorsHessian`, `perErrorsJtj`/`perErrorsHessian` |
| `global_curve_fit` | `errorsJtj`, `errorsHessian` per dataset; `errorJtj`/`errorHessian` on each `shared` entry |

The unselected Hessian is computed only when the fit has 20 or fewer free
parameters, because its cost is O(k²); beyond that it is NaN. The MATLAB
golden tests pass `covariance="hessian"` explicitly.

The Jacobian is a central difference whose step starts at `eps^(1/3)·|p|` and
grows until the residual change it causes is itself resolved, so a parameter
that merely happens to be near zero does not get a step too small to measure.

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
* `MSE` is the variance of one observation, in y units squared: `chiSqRed`
  for an unweighted fit. A weighted fit's observations do not share a
  variance, so it also returns `obsVar`, the per-point `s²/wᵢ` (its `MSE` is
  only their mean, a summary).
* A zero-weight point is not an observation: it is left out of `nPoints`,
  the degrees of freedom and every metric.

**Departure: `fit_compare` AIC/AICc/BIC.** MATLAB `fitCompare` uses
`n · ln(RSS/n) + 2k` on the unweighted RSS. That is a constant `n(1 + ln 2π)`
lower than the fit's own AIC, so the Diagnostics panel and the fit summary
showed different AICs for the same fit. `fit_compare` now uses the definition
above, on the weighted χ² when it is passed the fit's `weights`. Differences
such as ΔAIC between models are unchanged. The golden test freezes the
intended values as the MATLAB golden plus that constant.

## Confidence and prediction bands (`fit_bands`)

The bands are `ŷ ± t · √var`, where `var_ci = g Σ gᵀ` (with `g` the numerical
model gradient and `Σ` the parameter covariance) and `var_pi = var_ci + σ²`,
with `σ²` the variance of a new observation. The quantile `t` is
`scipy.stats.t.ppf` at the residual dof `n − k`. If `σ²` is unknown, the
prediction limits are returned as NaN instead of a wrong band.

For an unweighted fit `σ²` is the fit's `MSE`, one number. For a weighted fit
it is different at every point (`obsVar`, `s²/wᵢ`), so the prediction band
follows the error bars. The fit only knows that variance at the data points.
On the band's grid (`observation_variance_on_grid`):

* at a data point it is that point's own variance, as in statsmodels
  `get_prediction(..., weights=w)`;
* between data points it is linearly interpolated in x;
* outside the data range it is held at the nearest end point's value. The
  error model is not extrapolated.

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
* A free start that sits on a bound maps to ≈∓36 in the transformed space,
  where the transform is flat, and the parameter never left the bound while
  the fit reported success. Such a start is moved 0.1 % inside its bounds
  first (`nudge_inside`).
* `stalled_parameters` is a separate safety net. A free parameter that sits at
  its exact start, where a 0.1 % move kept inside its bounds would still lower
  the cost, is reported in `warnings`, and the fit gets `exitFlag` 0. A
  parameter on a genuinely active bound is not flagged: the outward move is
  clipped away and the inward one raises the cost.
* A model that is undefined (NaN or infinite) at a trial point counts as an
  infinitely bad fit there. If it is undefined at the fitted parameters, the
  fit gets `exitFlag` 0 and a warning.
* `fatol` gets fminsearch's `10·eps(f)` floor. scipy's purely absolute
  `fatol = 1e-12` cannot be met once the cost is in the thousands, so good
  fits used to exhaust their evaluation budget and report `exitFlag` 0.

## Statistics versions (saved fits)

The errors, RMSE and AIC above are "version 2". A fit saved before 2026-11
has version 1: Hessian errors, a weighted `RMSE = √(Σ w r²/n)`, and an AIC
without the `Σ ln w` term. `POST /api/fitting/fit` takes `stats_version` (1 or
2, default 2) and returns `statsVersion`.

A saved fit (`FitSpec`) records `statsVersion: 2` when the fitter reported it.
A spec without the field is version 1. Recalculating a version-1 fit, in the
recalc graph, the result panel or a pipeline replay, asks for version 1, so
its numbers keep their meaning. The result overview names the set in use, and
its **Update statistics** button recomputes the fit under version 2.

## Custom-equation notes

* `voigt(x, sigma, gamma)` uses the magnitudes of both widths. A fit reports
  the positive value of any parameter the model is even in (a width that only
  enters squared, a Voigt width), flipping the matching covariance terms.
* A blank guess is derived from the data (`calc.fit_equation_init`), on at
  most 2000 points and 15000 model evaluations. Omitting `guesses` entirely
  keeps the historical start of 1.0 per parameter.
