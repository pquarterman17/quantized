"""Fit Model: the general linear model (GAP_AUDIT_9 G1, JMP Standard Least Squares).

A continuous response against any mix of continuous and nominal factors,
crossed terms and polynomial terms, fitted by ordinary least squares. Pure
numpy/scipy (statsmodels is an optional extra here, so it is only the test
oracle). The coding (effect coding, Center Polynomials) is documented in
:mod:`quantized.calc.stats_lm_design`.

Reports, after JMP's Fit Least Squares report
(https://www.jmp.com/support/help/en/18.2/jmp/standard-least-squares-models.shtml):

* **Summary of fit** - R^2, adjusted R^2, RMSE, mean of response, N.
* **Analysis of variance** - whole-model F test against the intercept-only model.
* **Parameter estimates** - estimate, SE, t, p and a (1 - alpha) CI.
* **Effect tests** - one F test per term, the sum of squares for the
  hypothesis that all of the term's parameters are zero given every other
  term (the Wald / drop-the-columns test). Under the sum-to-zero coding with a
  full-rank design this IS the Type III sum of squares (it matches
  ``statsmodels.stats.anova.anova_lm(typ=3)`` on ``C(x, Sum)`` terms; see
  ``tests/test_stats_linear_model.py``).
* **Least squares means** - for every all-nominal term, the model prediction
  at each level (combination) with the other factors at their neutral values:
  a continuous factor at its sample mean, an uninvolved nominal factor
  averaged over its levels (JMP *Effect Details*, "Least Squares Means
  Table", https://www.jmp.com/support/help/en/18.1/jmp/effect-details.shtml).
* Per-row predicted values and residuals (actual-by-predicted and
  residual-by-predicted plots).

Refusals (fail closed, ``ValueError`` -> HTTP 422): a non-finite response
after dropping missing rows, a nominal factor with fewer than 2 levels among
the fitted rows, a rank-deficient design (names the first aliased term), and
fewer than 1 residual degree of freedom.

``fit_linear_model(...)["model"]`` is a plain-JSON description of the fitted
model (spec + coefficients + scaled covariance + error df) and
:func:`predict` evaluates it at new factor settings, which is the surface the
prediction profiler (G7) builds on.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import stats as sps

from quantized.calc.stats_lm_design import (
    AVERAGE_LEVEL,
    CONTINUOUS,
    NOMINAL,
    FactorSpec,
    ModelSpec,
    design_matrix,
    encode_profile,
    parameter_names,
    spec_from_dict,
    term_label,
    term_slices,
    validate_terms,
)

#: Relative singular-value threshold (on the column-normalised design) below
#: which a design counts as rank deficient. Column normalisation makes it
#: scale-free, so a well-posed but badly scaled polynomial (NIST Pontius, x up
#: to 3e6, x^2 up to 1e13) is not mistaken for a deficient one.
RANK_RTOL = 1e-10


def _finite_or_none(v: float) -> float | None:
    return v if math.isfinite(v) else None


def _num(v: object) -> float:
    if v is None:
        return math.nan
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return math.nan


def _rank(x: NDArray[np.float64]) -> int:
    norms = np.linalg.norm(x, axis=0)
    norms[norms == 0] = 1.0
    s = np.linalg.svd(x / norms, compute_uv=False)
    return int(np.sum(s > RANK_RTOL * s[0])) if s.size else 0


def _first_aliased_term(spec: ModelSpec, x: NDArray[np.float64]) -> str:
    """Name the first term whose columns add no new rank (for the refusal)."""
    prev = 1
    for term, sl in zip(spec.terms, term_slices(spec), strict=True):
        r = _rank(x[:, : sl.stop])
        if r < prev + (sl.stop - sl.start):
            return term_label(term)
        prev = r
    return term_label(spec.terms[-1])


def _prepare(
    response: Sequence[object],
    factors: Sequence[Mapping[str, Any]],
    terms: Sequence[Sequence[str]],
    center: bool,
) -> tuple[ModelSpec, NDArray[np.float64], dict[str, NDArray[np.float64]], NDArray[np.bool_]]:
    """Listwise-drop missing rows, fix nominal level order, build the spec."""
    y_all = np.asarray([_num(v) for v in response], dtype=float)
    n_all = y_all.size
    term_tuples = tuple(tuple(str(n) for n in t) for t in terms)
    used = {name for t in term_tuples for name in t}
    by_name = {str(f.get("name")): f for f in factors}
    unknown = sorted(used - set(by_name))
    if unknown:
        raise ValueError(f"term(s) use unknown factor(s): {', '.join(unknown)}")
    keep = np.isfinite(y_all)
    raw: dict[str, list[object] | NDArray[np.float64]] = {}
    for name in used:
        f = by_name[name]
        vals = f.get("values")
        if not isinstance(vals, list) or len(vals) != n_all:
            raise ValueError(f"factor {name!r} needs one value per response row")
        if f.get("kind") == NOMINAL:
            present = np.asarray([v is not None and str(v) != "" for v in vals], dtype=bool)
            keep &= present
            raw[name] = vals
        elif f.get("kind") == CONTINUOUS:
            arr = np.asarray([_num(v) for v in vals], dtype=float)
            keep &= np.isfinite(arr)
            raw[name] = arr
        else:
            raise ValueError(f"factor {name!r} kind must be 'continuous' or 'nominal'")
    specs: list[FactorSpec] = []
    profile: dict[str, NDArray[np.float64]] = {}
    for name in [nm for nm in by_name if nm in used]:
        f = by_name[name]
        if f.get("kind") == CONTINUOUS:
            arr = np.asarray(raw[name], dtype=float)[keep]
            mean = float(arr.mean()) if arr.size else 0.0
            specs.append(FactorSpec(name, CONTINUOUS, mean=mean))
            profile[name] = arr
            continue
        labels = [str(v) for v, k in zip(raw[name], keep, strict=True) if k]
        order_raw = f.get("levels")
        order = [str(v) for v in order_raw] if isinstance(order_raw, list) else sorted(set(labels))
        extra = sorted(set(labels) - set(order))
        levels = tuple(lv for lv in [*order, *extra] if lv in set(labels))
        if len(levels) < 2:
            raise ValueError(
                f"nominal factor {name!r} has {len(levels)} level(s) among the fitted rows; "
                "it needs at least 2"
            )
        index = {lv: i for i, lv in enumerate(levels)}
        specs.append(FactorSpec(name, NOMINAL, levels))
        profile[name] = np.asarray([index[lv] for lv in labels], dtype=float)
    spec = ModelSpec(tuple(specs), term_tuples, center)
    validate_terms(spec)
    return spec, y_all, profile, keep


def fit_linear_model(
    response: Sequence[object],
    factors: Sequence[Mapping[str, Any]],
    terms: Sequence[Sequence[str]],
    *,
    center_polynomials: bool = True,
    alpha: float = 0.05,
    response_name: str = "Y",
) -> dict[str, Any]:
    """Fit ``response ~ terms`` by OLS and return the JMP-style report.

    ``factors``: ``{"name", "kind": "continuous"|"nominal", "values": [...],
    "levels": [...] (optional nominal order)}``; nominal values are level
    labels (``None``/``""`` = missing), continuous values numbers (``None``/
    NaN = missing). ``terms``: factor-name lists, e.g. ``[["A"], ["B"],
    ["A", "B"], ["X", "X"]]``. Rows missing the response or any factor a term
    uses are dropped (listwise), and counted in ``n_dropped_missing``.
    """
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be between 0 and 1")
    spec, y_all, profile, keep = _prepare(response, factors, terms, center_polynomials)
    y = y_all[keep]
    n = int(y.size)
    x = design_matrix(spec, profile, n)
    p = x.shape[1]
    if n == 0:
        raise ValueError("no rows have a response and every factor value")
    if _rank(x) < p:
        raise ValueError(
            f"the model is rank deficient: term {_first_aliased_term(spec, x)!r} is not "
            "estimable from these rows (an empty cell in a crossed term, a constant "
            "column, or a term that duplicates others). Remove the term or add data."
        )
    df_error = n - p
    if df_error < 1:
        raise ValueError(
            f"{n} rows and {p} parameters leave {df_error} residual degrees of freedom; "
            "need at least 1. Remove terms or add data."
        )

    # Column-scaled QR solve: numerically stable for badly scaled polynomials.
    norms = np.linalg.norm(x, axis=0)
    q, r = np.linalg.qr(x / norms)
    beta = np.asarray(np.linalg.solve(r, q.T @ y) / norms, dtype=float)
    r_inv = np.asarray(np.linalg.inv(r), dtype=float)
    xtx_inv = np.asarray((r_inv @ r_inv.T) / np.outer(norms, norms), dtype=float)

    fitted = np.asarray(x @ beta, dtype=float)
    resid = np.asarray(y - fitted, dtype=float)
    sse = float(resid @ resid)
    ybar = float(y.mean())
    sst = float(((y - ybar) ** 2).sum())
    ssm = max(sst - sse, 0.0)
    df_model = p - 1
    mse = sse / df_error
    rmse = math.sqrt(mse)
    r2 = ssm / sst if sst > 0 else math.nan
    adj_r2 = 1.0 - (1.0 - r2) * (n - 1) / df_error if sst > 0 else math.nan
    f_model = (ssm / df_model) / mse if df_model > 0 and mse > 0 else math.nan
    p_model = float(sps.f.sf(f_model, df_model, df_error)) if math.isfinite(f_model) else math.nan

    cov = np.asarray(xtx_inv * mse, dtype=float)
    se = np.sqrt(np.clip(np.diag(cov), 0.0, None))
    t_crit = float(sps.t.ppf(1.0 - alpha / 2.0, df_error))
    names = parameter_names(spec)
    estimates = []
    for j in range(p):
        t = beta[j] / se[j] if se[j] > 0 else math.nan
        pv = float(2.0 * sps.t.sf(abs(t), df_error)) if math.isfinite(t) else math.nan
        estimates.append({
            "term": names[j], "estimate": float(beta[j]), "se": float(se[j]),
            "t": _finite_or_none(t), "p": _finite_or_none(pv),
            "lower": float(beta[j] - t_crit * se[j]), "upper": float(beta[j] + t_crit * se[j]),
        })

    effects = []
    for term, sl in zip(spec.terms, term_slices(spec), strict=True):
        b = beta[sl]
        c = xtx_inv[sl, sl]
        ss = float(b @ np.linalg.solve(c, b))
        df = sl.stop - sl.start
        f_val = (ss / df) / mse if mse > 0 else math.nan
        pv = float(sps.f.sf(f_val, df, df_error)) if math.isfinite(f_val) else math.nan
        effects.append({
            "effect": term_label(term), "nparm": df, "df": df, "ss": ss,
            "f": _finite_or_none(f_val), "p": _finite_or_none(pv),
        })

    predicted_all = np.full(y_all.size, math.nan)
    residual_all = np.full(y_all.size, math.nan)
    predicted_all[keep] = fitted
    residual_all[keep] = resid

    model = {
        "response": response_name, **spec.to_dict(),
        "parameters": names, "coefficients": beta.tolist(),
        "covariance": cov.tolist(), "df_error": df_error, "rmse": rmse,
    }
    return {
        "response": response_name,
        "n": n, "n_dropped_missing": int(y_all.size - n),
        "summary": {
            "r2": _finite_or_none(r2), "adj_r2": _finite_or_none(adj_r2), "rmse": rmse,
            "mean_response": ybar, "n": n,
        },
        "anova": [
            {"source": "Model", "df": df_model, "ss": ssm,
             "ms": ssm / df_model if df_model else None,
             "f": _finite_or_none(f_model), "p": _finite_or_none(p_model)},
            {"source": "Error", "df": df_error, "ss": sse, "ms": mse, "f": None, "p": None},
            {"source": "C. Total", "df": n - 1, "ss": sst, "ms": None, "f": None, "p": None},
        ],
        "parameter_estimates": estimates,
        "effect_tests": effects,
        "ls_means": _ls_means(spec, beta, cov, y, profile),
        "predicted": [_finite_or_none(float(v)) for v in predicted_all],
        "residual": [_finite_or_none(float(v)) for v in residual_all],
        "alpha": alpha,
        "center_polynomials": center_polynomials,
        "model": model,
    }


def _neutral(spec: ModelSpec, m: int) -> dict[str, NDArray[np.float64]]:
    """LS-means neutral profile: continuous at its mean, nominal averaged."""
    out: dict[str, NDArray[np.float64]] = {}
    for f in spec.factors:
        val = f.mean if f.kind == CONTINUOUS else float(AVERAGE_LEVEL)
        out[f.name] = np.full(m, val, dtype=float)
    return out


def _ls_means(
    spec: ModelSpec,
    beta: NDArray[np.float64],
    cov: NDArray[np.float64],
    y: NDArray[np.float64],
    profile: Mapping[str, NDArray[np.float64]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for term in spec.terms:
        if any(spec.factor(nm).kind != NOMINAL for nm in term):
            continue
        level_lists = [range(len(spec.factor(nm).levels)) for nm in term]
        combos = list(itertools.product(*level_lists))
        prof = _neutral(spec, len(combos))
        for i, nm in enumerate(term):
            prof[nm] = np.asarray([c[i] for c in combos], dtype=float)
        lmat = design_matrix(spec, prof, len(combos))
        est = np.asarray(lmat @ beta, dtype=float)
        se = np.sqrt(np.clip(np.einsum("ij,jk,ik->i", lmat, cov, lmat), 0.0, None))
        rows = []
        for k, combo in enumerate(combos):
            mask = np.ones(y.size, dtype=bool)
            for i, nm in enumerate(term):
                mask &= profile[nm] == combo[i]
            cnt = int(mask.sum())
            rows.append({
                "levels": [spec.factor(nm).levels[c] for nm, c in zip(term, combo, strict=True)],
                "ls_mean": float(est[k]), "se": float(se[k]),
                "mean": float(y[mask].mean()) if cnt else None, "n": cnt,
            })
        out.append({"effect": term_label(term), "factors": list(term), "rows": rows})
    return out


def predict(
    model: Mapping[str, Any],
    settings: Mapping[str, Sequence[object]],
) -> dict[str, Any]:
    """Evaluate a fitted model (``fit_linear_model(...)["model"]``) at new
    factor settings.

    ``settings`` maps every factor the model uses to a list (one entry per
    point): numbers for continuous factors, fitted level labels for nominal
    ones (``None`` = averaged over its levels, the LS-means neutral value).
    Returns the predicted mean and its standard error (``se_mean``, from the
    fitted covariance), plus ``df_error`` and ``rmse`` so a caller can form
    confidence or prediction intervals. Pure: no refit, no data needed.
    """
    spec = spec_from_dict(model)
    beta = np.asarray(model["coefficients"], dtype=float)
    cov = np.asarray(model["covariance"], dtype=float)
    profile, m = encode_profile(spec, settings)
    lmat = design_matrix(spec, profile, m)
    if lmat.shape[1] != beta.size or cov.shape != (beta.size, beta.size):
        raise ValueError("model coefficients do not match its terms")
    est = np.asarray(lmat @ beta, dtype=float)
    se = np.sqrt(np.clip(np.einsum("ij,jk,ik->i", lmat, cov, lmat), 0.0, None))
    return {
        "predicted": est.tolist(), "se_mean": se.tolist(),
        "df_error": int(model["df_error"]), "rmse": float(model["rmse"]),
    }
