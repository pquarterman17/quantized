"""``FigureRequest.plots2``: the wire half of the G15 plot types (parallel
coordinates, hexbin / 2-D KDE, Pareto, Bland-Altman; GAP_AUDIT_9).

Like ``polar``, setting ``plots2`` makes ``/api/export/figure`` (and the report
exporter) render through ``calc.figure_parallel`` / ``figure_density2d`` /
``figure_agreement`` instead of an XY figure, and every XY-only field is
REFUSED (422) rather than silently dropped. Column indices count
``[x, *channels]`` from 0 (0 = the x / ``time`` column), as ``polar_map`` does.
Rows with a non-finite value in any picked column are left out here (the
screen builder says how many); the calc layer refuses what is still unusable.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal

import numpy as np
from pydantic import BaseModel, Field

from quantized.calc.axis_categories import x_category_labels
from quantized.datastruct import is_categorical, level_of
from quantized.heavy_import import heavy_imports
from quantized.routes.export_figures_facets import _request_dataset
from quantized.routes.export_figures_polar import _xy_only_fields

if TYPE_CHECKING:
    from quantized.routes.export_figures import FigureRequest

Cmap = Literal["viridis", "magma", "gray", "rdbu"]


class Plots2Spec(BaseModel):
    """One of the G15 plots. ``kind`` picks the renderer; only that kind's
    columns / options are read."""

    kind: Literal["parallel", "density2d", "pareto", "bland_altman"]
    cols: list[int] = Field(default_factory=list, description="parallel: the axes, in order.")
    color_col: int | None = Field(default=None, ge=0, description="parallel: colour rows by it.")
    normalize: Literal["minmax", "zscore"] = "minmax"
    alpha: float = Field(default=0.6, ge=0.05, le=1.0)
    x_col: int = Field(default=0, ge=0, description="density2d: x; bland_altman: method A.")
    y_col: int = Field(default=1, ge=0, description="density2d: y; bland_altman: method B.")
    cat_col: int = Field(default=0, ge=0, description="pareto: category column.")
    value_col: int = Field(default=1, ge=0, description="pareto: value column.")
    method: Literal["hexbin", "kde"] = "hexbin"
    gridsize: int = Field(default=30, ge=5, le=200)
    log_counts: bool = False
    bandwidth: Literal["scott", "silverman"] | float = Field(
        default="scott", description="2-D KDE bandwidth. Scott's rule is provisional."
    )
    levels: int = Field(default=10, ge=2, le=100)
    show_points: bool = False
    cmap: Cmap = "viridis"
    ci_level: float = Field(default=0.95, gt=0.0, lt=1.0)
    loa_sd: float = Field(default=1.96, gt=0.0, le=10.0)
    percent: bool = False
    show_ci: bool = True
    x_label: str = ""


class Plots2Fields(BaseModel):
    plots2: Plots2Spec | None = Field(
        default=None,
        description="Render a G15 plot (parallel / density2d / pareto / bland_altman).",
    )


def _col(ds: Any, k: int, what: str) -> np.ndarray:
    n = len(ds.labels)
    if k > n:
        raise ValueError(f"{what} column {k} does not exist: the dataset has {n + 1} columns")
    return np.asarray(ds.time if k == 0 else ds.values[:, k - 1], dtype=float)


def _name(ds: Any, k: int) -> str:
    if k == 0:
        return str(ds.metadata.get("x_column_name") or "x")
    return str(ds.labels[k - 1])


def _finite_rows(arrs: list[np.ndarray]) -> np.ndarray:
    keep = np.ones(arrs[0].shape, dtype=bool)
    for a in arrs:
        keep &= np.isfinite(a)
    return keep


def _categories(ds: Any, k: int) -> list[str] | None:
    """Text labels of the X column when it is a text-category axis."""
    if k != 0:
        return None
    return x_category_labels(ds.metadata, None, ds.time)


def render_plots2_request(req: FigureRequest, *, fmt: str, dpi: int) -> bytes:
    """``render_figure_request``'s plots2 body."""
    assert req.plots2 is not None
    refused = _xy_only_fields(req)
    if req.series_styles:
        refused.append("series_styles")
    if refused:
        raise ValueError(f"this plot type cannot honour {', '.join(refused)}")
    p = req.plots2
    ds = _request_dataset(req)
    common: dict[str, Any] = {
        "title": req.title, "fmt": fmt, "style": req.style, "width_in": req.width_in,
        "height_in": req.height_in, "dpi": dpi, "transparent": req.transparent,
        "svg_text_as_paths": req.svg_text_as_paths,
    }
    if p.kind == "parallel":
        if len(p.cols) < 2 or len(set(p.cols)) != len(p.cols):
            raise ValueError("parallel coordinates need at least two different columns")
        cols = [_col(ds, k, "axis") for k in p.cols]
        color = _col(ds, p.color_col, "colour") if p.color_col is not None else None
        keep = _finite_rows(cols + ([color] if color is not None else []))
        with heavy_imports("quantized.calc.figure_parallel"):
            from quantized.calc.figure_parallel import render_parallel_figure
        return render_parallel_figure(
            np.column_stack([c[keep] for c in cols]) if keep.any() else np.empty((0, len(cols))),
            [_name(ds, k) for k in p.cols],
            color=None if color is None else color[keep],
            color_label=_name(ds, p.color_col) if p.color_col is not None else "",
            normalize=p.normalize, cmap="gray" if req.greyscale else p.cmap, alpha=p.alpha,
            **common,
        )
    if p.kind == "density2d":
        x, y = _col(ds, p.x_col, "x"), _col(ds, p.y_col, "y")
        with heavy_imports("quantized.calc.figure_density2d"):
            from quantized.calc.figure_density2d import render_density2d_figure
        return render_density2d_figure(
            x, y, method=p.method, gridsize=p.gridsize, log_counts=p.log_counts,
            bandwidth=p.bandwidth, levels=p.levels, show_points=p.show_points,
            cmap="gray" if req.greyscale else p.cmap,
            x_label=req.x_label or _name(ds, p.x_col), y_label=req.y_label or _name(ds, p.y_col),
            **common,
        )
    if p.kind == "bland_altman":
        a, b = _col(ds, p.x_col, "method A"), _col(ds, p.y_col, "method B")
        with heavy_imports("quantized.calc.figure_agreement"):
            from quantized.calc.figure_agreement import render_bland_altman_figure
        return render_bland_altman_figure(
            a, b, level=p.ci_level, k=p.loa_sd, percent=p.percent, show_ci=p.show_ci,
            x_label=req.x_label or "", y_label=req.y_label or "", **common,
        )
    cat = _col(ds, p.cat_col, "category")
    val = _col(ds, p.value_col, "value")
    texts = _categories(ds, p.cat_col)
    if texts is not None:
        labels = [texts[int(c) - 1] if np.isfinite(c) and 1 <= c <= len(texts) else "" for c in cat]
    elif p.cat_col >= 1 and is_categorical(ds, p.cat_col - 1):
        # A categorical CHANNEL (a text column of the sheet): its level text, not its code.
        labels = [level_of(ds, p.cat_col - 1, float(c)) or "" for c in cat]
    else:
        labels = [f"{c:g}" if np.isfinite(c) else "" for c in cat]
    pairs = [(lab, v) for lab, v in zip(labels, val, strict=True) if lab != "" and np.isfinite(v)]
    with heavy_imports("quantized.calc.figure_agreement"):
        from quantized.calc.figure_agreement import render_pareto_figure
    return render_pareto_figure(
        [lab for lab, _ in pairs], [v for _, v in pairs],
        value_label=req.y_label or _name(ds, p.value_col), **common,
    )
