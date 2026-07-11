"""FFT-based thickness reductions (PORT_PLAN #19) — see reductions.py.

Split from calc/reductions.py to respect the 500-line ceiling. Both public
functions re-export through ``quantized.calc.reductions``.

- ``fft_thickness``    — ``+bosonPlotter/peakTools.m`` ``fftThickness/doFFT``
- ``reflectivity_fft`` — ``peakTools.m`` ``reflectivityFFT/doReflFFT``
  (including the superlattice harmonic analysis)
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.interpolate import PchipInterpolator

__all__ = ["fft_thickness", "reflectivity_fft"]

_FloatArray = NDArray[np.float64]


def _window(name: str, n: int) -> _FloatArray:
    """MATLAB peakTools window formulas (symmetric, N-1 denominator)."""
    k = np.arange(n, dtype=float)
    if name == "hann":
        return np.asarray(0.5 * (1.0 - np.cos(2.0 * math.pi * k / (n - 1))), dtype=float)
    if name == "blackman":
        return np.asarray(
            0.42
            - 0.5 * np.cos(2.0 * math.pi * k / (n - 1))
            + 0.08 * np.cos(4.0 * math.pi * k / (n - 1)),
            dtype=float,
        )
    if name == "none":
        return np.ones(n, dtype=float)
    raise ValueError(f"unknown window {name!r} (expected 'hann', 'blackman' or 'none')")


def _next_pow2_len(n: int) -> int:
    """MATLAB ``2^nextpow2(4*N)`` — smallest power of two >= 4*N."""
    return 1 << (4 * n - 1).bit_length()


def _uniform_q_fft(
    q: _FloatArray, signal: _FloatArray, window: str
) -> tuple[_FloatArray, _FloatArray, _FloatArray]:
    """Shared tail of both FFT reductions: pchip onto a uniform Q grid is done
    by the callers (they differ in detrending); this applies the window and
    the 4x zero-padded FFT, returning (F_half, thickness_nm_axis, w) —
    thickness axis in nm from ``2*pi*k / (N_fft*dQ)`` Angstroms."""
    n = signal.size
    w = _window(window, n)
    windowed = signal * w
    n_fft = _next_pow2_len(n)
    f = np.asarray(np.abs(np.fft.fft(windowed, n_fft))[: n_fft // 2], dtype=float)
    dq = float(q[1] - q[0])
    thickness_a = 2.0 * math.pi * np.arange(n_fft // 2, dtype=float) / (n_fft * dq)
    return f, np.asarray(thickness_a / 10.0, dtype=float), w


def fft_thickness(
    two_theta_deg: Any,
    intensity: Any,
    wavelength_a: float,
    *,
    two_theta_min: float | None = None,
    two_theta_max: float | None = None,
    window: str = "hann",
    max_thickness_nm: float = 200.0,
) -> dict[str, Any]:
    """Film thickness from Laue-fringe periodicity via FFT (XRD).

    2-theta -> Q, pchip-resample to a uniform Q grid, mean-subtract, window,
    4x zero-padded FFT; the strongest peak in bins 4..(t <= max) is the
    thickness, with the FFT-peak FWHM/2 as the uncertainty.
    """
    if wavelength_a <= 0 or not math.isfinite(wavelength_a):
        raise ValueError("wavelength_a must be positive and finite")
    x_all = np.asarray(two_theta_deg, dtype=float).ravel()
    y_all = np.asarray(intensity, dtype=float).ravel()
    if x_all.size != y_all.size:
        raise ValueError("two_theta and intensity must have the same length")

    lo = float(x_all.min()) if two_theta_min is None else float(two_theta_min)
    hi = float(x_all.max()) if two_theta_max is None else float(two_theta_max)
    if lo >= hi:
        raise ValueError("two_theta_min must be less than two_theta_max")
    mask = (x_all >= lo) & (x_all <= hi)
    if int(mask.sum()) < 10:
        raise ValueError("too few data points in selected range (need >= 10)")
    tt_sel = x_all[mask]
    i_sel = y_all[mask]

    q = np.asarray(
        (4.0 * math.pi / wavelength_a) * np.sin(tt_sel / 2.0 * math.pi / 180.0), dtype=float
    )
    order = np.argsort(q, kind="stable")  # interp1 sorts sample points internally
    q_sorted = q[order]
    i_sorted = i_sel[order]

    n_pts = q_sorted.size
    q_uniform = np.linspace(float(q_sorted[0]), float(q_sorted[-1]), n_pts)
    i_uniform = np.asarray(PchipInterpolator(q_sorted, i_sorted)(q_uniform), dtype=float)
    i_uniform = np.asarray(i_uniform - np.mean(i_uniform), dtype=float)

    f, thickness_nm, _ = _uniform_q_fft(q_uniform, i_uniform, window)

    # MATLAB searches F(4:searchMax) (1-based) — skip the DC/low bins.
    search_min0 = 3  # 0-based index of MATLAB bin 4
    below = np.nonzero(thickness_nm <= max_thickness_nm)[0]
    search_max = int(below[-1]) + 1 if below.size else 0  # exclusive, = MATLAB count
    if search_max < search_min0 + 2:
        search_max = f.size
    seg = f[search_min0:search_max]
    peak_rel = int(np.argmax(seg))
    peak_val = float(seg[peak_rel])
    peak_idx = peak_rel + search_min0
    t_nm = float(thickness_nm[peak_idx])

    # Uncertainty from the FFT-peak FWHM (searched over the FULL half-spectrum
    # like MATLAB, not just the restricted range).
    half_max = peak_val / 2.0
    left_below = np.nonzero(f[: peak_idx + 1] < half_max)[0]
    right_below = np.nonzero(f[peak_idx:] < half_max)[0]
    if left_below.size and right_below.size:
        left_idx = int(left_below[-1])
        right_idx = peak_idx + int(right_below[0])
        fwhm_bins = right_idx - left_idx
        hw = math.ceil(fwhm_bins / 2)
        dt_nm = float(
            thickness_nm[min(peak_idx + hw, thickness_nm.size - 1)]
            - thickness_nm[max(peak_idx - hw, 0)]
        )
        uncertainty_nm = dt_nm / 2.0
    else:
        uncertainty_nm = float("nan")

    return {
        "thickness_nm": t_nm,
        "uncertainty_nm": uncertainty_nm,
        "wavelength_a": wavelength_a,
        "two_theta_range": [lo, hi],
        "fft_magnitude": f[:search_max].tolist(),
        "thickness_axis": thickness_nm[:search_max].tolist(),
        "n_points": int(mask.sum()),
    }


_PREPROCESS_MODES = ("logR", "logRQ4", "R", "RQ4")


def reflectivity_fft(
    x: Any,
    reflectivity: Any,
    *,
    is_neutron: bool = False,
    wavelength_a: float | None = None,
    x_min: float | None = None,
    x_max: float | None = None,
    window: str = "hann",
    preprocess: str = "logR",
    max_thickness_nm: float = 500.0,
    peak_prominence_threshold: float = 0.05,
) -> dict[str, Any]:
    """Film thickness(es) from Kiessig-fringe periodicity via FFT.

    Supports neutron NR (``x`` already Q in 1/Angstrom) and XRR (``x`` in
    degrees 2-theta, converted with ``wavelength_a``). Preprocess modes
    ``logR`` / ``logRQ4`` / ``R`` / ``RQ4`` (Q^4 = Fresnel correction),
    linear detrend, window, 4x zero-padded FFT, multi-peak detection with a
    prominence filter, and the MATLAB superlattice heuristics (harmonic
    scoring at 8% tolerance, satellite counting, suppressed-order sublayer
    split).
    """
    if preprocess not in _PREPROCESS_MODES:
        raise ValueError(f"preprocess must be one of {_PREPROCESS_MODES} (got {preprocess!r})")
    if not 0.0 < peak_prominence_threshold <= 1.0:
        raise ValueError("peak_prominence_threshold must be in (0, 1]")
    x_all = np.asarray(x, dtype=float).ravel()
    r_all = np.asarray(reflectivity, dtype=float).ravel()
    if x_all.size != r_all.size:
        raise ValueError("x and reflectivity must have the same length")

    lo = float(x_all.min()) if x_min is None else float(x_min)
    hi = float(x_all.max()) if x_max is None else float(x_max)
    if lo >= hi:
        raise ValueError("x_min must be less than x_max")
    mask = (x_all >= lo) & (x_all <= hi)
    if int(mask.sum()) < 10:
        raise ValueError("too few data points in selected range (need >= 10)")
    x_sel = x_all[mask]
    r_sel = r_all[mask]

    if is_neutron:
        q = np.asarray(x_sel, dtype=float)
    else:
        if wavelength_a is None or not math.isfinite(wavelength_a) or wavelength_a <= 0:
            raise ValueError("wavelength_a is required (positive, finite) for XRR mode")
        q = np.asarray(
            (4.0 * math.pi / wavelength_a) * np.sin(x_sel / 2.0 * math.pi / 180.0), dtype=float
        )

    use_q4 = "Q4" in preprocess
    use_log = preprocess.startswith("log")
    r_proc = np.asarray(r_sel, dtype=float)
    if use_q4:
        q_safe = np.asarray(np.maximum(q, 1e-6), dtype=float)
        r_proc = np.asarray(r_proc * q_safe**4, dtype=float)
    if use_log:
        r_proc = np.asarray(np.log10(np.maximum(r_proc, 1e-30)), dtype=float)

    order = np.argsort(q, kind="stable")
    q_sorted = q[order]
    r_sorted = r_proc[order]
    n_pts = q_sorted.size
    q_uniform = np.linspace(float(q_sorted[0]), float(q_sorted[-1]), n_pts)
    r_uniform = np.asarray(PchipInterpolator(q_sorted, r_sorted)(q_uniform), dtype=float)

    trend = np.polyfit(q_uniform, r_uniform, 1)
    r_uniform = np.asarray(r_uniform - np.polyval(trend, q_uniform), dtype=float)

    f, thickness_nm, _ = _uniform_q_fft(q_uniform, r_uniform, window)

    search_min0 = 3  # MATLAB bin 4, 0-based
    below = np.nonzero(thickness_nm <= max_thickness_nm)[0]
    search_max = int(below[-1]) + 1 if below.size else 0
    if search_max < search_min0 + 2:
        search_max = f.size
    f_search = np.asarray(f[search_min0:search_max], dtype=float)
    t_search = np.asarray(thickness_nm[search_min0:search_max], dtype=float)

    # Local maxima (strict on both sides), MATLAB fallback to the global max.
    n_s = f_search.size
    interior = np.arange(1, n_s - 1)
    is_max = (f_search[interior] > f_search[interior - 1]) & (
        f_search[interior] > f_search[interior + 1]
    )
    max_idx = interior[is_max]
    if max_idx.size == 0:
        max_idx = np.asarray([int(np.argmax(f_search))])

    pk_amps = f_search[max_idx]
    pk_thick = t_search[max_idx]

    # Prominence: height above the higher of the two flanking minima.
    prominences = np.empty(pk_amps.size, dtype=float)
    for j, idx in enumerate(max_idx):
        left_min = float(np.min(f_search[: idx + 1]))
        right_min = float(np.min(f_search[idx:]))
        prominences[j] = pk_amps[j] - max(left_min, right_min)
    prom_thresh = peak_prominence_threshold * float(np.max(prominences))
    keep = prominences > prom_thresh
    pk_amps = pk_amps[keep]
    pk_thick = pk_thick[keep]

    sort_ord = np.argsort(-pk_amps, kind="stable")
    pk_amps = pk_amps[sort_ord]
    pk_thick = pk_thick[sort_ord]
    if pk_amps.size > 20:
        pk_amps = pk_amps[:20]
        pk_thick = pk_thick[:20]

    superlattice, labels = _superlattice_analysis(pk_thick)

    result: dict[str, Any] = {
        "thicknesses_nm": pk_thick.tolist(),
        "amplitudes": pk_amps.tolist(),
        "harmonic_labels": labels,
        "q_range": [float(q.min()), float(q.max())],
        "preprocess": preprocess,
        "fft_magnitude": f_search.tolist(),
        "thickness_axis": t_search.tolist(),
        "is_neutron": is_neutron,
        "superlattice": superlattice,
    }
    if not is_neutron:
        result["wavelength_a"] = wavelength_a
    return result


_HARM_TOL = 0.08  # MATLAB harmTol: 8% relative tolerance for harmonic matching


def _ml_round(x: float) -> int:
    """MATLAB round(): half away from zero (Python round() is half-to-even)."""
    return int(math.floor(x + 0.5)) if x >= 0 else int(math.ceil(x - 0.5))


def _superlattice_analysis(
    pk_thick: _FloatArray,
) -> tuple[dict[str, Any], list[str]]:
    """Port of the doReflFFT superlattice block: try the 5 smallest peak
    thicknesses as bilayer-period candidates, score how many peaks sit on
    integer harmonics, and accept at >= 3 matches."""
    n_pk = pk_thick.size
    labels = [""] * n_pk

    detected = False
    lambda_nm = float("nan")
    total_nm = float("nan")
    n_repeats: float = float("nan")
    sub_a_nm = float("nan")
    sub_b_nm = float("nan")
    suppressed: list[int] = []

    if n_pk >= 2:
        t_asc = np.sort(pk_thick)
        best_score = 0
        best_lambda = float("nan")
        for cand in t_asc[: min(5, n_pk)]:
            score = 0
            for t in pk_thick:
                ratio = t / cand
                nr = _ml_round(ratio)
                if nr >= 1 and abs(ratio - nr) / nr < _HARM_TOL:
                    score += 1
            if score > best_score:
                best_score = score
                best_lambda = float(cand)

        if best_score >= 3:
            detected = True
            lambda_nm = best_lambda

            n_max = 1
            for t in pk_thick:
                ratio = t / lambda_nm
                nr = _ml_round(ratio)
                if nr >= 1 and abs(ratio - nr) / nr < _HARM_TOL and nr > n_max:
                    n_max = nr

            # Satellites between Lambda and 2*Lambda imply extra repeats.
            n_sub = 0
            for t in pk_thick:
                if 1.15 * lambda_nm < t < 1.85 * lambda_nm:
                    ratio = t / lambda_nm
                    nr = _ml_round(ratio)
                    if not (nr == 2 and abs(ratio - 2) / 2 < _HARM_TOL):
                        n_sub += 1

            n_repeats = n_sub + 2 if n_sub > 0 else n_max
            total_nm = n_repeats * lambda_nm

            for order in range(2, min(6, max(n_max, 3)) + 1):
                expected = order * lambda_nm
                if not any(abs(t - expected) / expected < _HARM_TOL for t in pk_thick):
                    suppressed.append(order)

            if suppressed:
                sub_a_nm = lambda_nm / suppressed[0]
                sub_b_nm = lambda_nm - sub_a_nm

            bilayer_assigned = False
            for j, t in enumerate(pk_thick):
                ratio = t / lambda_nm
                nr = _ml_round(ratio)
                is_harm = nr >= 1 and abs(ratio - nr) / nr < _HARM_TOL
                if is_harm and nr == 1 and not bilayer_assigned:
                    labels[j] = "Bilayer Λ"
                    bilayer_assigned = True
                elif is_harm and nr >= 2:
                    labels[j] = f"SL order {nr}"
                elif 1.15 * lambda_nm < t < 1.85 * lambda_nm:
                    nr2 = _ml_round(t / lambda_nm)
                    if not (nr2 == 2 and abs(t / lambda_nm - 2) / 2 < _HARM_TOL):
                        labels[j] = "Satellite"
                    # MATLAB leaves the order-2-within-tol case unlabeled here
                else:
                    labels[j] = "Independent"

    superlattice = {
        "detected": detected,
        "bilayer_period_nm": lambda_nm,
        "total_thickness_nm": total_nm,
        "n_repeats": n_repeats,
        "sublayer_a_nm": sub_a_nm,
        "sublayer_b_nm": sub_b_nm,
        "suppressed_orders": suppressed,
    }
    return superlattice, labels
