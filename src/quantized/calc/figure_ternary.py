"""Publication rendering for ternary diagrams (3-component compositions).

ORIGIN_GAP_PLAN #23 / GAP_TIER3_PLAN item 4. Pure layer: a 2-D array of
three-component rows (a, b, c) in fractional or percentage form -> ternary
scatter plot in image bytes. Hand-rolled barycentric transform (no
python-ternary dependency) on plain matplotlib axes for fast export.

Rows are normalized to sum to 1 (or all three components treated as fractions):
if rows don't sum to ~1, each is divided by its row sum; a warning is issued.
Non-positive rows (any component < 0 after normalization, or all-zero rows)
raise ValueError.

Shares ``calc.figure_styles`` presets and ``calc.figure``'s resolved-dpi
convention: an explicit ``dpi`` overrides the preset; otherwise the preset's
calibrated dpi is used.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from numpy.typing import ArrayLike, NDArray  # noqa: E402

from quantized.calc.figure_styles import figure_style  # noqa: E402

__all__ = ["render_ternary_figure"]

_FORMATS = ("pdf", "svg", "png", "tiff")
_FIGURE_SIZE_IN = (8, 7)  # inches: ternary is roughly square + colorbar


def render_ternary_figure(
    data: ArrayLike,
    *,
    labels: tuple[str, str, str] = ("A", "B", "C"),
    values: ArrayLike | None = None,
    fmt: str = "pdf",
    style: str = "default",
    dpi: int | None = None,
    marker_size: float | None = None,
    title: str = "",
) -> bytes:
    """Render a ternary diagram (3-component scatter plot).

    ``data`` is an (n, 3) array of compositions (a, b, c) for n samples.
    Each row is normalized so a+b+c=1 (or treated as fractions if already
    summing to ~1). Non-positive components raise ValueError; rows not
    summing to ~1 issue a warning and are divided by their row sum.

    ``labels`` names the three corners (default: A, B, C, positioned at the
    top, bottom-left, and bottom-right respectively). ``values`` (length n)
    colors the scatter points by an optional fourth dimension (e.g. an
    experimental result); if None, all points are the same color.

    Ternary gridlines are drawn at 10% intervals. ``fmt``, ``style``, and
    ``dpi`` follow ``render_figure``'s conventions: ``dpi`` defaults to the
    preset's calibrated resolution when not given.

    ``marker_size`` (default None) scales the scatter point size; None uses
    the preset's default. ``title`` is an optional figure title.

    Returns image bytes in the requested ``fmt``. Raises ``ValueError`` on
    malformed input (wrong shape, non-positive components, bad format).
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")

    arr = np.asarray(data, dtype=float)
    if arr.ndim != 2 or arr.shape[1] != 3:
        raise ValueError(
            f"data must be an (n, 3) array of 3-component compositions, "
            f"got shape {arr.shape}"
        )
    n = arr.shape[0]
    if n < 1:
        raise ValueError("need at least one composition row")

    # Normalize: divide each row by its sum, warn if far from 1.
    row_sums = np.sum(arr, axis=1, keepdims=True)
    if not np.all(np.isfinite(row_sums)) or np.any(row_sums == 0):
        raise ValueError("compositions must have finite, non-zero row sums")

    # Warn if rows don't sum to ~1 (tolerance: 0.001)
    if not np.allclose(row_sums, 1.0, rtol=0.01, atol=1e-3):
        print("Warning: input compositions don't sum to 1.0; normalizing each row.")

    normalized = arr / row_sums

    # Check for any non-positive components after normalization.
    if np.any(normalized < 0):
        raise ValueError(
            "all composition components must be non-negative after normalization"
        )

    if values is not None:
        vals = np.asarray(values, dtype=float)
        if vals.shape[0] != n:
            raise ValueError(
                f"values has {vals.shape[0]} entries, data has {n} rows"
            )
    else:
        vals = None

    st = figure_style(style)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)
    fallback = "DejaVu Serif" if st.font_generic == "serif" else "DejaVu Sans"
    rc: dict[str, Any] = {
        "font.family": st.font_generic,
        f"font.{st.font_generic}": [st.font_name, fallback],
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
        "xtick.labelsize": st.font_size - 1,
        "ytick.labelsize": st.font_size - 1,
        "xtick.direction": st.tick_dir,
        "ytick.direction": st.tick_dir,
    }

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, ax = plt.subplots(figsize=_FIGURE_SIZE_IN)
        try:
            _draw_ternary_scatter(
                ax, normalized, labels=labels, values=vals,
                marker_size=marker_size, style=st,
            )
            if title:
                fig.suptitle(title, fontsize=st.title_font_size)
            fig.tight_layout()
            buf = BytesIO()
            fig.savefig(buf, format=fmt, dpi=resolved_dpi)
            return buf.getvalue()
        finally:
            plt.close(fig)


def _barycentric_to_cartesian(a: float, b: float, c: float) -> tuple[float, float]:
    """Convert barycentric coordinates (a, b, c) summing to 1 to Cartesian (x, y).

    Triangle vertices: A (top) at (0.5, √3/2), B (bottom-left) at (0, 0),
    C (bottom-right) at (1, 0). The transformation is:
    x = c + 0.5*a
    y = (√3/2)*a
    """
    sqrt3_2 = np.sqrt(3) / 2
    x = c + 0.5 * a
    y = sqrt3_2 * a
    return x, y


def _draw_ternary_scatter(
    ax: Any,
    normalized: NDArray[np.float64],
    labels: tuple[str, str, str],
    values: NDArray[np.float64] | None,
    marker_size: float | None,
    style: Any,
) -> None:
    """Draw ternary triangle, gridlines, labels, and scatter points."""
    # Triangle vertices: (a, b, c) = (1, 0, 0), (0, 1, 0), (0, 0, 1)
    # Cartesian positions: A (top), B (bottom-left), C (bottom-right)
    ax_cart, ay_cart = _barycentric_to_cartesian(1.0, 0.0, 0.0)
    bx_cart, by_cart = _barycentric_to_cartesian(0.0, 1.0, 0.0)
    cx_cart, cy_cart = _barycentric_to_cartesian(0.0, 0.0, 1.0)

    # Draw triangle boundary
    triangle_x = [ax_cart, bx_cart, cx_cart, ax_cart]
    triangle_y = [ay_cart, by_cart, cy_cart, ay_cart]
    ax.plot(triangle_x, triangle_y, "k-", linewidth=1.5)

    # Draw gridlines at 10% intervals (0.1, 0.2, ..., 0.9)
    sqrt3_2 = np.sqrt(3) / 2
    for i in range(1, 10):
        frac = i / 10.0
        # Line of constant a (parallel to B-C edge, bottom)
        a_const_x = [_barycentric_to_cartesian(frac, 1.0 - frac, 0.0)[0],
                     _barycentric_to_cartesian(frac, 0.0, 1.0 - frac)[0]]
        a_const_y = [_barycentric_to_cartesian(frac, 1.0 - frac, 0.0)[1],
                     _barycentric_to_cartesian(frac, 0.0, 1.0 - frac)[1]]
        ax.plot(a_const_x, a_const_y, "gray", linewidth=0.5, alpha=0.5)

        # Line of constant b (parallel to A-C edge, right side)
        b_const_x = [_barycentric_to_cartesian(1.0 - frac, frac, 0.0)[0],
                     _barycentric_to_cartesian(0.0, frac, 1.0 - frac)[0]]
        b_const_y = [_barycentric_to_cartesian(1.0 - frac, frac, 0.0)[1],
                     _barycentric_to_cartesian(0.0, frac, 1.0 - frac)[1]]
        ax.plot(b_const_x, b_const_y, "gray", linewidth=0.5, alpha=0.5)

        # Line of constant c (parallel to A-B edge, left side)
        c_const_x = [_barycentric_to_cartesian(1.0 - frac, 0.0, frac)[0],
                     _barycentric_to_cartesian(0.0, 1.0 - frac, frac)[0]]
        c_const_y = [_barycentric_to_cartesian(1.0 - frac, 0.0, frac)[1],
                     _barycentric_to_cartesian(0.0, 1.0 - frac, frac)[1]]
        ax.plot(c_const_x, c_const_y, "gray", linewidth=0.5, alpha=0.5)

    # Plot compositions as scatter points
    coords = [_barycentric_to_cartesian(row[0], row[1], row[2]) for row in normalized]
    x_pts_list, y_pts_list = zip(*coords, strict=True)
    x_pts = np.asarray(x_pts_list, dtype=float)
    y_pts = np.asarray(y_pts_list, dtype=float)

    ms = marker_size if marker_size is not None else 50
    if values is not None:
        scatter = ax.scatter(x_pts, y_pts, c=values, s=ms, alpha=0.7,
                             edgecolors="black", linewidth=0.5, cmap="viridis")
        fig = ax.get_figure()
        fig.colorbar(scatter, ax=ax, label="Value")
    else:
        ax.scatter(x_pts, y_pts, s=ms, alpha=0.7, c="C0",
                   edgecolors="black", linewidth=0.5)

    # Corner labels and tick positioning
    offset = 0.05
    ax.text(ax_cart, ay_cart + offset, labels[0], ha="center", va="bottom",
            fontsize=style.font_size + 2, fontweight="bold")
    ax.text(bx_cart - offset, by_cart - offset, labels[1], ha="right", va="top",
            fontsize=style.font_size + 2, fontweight="bold")
    ax.text(cx_cart + offset, cy_cart - offset, labels[2], ha="left", va="top",
            fontsize=style.font_size + 2, fontweight="bold")

    # Clean up axes: no ticks, equal aspect, proper limits
    ax.set_xlim(-0.15, 1.15)
    ax.set_ylim(-0.15, sqrt3_2 + 0.15)
    ax.set_aspect("equal")
    ax.axis("off")
