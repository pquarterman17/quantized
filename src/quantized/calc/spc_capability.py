"""Process capability: Cp, Cpk, Pp, Ppk (+ Cpm with a target) (GAP_AUDIT_9 J14).

Formulas: NIST/SEMATECH e-Handbook 6.1.6
(https://www.itl.nist.gov/div898/handbook/pmc/section1/pmc16.htm), whose worked
example (USL 20, LSL 8, s 2, mean 16 -> Cp 1.0, Cpk 0.6667) is a test.

* within sigma: R-bar/d2 (subgroups, ``method="range"``), S-bar/c4
  (``method="sd"``) or MR-bar/d2 (individuals); drives Cp/Cpk;
* overall sigma: the sample standard deviation (n-1); drives Pp/Ppk.

Confidence intervals (approximate, assume a normal, stable process; the
observation count ``n`` and n-1 degrees of freedom are used for both the
within and overall indices, which is only approximate for the within ones):

* Cp / Pp: chi-square interval, Montgomery, *Introduction to Statistical
  Quality Control*, Ch. 8 (Chou, Owen & Borrego 1990 / Kane 1986);
* Cpk / Ppk: Bissell (1990), *Applied Statistics* 39(3), 331-340, normal
  approximation ``Cpk +/- z sqrt(1/(9n) + Cpk^2 / (2(n-1)))``, as printed in
  NIST 6.1.6 (which advises n >= 25).

Spec limits have NO default: at least one of LSL / USL is required (a one-sided
specification gives only CPU or CPL, and Cp / Pp stay null). Provisional, owner
to confirm: one-sided specs accepted; Shapiro-Wilk p reported as a normality
warning, not a gate.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy import stats as sps

from quantized.calc import spc_constants as K

MIN_N = 5


def _num(v: float | None) -> float | None:
    return None if v is None or not math.isfinite(v) else float(v)


def _within_sigma(g: np.ndarray | None, x: np.ndarray, method: str) -> tuple[float, str]:
    if g is not None:
        n = g.shape[1]
        if method == "sd":
            return float(g.std(axis=1, ddof=1).mean() / K.c4(n)), f"S-bar / c4 (subgroup size {n})"
        if method != "range":
            raise ValueError("sigma_method must be 'range' or 'sd'")
        return float(
            (g.max(axis=1) - g.min(axis=1)).mean() / K.d2(n)
        ), f"R-bar / d2 (subgroup size {n})"
    return float(np.abs(np.diff(x)).mean() / K.d2(2)), "MR-bar / d2 (moving range of 2)"


def _chi2_ci(index: float, n: int, alpha: float) -> tuple[float, float]:
    lo = index * math.sqrt(sps.chi2.ppf(alpha / 2, n - 1) / (n - 1))
    hi = index * math.sqrt(sps.chi2.ppf(1 - alpha / 2, n - 1) / (n - 1))
    return lo, hi


def _bissell_ci(index: float, n: int, alpha: float) -> tuple[float, float]:
    z = float(sps.norm.ppf(1 - alpha / 2))
    se = math.sqrt(1.0 / (9.0 * n) + index * index / (2.0 * (n - 1)))
    return index - z * se, index + z * se


def _indices(
    mean: float, sigma: float, lsl: float | None, usl: float | None
) -> dict[str, float | None]:
    cpu = None if usl is None else (usl - mean) / (3 * sigma)
    cpl = None if lsl is None else (mean - lsl) / (3 * sigma)
    both = [v for v in (cpu, cpl) if v is not None]
    cp = None if lsl is None or usl is None else (usl - lsl) / (6 * sigma)
    return {"cp": cp, "cpu": cpu, "cpl": cpl, "cpk": min(both)}


def _ppm(
    mean: float, sigma: float, lsl: float | None, usl: float | None
) -> dict[str, float | None]:
    below = None if lsl is None else float(sps.norm.cdf((lsl - mean) / sigma) * 1e6)
    above = None if usl is None else float(sps.norm.sf((usl - mean) / sigma) * 1e6)
    return {"below": below, "above": above, "total": (below or 0.0) + (above or 0.0)}


def process_capability(
    values: list[float],
    *,
    lsl: float | None,
    usl: float | None,
    target: float | None = None,
    subgroups: list[list[float]] | None = None,
    sigma_method: str = "range",
    alpha: float = 0.05,
    bins: int | None = None,
) -> dict[str, Any]:
    if lsl is None and usl is None:
        raise ValueError(
            "enter at least one specification limit (LSL and/or USL); there is no default"
        )
    for nm, v in (("LSL", lsl), ("USL", usl), ("target", target)):
        if v is not None and not math.isfinite(v):
            raise ValueError(f"{nm} must be a finite number")
    if lsl is not None and usl is not None and not lsl < usl:
        raise ValueError("LSL must be less than USL")
    if target is not None and (
        (lsl is not None and target < lsl) or (usl is not None and target > usl)
    ):
        raise ValueError("target must lie between LSL and USL")
    if not 0.0 < alpha < 1.0:
        raise ValueError("alpha must be between 0 and 1")
    x = np.asarray(values, dtype=float)
    if subgroups is None and (x.ndim != 1 or not np.all(np.isfinite(x))):
        raise ValueError("values must be a flat list of finite numbers")
    g: np.ndarray | None = None
    if subgroups is not None:
        sizes = {len(s) for s in subgroups}
        if len(sizes) != 1 or min(sizes) < 2 or len(subgroups) < 2:
            raise ValueError("subgroups must be at least 2 groups of one equal size >= 2")
        g = np.asarray(subgroups, dtype=float)
        if not np.all(np.isfinite(g)):
            raise ValueError("subgroups must hold finite numbers")
        x = g.ravel()
    if len(x) < MIN_N:
        raise ValueError(f"need at least {MIN_N} observations")
    n = len(x)
    mean = float(x.mean())
    s_overall = float(x.std(ddof=1))
    s_within, within_method = _within_sigma(g, x, sigma_method)
    if not (s_overall > 0 and s_within > 0):
        raise ValueError("the data have no variation (sigma is 0), so capability is undefined")
    within = _indices(mean, s_within, lsl, usl)
    overall = _indices(mean, s_overall, lsl, usl)
    rows: dict[str, Any] = {}
    for tag, idx in (("within", within), ("overall", overall)):
        names = ("cp", "cpk") if tag == "within" else ("pp", "ppk")
        cis: dict[str, list[float] | None] = {}
        for nm, key in zip(names, ("cp", "cpk"), strict=True):
            val = idx[key]
            if val is None:
                cis[nm] = None
            else:
                lo, hi = (_chi2_ci if key == "cp" else _bissell_ci)(val, n, alpha)
                cis[nm] = [lo, hi]
        rows[tag] = {
            "sigma": s_within if tag == "within" else s_overall,
            "ci": cis,
            **{nm: _num(idx[key]) for nm, key in zip(names, ("cp", "cpk"), strict=True)},
            "cpu" if tag == "within" else "ppu": _num(idx["cpu"]),
            "cpl" if tag == "within" else "ppl": _num(idx["cpl"]),
        }
    cpm = None
    if target is not None and lsl is not None and usl is not None:
        cpm = (usl - lsl) / (6 * math.sqrt(s_overall**2 + (mean - target) ** 2))
    nb = bins if bins is not None else max(5, min(50, int(math.ceil(math.log2(n) + 1))))
    counts, edges = np.histogram(x, bins=nb)
    sw = float(sps.shapiro(x).pvalue) if n <= 5000 else None
    return {
        "n": n,
        "mean": mean,
        "lsl": lsl,
        "usl": usl,
        "target": target,
        "alpha": alpha,
        "within": rows["within"],
        "overall": rows["overall"],
        "cpm": _num(cpm),
        "within_method": within_method,
        "ppm_within": _ppm(mean, s_within, lsl, usl),
        "ppm_overall": _ppm(mean, s_overall, lsl, usl),
        "histogram": {"edges": edges.tolist(), "counts": counts.tolist()},
        "normality_p": _num(sw),
        "ci_note": "Approximate intervals (Bissell 1990 for Cpk/Ppk, chi-square for Cp/Pp); "
        "assume a "
        "normal, stable process; n-1 degrees of freedom for all four.",
    }
