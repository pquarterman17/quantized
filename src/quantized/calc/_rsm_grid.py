"""Shared grid/result internals for the RSM cut families (linecut / sectorcut /
boxcut).

Promoted out of ``calc/linecut.py`` (RSM_CUTS_PLAN item 1) once a second cut
family (``calc/sectorcut.py``) needed the exact same building blocks: reshape
a scattered 2-D DataStruct back to its ``(N frames, M pixels)`` grid, pick
scattered (coordinate, intensity) columns for a given space, and assemble a
1-D result DataStruct with consistent metadata. A third family
(``calc/boxcut.py``, item 3) and a periodic-axis mask (pole figures, also
item 3) reuse these too — so this module is the ONE place all three cut
families read a map and write a result, and they cannot drift against each
other on grid convention or metadata shape.

The leading underscore in the MODULE name marks it package-internal (import
``quantized.calc._rsm_grid`` from ``calc/`` siblings only, never from
``routes/``); its members carry no underscore prefix of their own.

``full_grids`` / ``require_q`` / ``cut_result`` / ``SPACES`` are a verbatim
move of ``linecut.py``'s former ``_full_grids`` / ``_require_q`` /
``_cut_result`` / ``_SPACES`` — same behaviour, so ``line_cut`` and
``projection`` (which still reshape the whole map) are unaffected.
``cut_result`` gained two OPTIONAL keyword parameters (``labels``,
``parser_name``) so sector/chi/box's two-column ``[Intensity, "N points"]``
output can go through the same assembler; every existing linecut.py call
site omits both and gets the exact old defaults
(``labels=("Intensity",)``, ``parser_name="line_cut"``), so behaviour there
is byte-for-byte unchanged. ``scatter_columns`` is NEW here — it hoists the
inline column/unit-selection block that used to live directly inside
``cut_segment`` (space -> (x, y) coordinate columns + Intensity, with no
grid reshape — works on any scattered cloud, gridded or not) so segment
cuts, box's cloud path, and the sector/chi profiles all read columns the
same way. ``wrap_mask`` is also NEW: it replaces MATLAB
``+bosonPlotter/extract2DArcIntegral.m``'s three-branch azimuthal sector
mask (full-circle / non-wrapping / wrapping — see that file) with a single
rebase formula, used by the sector mask, the chi-profile binning domain,
AND box's periodic (pole-figure) axis.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = ["SPACES", "cut_result", "full_grids", "require_q", "scatter_columns", "wrap_mask"]

SPACES = ("angular", "q")


def full_grids(ds: DataStruct) -> dict[str, Any]:
    """Reshape the scattered 2-D DataStruct to full (N, M) per-point grids."""
    if not ds.metadata.get("is2D"):
        raise ValueError("dataset is not a 2-D map (metadata.is2D not set)")
    shape = ds.metadata.get("map_shape")
    if not shape or len(shape) != 2:
        raise ValueError(
            "dataset has no regular (frames x pixels) grid (map_shape missing) — "
            "use cut_segment, which works on the scattered cloud"
        )
    n, m = int(shape[0]), int(shape[1])
    axis1_name = str(ds.metadata.get("axis1_name", "Omega"))
    out: dict[str, Any] = {
        "tt": ds.column("2Theta").reshape(n, m),
        "sec": ds.column(axis1_name).reshape(n, m),
        "i": ds.column("Intensity").reshape(n, m),
        "qx": None,
        "qz": None,
        "sec_name": axis1_name,
        "unit": ds.units[list(ds.labels).index("Intensity")],
    }
    if "Qx" in ds.labels and "Qz" in ds.labels:
        out["qx"] = ds.column("Qx").reshape(n, m)
        out["qz"] = ds.column("Qz").reshape(n, m)
    return out


def require_q(g: dict[str, Any]) -> None:
    if g["qx"] is None:
        raise ValueError("dataset has no Qx/Qz columns — Q-space cut unavailable")


def scatter_columns(
    ds: DataStruct, space: str
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64], str, str]:
    """Scattered (x, y, Intensity) columns for ``space`` — no grid reshape.

    ``space='angular'`` -> ``(2Theta, <axis1_name>)``; ``space='q'`` ->
    ``(Qx, Qz)`` (raises if the dataset carries no Q columns). Returns
    ``(xs, ys, intensity, axis_unit, intensity_unit)``. Works on ANY
    scattered cloud, gridded or not — unlike ``full_grids`` it never
    requires ``map_shape``, which is what makes it the right primitive for
    ``cut_segment`` (interpolated, no grid needed) and the true-polar
    sector/chi profiles (which only ever need the Q columns themselves).
    """
    if space not in SPACES:
        raise ValueError(f"space must be one of {SPACES}, got {space!r}")
    axis1_name = str(ds.metadata.get("axis1_name", "Omega"))
    if space == "q":
        if "Qx" not in ds.labels:
            raise ValueError("dataset has no Qx/Qz columns — Q-space cut unavailable")
        xs, ys = ds.column("Qx"), ds.column("Qz")
        axis_unit = "Ang^-1"
    else:
        xs, ys = ds.column("2Theta"), ds.column(axis1_name)
        axis_unit = "deg"
    intensity = ds.column("Intensity")
    intensity_unit = ds.units[list(ds.labels).index("Intensity")]
    return xs, ys, intensity, axis_unit, intensity_unit


def cut_result(
    x: NDArray[np.float64],
    y: NDArray[np.float64],
    *,
    label: str,
    x_name: str,
    x_unit: str,
    unit: str | Sequence[str],
    ds: DataStruct,
    labels: Sequence[str] = ("Intensity",),
    parser_name: str = "line_cut",
    extra: dict[str, Any] | None = None,
) -> DataStruct:
    """Assemble the 1-D cut DataStruct (ascending x for the plot stage).

    ``y`` is 1-D for a single-channel cut — every ``linecut.py`` call site
    (H/V, segment, projection): they omit ``labels``/``parser_name`` and get
    the old hardcoded defaults (``labels=("Intensity",)``,
    ``parser_name="line_cut"``) back verbatim, so their behaviour is
    unchanged. ``y`` is 2-D ``(n_bins, n_channels)`` for a binned
    multi-column profile — sector/chi (``sectorcut.py``) and box
    (``boxcut.py``, item 3) pass ``column_stack([profile, counts])`` with
    ``labels=["Intensity", "N points"]`` and a per-column ``unit`` sequence
    (counts is unitless: ``""``).
    """
    order = np.argsort(x, kind="stable")
    x_sorted = np.asarray(x, dtype=float)[order]
    y_arr = np.asarray(y, dtype=float)
    y_sorted = y_arr[order] if y_arr.ndim == 1 else y_arr[order, :]
    units = (unit,) if isinstance(unit, str) else tuple(unit)
    metadata: dict[str, Any] = {
        "source": ds.metadata.get("source", ""),
        "parser_name": parser_name,
        "x_column_name": x_name,
        "x_column_unit": x_unit,
        "cut_label": label,
        "is2D": False,
        **(extra or {}),
    }
    return DataStruct.create(
        x_sorted, y_sorted, labels=list(labels), units=list(units), metadata=metadata
    )


def wrap_mask(
    angles_deg: NDArray[np.float64], lo: float, hi: float
) -> tuple[NDArray[np.bool_], float, NDArray[np.float64]]:
    """Rebase-then-mask a periodic (mod-360) angular selection.

    Replaces MATLAB ``extract2DArcIntegral.m``'s three-branch sector mask
    (full-circle / ``lo < hi`` non-wrapping / ``lo >= hi`` wrapping) with one
    formula, correct in every case including full-circle and the +-180 deg
    seam::

        span    = ((hi - lo) mod 360) or 360    # 360 when hi == lo (mod 360)
        rebased = (angles_deg - lo) mod 360      # in [0, 360)
        mask    = rebased < span

    Verified equivalent to MATLAB's three branches on both a wrapping sector
    (``lo=170, hi=-170`` includes points at +-175 deg — MATLAB's
    ``phi>=lo | phi<hi`` branch) and a non-wrapping one (``lo=-170,
    hi=170`` excludes them — MATLAB's ``phi>=lo & phi<hi`` branch); see
    ``test_calc_sectorcut.py::test_wrap_equivalence_matches_matlab_branches``.

    Shared by three call sites so they cannot silently disagree at the wrap
    boundary: the sector mask (``sectorcut.sector_profile``), the azimuthal
    BINNING DOMAIN (``sectorcut.chi_profile`` bins ``rebased`` directly, not
    the raw angle, so x stays monotonic across the seam even for a wrapping
    sector), and the pole-figure periodic axis (``boxcut.box_cut``'s
    ``wrap`` field, item 3).

    Returns ``(mask, span, rebased)``. ``span`` is always in ``(0, 360]``.
    """
    span = ((hi - lo) % 360.0) or 360.0
    rebased = np.asarray((np.asarray(angles_deg, dtype=float) - lo) % 360.0, dtype=float)
    mask = np.asarray(rebased < span, dtype=bool)
    return mask, span, rebased
