"""Companion channels for a Quantum Design import (plot audit round 2).

``import_qd_vsm`` / ``import_ppms`` keep MATLAB ``importQDVSM``'s default of
one moment column (the golden-parity contract). The registry asks for the
companions too (``companions=True``): the moment's own standard-error column,
bound as its y-error role, and the sweep/condition columns a user re-plots
against — temperature, field, time. The moment stays the only default curve
(``default_value_channels``), so the first plot is unchanged; the extra
columns are there to pick as x, or to show, with error bars from the start.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np

__all__ = ["companion_indices", "companion_metadata", "with_companions"]

# A moment column's own uncertainty column, by exact QD name.
_ERROR_OF = {
    "Moment": "M. Std. Err.",
    "DC Moment Free Ctr": "DC Moment Err Free Ctr",
    "DC Moment Fixed Ctr": "DC Moment Err Fixed Ctr",
    "Long Moment": "Long Scan Std Dev",
    "Trans Moment": "Trans Scan Std Dev",
    "AC Moment": "AC M. Std Err.",
}
# Columns worth re-plotting against, in this order; the first spelling present
# wins (VSM/MPMS3 names first, MPMS-classic second).
_SWEEPS = (("Temperature",), ("Magnetic Field", "Field"), ("Time Stamp", "Time"))


def _populated(matrix: np.ndarray, c: int) -> bool:
    return bool(np.count_nonzero(np.isfinite(matrix[:, c])) * 2 > matrix.shape[0])


def companion_indices(
    col_names: Sequence[str],
    col_units: Sequence[str],
    matrix: np.ndarray,
    x_idx: int,
    y_idx: Sequence[int],
) -> tuple[list[int], dict[int, int]]:
    """``(columns to append after y_idx, {error column: target column})``.

    An error column is taken only when populated and in its target's unit; a
    sweep column only when populated and not already the x or a y column."""
    names = list(col_names)
    taken = {x_idx, *y_idx}
    extra: list[int] = []
    errors: dict[int, int] = {}
    for target in y_idx:
        err_name = _ERROR_OF.get(names[target])
        if err_name in names:
            err = names.index(err_name)
            if err not in taken and _populated(matrix, err) and col_units[err] == col_units[target]:
                extra.append(err)
                errors[err] = target
                taken.add(err)
    for spellings in _SWEEPS:
        col = next((names.index(s) for s in spellings if s in names), None)
        if col is not None and col not in taken and _populated(matrix, col):
            extra.append(col)
            taken.add(col)
    return extra, errors


def companion_metadata(
    channels: Sequence[int], n_default: int, errors: dict[int, int]
) -> dict[str, Any]:
    """Plot hints for the value channels ``channels`` (column indices, y first):
    the first ``n_default`` are the default curves; each error binding is
    expressed in value-channel indices, as ``io/_refl_columns.py`` does."""
    pos = {col: k for k, col in enumerate(channels)}
    meta: dict[str, Any] = {"default_value_channels": list(range(n_default))}
    if errors:
        meta["error_channels"] = {pos[t]: pos[e] for e, t in errors.items()}
        meta["error_roles"] = [
            {"channel": pos[e], "target": pos[t], "axis": "y", "side": "both"}
            for e, t in errors.items()
        ]
    return meta


def with_companions(
    col_names: Sequence[str],
    col_units: Sequence[str],
    matrix: np.ndarray,
    x_idx: int,
    y_idx: Sequence[int],
) -> tuple[list[int], dict[str, Any]]:
    """``(value-channel column indices, plot-hint metadata)`` for a QD import."""
    extra, errors = companion_indices(col_names, col_units, matrix, x_idx, y_idx)
    channels = [*y_idx, *extra]
    return channels, companion_metadata(channels, len(y_idx), errors)
