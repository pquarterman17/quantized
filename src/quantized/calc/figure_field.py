"""Publication rendering for vector field plots (quiver and streamline).

ORIGIN_GAP_PLAN #23 / GAP_TIER3_PLAN item 4. Pure layer: gridded (x, y, u, v)
field data -> quiver or streamline vector plot in image bytes. Shares
``calc.figure_styles`` presets and ``calc.figure``'s resolved-dpi convention.

Validates that x/y axes have matching grid shape to the (u, v) components.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from numpy.typing import ArrayLike  # noqa: E402

from quantized.calc.figure_labels import safe_mathtext_label  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402

__all__ = ["render_field_figure"]

_FORMATS = ("pdf", "svg", "png", "tiff")
_FIGURE_SIZE_IN = (10, 8)  # inches


def render_field_figure(
    x_axis: ArrayLike,
    y_axis: ArrayLike,
    u_grid: ArrayLike,
    v_grid: ArrayLike,
    *,
    kind: str = "quiver",
    fmt: str = "pdf",
    style: str = "default",
    dpi: int | None = None,
    title: str = "",
    x_label: str = "",
    y_label: str = "",
) -> bytes:
    """Render a vector field plot (quiver or streamline).

    ``x_axis`` and ``y_axis`` are 1-D coordinate arrays defining a regular grid.
    ``u_grid`` and ``v_grid`` are 2-D arrays (shape: len(y_axis) × len(x_axis))
    of x and y components of the field at each grid point.

    ``kind`` is either "quiver" (arrows at each grid point) or "streamline"
    (streamlines following the field). ``fmt``, ``style``, and ``dpi`` follow
    ``render_figure``'s conventions: ``dpi`` defaults to the preset's calibrated
    resolution when not given.

    ``title``, ``x_label``, and ``y_label`` are optional figure labels.

    Returns image bytes in the requested ``fmt``. Raises ``ValueError`` on
    malformed input (wrong shape, bad kind, bad format).
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    if kind not in ("quiver", "streamline"):
        raise ValueError("kind must be 'quiver' or 'streamline'")
    # Rich-text labels (GOTO #5): de-math INVALID $...$ so savefig never raises.
    title = safe_mathtext_label(title)
    x_label = safe_mathtext_label(x_label)
    y_label = safe_mathtext_label(y_label)

    x_arr = np.asarray(x_axis, dtype=float)
    y_arr = np.asarray(y_axis, dtype=float)
    u_arr = np.asarray(u_grid, dtype=float)
    v_arr = np.asarray(v_grid, dtype=float)

    if x_arr.ndim != 1 or y_arr.ndim != 1:
        raise ValueError("x_axis and y_axis must be 1-D arrays")
    if u_arr.ndim != 2 or v_arr.ndim != 2:
        raise ValueError("u_grid and v_grid must be 2-D arrays")
    if u_arr.shape != v_arr.shape:
        raise ValueError("u_grid and v_grid must have the same shape")
    if u_arr.shape != (len(y_arr), len(x_arr)):
        raise ValueError(
            f"u_grid/v_grid shape {u_arr.shape} doesn't match "
            f"grid dimensions ({len(y_arr)}, {len(x_arr)})"
        )

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

    # Build a meshgrid for proper vector field plotting
    xx, yy = np.meshgrid(x_arr, y_arr, indexing="xy")

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, ax = plt.subplots(figsize=_FIGURE_SIZE_IN)
        try:
            if kind == "quiver":
                # Quiver: arrows at grid points, colored by magnitude
                magnitude = np.sqrt(u_arr**2 + v_arr**2)
                q = ax.quiver(xx, yy, u_arr, v_arr, magnitude, cmap="viridis")
                fig.colorbar(q, ax=ax, label="Magnitude")
            else:  # streamline
                # Streamline: field lines following the vector field
                speed = np.sqrt(u_arr**2 + v_arr**2)
                strm = ax.streamplot(
                    x_arr, y_arr, u_arr, v_arr,
                    color=speed, cmap="viridis", density=1.5, linewidth=1.0,
                )
                fig.colorbar(strm.lines, ax=ax, label="Speed")

            ax.set_xlabel(x_label)
            ax.set_ylabel(y_label)
            if title:
                ax.set_title(title, fontsize=st.title_font_size)

            if not st.box_on:
                ax.spines["top"].set_visible(False)
                ax.spines["right"].set_visible(False)

            fig.tight_layout()
            buf = BytesIO()
            fig.savefig(buf, format=fmt, dpi=resolved_dpi)
            return buf.getvalue()
        finally:
            plt.close(fig)
