"""Origin-style fit-report blocks for the curve-fit report sheet (#36).

``from_curve_fit`` (``calc.report_emit``) maps a fit's params and headline
goodness-of-fit; this adds what Origin's NLFit report sheet carries beyond
that, via ``calc.fit_report`` (no new math here, only table shaping):
parameter inference (t, Prob>|t|, confidence limits at ``ciLevel``), the ANOVA
table, the statistics block (N, df, reduced chi-square, R², adj. R²,
Root-MSE), and the covariance and correlation matrices.

The report needs the y the fit ran on; a ``calc.fitting`` result does not
carry it, but carries ``yFit`` and ``residuals`` (``residuals = y - yFit``),
so y is recovered exactly. ``dy`` in the result (the 1-sigma errors the fit
was weighted with) reproduces the fit's own weighted sums. A result without
residuals (e.g. a guess) gets no extra blocks.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

from quantized.calc.fit_report import fit_report
from quantized.calc.report import table_block

__all__ = ["fit_report_blocks"]


def _level_label(level: float) -> str:
    pct = level * 100
    return f"{pct:g}%"


def fit_report_blocks(
    result: Mapping[str, Any], param_names: Sequence[str]
) -> list[dict[str, Any]]:
    """The extra NLFit-report tables for ``result``; [] when it has no residuals."""
    residuals = result.get("residuals")
    y_fit = result.get("yFit")
    params = list(result.get("params") or [])
    if not isinstance(residuals, Sequence) or not isinstance(y_fit, Sequence) or not params:
        return []
    if len(residuals) != len(y_fit) or not residuals:
        return []
    r = np.asarray([np.nan if v is None else v for v in residuals], dtype=float)
    yf = np.asarray([np.nan if v is None else v for v in y_fit], dtype=float)
    keep = np.isfinite(r) & np.isfinite(yf)
    dy = result.get("dy")
    weights = None
    if isinstance(dy, Sequence) and len(dy) == len(residuals):
        d = np.asarray(dy, dtype=float)
        keep &= np.isfinite(d) & (d > 0)
        weights = (1.0 / d[keep] ** 2).tolist()
    level = float(result.get("ciLevel") or 0.95)
    # ``nFree`` may legitimately be 0 (every parameter held): only an ABSENT
    # count falls back to "all parameters free".
    n_free_raw = result.get("nFree")
    n_free = len(params) if n_free_raw is None else int(n_free_raw)
    errors = list(result.get("errors") or [None] * len(params))
    rep = fit_report(
        params, errors, result.get("covar"), (yf + r)[keep].tolist(), r[keep].tolist(), n_free,
        weights=weights, level=level,
    )
    lvl = _level_label(level)
    names = list(param_names)
    inference = table_block(
        ["Parameter", "Value", "Standard Error", "t-Value", "Prob>|t|",
         f"LCL ({lvl})", f"UCL ({lvl})"],
        [[names[i], p["value"], p["error"], p["t"], p["prob"], p["lcl"], p["ucl"]]
         for i, p in enumerate(rep["parameters"])],
        caption=f"Parameter inference ({lvl} confidence limits, {rep['stats']['dof']} df)",
    )
    s = rep["stats"]
    statistics = table_block(
        ["Statistic", "Value"],
        [["Number of points", s["n"]], ["Degrees of freedom", s["dof"]],
         ["Residual sum of squares", s["rss"]], ["Reduced χ²", s["reducedChiSq"]],
         ["R² (COD)", s["R2"]], ["Adj. R²", s["adjR2"]], ["Root-MSE (SD)", s["rootMSE"]]],
        caption="Statistics" + (" (weighted)" if weights is not None else ""),
    )
    anova = table_block(
        ["Source", "DF", "Sum of Squares", "Mean Square", "F Value", "Prob>F"],
        [[a["source"], a["df"], a["ss"], a["ms"], a["f"], a["prob"]] for a in rep["anova"]],
        caption="ANOVA",
    )
    blocks = [inference, statistics, anova]
    matrices = (("covariance", "Covariance matrix"), ("correlation", "Correlation matrix"))
    for key, caption in matrices:
        matrix = rep[key]
        if matrix is not None and len(matrix) == len(names):
            rows = [[names[i], *row] for i, row in enumerate(matrix)]
            blocks.append(table_block(["", *names], rows, caption=caption))
    return blocks
