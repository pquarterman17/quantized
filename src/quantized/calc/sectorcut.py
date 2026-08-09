"""Polar (|Q|, azimuth) profiles from 2-D RSM DataStructs (RSM_CUTS_PLAN item 1).

Port + extension of MATLAB ``+bosonPlotter/extract2DArcIntegral.m`` (the
"blind" arc-integral dialog, ``onArcIntButton.m``). Given the reciprocal-
space cloud (Qx, Qz, Intensity) of an RSM::

    qrad = hypot(Qx, Qz)                  # radial |Q|, in Ang^-1
    phi  = atan2d(Qz, Qx), in [-180, 180]  # azimuth, 0 deg = +Qx, CCW

**This is MATLAB's ``atan2d`` convention, not the geometrically "natural"
one** — 0 deg is along +Qx (in-plane), NOT +Qz (the specular, out-of-plane
direction most epitaxial users think of as "straight up"). Kept for parity
with the MATLAB reference; callers that want "0 deg = specular" must offset
``phi`` by 90 deg themselves.

:func:`sector_profile` bins |Q| within an azimuthal sector (MATLAB's arc
integral). :func:`chi_profile` is NEW — MATLAB has no azimuthal-profile
counterpart, only the reverse (integrate over phi to get a radial trace).
Both are the TRUE-POLAR branch (i) of the RSM_CUTS_PLAN polar-space rule:
they require Qx/Qz (a defined origin + radius); a generic angular pair like
2Theta/Omega has no radius (branch (iii), forbidden — see the branch-(iii)
reason each raises when Q is absent). Native-polar data (pole figures: an
azimuthal axis already in the schema, no Qx/Qz) is branch (ii) and goes
through ``boxcut.box_cut``'s periodic ``wrap`` axis instead (item 3), not
here.

Sector-mask replacement: MATLAB's three-branch mask (full-circle /
non-wrapping ``sMin<sMax`` / wrapping ``sMin>=sMax``) is replaced by ONE
rebase formula, :func:`quantized.calc._rsm_grid.wrap_mask` — see that
function's docstring for the formula and the branch-equivalence proof. The
SAME rebase also defines chi_profile's binning domain, so a wrapping
sector's azimuthal profile stays monotonic across the +-180 deg seam
instead of jumping from +180 back to -180 mid-profile.

Radial/azimuthal binning matches MATLAB's ``accumarray``-based scheme
(``binSum``/``binCount`` per bin, mean = sum/count with an empty bin ->
NaN) via two ``np.histogram`` calls over the same edges — one weighted by
intensity (the sum), one unweighted (the count). Because the sector/annulus
mask already restricts every point to ``[edges[0], edges[-1]]`` before
binning, ``np.histogram``'s right-inclusive last bin reproduces MATLAB's
``floor(...) + clamp(1, nBins)`` indexing exactly.

UNCERTAINTY (correcting an earlier draft of this plan): the "N points"
column is NOT a sqrt(N) error bar. For SUMMED raw counts the Poisson
uncertainty is ``sigma = sqrt(sum(I))``, computable from the Intensity
column alone -- and valid ONLY when the Intensity unit is raw counts, not
cps (PANalytical XRDML frequently reports counts-per-second; check
``ds.units`` / ``ds.metadata`` before treating ``sqrt(I)`` as meaningful --
for cps, scale by the counting time first). "N points" exists for
mean-normalization (the literal mean divisor) and to flag under-sampled
bins (small N is unreliable; N=0 already reports NaN) -- it is not itself a
standalone uncertainty.

Pure calc layer (ndarray/DataStruct in -> DataStruct out); no
fastapi/pydantic imports.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc._rsm_grid import cut_result, require_finite, scatter_columns, wrap_mask
from quantized.datastruct import DataStruct

__all__ = ["chi_profile", "sector_profile"]

_MODES = ("sum", "mean")

# Appended to scatter_columns' "no Qx/Qz" ValueError so callers see WHY a
# polar op is unavailable (RSM_CUTS_PLAN polar-space rule, branch (iii)):
# hypot/atan2 need a shared origin and units on both axes, which a generic
# angular pair (2Theta/Omega) does not have. Pole figures (branch (ii),
# native azimuth/tilt axes, no Qx/Qz) are NOT reachable through here either
# -- they go through boxcut.box_cut's periodic `wrap` axis (item 3).
_POLAR_REQUIRES_Q = (
    "{} -- true-polar sector/chi profiles need a reciprocal-space origin "
    "(branch (i) of the polar-space rule); a generic angular pair like "
    "2Theta/Omega has no defined radius or azimuth (branch (iii), "
    "forbidden: hypot(2Theta, Omega) would mix axes with different "
    "physical meanings). A native-polar dataset (pole figure: azimuth + "
    "tilt axes, no Q) uses boxcut.box_cut's periodic `wrap` axis instead."
)


def _validate_common(
    q_min: float, q_max: float, n_bins: int, mode: str,
    phi_min: float = 0.0, phi_max: float = 0.0,
) -> None:
    require_finite(q_min=q_min, q_max=q_max, phi_min=phi_min, phi_max=phi_max)
    if mode not in _MODES:
        raise ValueError(f"mode must be one of {_MODES}, got {mode!r}")
    if n_bins < 2:
        raise ValueError("n_bins must be >= 2")
    if q_min < 0 or q_max <= q_min:
        raise ValueError(f"require q_max > q_min >= 0, got q_min={q_min!r}, q_max={q_max!r}")


def _polar_columns(
    ds: DataStruct,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64], str]:
    """Scattered (qrad, phi_deg, Intensity, intensity_unit) — see module docstring."""
    try:
        qx, qz, intensity, _axis_unit, intensity_unit, _x_name, _y_name = scatter_columns(
            ds, "q"
        )
    except ValueError as exc:
        raise ValueError(_POLAR_REQUIRES_Q.format(exc)) from exc
    qrad = np.asarray(np.hypot(qx, qz), dtype=float)
    phi = np.asarray(np.degrees(np.arctan2(qz, qx)), dtype=float)
    return qrad, phi, np.asarray(intensity, dtype=float), intensity_unit


def _bin_profile(
    coord: NDArray[np.float64],
    intensity: NDArray[np.float64],
    edges: NDArray[np.float64],
    mode: str,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Weighted-sum + unweighted-count histograms over ``edges`` -> (profile, counts).

    ``mode="sum"``: profile is the per-bin summed intensity (MATLAB's
    default). ``mode="mean"``: profile is sum/count, NaN where a bin is
    empty (MATLAB's ``binCount==0 -> NaN``, replicated exactly).
    """
    sum_i, _ = np.histogram(coord, bins=edges, weights=intensity)
    counts, _ = np.histogram(coord, bins=edges)
    sum_i = np.asarray(sum_i, dtype=float)
    counts = np.asarray(counts, dtype=float)
    if mode == "mean":
        with np.errstate(invalid="ignore", divide="ignore"):
            profile = np.asarray(np.where(counts > 0, sum_i / counts, np.nan), dtype=float)
    else:
        profile = sum_i
    return profile, counts


def _sector_label(kind: str, q_min: float, q_max: float, mode: str, phi_min: float,
                   phi_max: float, span: float) -> str:
    label = f"{kind} |Q|=[{q_min:.4g}, {q_max:.4g}] Ang^-1 ({mode})"
    if span < 360.0 - 1e-9:
        label += f" sector [{phi_min:.4g}, {phi_max:.4g}] deg"
    elif phi_min != phi_max or phi_max - phi_min >= 360.0:
        return label  # a genuine full circle, requested as such
    else:
        # phi_min == phi_max makes the rebase span 360 (MATLAB's branch does
        # the same), so a ZERO-width sector silently integrates EVERYTHING.
        # Harmless in MATLAB's min/max-only dialog; a live trap now that the
        # ROI panel offers centre +/- half-width as its primary control, where
        # half-width 0 is one keystroke away. calc keeps the parity behaviour
        # but says what it actually did -- the route rejects the ambiguous
        # centre/half-width spelling outright (RSM_CUTS_PLAN item 21).
        label += f" FULL CIRCLE (phi_min == phi_max == {phi_min:.4g} deg)"
    return label


def sector_profile(
    ds: DataStruct,
    *,
    q_min: float,
    q_max: float,
    n_bins: int = 100,
    phi_min: float = -180.0,
    phi_max: float = 180.0,
    mode: str = "sum",
) -> DataStruct:
    """Integrate a 2-D RSM along arcs of constant |Q|, within an azimuthal sector.

    Radial profile: bins |Q| into ``n_bins`` bins over ``[q_min, q_max]``,
    counting only points inside the ``[phi_min, phi_max)`` sector (mod-360,
    see :func:`quantized.calc._rsm_grid.wrap_mask` — full circle by
    default). ``mode="sum"`` (MATLAB's default) totals intensity per bin;
    ``mode="mean"`` divides by the per-bin point count, NaN where a bin is
    empty. See the module docstring for the phi convention (0 deg = +Qx,
    CCW) and the "N points" uncertainty caveat.

    Returns a 2-column ``DataStruct`` (``labels=["Intensity", "N points"]``,
    x = |Q| bin centres, Ang^-1) via
    :func:`quantized.calc._rsm_grid.cut_result` — the SAME assembler
    ``linecut.py`` uses, so metadata shape never drifts between cut
    families.

    Raises ``ValueError`` if the dataset has no Qx/Qz (see the module
    docstring's polar-space-rule note), if ``q_max <= q_min`` or
    ``q_min < 0``, if ``n_bins < 2``, for an unknown ``mode``, or if no
    point falls inside the requested q-range/sector.
    """
    _validate_common(q_min, q_max, n_bins, mode, phi_min, phi_max)
    qrad, phi, intensity, intensity_unit = _polar_columns(ds)

    sector_mask, span, _rebased = wrap_mask(phi, phi_min, phi_max)
    mask = sector_mask & np.isfinite(intensity) & (qrad >= q_min) & (qrad <= q_max)
    if not np.any(mask):
        raise ValueError(
            f"no data points fall within q=[{q_min:g}, {q_max:g}] Ang^-1 and "
            f"sector [{phi_min:g}, {phi_max:g}] deg"
        )

    edges = np.linspace(q_min, q_max, n_bins + 1)
    profile, counts = _bin_profile(qrad[mask], intensity[mask], edges, mode)
    centres = (edges[:-1] + edges[1:]) / 2.0

    label = _sector_label("Sector", q_min, q_max, mode, phi_min, phi_max, span)
    return cut_result(
        centres,
        np.column_stack([profile, counts]),
        label=label,
        x_name="|Q|",
        x_unit="Ang^-1",
        unit=[intensity_unit, ""],
        ds=ds,
        labels=["Intensity", "N points"],
        parser_name="sector_profile",
        extra={
            "cut_kind": "sector",
            "q_range": [q_min, q_max],
            "sector": [phi_min, phi_max],
            "mode": mode,
            "n_bins": n_bins,
            "cut_space": "q",
        },
    )


def chi_profile(
    ds: DataStruct,
    *,
    q_min: float,
    q_max: float,
    n_bins: int = 90,
    phi_min: float = -180.0,
    phi_max: float = 180.0,
    mode: str = "mean",
) -> DataStruct:
    """Azimuthal ("chi") profile: intensity vs angle, within a |Q| annulus.

    NEW -- MATLAB's ``extract2DArcIntegral`` has no azimuthal-profile
    counterpart (only the reverse: integrate over phi to get a radial
    trace). Masks the ``[q_min, q_max]`` annulus (no radial binning), then
    bins the REBASED azimuth (:func:`quantized.calc._rsm_grid.wrap_mask`'s
    third return value) over ``[0, span)`` so a wrapping sector's x axis
    stays monotonic across the +-180 deg seam instead of jumping from +180
    back to -180 mid-profile. x is reported as ``phi_min + bin centre``, so
    for a wrapping sector (e.g. ``phi_min=170, phi_max=-170``) x
    legitimately runs past 180 deg (e.g. to ~190) -- this is intentional:
    it is the SAME azimuth continuing around the seam, not a bug.

    ``mode="mean"`` is the default here (unlike ``sector_profile``'s
    ``"sum"``) because chi_profile answers "how does intensity vary with
    angle at this |Q|", where a per-bin mean is the natural read; use
    ``"sum"`` for a raw per-bin total. See the module docstring for the phi
    convention and the "N points" uncertainty caveat (unchanged here).

    Returns a 2-column ``DataStruct`` (``labels=["Intensity", "N points"]``,
    x = azimuth in degrees) via the shared
    :func:`quantized.calc._rsm_grid.cut_result` assembler.

    Raises the same ``ValueError``\\ s as :func:`sector_profile` (no Qx/Qz,
    bad q-range, ``n_bins < 2``, unknown ``mode``, empty selection).
    """
    _validate_common(q_min, q_max, n_bins, mode, phi_min, phi_max)
    qrad, phi, intensity, intensity_unit = _polar_columns(ds)

    sector_mask, span, rebased = wrap_mask(phi, phi_min, phi_max)
    mask = sector_mask & np.isfinite(intensity) & (qrad >= q_min) & (qrad <= q_max)
    if not np.any(mask):
        raise ValueError(
            f"no data points fall within q=[{q_min:g}, {q_max:g}] Ang^-1 and "
            f"sector [{phi_min:g}, {phi_max:g}] deg"
        )

    edges = np.linspace(0.0, span, n_bins + 1)
    profile, counts = _bin_profile(rebased[mask], intensity[mask], edges, mode)
    centres = phi_min + (edges[:-1] + edges[1:]) / 2.0

    label = _sector_label("Chi profile", q_min, q_max, mode, phi_min, phi_max, span)
    extra: dict[str, Any] = {
        "cut_kind": "chi",
        "q_range": [q_min, q_max],
        "sector": [phi_min, phi_max],
        "mode": mode,
        "n_bins": n_bins,
        "cut_space": "q",
    }
    return cut_result(
        centres,
        np.column_stack([profile, counts]),
        label=label,
        x_name="Azimuth (phi)",
        x_unit="deg",
        unit=[intensity_unit, ""],
        ds=ds,
        labels=["Intensity", "N points"],
        parser_name="chi_profile",
        extra=extra,
    )
