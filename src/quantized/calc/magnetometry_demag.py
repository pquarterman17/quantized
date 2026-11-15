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
    field_errors: list[ArrayLike] | None = None,
) -> tuple[NDArray[np.float64], list[NDArray[np.float64]]]:
    """Return internal field and its propagated uncertainties.

    Each uncertainty array is absolute, in ``field_unit`` and row-aligned with
    ``field``. The demagnetizing factor is treated as exact: the result never
    includes geometry-factor uncertainty. With ``H_int = H - N M`` and ``H``,
    ``M`` independent, ``sigma_Hint^2 = sigma_H^2 + (N sigma_M)^2``:

    * one array per ``magnetization_errors`` entry, each combined in
      quadrature with the applied-field uncertainty when ``field_errors`` is
      given (several field-error arrays are themselves summed in quadrature);
    * with only ``field_errors``, a single array: the applied-field
      uncertainty carried through unchanged (``dH_int/dH = 1``).

    A non-finite or wrong-length error array raises ``ValueError`` (fail
    closed); finite-ness is checked only where the caller supplied a value.
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
    sigma_h = np.zeros(h.size)
    for error in field_errors or []:
        sh = np.asarray(error, dtype=float).ravel()
        if sh.size != h.size:
            raise ValueError("each applied-field uncertainty must match the data length")
        if not np.all(np.isfinite(sh)):
            raise ValueError("applied-field uncertainty must be finite")
        sigma_h = np.asarray(np.sqrt(sigma_h**2 + sh**2), dtype=float)
    propagated: list[NDArray[np.float64]] = []
    for error in magnetization_errors or []:
        sigma = np.asarray(error, dtype=float).ravel()
        if sigma.size != h.size:
            raise ValueError("each magnetization uncertainty must match the data length")
        from_m = np.abs(sigma) * abs(n_factor * m_to_si * h_from_si)
        propagated.append(np.asarray(np.sqrt(sigma_h**2 + from_m**2), dtype=float))
    if field_errors and not magnetization_errors:
        propagated.append(sigma_h)
    return corrected, propagated
