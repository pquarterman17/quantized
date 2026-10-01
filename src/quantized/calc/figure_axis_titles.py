"""Axis-title Format + drag on export (``overrides["axis_titles"]``).

The canvas draws each axis title with its right-click Format choices (size,
bold, italic -- ``PlotView.axisLabelStyles``) at its dragged offset
(``PlotView.axisLabelOffsets``); the request carries both as
``FigureRequest.axis_label_styles``/``axis_label_offsets``, which the route
folds into the override bag as ONE per-axis map (``routes.export_figures_schema
.request_overrides``)::

    {"x": {"size": 14, "bold": True, "italic": False, "offset": [dx, dy]},
     "y": {...}, "y2": {...}}

Units follow the export's standing screen-px convention: a CSS px value rides
the wire verbatim and is read as a typographic POINT, as an annotation's
``size`` (``figure_overrides``), a series' ``marker_size`` and a line
``width`` already are. So ``size`` is the title's font size in points and
``offset`` moves it ``dx`` pt right and ``dy`` pt DOWN (the screen's y
direction), keeping a moved title the same number of its own font sizes away
from where it started. The move is a display-space translation laid over the
label's own transform, so it survives matplotlib re-placing the label at draw
time and ``tight_layout`` sees the moved box. An absent key keeps
the preset's choice; ``bold``/``italic`` false keep the preset's upright,
normal-weight title. Pure layer: mutates the given axes' label artists.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from matplotlib.transforms import ScaledTranslation

__all__ = ["apply_axis_titles", "validate_axis_titles"]

_AXES = ("x", "y", "y2")
#: CSS px -> points: 1:1 (see the module doc), 72 points per inch.
_PT_PER_INCH = 72.0


def validate_axis_titles(spec: Any) -> None:
    """Raise ``ValueError`` on a malformed ``axis_titles`` map; unknown keys
    inside an entry are ignored, as everywhere in the override bag."""
    if spec is None:
        return
    if not isinstance(spec, Mapping):
        raise ValueError("axis_titles must be a map of axis -> title style")
    for key, entry in spec.items():
        if key not in _AXES or not isinstance(entry, Mapping):
            raise ValueError("axis_titles keys must be x / y / y2, each a style map")
        size = entry.get("size")
        if size is not None and (isinstance(size, bool) or not 0 < float(size) <= 200):
            raise ValueError("axis_titles size must be in (0, 200]")
        offset = entry.get("offset")
        if offset is not None and (not isinstance(offset, (list, tuple)) or len(offset) != 2):
            raise ValueError("axis_titles offset must be a [dx, dy] pair")


def apply_axis_titles(fig: Any, axes: Mapping[str, Any], spec: Any) -> None:
    """Apply ``spec`` (the ``axis_titles`` override) to the title of every axis
    named in ``axes`` (``{"x": ax, "y": ax}`` for the primary axes, ``{"y2":
    ax2}`` for a twinx). An axis ``spec`` does not name is left untouched."""
    if not isinstance(spec, Mapping):
        return
    for key, ax in axes.items():
        entry = spec.get(key)
        if not isinstance(entry, Mapping):
            continue
        label = (ax.xaxis if key == "x" else ax.yaxis).label
        size = entry.get("size")
        if size is not None:
            label.set_fontsize(float(size))
        if entry.get("bold"):
            label.set_fontweight("bold")
        if entry.get("italic"):
            label.set_fontstyle("italic")
        offset = entry.get("offset")
        if offset is not None:
            dx, dy = float(offset[0]), float(offset[1])
            if dx or dy:
                # Screen y runs DOWN, display y up: a title dragged down moves down.
                pt = 1.0 / _PT_PER_INCH
                shift = ScaledTranslation(dx * pt, -dy * pt, fig.dpi_scale_trans)
                label.set_transform(label.get_transform() + shift)
