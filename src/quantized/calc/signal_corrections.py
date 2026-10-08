"""Signal-specific correction helpers shared by the correction pipeline."""

from __future__ import annotations

import math
from typing import Any

import numpy as np


def detrend_channels(
    time: np.ndarray,
    values: np.ndarray,
    channels: list[int],
    labels: list[str],
    order: object,
    *,
    has_y_errors: bool,
) -> None:
    """Subtract a fitted polynomial trend from selected channels in place."""
    if has_y_errors:
        raise ValueError(
            "detrending data with bound Y uncertainty is not supported; "
            "unassign the error columns or detrend before assigning them"
        )
    if isinstance(order, bool) or not isinstance(order, int) or order < 0 or order > 5:
        raise ValueError("detrendOrder must be an integer from 0 to 5")
    for channel in channels:
        column = values[:, channel]
        finite = np.isfinite(time) & np.isfinite(column)
        finite_x = time[finite]
        if int(np.count_nonzero(finite)) <= order or np.unique(finite_x).size <= order:
            raise ValueError(
                f"cannot detrend channel {labels[channel]!r}: not enough finite rows"
            )
        coefficients = np.polyfit(finite_x, column[finite], order)
        values[:, channel] = column - np.polyval(coefficients, time)


def reference_divisors(
    time: np.ndarray,
    values: np.ndarray,
    channels: list[int],
    labels: list[str],
    *,
    explicit: Any,
    lower: Any,
    upper: Any,
) -> dict[int, float]:
    """Validate a reference selection and return one divisor per channel."""
    if explicit is not None and (lower is not None or upper is not None):
        raise ValueError("reference normalization must use a value or an X range, not both")
    if explicit is None and (lower is None or upper is None):
        raise ValueError("reference normalization needs a value or an X range")
    try:
        explicit_value = float(explicit) if explicit is not None else None
        lower_value = float(lower) if lower is not None else None
        upper_value = float(upper) if upper is not None else None
    except (TypeError, ValueError) as exc:
        raise ValueError("reference normalization values must be numeric") from exc
    if explicit_value is not None and (
        not math.isfinite(explicit_value) or explicit_value == 0
    ):
        raise ValueError("reference normalization value must be finite and non-zero")
    rows: np.ndarray | None = None
    if explicit_value is None:
        assert lower_value is not None and upper_value is not None
        if (
            not math.isfinite(lower_value)
            or not math.isfinite(upper_value)
            or lower_value >= upper_value
        ):
            raise ValueError("reference normalization X range must be finite and increasing")
        rows = (time >= lower_value) & (time <= upper_value)
        if not np.any(rows):
            raise ValueError("reference normalization X range contains no rows")

    divisors: dict[int, float] = {}
    for channel in channels:
        divisor = (
            explicit_value
            if explicit_value is not None
            else float(np.nanmean(values[rows, channel]))
        )
        if not math.isfinite(divisor) or divisor == 0:
            raise ValueError(
                f"cannot normalize channel {labels[channel]!r}: "
                "reference is zero or non-finite"
            )
        divisors[channel] = divisor
    return divisors
