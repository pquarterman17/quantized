"""Loaded-data preparation for a physically meaningful Curie--Weiss fit.

The legacy calculator accepts an already-normalized molar susceptibility.  A
real MPMS temperature sweep normally contains total moment and applied field
instead.  This module owns the otherwise easy-to-get-wrong conversion

``chi_molar = (moment / field) / moles``

and keeps the assumptions explicit: total moment needs sample mass and molar
mass, mass-normalized moment needs molar mass, and an already-molar response is
accepted unchanged.  Sample quantities and the field are treated as exact;
response uncertainty is propagated through both divisions.
"""

from __future__ import annotations

import math
from typing import Any, Literal

import numpy as np

from .magnetic import curie_weiss_fit
from .magnetometry_units import field_factor

ResponseBasis = Literal["molar_susceptibility", "total_moment", "mass_moment"]


def curie_weiss_data_fit(
    temperature: list[float],
    response: list[float],
    *,
    response_basis: ResponseBasis,
    fit_range: tuple[float, float],
    field: list[float] | None = None,
    field_unit: str = "Oe",
    sample_mass_g: float | None = None,
    molar_mass_g_mol: float | None = None,
    response_errors: list[list[float]] | None = None,
) -> dict[str, Any]:
    """Convert a loaded M(T)/chi(T) series and fit its Curie--Weiss regime.

    Returned series remain row-aligned with the request.  Non-positive molar
    susceptibility and zero-field rows are represented by NaN and excluded
    from the fit.  At least three valid points must lie inside the explicit fit
    range; unlike the MATLAB auto-range fallback, this workflow never silently
    substitutes a different range from the one shown in the GUI.
    """
    t = np.asarray(temperature, dtype=float).ravel()
    y = np.asarray(response, dtype=float).ravel()
    if t.size < 3:
        raise ValueError("need at least 3 data points")
    if y.size != t.size:
        raise ValueError("temperature and response must be the same length")
    lo, hi = (float(fit_range[0]), float(fit_range[1]))
    if not (math.isfinite(lo) and math.isfinite(hi) and lo < hi):
        raise ValueError("fit range must contain two finite values with minimum < maximum")

    errors = [np.asarray(values, dtype=float).ravel() for values in (response_errors or [])]
    if any(values.size != t.size for values in errors):
        raise ValueError("every response-error series must match the data length")

    if response_basis == "molar_susceptibility":
        chi = y.copy()
        scales = np.ones(t.size, dtype=float)
    else:
        if field is None:
            raise ValueError("applied field is required to derive molar susceptibility")
        h = np.asarray(field, dtype=float).ravel()
        if h.size != t.size:
            raise ValueError("temperature, response, and field must be the same length")
        h_factor, supported, reason = field_factor(field_unit, "Oe")
        if not supported:
            raise ValueError(reason)
        h_oe = np.asarray(h * h_factor, dtype=float)
        if molar_mass_g_mol is None or not math.isfinite(molar_mass_g_mol) or molar_mass_g_mol <= 0:
            raise ValueError("a positive finite molar mass is required")
        if response_basis == "total_moment":
            if sample_mass_g is None or not math.isfinite(sample_mass_g) or sample_mass_g <= 0:
                raise ValueError("a positive finite sample mass is required for total moment")
            numerator = molar_mass_g_mol / sample_mass_g
        elif response_basis == "mass_moment":
            numerator = molar_mass_g_mol
        else:
            raise ValueError(f'unsupported response basis "{response_basis}"')
        with np.errstate(divide="ignore", invalid="ignore"):
            scales = np.asarray(numerator / h_oe, dtype=float)
            chi = np.asarray(y * scales, dtype=float)
        invalid_field = ~np.isfinite(h_oe) | (h_oe == 0)
        chi[invalid_field] = np.nan
        scales[invalid_field] = np.nan

    finite_t = np.isfinite(t)
    positive = np.isfinite(chi) & (chi > 0)
    fit_mask = finite_t & positive & (t >= lo) & (t <= hi)
    n_fit = int(np.count_nonzero(fit_mask))
    if n_fit < 3:
        raise ValueError(
            f"fit range contains only {n_fit} finite positive-susceptibility "
            "points; need at least 3"
        )
    if np.unique(t[fit_mask]).size < 2:
        raise ValueError("fit range needs at least two distinct temperature values")

    # The legacy helper considers ``+inf > 0`` valid and would therefore turn
    # an overflowed susceptibility into an inverse value of zero.  Feed it the
    # exact finite-positive population counted above so the reported mask and
    # the fitted rows cannot diverge.
    fit_chi = chi.copy()
    fit_chi[~positive] = np.nan
    result = curie_weiss_fit(t.tolist(), fit_chi.tolist(), fit_range=(lo, hi))
    slope, intercept = result["fit_line"]
    fit_values = np.full(t.size, np.nan, dtype=float)
    in_range = finite_t & (t >= lo) & (t <= hi)
    fit_values[in_range] = slope * t[in_range] + intercept

    chi_errors: list[list[float]] = []
    inverse_errors: list[list[float]] = []
    for values in errors:
        propagated = np.asarray(np.abs(values * scales), dtype=float)
        inverse = np.full(t.size, np.nan, dtype=float)
        usable = positive & np.isfinite(propagated)
        inverse[usable] = propagated[usable] / np.square(chi[usable])
        chi_errors.append(propagated.tolist())
        inverse_errors.append(inverse.tolist())

    return {
        **result,
        "susceptibility_molar": chi.tolist(),
        "susceptibility_errors_molar": chi_errors,
        "inverse_errors": inverse_errors,
        "fit_inv_chi": fit_values.tolist(),
        "fit_mask": fit_mask.tolist(),
        "n_fit": n_fit,
        "fit_range_used": [lo, hi],
        "excluded_nonpositive": int(np.count_nonzero(np.isfinite(chi) & (chi <= 0))),
    }
