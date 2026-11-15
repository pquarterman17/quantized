"""Data-driven marks for the publication renderer (gap audit 3, N5 + N6).

* **Size-by (N5)** -- ``size_by`` (a per-row array, resolved from a channel
  index by ``calc.plotting.resolve_style_channels``) maps each point's marker
  DIAMETER linearly over the array's finite range onto ``size_range``
  (``[min, max]`` points, default :data:`DEFAULT_SIZE_RANGE`); matplotlib's
  ``s`` is the squared diameter. The canvas rule is
  ``lib/sizescatter.ts``'s ``sizeDiameter`` (same linear map, a constant column
  reads mid-range, a non-finite value draws no point). A size key (a second
  legend titled ``size_label``) is added so the mapping is legible.
* **Spline connect (N6)** -- ``connect: "spline"`` draws a natural cubic spline
  through the points, :data:`SUBSTEPS` samples per segment (the canvas'
  ``lib/cubicSpline.ts`` samples identically). Only where X is strictly
  ascending: a loop (hysteresis) or a repeated X cannot be a function of X, so
  that series is drawn straight, in row order, and a figure warning says so.
* **Drop lines (N6)** -- ``drop_lines`` (``"x"``/``"y"``/``"both"``) draws a
  segment from each point to the X axis (axis bottom) / Y axis (axis left),
  placed AFTER the final limits are set (:func:`apply_drop_lines`).

Pure layer: no fastapi/pydantic imports.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.figure_bars import draw_series
from quantized.calc.figure_colorscatter import MARKER_CODES
from quantized.calc.figure_sizes import add_size_legend, size_diameters
from quantized.calc.figure_warnings import note_figure_warning
from quantized.heavy_import import heavy_imports

__all__ = [
    "drop_size_by",
    "warn_marks_not_drawn",
    "SUBSTEPS",
    "DropLine",
        "apply_drop_lines",
    "draw_marked_series",
    "size_diameters",
    "spline_dense",
]

#: Spline samples per segment -- ``lib/cubicSpline.ts``'s ``SUBSTEPS``.
SUBSTEPS = 16


def _natural_spline(
    x: NDArray[np.float64], y: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Natural cubic spline through ``(x, y)`` at SUBSTEPS points per segment."""
    with heavy_imports("scipy.interpolate"):
        from scipy.interpolate import CubicSpline

    xd = np.concatenate(
        [np.linspace(x[i], x[i + 1], SUBSTEPS, endpoint=False) for i in range(len(x) - 1)]
        + [x[-1:]]
    )
    return xd, np.asarray(CubicSpline(x, y, bc_type="natural")(xd), dtype=float)


def _runs(ok: NDArray[np.bool_]) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    i = 0
    while i < len(ok):
        if not ok[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(ok) and ok[j + 1]:
            j += 1
        out.append((i, j))
        i = j + 1
    return out


def spline_dense(
    x: NDArray[np.float64], y: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64], list[int]] | None:
    """``(x, y, knot_indices)`` of the spline-connected curve, or ``None`` when
    it cannot be drawn: X is not strictly ascending over the finite rows (a
    loop or a tie), or no run of finite rows has the 3 points a cubic needs.
    A non-finite row ends a run; each run is splined on its own and the runs
    are joined by one NaN row so the line breaks there."""
    xv, yv = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    n = min(len(xv), len(yv))
    xv, yv = xv[:n], yv[:n]
    ok = np.isfinite(xv) & np.isfinite(yv)
    if ok.sum() < 3 or np.any(np.diff(xv[ok]) <= 0):
        return None
    xs: list[NDArray[np.float64]] = []
    ys: list[NDArray[np.float64]] = []
    knots: list[int] = []
    offset = 0
    for a, b in _runs(ok):
        rx, ry = xv[a : b + 1], yv[a : b + 1]
        if len(rx) >= 3:
            seg_x, seg_y = _natural_spline(rx, ry)
            seg_k = [k * SUBSTEPS for k in range(len(rx))]
        else:  # too short for a cubic: straight, knots only
            seg_x, seg_y, seg_k = rx, ry, list(range(len(rx)))
        if xs:
            xs.append(np.array([np.nan]))
            ys.append(np.array([np.nan]))
            offset += 1
        knots.extend(offset + k for k in seg_k)
        xs.append(seg_x)
        ys.append(seg_y)
        offset += len(seg_x)
    return np.concatenate(xs), np.concatenate(ys), knots


def draw_marked_series(
    ax: Any,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    label: str,
    kw: dict[str, Any],
    spec: Mapping[str, Any] | None,
    *,
    bars: bool = True,
) -> tuple[Any, Any]:
    """``(artist, colour)`` for one series, honouring ``connect`` and
    ``size_by`` on top of :func:`draw_series` (bars / the plain line)."""
    if not spec or (bars and spec.get("bars")):
        return draw_series(ax, xv, yv, label, kw, spec) if bars else _plain(ax, xv, yv, label, kw)
    kw = dict(kw)
    sizes = size_diameters(spec, len(xv))
    if sizes is not None:
        kw.pop("marker", None)
        kw.pop("markersize", None)
        kw.pop("markerfacecolor", None)
    px, py, mark = xv, yv, None
    if spec.get("connect") == "spline":
        dense = spline_dense(xv, yv)
        if dense is None:
            note_figure_warning(
                f"Spline connect needs monotonic (strictly ascending) X; series {label!r} "
                "is drawn with straight segments in row order (a loop or repeated X "
                "cannot be a spline)."
            )
        else:
            px, py, mark = dense
    if mark is not None and "marker" in kw:
        kw["markevery"] = mark
    (line,) = ax.plot(px, py, label=label, **kw)
    color = line.get_color()
    if sizes is not None:
        _scatter_sized(ax, xv, yv, sizes, spec, color)
        add_size_legend(ax, spec, color, _marker(spec))
    return line, color


def _plain(ax: Any, xv: Any, yv: Any, label: str, kw: dict[str, Any]) -> tuple[Any, Any]:
    (line,) = ax.plot(xv, yv, label=label, **kw)
    return line, line.get_color()


_MARK_NAMES = {"connect": "spline connect", "size_by": "size-by", "drop_lines": "drop lines"}


def _asked(spec: Mapping[str, Any] | None, key: str) -> bool:
    return bool(spec) and (spec.get(key) is not None if key == "size_by" else bool(spec.get(key)))  # type: ignore[union-attr]


def warn_marks_not_drawn(
    specs: Sequence[Mapping[str, Any] | None] | None,
    where: str,
    keys: Sequence[str] = ("connect", "size_by", "drop_lines"),
) -> bool:
    """Say, once, which of the marks ``specs`` ask for a figure path cannot draw
    (``where``: "facet figures", "the inset", ...) -- never a silent skip. The
    screen's matching view strips the same marks. True when it warned."""
    names = [_MARK_NAMES[k] for k in keys if any(_asked(s, k) for s in specs or [])]
    if not names:
        return False
    what = ", ".join(names[:-1]) + (" and " if len(names) > 1 else "") + names[-1]
    note_figure_warning(
        f"{what[0].upper()}{what[1:]} {'is' if len(names) == 1 else 'are'} not drawn in {where}; "
        "those series are drawn as ordinary lines."
    )
    return True


def drop_size_by(
    specs: Sequence[Mapping[str, Any] | None] | None, where: str
) -> list[Mapping[str, Any] | None] | None:
    """``specs`` without ``size_by`` (warned), for a path that cannot size points."""
    if specs is None:
        return None
    warn_marks_not_drawn(specs, where, ("size_by",))
    return [{k: v for k, v in s.items() if k != "size_by"} if s else s for s in specs]


def _marker(spec: Mapping[str, Any]) -> str:
    shape = spec.get("marker_shape")
    return MARKER_CODES.get(shape, "o") if isinstance(shape, str) else "o"


def _scatter_sized(
    ax: Any,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    sizes: NDArray[np.float64],
    spec: Mapping[str, Any],
    color: Any,
) -> None:
    keep = np.isfinite(xv) & np.isfinite(yv) & np.isfinite(sizes)
    marker = _marker(spec)
    hollow = spec.get("marker_fill") == "hollow" or marker in ("+", "x")
    ax.scatter(
        xv[keep], yv[keep], s=sizes[keep] ** 2, marker=marker, zorder=3,
        **({"facecolors": "none", "edgecolors": color} if hollow else {"color": color}),
    )


DropLine = tuple[NDArray[np.float64], NDArray[np.float64], str, Any]


def apply_drop_lines(ax: Any, drops: Sequence[DropLine]) -> None:
    """Drop lines, drawn once the limits are final: ``(x, y, mode, colour)`` per
    series; ``"x"`` runs each point DOWN to the axis bottom, ``"y"`` LEFT to the
    axis left edge, ``"both"`` does both. Non-finite points draw nothing."""
    if not drops:
        return
    with heavy_imports("matplotlib.collections"):
        from matplotlib.collections import LineCollection
    ylo, xlo = ax.get_ylim()[0], ax.get_xlim()[0]
    for xv, yv, mode, color in drops:
        ok = np.isfinite(xv) & np.isfinite(yv)
        for axis, base in (("x", ylo), ("y", xlo)):
            if mode not in (axis, "both"):
                continue
            segs = [
                [(x, y), (x, base)] if axis == "x" else [(x, y), (base, y)]
                for x, y in zip(xv[ok], yv[ok], strict=True)
            ]
            ax.add_collection(
                LineCollection(segs, colors=[color], linewidths=0.8, linestyles="dotted", zorder=1)
            )
