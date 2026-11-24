"""Shewhart control charts (GAP_AUDIT_9 J14): X-bar/R, X-bar/S, I-MR, P, NP, C, U.

Formulas: NIST/SEMATECH e-Handbook of Statistical Methods section 6.3.2
(https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc32.htm: X-bar/R/S,
6.3.2.2 individuals) and 6.3.3 (attribute charts); Montgomery, *Introduction to
Statistical Quality Control*, Ch. 6-7. Limits are always +/-3 sigma of the
plotted statistic. Constants: ``calc.spc_constants``. Pure numpy.

Fail closed: unequal subgroup sizes are refused for X-bar charts (the fixed
constants assume one n); P/U accept varying sizes (per-point limits); too few
points, non-finite values, impossible counts and a constant ``n`` for NP are
refused with a message rather than guessed.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from quantized.calc import spc_constants as K
from quantized.calc.spc_rules import check_rules

MIN_POINTS = 2
CHARTS = ("xbar-r", "xbar-s", "imr", "p", "np", "c", "u")
_D2_N2 = K.d2(2)


def _arr(v: list[float], name: str) -> np.ndarray:
    a = np.asarray(v, dtype=float)
    if a.ndim != 1 or not np.all(np.isfinite(a)):
        raise ValueError(f"{name} must be a flat list of finite numbers")
    return a


def _panel(
    name: str,
    y: np.ndarray,
    center: float,
    ucl: np.ndarray,
    lcl: np.ndarray,
    rules: list[str],
    run_length: int,
    sigma: np.ndarray | None,
) -> dict[str, Any]:
    """One chart panel; rules 2-4 only when ``sigma`` (per-point) is given."""
    viol = check_rules(
        y,
        center,
        sigma if sigma is not None else (ucl - center) / 3.0,
        [r for r in rules if r == "we1" or sigma is not None],
        run_length,
    )
    flagged = sorted({i for v in viol for i in v["indices"]})
    # "beyond the limits" is judged against the (possibly clamped) drawn limits.
    beyond = [i for i in range(len(y)) if y[i] > ucl[i] or y[i] < lcl[i]]
    return {
        "name": name,
        "values": y.tolist(),
        "center": float(center),
        "ucl": ucl.tolist(),
        "lcl": lcl.tolist(),
        "beyond_limits": beyond,
        "violations": viol,
        "flagged": flagged,
    }


def _subgroups(subgroups: list[list[float]]) -> np.ndarray:
    if len(subgroups) < MIN_POINTS:
        raise ValueError(f"need at least {MIN_POINTS} subgroups")
    sizes = {len(g) for g in subgroups}
    if len(sizes) != 1:
        raise ValueError(
            f"subgroups have unequal sizes {sorted(sizes)}; X-bar charts here need one fixed size "
            "(drop incomplete subgroups or use the individuals chart)"
        )
    n = sizes.pop()
    if n < 2:
        raise ValueError(
            "subgroup size must be at least 2 (use the I-MR chart for single observations)"
        )
    K.d2(n)  # range check with a clear message
    return _arr([v for g in subgroups for v in g], "subgroups").reshape(len(subgroups), n)


def control_chart(
    chart: str,
    *,
    subgroups: list[list[float]] | None = None,
    values: list[float] | None = None,
    counts: list[float] | None = None,
    sizes: list[float] | None = None,
    rules: list[str] | None = None,
    run_length: int = 8,
) -> dict[str, Any]:
    """Compute one chart. Inputs by chart: ``xbar-r``/``xbar-s``: ``subgroups``;
    ``imr``: ``values``; ``p``/``np``/``c``/``u``: ``counts`` (+ ``sizes``)."""
    if chart not in CHARTS:
        raise ValueError(f"chart must be one of {CHARTS}, got {chart!r}")
    rules = list(rules or [])
    if chart in ("xbar-r", "xbar-s"):
        if subgroups is None:
            raise ValueError("this chart needs subgroups")
        return _xbar(chart, _subgroups(subgroups), rules, run_length)
    if chart == "imr":
        if values is None:
            raise ValueError("the individuals chart needs values")
        return _imr(_arr(values, "values"), rules, run_length)
    if counts is None:
        raise ValueError("attribute charts need counts")
    return _attribute(chart, _arr(counts, "counts"), sizes, rules, run_length)


def _xbar(chart: str, g: np.ndarray, rules: list[str], run_length: int) -> dict[str, Any]:
    k, n = g.shape
    xbar = g.mean(axis=1)
    grand = float(xbar.mean())
    const = K.published_constants(n)
    if chart == "xbar-r":
        disp = g.max(axis=1) - g.min(axis=1)
        dbar = float(disp.mean())
        sigma_w = dbar / const["d2"]
        half = const["A2"] * dbar
        disp_name, lo, hi = "R", const["D3"] * dbar, const["D4"] * dbar
    else:
        disp = g.std(axis=1, ddof=1)
        dbar = float(disp.mean())
        sigma_w = dbar / const["c4"]
        half = const["A3"] * dbar
        disp_name, lo, hi = "S", const["B3"] * dbar, const["B4"] * dbar
    ones = np.ones(k)
    sig = np.full(k, half / 3.0)
    panels = [
        _panel(
            "X-bar",
            xbar,
            grand,
            ones * (grand + half),
            ones * (grand - half),
            rules,
            run_length,
            sig,
        ),
        _panel(disp_name, disp, dbar, ones * hi, ones * lo, rules, run_length, None),
    ]
    return {
        "chart": chart,
        "n_subgroups": k,
        "subgroup_size": n,
        "panels": panels,
        "sigma_within": sigma_w,
        "grand_mean": grand,
        "dispersion_mean": dbar,
        "constants": const,
        "out_of_control": _count(panels),
    }


def _imr(x: np.ndarray, rules: list[str], run_length: int) -> dict[str, Any]:
    if len(x) < 3:
        raise ValueError("the individuals chart needs at least 3 observations")
    mr = np.abs(np.diff(x))
    mrbar = float(mr.mean())
    mean = float(x.mean())
    sigma_w = mrbar / _D2_N2
    half = 3.0 * sigma_w  # 3 MRbar / 1.128 = 2.660 MRbar (NIST 6.3.2.2)
    k, m = len(x), len(mr)
    d4 = K.d4_upper(2)
    panels = [
        _panel(
            "Individuals",
            x,
            mean,
            np.full(k, mean + half),
            np.full(k, mean - half),
            rules,
            run_length,
            np.full(k, sigma_w),
        ),
        _panel(
            "Moving range",
            mr,
            mrbar,
            np.full(m, d4 * mrbar),
            np.full(m, 0.0),
            rules,
            run_length,
            None,
        ),
    ]
    return {
        "chart": "imr",
        "n_subgroups": k,
        "subgroup_size": 1,
        "panels": panels,
        "sigma_within": sigma_w,
        "grand_mean": mean,
        "dispersion_mean": mrbar,
        "constants": K.published_constants(2),
        "out_of_control": _count(panels),
    }


def _attribute(
    chart: str, c: np.ndarray, sizes: list[float] | None, rules: list[str], run_length: int
) -> dict[str, Any]:
    k = len(c)
    if k < MIN_POINTS:
        raise ValueError(f"need at least {MIN_POINTS} points")
    if np.any(c < 0):
        raise ValueError("counts must be 0 or more")
    if chart == "c":
        if sizes is not None:
            raise ValueError(
                "the C chart assumes a constant inspection unit; use the U chart for varying sizes"
            )
        cbar = float(c.mean())
        if cbar <= 0:
            raise ValueError("all counts are 0: nothing to chart")
        s = math.sqrt(cbar)
        panel = _panel(
            "C",
            c,
            cbar,
            np.full(k, cbar + 3 * s),
            np.full(k, max(0.0, cbar - 3 * s)),
            rules,
            run_length,
            np.full(k, s),
        )
        return _attr_result("c", k, panel, cbar, None)
    if sizes is None:
        raise ValueError(f"the {chart.upper()} chart needs the sample sizes")
    n = _arr(sizes, "sizes")
    if len(n) != k:
        raise ValueError("sizes and counts must have the same length")
    if np.any(n <= 0):
        raise ValueError("sample sizes must be positive")
    if chart in ("p", "np") and np.any(c > n):
        raise ValueError("a count exceeds its sample size")
    if chart == "u":
        ubar = float(c.sum() / n.sum())
        if ubar <= 0:
            raise ValueError("all counts are 0: nothing to chart")
        sg = np.sqrt(ubar / n)
        panel = _panel(
            "U", c / n, ubar, ubar + 3 * sg, np.maximum(0.0, ubar - 3 * sg), rules, run_length, sg
        )
        return _attr_result("u", k, panel, ubar, n)
    pbar = float(c.sum() / n.sum())
    if pbar <= 0 or pbar >= 1:
        raise ValueError("the overall proportion is 0 or 1: nothing to chart")
    if chart == "np":
        if np.ptp(n) != 0:
            raise ValueError(
                "the NP chart needs a constant sample size; use the P chart for varying sizes"
            )
        s = math.sqrt(n[0] * pbar * (1 - pbar))
        mid = float(n[0] * pbar)
        panel = _panel(
            "NP",
            c,
            mid,
            np.full(k, mid + 3 * s),
            np.full(k, max(0.0, mid - 3 * s)),
            rules,
            run_length,
            np.full(k, s),
        )
        return _attr_result("np", k, panel, pbar, n)
    sg = np.sqrt(pbar * (1 - pbar) / n)
    panel = _panel(
        "P",
        c / n,
        pbar,
        np.minimum(1.0, pbar + 3 * sg),
        np.maximum(0.0, pbar - 3 * sg),
        rules,
        run_length,
        sg,
    )
    return _attr_result("p", k, panel, pbar, n)


def _attr_result(
    chart: str, k: int, panel: dict[str, Any], center: float, n: np.ndarray | None
) -> dict[str, Any]:
    return {
        "chart": chart,
        "n_subgroups": k,
        "subgroup_size": None if n is None else float(np.mean(n)),
        "panels": [panel],
        "sigma_within": None,
        "grand_mean": center,
        "dispersion_mean": None,
        "constants": None,
        "out_of_control": _count([panel]),
    }


def _count(panels: list[dict[str, Any]]) -> int:
    return len({(p["name"], i) for p in panels for i in p["flagged"] + p["beyond_limits"]})
