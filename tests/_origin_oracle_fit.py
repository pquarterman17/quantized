"""Read an Origin ``nlfit`` oracle fixture (``tools/origin_oracle/oracle_cases_fit``).

The report sheet Origin writes has a "Value" and a "Standard Error" column
whose first ``len(params)`` rows are the fitted parameters (derived
quantities follow them), and a statistics column listing, in order: points,
degrees of freedom, reduced chi-square, residual sum of squares, R-square,
adjusted R-square and the fit status string.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from _origin_oracle_fixture import OracleFixture

STAT_ORDER = ("n", "dof", "red_chisq", "rss", "r2", "adj_r2", "status")


@dataclass(frozen=True)
class OriginFit:
    case_id: str
    function: str  # quantized registry name
    param_names: list[str]
    x: NDArray[np.float64]
    y: NDArray[np.float64]
    start: NDArray[np.float64]  # what Origin started from
    start_kind: str  # "origin_guess" or "planted"
    params: NDArray[np.float64]  # what Origin fitted
    errors: NDArray[np.float64]
    stats: dict[str, float | str]

    @property
    def converged(self) -> bool:
        return str(self.stats["status"]).startswith("Succeeded")


def read_fit(fx: OracleFixture) -> OriginFit:
    planted = fx.planted
    names: list[str] = planted["param_names"]
    n = len(names)
    cols = fx.input_columns()
    x, y = cols["x"], cols["y"]
    value = np.array(fx.column("Value")[:n], dtype=float)
    error = np.array(fx.column("Standard Error")[:n], dtype=float)
    stats_col = next(
        c["values"]
        for b in fx.oracle["books"]
        for s in b["sheets"]
        for c in s["columns"]
        if c["long"] == "y" and len(c["values"]) >= 7 and isinstance(c["values"][6], str)
    )
    stats = dict(zip(STAT_ORDER, stats_col[:7], strict=True))
    start = np.array([fx.oracle["values"][f"qz_s{i}"] for i in range(1, n + 1)], dtype=float)
    return OriginFit(
        fx.case_id, planted["function"], names, x, y, start,
        str(fx.truth["conventions"]["start"]), value, error, stats,
    )
