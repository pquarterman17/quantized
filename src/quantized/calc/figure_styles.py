"""Publication figure-style presets (ported from ``+styles/template.m``).

Pure data layer: a named-template table whose parameters (font, sizes, line
width, figure geometry, grid/box/legend) are transcribed verbatim from the
MATLAB ``styles.template`` reference so exported figures match journal specs
(APS, Nature, thesis, report, web, …). ``render_figure`` consumes a resolved
``FigureStyle``; no matplotlib/fastapi imports here.
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["FigureStyle", "FIGURE_STYLES", "figure_style", "style_names"]

_CM_PER_IN = 2.54


@dataclass(frozen=True, slots=True)
class FigureStyle:
    """One named figure style. Sizes are in points (fonts/line) or cm (figure)."""

    name: str
    font_name: str
    font_size: float  # axis tick / label size (pt)
    title_font_size: float
    legend_font_size: float
    line_width: float
    line_width_thin: float
    marker_size: float
    fig_width_cm: float
    fig_height_cm: float
    dpi: int
    grid_alpha: float  # 0 = no grid
    legend_box: bool
    box_on: bool = True
    tick_dir: str = "in"
    legend_location: str = "best"

    @property
    def fig_width_in(self) -> float:
        return self.fig_width_cm / _CM_PER_IN

    @property
    def fig_height_in(self) -> float:
        return self.fig_height_cm / _CM_PER_IN

    @property
    def font_generic(self) -> str:
        """Generic family so matplotlib falls back silently if the named font
        (Helvetica/Arial/Times) is absent on the host."""
        return "serif" if "times" in self.font_name.lower() else "sans-serif"


def _t(
    name: str,
    font: str,
    fs: float,
    title_fs: float,
    legend_fs: float,
    lw: float,
    lw_thin: float,
    marker: float,
    w_cm: float,
    h_cm: float,
    dpi: int,
    *,
    grid_alpha: float,
    legend_box: bool,
    box_on: bool = True,
) -> FigureStyle:
    return FigureStyle(
        name=name,
        font_name=font,
        font_size=fs,
        title_font_size=title_fs,
        legend_font_size=legend_fs,
        line_width=lw,
        line_width_thin=lw_thin,
        marker_size=marker,
        fig_width_cm=w_cm,
        fig_height_cm=h_cm,
        dpi=dpi,
        grid_alpha=grid_alpha,
        legend_box=legend_box,
        box_on=box_on,
    )


# Values transcribed verbatim from quantized_matlab/+styles/template.m — do not
# "fix" them; they are calibrated journal/context specs.
FIGURE_STYLES: dict[str, FigureStyle] = {
    # Our interactive baseline (matches the legacy render_figure look): the
    # renderer default when no style is requested.
    "default": _t("default", "DejaVu Sans", 10, 11, 9, 1.2, 0.7, 5, 15.24, 10.16, 200,
                   grid_alpha=0.25, legend_box=False),
    "aps": _t("aps", "Helvetica", 9, 10, 8, 1.25, 0.75, 4, 8.6, 6.5, 600,
              grid_alpha=0.0, legend_box=False),
    "aps_double": _t("aps_double", "Helvetica", 9, 10, 8, 1.25, 0.75, 4, 17.8, 6.5, 600,
                     grid_alpha=0.0, legend_box=False),
    "nature": _t("nature", "Arial", 7, 8, 6, 1.0, 0.5, 3, 8.9, 6.0, 600,
                 grid_alpha=0.0, legend_box=False),
    "nature_double": _t("nature_double", "Arial", 7, 8, 6, 1.0, 0.5, 3, 18.3, 6.0, 600,
                        grid_alpha=0.0, legend_box=False),
    "thesis": _t("thesis", "Times New Roman", 11, 12, 10, 1.5, 0.75, 5, 15.0, 10.0, 300,
                 grid_alpha=0.15, legend_box=True),
    "presentation": _t("presentation", "Arial", 18, 20, 14, 2.5, 1.5, 8, 25.0, 18.0, 150,
                       grid_alpha=0.2, legend_box=False),
    "poster": _t("poster", "Arial", 24, 28, 18, 3.0, 2.0, 10, 30.0, 22.0, 150,
                 grid_alpha=0.15, legend_box=False),
    "report": _t("report", "Times New Roman", 10, 11, 9, 1.4, 0.7, 5, 12.0, 8.5, 300,
                 grid_alpha=0.0, legend_box=True),
    "web": _t("web", "Arial", 13, 15, 11, 2.0, 0.9, 6, 16.0, 10.0, 150,
              grid_alpha=0.12, legend_box=False),
}


def style_names() -> list[str]:
    """Sorted list of available style names (``default`` first)."""
    rest = sorted(n for n in FIGURE_STYLES if n != "default")
    return ["default", *rest]


def figure_style(name: str) -> FigureStyle:
    """Resolve a style by name; raises ``ValueError`` on an unknown name."""
    try:
        return FIGURE_STYLES[name]
    except KeyError as exc:
        raise ValueError(
            f"unknown style {name!r}; available: {', '.join(style_names())}"
        ) from exc
