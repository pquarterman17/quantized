"""Publication figure rendering via matplotlib. Pure layer: data in -> bytes.

Renders a clean publication-style figure (white background, vector by default)
to PDF / SVG (vector) or PNG / TIFF (raster, at a chosen DPI). Server-side so the
browser gets a real vector file — the architecture's vector-by-default export
preference; raster formats are available for journals that demand them. TIFF
output goes through Pillow (a matplotlib dependency). matplotlib is imported here
only (the heavy import is lazy at the route boundary).
"""

from __future__ import annotations

from collections.abc import Sequence
from io import BytesIO

import matplotlib

matplotlib.use("Agg")  # headless: render to a buffer, never to a display

import matplotlib.pyplot as plt  # noqa: E402  (must follow matplotlib.use)
import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = ["render_figure"]

_FORMATS = ("pdf", "svg", "png", "tiff")


def render_figure(
    x: ArrayLike,
    series: Sequence[tuple[str, ArrayLike]],
    *,
    x_label: str = "",
    y_label: str = "",
    x_log: bool = False,
    y_log: bool = False,
    fmt: str = "pdf",
    width_in: float = 6.0,
    height_in: float = 4.0,
    dpi: int = 200,
) -> bytes:
    """Render ``series`` (each ``(label, y)``) against ``x`` to image bytes.

    ``fmt`` is ``pdf`` / ``svg`` (vector) or ``png`` / ``tiff`` (raster, sized by
    ``dpi``). A legend is drawn only for multiple series. Raises ``ValueError`` on
    an unknown format.
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")

    xv: NDArray[np.float64] = np.asarray(x, dtype=float)
    fig, ax = plt.subplots(figsize=(width_in, height_in))
    try:
        for label, y in series:
            ax.plot(xv, np.asarray(y, dtype=float), label=label, linewidth=1.2)
        if x_log:
            ax.set_xscale("log")
        if y_log:
            ax.set_yscale("log")
        if x_label:
            ax.set_xlabel(x_label)
        if y_label:
            ax.set_ylabel(y_label)
        if len(series) > 1:
            ax.legend(frameon=False, fontsize="small")
        ax.grid(True, alpha=0.25)
        fig.tight_layout()
        buf = BytesIO()
        fig.savefig(buf, format=fmt, dpi=dpi)
        return buf.getvalue()
    finally:
        plt.close(fig)
