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

from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.figure_fonts import font_family_rc
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_render import new_figure, render_scope, savefig_bytes
from quantized.calc.figure_styles import figure_style
from quantized.calc.figure_ternary_frame import SQRT3_2, draw_ternary_frame

__all__ = ["render_ternary_figure"]

_FORMATS = ("pdf", "svg", "eps", "png", "tiff")
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
    rc: dict[str, Any] = {
        **font_family_rc(st),
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
        "xtick.labelsize": st.font_size - 1,
        "ytick.labelsize": st.font_size - 1,
        "xtick.direction": st.tick_dir,
        "ytick.direction": st.tick_dir,
    }

    with render_scope(rc):
        # Rich-text labels (GOTO #5): de-math INVALID $...$ so savefig never
        # raises. Inside render_scope (review fix): every trial-parse below
        # reacquires the SAME re-entrant lock this scope already holds --
        # one real acquire per render, not one per label.
        title = safe_mathtext_label(title)
        labels = (
            safe_mathtext_label(str(labels[0])),
            safe_mathtext_label(str(labels[1])),
            safe_mathtext_label(str(labels[2])),
        )
        fig = new_figure(figsize=_FIGURE_SIZE_IN)
        ax = fig.subplots()
        _draw_ternary_scatter(
            ax, normalized, labels=labels, values=vals,
            marker_size=marker_size, style=st,
        )
        if title:
            fig.suptitle(title, fontsize=st.title_font_size)
        fig.tight_layout()
        return savefig_bytes(fig, fmt, dpi=resolved_dpi)


def _draw_ternary_scatter(
    ax: Any,
    normalized: NDArray[np.float64],
    labels: tuple[str, str, str],
    values: NDArray[np.float64] | None,
    marker_size: float | None,
    style: Any,
) -> None:
    """Draw ternary triangle, gridlines, labels, and scatter points."""
    draw_ternary_frame(ax, labels, style.font_size)

    # Plot compositions as scatter points
    x_pts = normalized[:, 2] + 0.5 * normalized[:, 0]
    y_pts = SQRT3_2 * normalized[:, 0]

    ms = marker_size if marker_size is not None else 50
    if values is not None:
        scatter = ax.scatter(x_pts, y_pts, c=values, s=ms, alpha=0.7,
                             edgecolors="black", linewidth=0.5, cmap="viridis")
        fig = ax.get_figure()
        fig.colorbar(scatter, ax=ax, label="Value")
    else:
        ax.scatter(x_pts, y_pts, s=ms, alpha=0.7, c="C0",
                   edgecolors="black", linewidth=0.5)
