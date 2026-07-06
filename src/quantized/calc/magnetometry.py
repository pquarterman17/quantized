"""Magnetometry helpers. Ports of MATLAB +utilities magnetometry functions.

Pure calc layer. ``subtract_mag_background`` removes a linear (dia/paramagnetic)
background fit over a high-temperature window; ``convert_mag_units`` converts
field and (sample-aware) moment units.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from .processing import derivative

__all__ = [
    "convert_mag_units",
    "hysteresis_analysis",
    "subtract_hysteresis_background",
    "subtract_mag_background",
]

_EPS = float(np.finfo(float).eps)

# Field unit <-> Oersted conversion factors (CGS<->SI).
_FIELD_TO_OE = {"Oe": 1.0, "T": 1e4, "mT": 10.0, "A/m": 4 * math.pi / 1e3}
_FIELD_FROM_OE = {"Oe": 1.0, "T": 1e-4, "mT": 0.1, "A/m": 1e3 / (4 * math.pi)}


def subtract_mag_background(
    temperature: ArrayLike,
    moment: ArrayLike,
    *,
    fit_range: tuple[float, float] | None = None,
    auto_fraction: float = 0.1,
) -> tuple[NDArray[np.float64], float, float]:
    """Subtract a linear background fit over a high-T window. Port of subtractMagBackground.

    Fits ``M = slope*T + intercept`` over ``fit_range`` (or, by default, the top
    ``auto_fraction`` of the temperature span) and subtracts it from all points.
    Returns ``(corrected, slope, intercept)``. Falls back to the full range if the
    fit window has fewer than 2 points.
    """
    t = np.asarray(temperature, dtype=float).ravel()
    m = np.asarray(moment, dtype=float).ravel()
    n = t.size
    if n < 3:
        raise ValueError("need at least 3 data points")
    if m.size != n:
        raise ValueError("temperature and moment must be the same length")

    t_min, t_max = float(t.min()), float(t.max())
    if fit_range is None:
        mask = t >= (t_max - auto_fraction * (t_max - t_min))
    else:
        mask = (t >= fit_range[0]) & (t <= fit_range[1])
    if int(mask.sum()) < 2:
        mask = np.ones(n, dtype=bool)

    slope, intercept = np.polyfit(t[mask], m[mask], 1)
    corrected = m - (slope * t + intercept)
    return np.asarray(corrected, dtype=float), float(slope), float(intercept)


def subtract_hysteresis_background(
    h: ArrayLike,
    m: ArrayLike,
    *,
    hi_fraction: float = 0.7,
    min_points: int = 4,
) -> tuple[NDArray[np.float64], float, float]:
    """Remove a linear dia/paramagnetic background from an M-H hysteresis loop
    and vertically centre it.

    Both saturated tails (``|H| > hi_fraction * max|H|``) sit where
    ``M ~= +/-Ms + chi*H + offset``. Each tail is fit *separately* for its slope,
    the two are averaged, and that background susceptibility ``chi`` is removed
    (``M -= chi*H``). The loop is then centred on the midpoint of its two
    saturation plateaus so **no vertical offset remains** — the tails land
    symmetrically on ``+/-Ms`` about ``M = 0``.

    Fitting the tails separately matters: a single fit across *both* tails folds
    the +/-Ms jump between them into the slope (``chi + Ms/Hmax``), which
    over-subtracts and shears a well-saturated loop toward the origin. Per-tail
    slopes see only the constant ``+Ms`` or ``-Ms`` within one tail, so they
    recover the true background.

    Improves on MATLAB ``bosonPlotter.hysteresis.subtractLinearBG`` (single
    both-tails fit, slope-only, offset kept — which left the loop vertically
    shifted). Falls back to a both-tails slope with no centring when high field
    is present on only one side (a minor loop — a symmetric centre is undefined).
    A no-op (``chi = offset = 0``, ``M`` unchanged) when fewer than
    ``min_points`` high-field points exist or the field span is degenerate.

    Distinct from :func:`subtract_mag_background` (M-vs-T, one-sided high-T
    window). Do not use that on a hysteresis loop.

    Returns ``(corrected, slope, offset)`` — ``slope`` = removed susceptibility
    ``chi``, ``offset`` = removed vertical shift.
    """
    hv = np.asarray(h, dtype=float).ravel()
    mv = np.asarray(m, dtype=float).ravel()
    if hv.size != mv.size:
        raise ValueError("h and m must be the same length")
    if hv.size == 0:
        raise ValueError("need at least 1 data point")

    h_max = float(np.nanmax(np.abs(hv)))
    if not np.isfinite(h_max) or h_max == 0.0:
        return mv.copy(), 0.0, 0.0
    thresh = hi_fraction * h_max
    pos = hv > thresh
    neg = hv < -thresh
    n_pos = int(np.count_nonzero(pos))
    n_neg = int(np.count_nonzero(neg))

    # Both saturated tails present: per-tail slope + vertical centring.
    if n_pos >= 2 and n_neg >= 2 and (n_pos + n_neg) >= min_points:
        slope = 0.5 * (
            float(np.polyfit(hv[pos], mv[pos], 1)[0])
            + float(np.polyfit(hv[neg], mv[neg], 1)[0])
        )
        if not np.isfinite(slope):
            return mv.copy(), 0.0, 0.0
        corrected = np.asarray(mv - slope * hv, dtype=float)
        offset = 0.5 * (float(np.mean(corrected[pos])) + float(np.mean(corrected[neg])))
        if not np.isfinite(offset):
            offset = 0.0
        return np.asarray(corrected - offset, dtype=float), slope, offset

    # One-sided high field (a minor loop): both-tails slope only, no centring.
    hi = np.abs(hv) > thresh
    if int(np.count_nonzero(hi)) < min_points:
        return mv.copy(), 0.0, 0.0
    slope = float(np.polyfit(hv[hi], mv[hi], 1)[0])
    if not np.isfinite(slope):
        return mv.copy(), 0.0, 0.0
    return np.asarray(mv - slope * hv, dtype=float), slope, 0.0


def _field_factor(from_u: str, to_u: str) -> tuple[float, bool, str]:
    if from_u == to_u:
        return 1.0, True, ""
    if from_u not in _FIELD_TO_OE:
        return 1.0, False, f'Unknown source field unit "{from_u}"'
    if to_u not in _FIELD_FROM_OE:
        return 1.0, False, f'Unknown target field unit "{to_u}"'
    return _FIELD_TO_OE[from_u] * _FIELD_FROM_OE[to_u], True, ""


def _moment_factor(
    from_u: str, to_u: str, mass_g: float, vol_cm3: float
) -> tuple[float, bool, str]:
    if from_u == to_u:
        return 1.0, True, ""
    if from_u != "emu":
        msg = f'Moment conversions from "{from_u}" are not yet supported (only from "emu")'
        return 1.0, False, msg
    if to_u == "emu":
        return 1.0, True, ""
    if to_u == "A·m²":
        return 1e-3, True, ""
    if to_u == "emu/g":
        if mass_g <= 0:
            return 1.0, False, "Cannot convert moment to emu/g: sample mass is 0."
        return 1.0 / mass_g, True, ""
    if to_u in ("emu/cm³", "kA/m"):
        if vol_cm3 <= 0:
            return 1.0, False, f"Cannot convert moment to {to_u}: sample volume is 0."
        return 1.0 / vol_cm3, True, ""
    return 1.0, False, f'Unknown target moment unit "{to_u}"'


def _append_warn(s: str, msg: str) -> str:
    if not msg:
        return s
    return msg if not s else f"{s}\n{msg}"


def convert_mag_units(
    x: ArrayLike,
    y: ArrayLike,
    *,
    from_field: str = "Oe",
    to_field: str = "Oe",
    from_moment: str = "emu",
    to_moment: str = "emu",
    sample_mass: float = 0.0,
    sample_volume: float = 0.0,
) -> tuple[NDArray[np.float64], NDArray[np.float64], str, str, str]:
    """Convert field (x) and moment (y) units. Port of convertMagUnits.

    Returns ``(x_out, y_out, x_unit, y_unit, warning)``. Moment conversions are
    sample-aware (emu/g needs mass, emu/cm³ and kA/m need volume) and only from
    ``emu``. On a failed conversion the data is left unchanged, the unit label
    reverts to the source, and a message is appended to ``warning``.
    """
    x_out = np.asarray(x, dtype=float)
    y_out = np.asarray(y, dtype=float)
    x_unit, y_unit, warning = to_field, to_moment, ""

    x_factor, x_ok, x_reason = _field_factor(from_field, to_field)
    if not x_ok:
        warning = _append_warn(warning, x_reason)
        x_unit = from_field
    elif x_out.size:
        x_out = x_out * x_factor

    y_factor, y_ok, y_reason = _moment_factor(from_moment, to_moment, sample_mass, sample_volume)
    if not y_ok:
        warning = _append_warn(warning, y_reason)
        y_unit = from_moment
    elif y_out.size:
        y_out = y_out * y_factor

    return x_out, y_out, x_unit, y_unit, warning


def _interp_crossing(
    x: NDArray[np.float64], y: NDArray[np.float64], target_y: float
) -> float:
    """x where y crosses target_y (steepest crossing wins). Port of interpCrossing."""
    dy = y - target_y
    cross = np.flatnonzero(dy[:-1] * dy[1:] < 0)
    if cross.size == 0:
        return float("nan")
    x_cross = np.empty(cross.size)
    slopes = np.empty(cross.size)
    for ci, i in enumerate(cross):
        x_cross[ci] = x[i] - dy[i] * (x[i + 1] - x[i]) / (dy[i + 1] - dy[i])
        slopes[ci] = abs(dy[i + 1] - dy[i]) / max(abs(x[i + 1] - x[i]), _EPS)
    return float(x_cross[int(np.argmax(slopes))])


def _compute_fwhm(x: NDArray[np.float64], y: NDArray[np.float64], peak_idx: int) -> float:
    """FWHM of a peak by half-max crossings on both sides. Port of computeFWHM."""
    finite = np.isfinite(x) & np.isfinite(y)
    if not finite[peak_idx] or int(finite.sum()) < 3:
        return float("nan")
    half = y[peak_idx] / 2.0
    if not np.isfinite(half) or half <= 0:
        return float("nan")

    x_left = float("nan")
    for i in range(peak_idx - 1, -1, -1):
        if not finite[i]:
            continue
        if y[i] < half:
            denom = y[i + 1] - y[i]
            frac = 0.0 if abs(denom) < _EPS else (half - y[i]) / denom
            x_left = x[i] + frac * (x[i + 1] - x[i])
            break
    x_right = float("nan")
    for i in range(peak_idx + 1, y.size):
        if not finite[i]:
            continue
        if y[i] < half:
            denom = y[i - 1] - y[i]
            frac = 0.0 if abs(denom) < _EPS else (half - y[i]) / denom
            x_right = x[i] + frac * (x[i - 1] - x[i])
            break

    if math.isnan(x_left) and math.isnan(x_right):
        fw = float("nan")
    elif math.isnan(x_left):
        fw = 2.0 * abs(x_right - x[peak_idx])
    elif math.isnan(x_right):
        fw = 2.0 * abs(x[peak_idx] - x_left)
    else:
        fw = abs(x_right - x_left)
    return fw if np.isfinite(fw) else float("nan")


def _sorted_unique(
    x: NDArray[np.float64], y: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """MATLAB unique('stable')+sort: sorted unique x with first-occurrence y."""
    xu, idx = np.unique(x, return_index=True)
    return xu, y[idx]


def hysteresis_analysis(
    h: ArrayLike,
    m: ArrayLike,
    *,
    saturation_fraction: float = 0.8,
    pre_smooth: int = 0,
    virgin_detect: bool = True,
) -> dict[str, Any]:
    """Analyze an M-H hysteresis loop. Port of utilities.hysteresisAnalysis.

    Splits the loop into ascending/descending branches (by sweep direction),
    extracts coercivity ``Hc`` (M=0 crossings), remanence ``Mr`` (H=0 crossings),
    saturation ``Ms`` (high-field average), squareness, loop area, and the
    switching-field distribution ``SFD`` (peak dM/dH). Returns a dict mirroring the
    MATLAB result struct (per-branch arrays, dM/dH, warnings).
    """
    hv = np.asarray(h, dtype=float).ravel()
    mv = np.asarray(m, dtype=float).ravel()
    n = hv.size
    if n < 20:
        raise ValueError("need at least 20 data points")
    warnings: list[str] = []
    if pre_smooth > 0:
        mv = smooth_data_savgol(mv, pre_smooth)

    sign_dh = np.sign(np.diff(hv))
    sign_dh[sign_dh == 0] = 1.0
    reversals = np.flatnonzero(np.diff(sign_dh) != 0) + 2  # 1-based segment boundaries
    seg_starts = np.concatenate([[1], reversals]).astype(int)
    seg_ends = np.concatenate([reversals - 1, [n]]).astype(int)
    n_segs = seg_starts.size

    seg_ranges = np.zeros(n_segs)
    seg_dirs = np.zeros(n_segs)
    for si in range(n_segs):
        s, e = int(seg_starts[si]), int(seg_ends[si])
        if e > s:
            seg_ranges[si] = hv[e - 1] - hv[s - 1]
            seg_dirs[si] = np.sign(seg_ranges[si])

    asc_segs = list(np.flatnonzero(seg_dirs > 0))
    desc_segs = list(np.flatnonzero(seg_dirs < 0))

    virgin = {"H": np.array([]), "M": np.array([])}
    if virgin_detect and asc_segs:
        first_seg = int(asc_segs[0])
        s1, e1 = int(seg_starts[first_seg]), int(seg_ends[first_seg])
        if abs(hv[s1 - 1]) < 0.1 * float(np.max(np.abs(hv))) and first_seg == 0:
            virgin = {"H": hv[s1 - 1 : e1], "M": mv[s1 - 1 : e1]}
            asc_segs.pop(0)

    def _best_branch(segs: list[Any]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
        if not segs:
            return np.array([]), np.array([])
        best = int(segs[int(np.argmax(np.abs(seg_ranges[segs])))])
        s, e = int(seg_starts[best]), int(seg_ends[best])
        return hv[s - 1 : e], mv[s - 1 : e]

    asc_h, asc_m = _best_branch(asc_segs)
    if asc_h.size == 0:
        warnings.append("No ascending branch detected")
    desc_h, desc_m = _best_branch(desc_segs)
    if desc_h.size == 0:
        warnings.append("No descending branch detected")

    hc = np.array([np.nan, np.nan])
    if asc_h.size:
        hc[0] = _interp_crossing(asc_h, asc_m, 0.0)
        if math.isnan(hc[0]):
            warnings.append("No M=0 crossing on ascending branch")
    if desc_h.size:
        hc[1] = _interp_crossing(desc_h, desc_m, 0.0)
        if math.isnan(hc[1]):
            warnings.append("No M=0 crossing on descending branch")
    hc_mean = _nanmean_abs(hc)
    if np.all(np.isfinite(hc)) and hc_mean > 0:
        asymm = abs(abs(hc[0]) - abs(hc[1])) / hc_mean
        if asymm > 0.1:
            warnings.append(f"Asymmetric loop: |Hc| differ by {asymm * 100:.0f}%")

    mr = np.array([np.nan, np.nan])
    if asc_h.size:
        mr[0] = _interp_crossing(asc_m, asc_h, 0.0)
        if math.isnan(mr[0]):
            warnings.append("No H=0 crossing on ascending branch")
    if desc_h.size:
        mr[1] = _interp_crossing(desc_m, desc_h, 0.0)
        if math.isnan(mr[1]):
            warnings.append("No H=0 crossing on descending branch")
    mr_mean = _nanmean_abs(mr)

    hmax = float(np.max(np.abs(hv)))
    sat_thresh = saturation_fraction * hmax
    ms = np.array([np.nan, np.nan])
    if desc_h.size:
        hi = desc_h > sat_thresh
        if int(hi.sum()) >= 3:
            ms[0] = float(np.mean(desc_m[hi]))
    if asc_h.size:
        lo = asc_h < -sat_thresh
        if int(lo.sum()) >= 3:
            ms[1] = float(np.mean(asc_m[lo]))
    ms_mean = _nanmean_abs(ms)

    if desc_h.size and asc_h.size:
        all_hi = np.abs(hv) > sat_thresh
        if int(all_hi.sum()) >= 6:
            m_hi = mv[all_hi]
            dm_rel = float(np.std(m_hi, ddof=1) / max(abs(np.mean(m_hi)), _EPS))
            if dm_rel > 0.1:
                warnings.append("Loop may not be saturated (high-field M still varying)")

    squareness = float(np.fmin(mr_mean / max(ms_mean, _EPS), 1.0))

    sfd = {"peakH": float("nan"), "peakdMdH": float("nan"), "fwhm": float("nan")}
    dmdh_asc: NDArray[np.float64] = np.array([])
    dmdh_desc: NDArray[np.float64] = np.array([])
    if asc_h.size >= 5:
        hu, mu = _sorted_unique(asc_h, asc_m)
        if hu.size >= 5:
            dmdh_asc = derivative(hu, mu, pre_smooth=max(3, pre_smooth))
            pk = int(np.argmax(np.abs(dmdh_asc)))
            sfd = {
                "peakH": float(hu[pk]),
                "peakdMdH": float(dmdh_asc[pk]),
                "fwhm": _compute_fwhm(hu, np.abs(dmdh_asc), pk),
            }
    if desc_h.size >= 5:
        hud, mud = _sorted_unique(desc_h, desc_m)
        if hud.size >= 5:
            dmdh_desc = derivative(hud, mud, pre_smooth=max(3, pre_smooth))

    loop_area = float("nan")
    if asc_h.size and desc_h.size:
        ha_u, ma_u = _sorted_unique(asc_h, asc_m)
        hd_u, md_u = _sorted_unique(desc_h, desc_m)
        hmin_ov = max(ha_u[0], hd_u[0])
        hmax_ov = min(ha_u[-1], hd_u[-1])
        if hmax_ov > hmin_ov and ha_u.size >= 2 and hd_u.size >= 2:
            hgrid = np.linspace(hmin_ov, hmax_ov, 500)
            m_asc_i = np.interp(hgrid, ha_u, ma_u, left=np.nan, right=np.nan)
            m_desc_i = np.interp(hgrid, hd_u, md_u, left=np.nan, right=np.nan)
            valid = ~np.isnan(m_asc_i) & ~np.isnan(m_desc_i)
            if int(valid.sum()) > 10:
                loop_area = abs(
                    float(np.trapezoid(m_desc_i[valid], hgrid[valid]))
                    - float(np.trapezoid(m_asc_i[valid], hgrid[valid]))
                )

    return {
        "Hc": hc,
        "HcMean": hc_mean,
        "Mr": mr,
        "MrMean": mr_mean,
        "Ms": ms,
        "MsMean": ms_mean,
        "squareness": squareness,
        "loopArea": loop_area,
        "SFD": sfd,
        "ascending": {"H": asc_h, "M": asc_m},
        "descending": {"H": desc_h, "M": desc_m},
        "virgin": virgin,
        "dMdH_asc": dmdh_asc,
        "dMdH_desc": dmdh_desc,
        "warnings": warnings,
    }


def _nanmean_abs(v: NDArray[np.float64]) -> float:
    """mean(abs(v), 'omitnan'); NaN if all-NaN (no warning)."""
    av = np.abs(v)
    if np.all(np.isnan(av)):
        return float("nan")
    return float(np.nanmean(av))


def smooth_data_savgol(m: NDArray[np.float64], window: int) -> NDArray[np.float64]:
    """Savitzky-Golay presmooth used by the (default-off) PreSmooth path."""
    from .processing import smooth_data

    return smooth_data(m, method="savitzky-golay", window=window)
