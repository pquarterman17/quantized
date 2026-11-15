"""The 2D plot types the corpus builds, and how Origin builds each one.

Every recipe is Origin's OWN menu recipe, copied from the installed
``Plot.ogs`` (Origin 2026b): the Plot menu runs
``run.section(plot, General, <code> <template> ...)`` -> ``worksheet -p
<code> <template>`` on the selected columns. Codes the menu does not name
(bubble, colour-mapped) come from ``PlotPopup/FilterPlotTypes.xml``'s
``PlotID`` column. Building through the menu's command, not ``plotxy
plot:=N``, matters: ``plotxy`` accepts ANY N (even 999) and reports success,
so a wrong guess fails silently; the builder reads the real type back with
Origin C ``DataPlot::GetPlotType()`` (``qz_oracle.c``) and records it.

``shape`` names the input a type needs; ``generate.py`` families declare the
shapes they can feed (see :func:`applicable`).
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["ERROR_BAR_TYPES", "PLOT_TYPES", "PlotType", "applicable", "by_name"]

# Input shapes a family can provide (families.Family.shapes).
XY = "xy"  # X + one or more Y
XY_MULTI = "xy_multi"  # X + >= 2 Y (stacking, waterfall, double-Y)
XYY = "xyy"  # X, Y, and a third numeric column (bubble size / colour)
CATEGORY = "category"  # X usable as categories (text or few distinct values) + Y
DISTRIBUTION = "distribution"  # >= 1 Y column of samples (box/violin/histogram)
XY_ERR = "xy_err"  # X, Y, Y-error columns
XYZ = "xyz"  # X, Y, Z-designated column on a scattered/regular grid
MATRIX = "matrix"  # a matrix sheet
TERNARY = "ternary"  # three fractions summing to 1 (X, Y, Z-designated)
POLAR = "polar"  # angle (deg) + radius


# Plot types of the error-bar companions Origin adds for Y-error / X-error
# columns (measured 2026-11-15 on the error_columns family: [201, 231, 233]).
# NB `plotxy plot:=231` on a sheet without error columns killed Origin.
ERROR_BAR_TYPES = frozenset({231, 233})


@dataclass(frozen=True)
class PlotType:
    name: str  # corpus id (directory name)
    code: int | None  # requested code; None = template decides ("?")
    template: str  # Origin template (.otp/.otpu) the menu uses
    shape: str
    # Columns to select, as a function of the sheet: "xy" = X + every Y,
    # "y" = the Y columns only, "xyz" = the X,Y,Z triple, "matrix" = matrix.
    select: str = "xy"
    # Plot types Origin is EXPECTED to report (measured), when they differ
    # from ``code``: menu ids like bubble (193) are creation aliases whose
    # plots read back as scatter (201) plus a size/colour modifier.
    expect: tuple[int, ...] = ()
    note: str = ""

    def expected_readback(self) -> frozenset[int]:
        """Types an ok build may report: ``expect`` (or ``code``) plus the
        error-bar companions an X/Y-error column adds."""
        base = self.expect or (() if self.code is None else (self.code,))
        return frozenset(base) | ERROR_BAR_TYPES


PLOT_TYPES: tuple[PlotType, ...] = (
    # -- XY family (Plot.ogs [Line] [Scatter] [LineSymbol] [Area] [StackArea])
    PlotType("line", 200, "Line", XY),
    PlotType("scatter", 201, "Scatter", XY),
    PlotType("line_symbol", 202, "LineSymb", XY),
    PlotType("area", 204, "Area", XY),
    PlotType("stacked_area", 214, "StackArea", XY_MULTI),
    PlotType(
        "step_horizontal",
        200,
        "Line",
        XY,
        note="Plot > Basic 2D > Horizontal Step is a line plot with a step "
        "connect (styles.STEP_HORIZONTAL_CONNECT); the oracle records the "
        "connect value read back",
    ),
    PlotType("double_y", None, "DOUBLEY", XY_MULTI, expect=(202,),
             note="Plot.ogs [2Ys_Y-Y]; two layers of line+symbol"),
    PlotType("y_error", 201, "Scatter", XY_ERR, note="scatter with a Y-error column"),
    PlotType(
        "stacked_lines_offset",
        200,
        "OffsetStackY",
        XY_MULTI,
        note="Plot.ogs [OffsetYs]; the 2D 'waterfall'. Origin 2026b's Waterfal "
        "template ([WaterFall]) draws a 3D waterfall, out of scope",
    ),
    PlotType("polar", 192, "Polar", POLAR, expect=(200,),
             note="Plot.ogs [Polar]: theta(X) r(Y); polar is the LAYER's "
             "coordinate system, the plot reads back as a line (200)"),
    # -- category family (Plot.ogs [Column] [StackCol] [Bar] [StackBar] [FloatColumn])
    PlotType("column", 203, "Column", CATEGORY),
    PlotType("stacked_column", 213, "StackColumn", CATEGORY),
    PlotType("bar", 215, "Bar", CATEGORY),
    PlotType("stacked_bar", 216, "StackBar", CATEGORY),
    PlotType("floating_column", 207, "FloatCol", CATEGORY),
    # -- statistics (Plot.ogs [BoxChart] [ViolinPlot] [ColumnScatter] [Histogram])
    PlotType("box", 206, "Box", DISTRIBUTION, select="y"),
    PlotType("violin", 206, "Violin", DISTRIBUTION, select="y"),
    PlotType("strip", 206, "ColumnScatter", DISTRIBUTION, select="y"),
    PlotType("histogram", 219, "Hist", DISTRIBUTION, select="y"),
    # -- specialised 2D (FilterPlotTypes.xml PlotID / Plot.ogs)
    PlotType("bubble", 193, "bubble", XYY, expect=(201,)),
    PlotType(
        "color_mapped",
        247,
        "colormapped",
        XYY,
        expect=(201,),
        note="CMAP.otp is a 3D wall template (measured: 247+CMAP drew 3D walls, "
        "read back 204) and 247+Scatter drew a plain scatter; colormapped.otpu "
        "is the 2D colour-mapped scatter",
    ),
    PlotType("contour_xyz", 243, "TriContour", XYZ, select="xyz"),
    PlotType("contour_matrix", 226, "Contour", MATRIX, select="matrix"),
    PlotType("heatmap_matrix", 105, "HeatMap", MATRIX, select="matrix"),
    PlotType("ternary", 245, "Ternary", TERNARY, select="xyz", expect=(201,),
             note="ternary is the layer's coordinate system; plots read back 201"),
)

_BY_NAME = {p.name: p for p in PLOT_TYPES}


def by_name(name: str) -> PlotType:
    return _BY_NAME[name]


def applicable(shapes: frozenset[str] | set[str]) -> list[PlotType]:
    """Plot types a family providing ``shapes`` can feed, in table order."""
    return [p for p in PLOT_TYPES if p.shape in shapes]
