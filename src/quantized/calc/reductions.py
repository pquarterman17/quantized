"""Data reductions ported from quantized_matlab (PORT_PLAN #19).

Four reductions, each replicating the MATLAB *algorithm* (not just the
answer — per the replicate-vs-delegate rule these are idiosyncratic local
implementations, so window functions, zero-padding, peak search bounds and
the superlattice heuristics are ported step-for-step):

- ``williamson_hall``   — ``+calc/+crystal/williamsonHall.m``
- ``fft_thickness``     — ``+bosonPlotter/peakTools.m`` ``fftThickness/doFFT``
  (the math inside the dialog; the uifigure chrome is not part of the port)
- ``reflectivity_fft``  — ``peakTools.m`` ``reflectivityFFT/doReflFFT``
- ``spin_asymmetry``    — ``+bosonPlotter/computeAsymmetryForExport.m``
  (the (R++ − R−−)/(R++ + R−−) formula + exact error propagation; the
  polarization-pair discovery is GUI bookkeeping and stays in the caller)

pchip interpolation delegates to scipy (documented equivalent of MATLAB
``interp1(..., 'pchip')``); everything else is explicit.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.reductions_fft import fft_thickness, reflectivity_fft

__all__ = [
    "fft_thickness",
    "reflectivity_fft",
    "spin_asymmetry",
    "williamson_hall",
]

_FloatArray = NDArray[np.float64]


def williamson_hall(
    two_theta_deg: Any,
    fwhm_deg: Any,
    *,
    wavelength_a: float = 1.5406,
    k_factor: float = 0.9,
    instrumental_broadening_deg: float = 0.0,
) -> dict[str, Any]:
    """Separate crystallite size and microstrain from XRD peak widths.

    Williamson-Hall (uniform strain model): ``beta*cos(theta) = K*lambda/D
    + 4*eps*sin(theta)``; a linear fit of beta*cos(theta) vs 4*sin(theta)
    gives slope = microstrain and intercept = K*lambda/D. Instrumental
    broadening is subtracted in quadrature (clamped at 1e-16 like MATLAB
    when a peak is narrower than the instrument).
    """
    tt = np.asarray(two_theta_deg, dtype=float).ravel()
    fw = np.asarray(fwhm_deg, dtype=float).ravel()
    n = tt.size
    if n != fw.size:
        raise ValueError(
            f"two_theta and fwhm must have the same length (got {n} vs {fw.size})"
        )
    if n < 2:
        raise ValueError(f"at least 2 peaks are required for the Williamson-Hall fit (got {n})")
    if not np.all((tt > 0) & (tt < 180)):
        raise ValueError("all 2-theta values must be in the range (0, 180) degrees")
    if not np.all(fw > 0):
        raise ValueError("all FWHM values must be positive")
    if wavelength_a <= 0:
        raise ValueError("wavelength_a must be positive")
    if k_factor <= 0:
        raise ValueError("k_factor must be positive")
    if instrumental_broadening_deg < 0:
        raise ValueError("instrumental_broadening_deg must be non-negative")

    theta = np.asarray((tt / 2.0) * (math.pi / 180.0), dtype=float)
    beta_meas = np.asarray(fw * (math.pi / 180.0), dtype=float)

    beta_inst = instrumental_broadening_deg * (math.pi / 180.0)
    if beta_inst > 0:
        beta_sq = np.asarray(beta_meas**2 - beta_inst**2, dtype=float)
        # MATLAB warns and clamps when the instrument is broader than a peak.
        beta_sq = np.asarray(np.maximum(beta_sq, 1e-16), dtype=float)
        beta = np.asarray(np.sqrt(beta_sq), dtype=float)
    else:
        beta = beta_meas

    x = np.asarray(4.0 * np.sin(theta), dtype=float)
    y = np.asarray(beta * np.cos(theta), dtype=float)

    design = np.column_stack([x, np.ones(n)])
    coeffs, _, _, _ = np.linalg.lstsq(design, y, rcond=None)
    slope = float(coeffs[0])
    intercept = float(coeffs[1])

    if intercept <= 0:
        grain_size_nm = float("nan")  # undefined; peaks likely span phases
    else:
        grain_size_nm = (k_factor * wavelength_a) / intercept / 10.0

    y_fit = design @ coeffs
    ss_res = float(np.sum((y - y_fit) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r2 = 1.0 if ss_tot < np.finfo(float).eps else 1.0 - ss_res / ss_tot

    return {
        "grain_size_nm": grain_size_nm,
        "microstrain": slope,
        "r2": r2,
        "plot_x": x.tolist(),
        "plot_y": y.tolist(),
        "fit_line": [slope, intercept],
    }


def spin_asymmetry(
    r_pp: Any,
    r_mm: Any,
    dr_pp: Any = None,
    dr_mm: Any = None,
) -> dict[str, Any]:
    """Neutron spin asymmetry ``(R++ - R--) / (R++ + R--)``.

    Points where either channel is non-positive or NaN yield NaN (matching
    MATLAB's validity mask). The propagated error uses the exact partials
    ``dA/dR++ = 2 R-- / (R++ + R--)^2`` and ``dA/dR-- = -2 R++ / (...)^2``;
    absent uncertainties are treated as zero (so ``d_asymmetry`` is 0 on
    valid points, NaN on invalid ones — same as the MATLAB export path).
    """
    rpp = np.asarray(r_pp, dtype=float).ravel()
    rmm = np.asarray(r_mm, dtype=float).ravel()
    if rpp.size != rmm.size:
        raise ValueError(
            "spin channels must share one Q grid (interpolate first); "
            f"got {rpp.size} vs {rmm.size} points"
        )
    dpp = np.zeros_like(rpp) if dr_pp is None else np.asarray(dr_pp, dtype=float).ravel()
    dmm = np.zeros_like(rmm) if dr_mm is None else np.asarray(dr_mm, dtype=float).ravel()
    if dpp.size != rpp.size or dmm.size != rmm.size:
        raise ValueError("uncertainty arrays must match the reflectivity length")

    valid = (rpp > 0) & (rmm > 0) & ~np.isnan(rpp) & ~np.isnan(rmm)
    asym = np.full(rpp.shape, np.nan)
    err = np.full(rpp.shape, np.nan)
    total = rpp + rmm
    asym[valid] = (rpp[valid] - rmm[valid]) / total[valid]
    da_dpp = 2.0 * rmm[valid] / total[valid] ** 2
    da_dmm = -2.0 * rpp[valid] / total[valid] ** 2
    err[valid] = np.sqrt((da_dpp * dpp[valid]) ** 2 + (da_dmm * dmm[valid]) ** 2)

    return {
        "asymmetry": asym.tolist(),
        "d_asymmetry": err.tolist(),
        "n_valid": int(valid.sum()),
    }
