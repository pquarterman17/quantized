"""Publication rendering for MCMC/bootstrap posterior corner (pairs) plots.

ORIGIN_GAP_PLAN #29 residual. Pure layer: an ``(n_samples, k)`` array of
joint parameter draws in -> image bytes out. matplotlib only -- no
``corner.py`` dependency, deliberately, since the whole grid is a few hundred
lines of plain axes. Diagonal panels are 1-D marginal histograms; panels
below the diagonal are 2-D density histograms of each parameter pair; the
upper triangle is left blank -- the conventional "corner plot" layout (see
Foreman-Mackey's ``corner`` package for the reference look this mirrors).
Shares ``calc.figure_styles`` presets and ``calc.figure``'s resolved-dpi
convention (an explicit ``dpi`` overrides the preset; otherwise the preset's
calibrated dpi is used), so corner exports match the rest of the publication
export pipeline.
"""

from __future__ import annotations

from collections.abc import Sequence
from io import BytesIO
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.ticker import MaxNLocator  # noqa: E402
from numpy.typing import ArrayLike, NDArray  # noqa: E402

from quantized.calc.figure_labels import safe_mathtext_label  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402

__all__ = ["render_corner_figure"]

_FORMATS = ("pdf", "svg", "png", "tiff")
_PANEL_IN = 2.1  # per-parameter panel edge length (inches) at the default size
_MAX_TICKS = 4
_TRUTH_COLOR = "firebrick"


def render_corner_figure(
    samples: ArrayLike,
    param_names: Sequence[str],
    *,
    truths: Sequence[float] | None = None,
    title: str = "",
    fmt: str = "pdf",
    style: str = "default",
    dpi: int | None = None,
    bins: str | int = "fd",
    width_in: float | None = None,
    height_in: float | None = None,
) -> bytes:
    """Render a pairwise posterior/bootstrap corner (pairs) plot.

    ``samples`` is ``(n_samples, k)`` joint parameter draws -- e.g. the
    ``samples`` array from :func:`calc.fit_bootstrap.fit_posterior` or
    ``bootstrap_fit(..., return_samples=True)``'s ``boot_samples``.
    ``param_names`` names the ``k`` columns (must match ``samples.shape[1]``).

    Diagonal panels are 1-D marginal histograms (``bins`` -- a count or a
    numpy binning rule, e.g. ``"fd"``); panels below the diagonal are 2-D
    density histograms of each parameter pair; the upper triangle is left
    blank. ``truths`` (length ``k``), when given, draws a reference dashed
    line (diagonal panels) / crosshair (off-diagonal panels) at each
    parameter's fitted value.

    ``fmt`` / ``style`` / ``width_in`` / ``height_in`` match ``render_figure``
    (default panel geometry scales with ``k`` -- corner grids need more
    canvas than a single-series plot -- unless explicit sizes are given).
    ``dpi`` defaults to the preset's calibrated resolution when not given
    (``None``), same as ``calc.figure``'s ``resolved_dpi``.

    Raises ``ValueError`` on shape mismatches (``param_names``/``truths``
    length vs. the sample columns) or too few finite joint samples.
    """
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")

    arr = np.asarray(samples, dtype=float)
    if arr.ndim != 2:
        raise ValueError(
            f"samples must be a 2-D (n_samples, n_params) array, got ndim={arr.ndim}"
        )
    _n_samples, k = arr.shape
    if k < 1:
        raise ValueError("samples needs at least one parameter column")
    names = [safe_mathtext_label(str(nm)) for nm in param_names]
    # (Rich-text labels, GOTO #5: de-math INVALID $...$ so savefig never raises.)
    if len(names) != k:
        raise ValueError(f"param_names has {len(names)} entries, samples has {k} columns")
    if truths is not None and len(truths) != k:
        raise ValueError(f"truths has {len(truths)} entries, samples has {k} columns")

    finite = arr[np.all(np.isfinite(arr), axis=1)]
    if finite.shape[0] < 2:
        raise ValueError("need at least 2 finite joint samples to render a corner plot")
    tr = np.asarray(truths, dtype=float) if truths is not None else None

    title = safe_mathtext_label(title)
    st = figure_style(style)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)
    figsize = (width_in or _PANEL_IN * k, height_in or _PANEL_IN * k)
    fallback = "DejaVu Serif" if st.font_generic == "serif" else "DejaVu Sans"
    # Shrink tick labels a touch as the grid grows so k up to ~6 stays readable.
    tick_fs = max(st.font_size - max(k - 2, 0), 6.0)
    rc: dict[str, Any] = {
        "font.family": st.font_generic,
        f"font.{st.font_generic}": [st.font_name, fallback],
        "font.size": tick_fs,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
        "xtick.labelsize": tick_fs,
        "ytick.labelsize": tick_fs,
        "xtick.direction": st.tick_dir,
        "ytick.direction": st.tick_dir,
    }
    ranges = [_pad_range(finite[:, i]) for i in range(k)]

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, axes = plt.subplots(k, k, figsize=figsize, squeeze=False)
        try:
            for row in range(k):
                for col in range(k):
                    ax = axes[row][col]
                    if col > row:
                        ax.axis("off")
                        continue
                    truth_col = float(tr[col]) if tr is not None else None
                    if col == row:
                        _draw_marginal(ax, finite[:, col], bins, ranges[col], truth_col)
                    else:
                        truth_row = float(tr[row]) if tr is not None else None
                        _draw_pair(
                            ax, finite[:, col], finite[:, row], bins,
                            ranges[col], ranges[row], truth_col, truth_row,
                        )
                    _style_panel(ax, row, col, k, names, st)
            if title:
                fig.suptitle(title, fontsize=st.title_font_size)
                fig.tight_layout(rect=(0.0, 0.0, 1.0, 0.96))
            else:
                fig.tight_layout()
            buf = BytesIO()
            fig.savefig(buf, format=fmt, dpi=resolved_dpi)
            return buf.getvalue()
        finally:
            plt.close(fig)


def _pad_range(v: NDArray[np.float64]) -> tuple[float, float]:
    """Axis limits for one parameter: data range + 5% pad (a small fixed
    window around a degenerate, all-equal column)."""
    lo, hi = float(np.min(v)), float(np.max(v))
    if hi <= lo:
        pad = abs(lo) * 0.05 or 0.5
        return lo - pad, hi + pad
    pad = 0.05 * (hi - lo)
    return lo - pad, hi + pad


def _bin_edges(v: NDArray[np.float64], bins: str | int) -> NDArray[np.float64]:
    """Bin edges from a count or a numpy binning rule, clipped to a readable
    panel range (too few bins looks sparse, too many looks noisy at panel
    size)."""
    edges = np.asarray(np.histogram_bin_edges(v, bins=bins), dtype=float)
    n_bins = edges.size - 1
    if n_bins < 4:
        edges = np.asarray(np.histogram_bin_edges(v, bins=4), dtype=float)
    elif n_bins > 60:
        edges = np.asarray(np.histogram_bin_edges(v, bins=60), dtype=float)
    return edges


def _draw_marginal(
    ax: Any,
    v: NDArray[np.float64],
    bins: str | int,
    rng: tuple[float, float],
    truth: float | None,
) -> None:
    edges = _bin_edges(v, bins)
    ax.hist(v, bins=edges, density=True, color="0.6", edgecolor="white", linewidth=0.5)
    if truth is not None and np.isfinite(truth):
        ax.axvline(truth, color=_TRUTH_COLOR, linestyle="--", linewidth=1.2)
    ax.set_xlim(rng)
    ax.set_yticks([])


def _draw_pair(
    ax: Any,
    xv: NDArray[np.float64],
    yv: NDArray[np.float64],
    bins: str | int,
    x_rng: tuple[float, float],
    y_rng: tuple[float, float],
    truth_x: float | None,
    truth_y: float | None,
) -> None:
    x_edges = _bin_edges(xv, bins)
    y_edges = _bin_edges(yv, bins)
    ax.hist2d(xv, yv, bins=[x_edges, y_edges], cmap="Greys")
    if truth_x is not None and np.isfinite(truth_x):
        ax.axvline(truth_x, color=_TRUTH_COLOR, linestyle="--", linewidth=1.2)
    if truth_y is not None and np.isfinite(truth_y):
        ax.axhline(truth_y, color=_TRUTH_COLOR, linestyle="--", linewidth=1.2)
    ax.set_xlim(x_rng)
    ax.set_ylim(y_rng)


def _style_panel(ax: Any, row: int, col: int, k: int, names: list[str], st: Any) -> None:
    """Shared axis cosmetics: labels only on the outer edges, thinned tick
    counts, and the preset's box-on spine treatment."""
    ax.xaxis.set_major_locator(MaxNLocator(nbins=_MAX_TICKS, prune="both"))
    if col != row:
        ax.yaxis.set_major_locator(MaxNLocator(nbins=_MAX_TICKS, prune="both"))
    if row == k - 1:
        ax.set_xlabel(names[col])
        plt.setp(ax.get_xticklabels(), rotation=45, ha="right")
    else:
        ax.tick_params(labelbottom=False)
    if col == 0 and row > 0:
        ax.set_ylabel(names[row])
    elif col != 0:
        ax.tick_params(labelleft=False)
    if not st.box_on:
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
