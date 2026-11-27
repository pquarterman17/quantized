"""Read Origin's report and result sheets out of a frozen oracle fixture.

``OracleFixture.column`` finds columns by long name across all sheets; the
wave-6 analyses (kmeans, hcluster, wavelets) need the sheet by name and the
columns by position, because a report repeats long names (the four initial
and four final centre columns are both named v1..v4).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from _origin_oracle_fixture import OracleFixture


def sheet_columns(fx: OracleFixture, name: str) -> list[tuple[str, list[object]]]:
    """``[(long name, values)]`` of the sheet called ``name``, in column order."""
    for b in fx.oracle["books"]:
        for s in b["sheets"]:
            if s["name"] == name:
                return [(c["long"], c["values"]) for c in s["columns"]]
    raise KeyError(f"{fx.case_id}: no sheet {name!r}")


def numeric(values: list[object], n: int | None = None) -> NDArray[np.float64]:
    """Values as floats (blank, text and null cells are NaN), first ``n`` rows."""
    out: list[float] = []
    for v in values[:n]:
        try:
            out.append(float(v))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            out.append(float("nan"))
    return np.array(out, dtype=float)


def named(cols: list[tuple[str, list[object]]], long_name: str) -> list[object]:
    """The first column called ``long_name`` in a sheet."""
    for name, values in cols:
        if name == long_name:
            return values
    raise KeyError(long_name)


def trimmed(values: list[object]) -> NDArray[np.float64]:
    """Numeric values with the NaN padding removed."""
    v = numeric(values)
    return v[~np.isnan(v)]
