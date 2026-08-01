"""Publication rendering for the multivariate workbench (JMP_GAP_PLAN #10
residual): correlation heatmap, scatterplot matrix (SPLOM), and PCA
scores/loadings/biplot + scree. Pure layer: pre-computed numbers in -> image
bytes out, matching the interactive canvases' own layout math (SplomTabView's
``splomRender.ts`` / PcaView's ``pcaScoresRender.ts``) so on-screen and
exported figures agree on the SAME numbers, not just similar-looking plots
(the box/violin convention ``figure_statplots`` already established).
Shares ``calc.figure_styles`` presets and ``calc.figure``'s resolved-dpi
convention. No ``corner.py`` / seaborn dependency -- plain matplotlib axes.
"""

from __future__ import annotations

from collections.abc import Sequence
from io import BytesIO
from typing import Any, Literal

import matplotlib

matplotlib.use("Agg")  # headless

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.ticker import MaxNLocator  # noqa: E402
from numpy.typing import ArrayLike, NDArray  # noqa: E402

from quantized.calc.figure_labels import safe_mathtext_label  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402

__all__ = [
    "render_correlation_heatmap_figure",
    "render_pca_figure",
    "render_pca_scree_figure",
    "render_splom_figure",
]

_FORMATS = ("pdf", "svg", "png", "tiff")
_PANEL_IN = 1.6  # SPLOM per-variable panel edge length (inches)


def _resolve(fmt: str, style: str, dpi: int | None) -> tuple[Any, int, dict[str, Any]]:
    if fmt not in _FORMATS:
        raise ValueError(f"fmt must be one of {_FORMATS}")
    st = figure_style(style)
    resolved_dpi = int(dpi) if dpi is not None else int(st.dpi)
    fallback = "DejaVu Serif" if st.font_generic == "serif" else "DejaVu Sans"
    rc: dict[str, Any] = {
        "font.family": st.font_generic,
        f"font.{st.font_generic}": [st.font_name, fallback],
        "font.size": st.font_size,
        "axes.labelsize": st.font_size,
        "axes.titlesize": st.title_font_size,
    }
    return st, resolved_dpi, rc


def _savefig(fig: Any, fmt: str, dpi: int) -> bytes:
    buf = BytesIO()
    fig.savefig(buf, format=fmt, dpi=dpi)
    return buf.getvalue()


# ── Correlation heatmap ──────────────────────────────────────────────────────


def render_correlation_heatmap_figure(
    labels: list[str],
    r: ArrayLike,
    *,
    title: str = "",
    fmt: str = "pdf",
    style: str = "default",
    dpi: int | None = None,
    width_in: float | None = None,
    height_in: float | None = None,
) -> bytes:
    """Render an n x n Pearson/Spearman correlation matrix as a diverging
    heatmap with each cell annotated by its r value -- the SAME ``r`` matrix
    ``CorrelationMatrix.tsx`` colors on screen (``calc.stats_multivar.
    correlation_matrix``), just rendered server-side. ``vmin=-1``/``vmax=1``
    fixed scale (matches the interactive view's colormap domain, r is always
    in [-1, 1])."""
    rmat = np.asarray(r, dtype=float)
    n = len(labels)
    if rmat.shape != (n, n):
        raise ValueError(f"r must be an {n}x{n} matrix matching labels, got {rmat.shape}")
    if n < 2:
        raise ValueError("correlation heatmap needs at least 2 variables")
    names = [safe_mathtext_label(str(lab)) for lab in labels]
    title = safe_mathtext_label(title)

    st, resolved_dpi, rc = _resolve(fmt, style, dpi)
    fig_w = width_in or max(st.fig_width_in, 0.55 * n + 1.2)
    fig_h = height_in or max(st.fig_height_in, 0.55 * n + 1.2)
    figsize = (fig_w, fig_h)
    tick_fs = max(st.font_size - max(n - 6, 0) * 0.5, 6.0)
    rc["xtick.labelsize"] = tick_fs
    rc["ytick.labelsize"] = tick_fs

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, ax = plt.subplots(figsize=figsize)
        try:
            im = ax.imshow(rmat, cmap="RdBu_r", vmin=-1.0, vmax=1.0, aspect="equal")
            ax.set_xticks(range(n))
            ax.set_yticks(range(n))
            ax.set_xticklabels(names, rotation=45, ha="right")
            ax.set_yticklabels(names)
            for i in range(n):
                for j in range(n):
                    v = rmat[i, j]
                    if not np.isfinite(v):
                        continue
                    ink = "white" if abs(v) > 0.55 else "black"
                    ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=tick_fs, color=ink)
            fig.colorbar(im, ax=ax, shrink=0.85, label="r")
            if title:
                ax.set_title(title)
            fig.tight_layout()
            return _savefig(fig, fmt, resolved_dpi)
        finally:
            plt.close(fig)


# ── SPLOM ─────────────────────────────────────────────────────────────────────


def _bin_edges(v: NDArray[np.float64], bins: str | int) -> NDArray[np.float64]:
    edges = np.asarray(np.histogram_bin_edges(v, bins=bins), dtype=float)
    n_bins = edges.size - 1
    if n_bins < 4:
        edges = np.asarray(np.histogram_bin_edges(v, bins=4), dtype=float)
    elif n_bins > 40:
        edges = np.asarray(np.histogram_bin_edges(v, bins=40), dtype=float)
    return edges


def render_splom_figure(
    labels: list[str],
    columns: Sequence[ArrayLike],
    *,
    title: str = "",
    fmt: str = "pdf",
    style: str = "default",
    dpi: int | None = None,
    bins: str | int = "fd",
    width_in: float | None = None,
    height_in: float | None = None,
) -> bytes:
    """Render a full n x n scatterplot matrix -- SAME cell layout as
    ``splomRender.ts``'s canvas: panel (row i, col j) plots column j on X
    against column i on Y, diagonal panels are a 1-D histogram. ``columns``
    is column-major (one array per variable, the ``/api/stats/correlation``
    request shape), already the listwise-complete row set the interactive
    SPLOM shares with correlation/PCA (``useMultivar``'s ``rows``)."""
    n = len(labels)
    if n < 2:
        raise ValueError("SPLOM needs at least 2 variables")
    if len(columns) != n:
        raise ValueError(f"columns has {len(columns)} entries, labels has {n}")
    cols = [np.asarray(c, dtype=float).ravel() for c in columns]
    for i, c in enumerate(cols):
        if not np.any(np.isfinite(c)):
            raise ValueError(f"column {i} ({labels[i]!r}) has no finite values")
    names = [safe_mathtext_label(str(lab)) for lab in labels]
    title = safe_mathtext_label(title)

    st, resolved_dpi, rc = _resolve(fmt, style, dpi)
    figsize = (width_in or _PANEL_IN * n, height_in or _PANEL_IN * n)
    tick_fs = max(st.font_size - max(n - 2, 0), 6.0)
    rc["xtick.labelsize"] = tick_fs
    rc["ytick.labelsize"] = tick_fs

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, axes = plt.subplots(n, n, figsize=figsize, squeeze=False)
        try:
            for i in range(n):
                for j in range(n):
                    ax = axes[i][j]
                    if i == j:
                        edges = _bin_edges(cols[i][np.isfinite(cols[i])], bins)
                        ax.hist(cols[i], bins=edges, color="0.6", edgecolor="white", linewidth=0.4)
                        ax.set_yticks([])
                    else:
                        xv, yv = cols[j], cols[i]
                        mask = np.isfinite(xv) & np.isfinite(yv)
                        ax.scatter(xv[mask], yv[mask], s=6, color="0.25", alpha=0.55, linewidths=0)
                    ax.xaxis.set_major_locator(MaxNLocator(nbins=3, prune="both"))
                    if i != n - 1:
                        ax.tick_params(labelbottom=False)
                    else:
                        ax.set_xlabel(names[j])
                        plt.setp(ax.get_xticklabels(), rotation=45, ha="right")
                    if j != 0 or i == j:
                        ax.tick_params(labelleft=False)
                    else:
                        ax.yaxis.set_major_locator(MaxNLocator(nbins=3, prune="both"))
                        ax.set_ylabel(names[i])
                    if not st.box_on:
                        ax.spines["top"].set_visible(False)
                        ax.spines["right"].set_visible(False)
            if title:
                fig.suptitle(title, fontsize=st.title_font_size)
                fig.tight_layout(rect=(0.0, 0.0, 1.0, 0.96))
            else:
                fig.tight_layout()
            return _savefig(fig, fmt, resolved_dpi)
        finally:
            plt.close(fig)


# ── PCA scores / loadings / biplot ───────────────────────────────────────────

PcaMode = Literal["scores", "loadings", "biplot"]


def render_pca_figure(
    mode: PcaMode,
    *,
    points: list[list[float]] | None = None,
    vectors: list[dict[str, Any]] | None = None,
    x_label: str = "",
    y_label: str = "",
    title: str = "",
    fmt: str = "pdf",
    style: str = "default",
    dpi: int | None = None,
    width_in: float | None = None,
    height_in: float | None = None,
) -> bytes:
    """Render a PCA scores / loadings / biplot panel -- SAME single-panel
    layout as ``pcaScoresRender.ts``: ``points`` (score coordinates) and/or
    ``vectors`` (``{x, y, label}`` loadings, already in PC-space, e.g.
    ``coeff[:, pcX]``/``coeff[:, pcY]`` scaled by ``sqrt(latent)`` upstream --
    this function draws exactly what it's given, no scaling of its own except
    the biplot vector-into-score-cloud rescale below).

    ``mode="biplot"`` (points AND vectors both given) rescales the vectors so
    the longest one reaches ~85% of the score cloud's radius (R's
    ``biplot()`` convention, mirrored bit-for-bit from ``pcaScoresRender.ts``)
    so they read as directions, not literal score-scale units; ``"scores"``/
    ``"loadings"`` alone draw unscaled.
    """
    if mode not in ("scores", "loadings", "biplot"):
        raise ValueError(f"mode must be one of scores/loadings/biplot, got {mode!r}")
    pts = np.asarray(points, dtype=float).reshape(-1, 2) if points else np.zeros((0, 2))
    vecs = vectors or []
    if pts.shape[0] == 0 and len(vecs) == 0:
        raise ValueError("render_pca_figure needs points and/or vectors")
    title = safe_mathtext_label(title)
    x_label = safe_mathtext_label(x_label)
    y_label = safe_mathtext_label(y_label)

    st, resolved_dpi, rc = _resolve(fmt, style, dpi)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)

    vx = np.array([float(v["x"]) for v in vecs], dtype=float)
    vy = np.array([float(v["y"]) for v in vecs], dtype=float)
    has_points = pts.shape[0] > 0
    has_vectors = len(vecs) > 0
    if has_vectors and has_points:
        finite_pts = pts[np.all(np.isfinite(pts), axis=1)]
        score_radius = float(np.max(np.abs(finite_pts))) if finite_pts.size else 1.0
        loading_radius = float(np.max(np.hypot(vx, vy))) if vx.size else 1e-12
        loading_radius = max(loading_radius, 1e-12)
        vec_scale = (score_radius * 0.85) / loading_radius
    else:
        vec_scale = 1.0
    vx, vy = vx * vec_scale, vy * vec_scale

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, ax = plt.subplots(figsize=figsize)
        try:
            if has_points:
                finite = pts[np.all(np.isfinite(pts), axis=1)]
                ax.scatter(
                    finite[:, 0], finite[:, 1], s=14, color="0.25", alpha=0.65,
                    linewidths=0, zorder=3,
                )
            if has_vectors:
                for k, v in enumerate(vecs):
                    x1, y1 = float(vx[k]), float(vy[k])
                    if not (np.isfinite(x1) and np.isfinite(y1)):
                        continue
                    ax.annotate(
                        "", xy=(x1, y1), xytext=(0, 0),
                        arrowprops={"arrowstyle": "-|>", "color": "firebrick", "lw": 1.4},
                        zorder=4,
                    )
                    ax.annotate(
                        safe_mathtext_label(str(v.get("label", ""))), xy=(x1, y1),
                        xytext=(4 if x1 >= 0 else -4, 0), textcoords="offset points",
                        ha="left" if x1 >= 0 else "right", va="center", fontsize=st.font_size * 0.8,
                        color="firebrick", zorder=4,
                    )
            ax.axhline(0, color="0.6", linewidth=0.8, zorder=1)
            ax.axvline(0, color="0.6", linewidth=0.8, zorder=1)
            if x_label:
                ax.set_xlabel(x_label)
            if y_label:
                ax.set_ylabel(y_label)
            if title:
                ax.set_title(title)
            if not st.box_on:
                ax.spines["top"].set_visible(False)
                ax.spines["right"].set_visible(False)
            fig.tight_layout()
            return _savefig(fig, fmt, resolved_dpi)
        finally:
            plt.close(fig)


def render_pca_scree_figure(
    explained: list[float],
    cumulative: list[float],
    *,
    title: str = "",
    fmt: str = "pdf",
    style: str = "default",
    dpi: int | None = None,
    width_in: float | None = None,
    height_in: float | None = None,
) -> bytes:
    """Render a PCA scree plot: percent-explained-variance bars per
    component with the cumulative curve overlaid -- the same two arrays
    ``PcaScree.tsx`` draws as DOM bars (``explained``/``cumulative`` straight
    from ``calc.stats.pca_analysis``)."""
    exp = np.asarray(explained, dtype=float)
    cum = np.asarray(cumulative, dtype=float)
    k = exp.size
    if k < 1:
        raise ValueError("scree plot needs at least 1 component")
    if cum.size != k:
        raise ValueError(f"cumulative has {cum.size} entries, explained has {k}")
    title = safe_mathtext_label(title)

    st, resolved_dpi, rc = _resolve(fmt, style, dpi)
    figsize = (width_in or st.fig_width_in, height_in or st.fig_height_in)
    x = np.arange(1, k + 1)

    with matplotlib.rc_context(rc):  # type: ignore[arg-type]
        fig, ax = plt.subplots(figsize=figsize)
        try:
            ax.bar(x, exp, color="0.6", edgecolor="white", linewidth=0.5, label="% explained")
            ax2 = ax.twinx()
            ax2.plot(
                x, cum, color="firebrick", marker="o", markersize=3, linewidth=1.25,
                label="cumulative %",
            )
            ax2.set_ylim(0, max(100.0, float(np.nanmax(cum)) if cum.size else 100.0))
            ax.set_xticks(x)
            ax.set_xticklabels([f"PC{i}" for i in x])
            ax.set_xlabel("component")
            ax.set_ylabel("% explained")
            ax2.set_ylabel("cumulative %")
            if title:
                ax.set_title(title)
            if not st.box_on:
                ax.spines["top"].set_visible(False)
            fig.tight_layout()
            return _savefig(fig, fmt, resolved_dpi)
        finally:
            plt.close(fig)
