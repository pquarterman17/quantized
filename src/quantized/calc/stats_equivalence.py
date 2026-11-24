"""Equivalence testing (TOST) and normal tolerance intervals.

GAP_AUDIT_9 G6. Pure numpy/scipy (BSD); nothing ported from pingouin (GPL).

References:
- Schuirmann, D. J. (1987), J. Pharmacokinet. Biopharm. 15, 657-680 (TOST).
- Lakens, D. (2017), "Equivalence tests", Soc. Psychol. Personal. Sci. 8,
  355-362, doi:10.1177/1948550617697177 (practical guidance, 1-2*alpha CI).
- NIST/SEMATECH e-Handbook of Statistical Methods, section 7.2.6.3
  (tolerance limits for a normal distribution; Howe two-sided factor,
  noncentral-t one-sided factor).
- Eisenhart, Hastay & Wallis (1947), Techniques of Statistical Analysis, ch. 2
  (the exact two-sided factor solved here by quadrature).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import optimize
from scipy import stats as sps

DESIGNS = ("welch", "pooled", "paired")
SIDES = ("two", "upper", "lower")


def _vec(x: NDArray[np.float64], name: str, min_n: int) -> NDArray[np.float64]:
    v: NDArray[np.float64] = np.asarray(x, dtype=float).ravel()
    v = np.asarray(v[np.isfinite(v)], dtype=float)
    if v.size < min_n:
        raise ValueError(f"{name} needs at least {min_n} finite observations")
    return v


def _bounds(margin: float | None, low: float | None, high: float | None) -> tuple[float, float]:
    if margin is not None:
        if low is not None or high is not None:
            raise ValueError("give either a symmetric margin or low/high bounds, not both")
        if not np.isfinite(margin) or margin <= 0:
            raise ValueError("the equivalence margin must be a positive number")
        return -float(margin), float(margin)
    if low is None or high is None:
        raise ValueError("an equivalence margin is required: set a symmetric margin or both bounds")
    if not (np.isfinite(low) and np.isfinite(high)) or low >= high:
        raise ValueError("the lower equivalence bound must be below the upper bound")
    return float(low), float(high)


def _tost(
    diff: float, se: float, df: float, low: float, high: float, alpha: float, sd: float
) -> dict[str, Any]:
    if not 0.0 < alpha < 0.5:
        raise ValueError("alpha must be between 0 and 0.5 for an equivalence test")
    if se <= 0.0:
        raise ValueError("the standard error is zero (no variation); the test is undefined")
    t_lo = (diff - low) / se  # H0: true difference <= low
    t_hi = (diff - high) / se  # H0: true difference >= high
    p_lo = float(sps.t.sf(t_lo, df))
    p_hi = float(sps.t.cdf(t_hi, df))
    p = max(p_lo, p_hi)
    tc = float(sps.t.isf(alpha, df))
    ci = (diff - tc * se, diff + tc * se)  # the (1 - 2 alpha) interval
    return {
        "diff": float(diff),
        "se": float(se),
        "df": float(df),
        "low": low,
        "high": high,
        "alpha": alpha,
        "t_lower": float(t_lo),
        "p_lower": p_lo,
        "t_upper": float(t_hi),
        "p_upper": p_hi,
        "p": float(p),
        "ci_low": float(ci[0]),
        "ci_high": float(ci[1]),
        "ci_level": 1.0 - 2.0 * alpha,
        "equivalent": bool(p < alpha),
        "effect_size": float(diff / sd) if sd > 0 else None,
    }


def tost_one_sample(
    x: NDArray[np.float64],
    *,
    mu0: float = 0.0,
    margin: float | None = None,
    low: float | None = None,
    high: float | None = None,
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Is the mean within ``[mu0 + low, mu0 + high]`` (symmetric ``margin``:
    ``mu0 +- margin``)? Two one-sided t tests on ``mean - mu0``; equivalence is
    declared when both reject, i.e. the (1-2 alpha) CI lies inside the margin.
    ``effect_size`` is Cohen's d (mean - mu0 over the sample SD)."""
    v = _vec(x, "the sample", 2)
    lo, hi = _bounds(margin, low, high)
    sd = float(np.std(v, ddof=1))
    out = _tost(
        float(np.mean(v)) - mu0, sd / float(np.sqrt(v.size)), v.size - 1.0, lo, hi, alpha, sd
    )
    return {
        **out,
        "n": int(v.size),
        "mean": float(np.mean(v)),
        "mu0": float(mu0),
        "method": "TOST one-sample t",
        "design": "one-sample",
    }


def tost_two_sample(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    *,
    design: str = "welch",
    margin: float | None = None,
    low: float | None = None,
    high: float | None = None,
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Equivalence of ``mean(x) - mean(y)`` within ``[low, high]``.
    ``design``: ``welch`` (unequal variances, Satterthwaite df), ``pooled``
    (equal variances) or ``paired`` (rows are pairs). ``effect_size`` is
    Cohen's d (difference over the pooled SD; paired: SD of differences)."""
    if design not in DESIGNS:
        raise ValueError(f"design must be one of {DESIGNS}, got {design!r}")
    lo, hi = _bounds(margin, low, high)
    if design == "paired":
        a = np.asarray(x, dtype=float).ravel()
        b = np.asarray(y, dtype=float).ravel()
        if a.size != b.size:
            raise ValueError("a paired test needs equal-length columns")
        keep = np.isfinite(a) & np.isfinite(b)
        d = a[keep] - b[keep]
        if d.size < 2:
            raise ValueError("a paired test needs at least 2 complete pairs")
        sd = float(np.std(d, ddof=1))
        out = _tost(float(np.mean(d)), sd / float(np.sqrt(d.size)), d.size - 1.0, lo, hi, alpha, sd)
        return {
            **out,
            "n1": int(d.size),
            "n2": int(d.size),
            "mean1": float(np.mean(a[keep])),
            "mean2": float(np.mean(b[keep])),
            "method": "TOST paired t",
            "design": design,
        }
    a, b = _vec(x, "the first sample", 2), _vec(y, "the second sample", 2)
    va, vb = float(np.var(a, ddof=1)), float(np.var(b, ddof=1))
    diff = float(np.mean(a) - np.mean(b))
    pooled = float(np.sqrt(((a.size - 1) * va + (b.size - 1) * vb) / (a.size + b.size - 2)))
    if design == "pooled":
        se = pooled * float(np.sqrt(1.0 / a.size + 1.0 / b.size))
        df = a.size + b.size - 2.0
    else:
        qa, qb = va / a.size, vb / b.size
        se = float(np.sqrt(qa + qb))
        df = (qa + qb) ** 2 / (qa * qa / (a.size - 1) + qb * qb / (b.size - 1)) if se > 0 else 1.0
    out = _tost(diff, se, df, lo, hi, alpha, pooled)
    return {
        **out,
        "n1": int(a.size),
        "n2": int(b.size),
        "mean1": float(np.mean(a)),
        "mean2": float(np.mean(b)),
        "method": "TOST Welch t" if design == "welch" else "TOST pooled t",
        "design": design,
    }


def _howe_k2(n: int, coverage: float, confidence: float) -> float:
    nu = n - 1.0
    z = float(sps.norm.ppf((1.0 + coverage) / 2.0))
    return float(z * np.sqrt(nu * (1.0 + 1.0 / n) / sps.chi2.ppf(1.0 - confidence, nu)))


def _exact_k2(n: int, coverage: float, confidence: float) -> float:
    """Exact two-sided factor: P over (mean, sd) that the interval mean +- k sd
    covers at least ``coverage`` of the population equals ``confidence``.
    With z = (xbar-mu)/sigma ~ N(0, 1/n) and s = S/sigma (nu s^2 ~ chi2_nu), the
    covered mass is Phi(z+ks) - Phi(z-ks); for each z the smallest k*s that
    reaches ``coverage`` is t*(z), so confidence = E_z[ P(chi2_nu >= nu t*^2/k^2) ]
    (Gauss-Hermite in z, brentq in t* and k)."""
    nu = n - 1.0
    nodes, weights = np.polynomial.hermite.hermgauss(96)
    zs = nodes * float(np.sqrt(2.0 / n))
    ws = weights / float(np.sqrt(np.pi))
    tstar = np.array(
        [
            optimize.brentq(
                lambda t, z=z: sps.norm.cdf(z + t) - sps.norm.cdf(z - t) - coverage,
                0.0,
                abs(z) + 40.0,
            )
            for z in zs
        ]
    )

    def conf(k: float) -> float:
        return float(np.sum(ws * sps.chi2.sf(nu * tstar**2 / (k * k), nu)))

    k0 = _howe_k2(n, coverage, confidence)
    return float(optimize.brentq(lambda k: conf(k) - confidence, k0 / 3.0, k0 * 3.0, xtol=1e-12))


def tolerance_interval(
    x: NDArray[np.float64],
    *,
    coverage: float = 0.9,
    confidence: float = 0.95,
    sides: str = "two",
) -> dict[str, Any]:
    """Normal-theory tolerance interval: with ``confidence`` the limits
    contain at least ``coverage`` (proportion p) of the population.
    ``two``: mean +- k2 s with the EXACT k2 (Howe's approximation, the NIST
    formula, is returned as ``k_howe`` for comparison). ``upper`` / ``lower``:
    one-sided limit mean +- k1 s, ``k1 = nct.ppf(confidence, n-1, z_p sqrt(n))
    / sqrt(n)`` (exact; NIST 7.2.6.3). Assumes the data are normal."""
    if sides not in SIDES:
        raise ValueError(f"sides must be one of {SIDES}, got {sides!r}")
    if not 0.0 < coverage < 1.0 or not 0.0 < confidence < 1.0:
        raise ValueError("coverage and confidence must each be between 0 and 1 (exclusive)")
    if coverage > 0.9999 or confidence > 0.9999:
        raise ValueError("coverage and confidence above 0.9999 are not supported")
    v = _vec(x, "the sample", 3)
    n = int(v.size)
    mean, sd = float(np.mean(v)), float(np.std(v, ddof=1))
    if sd <= 0.0:
        raise ValueError("the sample has zero variance; a tolerance interval is undefined")
    out: dict[str, Any] = {
        "n": n,
        "mean": mean,
        "sd": sd,
        "coverage": coverage,
        "confidence": confidence,
        "sides": sides,
        "lower": None,
        "upper": None,
        "k_howe": None,
    }
    if sides == "two":
        k = _exact_k2(n, coverage, confidence)
        out.update(
            k=k,
            lower=mean - k * sd,
            upper=mean + k * sd,
            k_howe=_howe_k2(n, coverage, confidence),
            method="Normal tolerance interval (two-sided, exact factor)",
        )
        return out
    zp = float(sps.norm.ppf(coverage))
    k = float(sps.nct.ppf(confidence, n - 1.0, zp * np.sqrt(n)) / np.sqrt(n))
    out.update(k=k, method="Normal tolerance bound (one-sided, noncentral t)")
    if sides == "upper":
        out["upper"] = mean + k * sd
    else:
        out["lower"] = mean - k * sd
    return out
