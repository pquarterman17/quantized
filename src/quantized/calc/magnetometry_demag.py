"""Internal-field correction for volume-normalized magnetometry data.

The calculation is performed in SI so the same expression is valid for every
supported input unit::

    H_internal = H_applied - N M

For ``H`` in Oe and ``M`` in emu/cm³ the conversions reduce to the familiar
CGS form ``H_internal = H_applied - 4*pi*N*M``.  ``N`` is dimensionless and
uses the SI convention (the three principal factors sum to one).
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import ArrayLike, NDArray

from .magnetometry_units import field_factor

__all__ = ["demag_correct_field"]

_MAGNETIZATION_TO_AM = {"A/m": 1.0, "kA/m": 1_000.0, "emu/cm³": 1_000.0}


def demag_correct_field(
    field: ArrayLike,
    magnetization: ArrayLike,
    *,
    n_factor: float,
    field_unit: str,
    magnetization_unit: str,
    magnetization_errors: list[ArrayLike] | None = None,
) -> tuple[NDArray[np.float64], list[NDArray[np.float64]]]:
    """Return internal field and propagated magnetization-only uncertainties.

    Each uncertainty array is absolute and row-aligned with ``field``.  The
    demagnetizing factor is treated as exact; callers must not imply that the
    returned uncertainty includes geometry-factor or applied-field uncertainty.
    """
    h = np.asarray(field, dtype=float).ravel()
    m = np.asarray(magnetization, dtype=float).ravel()
    if h.size != m.size:
        raise ValueError("field and magnetization must be the same length")
    if not math.isfinite(n_factor) or not 0.0 <= n_factor <= 1.0:
        raise ValueError("demagnetizing factor N must be finite and between 0 and 1")

    h_to_si, h_ok, h_reason = field_factor(field_unit, "A/m")
    h_from_si, back_ok, back_reason = field_factor("A/m", field_unit)
    if not h_ok:
        raise ValueError(h_reason)
    if not back_ok:
        raise ValueError(back_reason)
    try:
        m_to_si = _MAGNETIZATION_TO_AM[magnetization_unit]
    except KeyError as exc:
        supported = ", ".join(_MAGNETIZATION_TO_AM)
        raise ValueError(
            "magnetization unit must be volume-normalized "
            f'({supported}); got "{magnetization_unit}"'
        ) from exc

    corrected = np.asarray((h * h_to_si - n_factor * m * m_to_si) * h_from_si, dtype=float)
    propagated: list[NDArray[np.float64]] = []
    for error in magnetization_errors or []:
        sigma = np.asarray(error, dtype=float).ravel()
        if sigma.size != h.size:
            raise ValueError("each magnetization uncertainty must match the data length")
        propagated.append(
            np.asarray(np.abs(sigma) * abs(n_factor * m_to_si * h_from_si), dtype=float)
        )
    return corrected, propagated
