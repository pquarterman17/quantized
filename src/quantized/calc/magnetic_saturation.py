"""Law of approach to saturation for a single high-field M(H) branch.

``M(H) = Ms (1 - a/H - b/H^2) + chi_hf H``.  ``a/H`` reflects inclusions or
microstress, ``b/H^2`` magnetocrystalline anisotropy, ``chi_hf H`` the forced
high-field susceptibility.  Linear in ``(Ms, -Ms a, -Ms b, chi_hf)``, so it is
fitted by OLS on ``[1, 1/H, 1/H^2, H]`` (columns scaled for conditioning);
uncertainties come from ``s^2 (X'X)^-1`` with delta-method propagation for
``a`` and ``b``.  Terms can be switched off.  For volumetric M,
``b = (4/15)(K1/(mu0 Ms))^2`` (uniaxial) or ``(8/105)(K1/(mu0 Ms))^2`` (cubic),
random polycrystal, gives K1 in J/m^3 (Ms uncertainty not propagated into K1).
"""

from __future__ import annotations

import math
from typing import Any, Literal

import numpy as np

from .magnetic_isotherms import MU0, field_units, mag_unit_info


def _ratio(c: Any, cov: Any, j: int) -> tuple[float, float]:
    """-c_j / c_0 and its delta-method standard error."""
    val = float(-c[j] / c[0])
    if c[j] == 0:
        return val, float("nan")
    var = val**2 * (cov[j, j] / c[j] ** 2 + cov[0, 0] / c[0] ** 2 - 2 * cov[0, j] / (c[j] * c[0]))
    return val, math.sqrt(var) if var >= 0 else float("nan")


def approach_to_saturation(
    field: list[float],
    magnetization: list[float],
    *,
    field_unit: str = "Oe",
    magnetization_unit: str = "emu/cm3",
    h_min: float,
    include_a: bool = True,
    include_b: bool = True,
    include_chi: bool = True,
    symmetry: Literal["uniaxial", "cubic"] = "uniaxial",
) -> dict[str, Any]:
    h_per = field_units(field_unit)[1]
    m_fac, si_unit, volumetric = mag_unit_info(magnetization_unit)
    h = np.asarray(field, dtype=float).ravel() * h_per
    m = np.asarray(magnetization, dtype=float).ravel()
    if h.size != m.size:
        raise ValueError("field and magnetization must be the same length")
    h0 = float(h_min) * h_per
    if not (math.isfinite(h0) and h0 > 0):
        raise ValueError("h_min must be a positive finite field")
    sel = np.isfinite(h) & np.isfinite(m) & (h >= h0)
    h, m = h[sel], m[sel] * m_fac
    cols = [np.ones_like(h)]
    names = ["Ms"]
    for flag, name, col in (
        (include_a, "a", 1.0 / h),
        (include_b, "b", 1.0 / h**2),
        (include_chi, "chi_hf", h),
    ):
        if flag:
            cols.append(col)
            names.append(name)
    p = len(cols)
    if h.size < p + 1:
        raise ValueError(f"need at least {p + 1} points at H >= h_min for {p} parameters")
    x = np.column_stack(cols)
    scale = np.linalg.norm(x, axis=0)
    xs = x / scale
    coef_s, *_ = np.linalg.lstsq(xs, m, rcond=None)
    res = m - xs @ coef_s
    rss = float(res @ res)
    cov = (rss / (h.size - p)) * np.linalg.inv(xs.T @ xs) / np.outer(scale, scale)
    c = coef_s / scale
    idx = {n: i for i, n in enumerate(names)}
    ms = float(c[0])
    sst = float(np.sum((m - m.mean()) ** 2))
    out: dict[str, Any] = {
        "Ms": ms,
        "Ms_se": math.sqrt(float(cov[0, 0])),
        "magnetization_si_unit": si_unit,
        "n_points": int(h.size),
        "h_min": float(h_min),
        "field_unit": field_unit,
        "rss": rss,
        "r2": 1.0 - rss / sst if sst > 0 else float("nan"),
        "a": 0.0,
        "a_se": 0.0,
        "b": 0.0,
        "b_se": 0.0,
        "chi_hf": 0.0,
        "chi_hf_se": 0.0,
        "a_units": "A/m",
        "b_units": "(A/m)^2",
    }
    for n in ("a", "b"):
        if n in idx:
            out[n], out[f"{n}_se"] = _ratio(c, cov, idx[n])
    if "chi_hf" in idx:
        j = idx["chi_hf"]
        out["chi_hf"], out["chi_hf_se"] = float(c[j]), math.sqrt(float(cov[j, j]))
    if volumetric and out["b"] > 0 and ms > 0:
        k_coef = 4.0 / 15.0 if symmetry == "uniaxial" else 8.0 / 105.0
        k1 = MU0 * ms * math.sqrt(out["b"] / k_coef)
        out["k1"] = k1
        out["k1_se"] = k1 * 0.5 * out["b_se"] / out["b"]
        out["k1_units"] = "J/m^3"
    return out
