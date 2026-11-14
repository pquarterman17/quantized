"""Panel insets (audit item #15): a movable/resizable box INSIDE a graph that
shows something other than that graph's own data -- a different dataset's
columns on their own axes/scale/legend ("dataset"), a raster photo/schematic
("image"), or a small table such as fit parameters ("table"). This is the
*screen's* ``PlotView.panelInsets`` (``frontend/src/lib/panelInset.ts``),
carried in the request as ``overrides["panel_insets"]``, a list of::

    {"at": [left, top, width, height], "content": {...}}

``at`` is the box's PLOT AREA as fractions of the main axes, top-origin --
the exact convention the magnifier inset (``figure_inset.py``) uses, so the
two families place identically. Unlike the magnifier, a panel inset never
zooms the host axes' own series: it carries its OWN content, so there is no
source region to outline or connect, and (unlike ``apply_inset``) it does
not need twin-axes awareness on a dual-Y figure -- it draws once, from
``figure.py``/``figure_y2.py`` calling :func:`apply_panel_insets` right after
:func:`quantized.calc.figure_inset.apply_inset` (dual-Y strips this key from
the primary-only ``ov`` the same way it strips ``"inset"``, so it draws
exactly once).

``content.kind``:

- ``"dataset"``: a FROZEN snapshot of another dataset's columns, captured by
  the screen when the inset is inserted (not a live binding -- the screen's
  cross-series live-linking machinery is a separate, in-flight workstream).
  ``{"x": [...], "series": [{"label", "y": [...], "color"?}], "x_scale"?,
  "y_scale"?, "legend"?, "title"?}``.
- ``"image"``: a raster photo/schematic, base64-encoded. ``{"data": "<b64>",
  "format": "png"|"jpeg", "title"?}``. This is a deliberate, narrow exception
  to the vector-export preference (CLAUDE.md): unlike the page-facet raster
  grid this codebase removed for polluting an otherwise fully-vector page
  (see ``figure_page_facets.py``/``figure_page.py``'s own history), a panel
  inset is the ONE artist the user explicitly asked to be a picture, confined
  to its own small box -- the rest of the page stays vector.
- ``"table"``: a small text table (e.g. fit parameters). ``{"headers"?: [...],
  "rows": [[...]], "title"?}``.

Pure layer: matplotlib + numpy + Pillow (already a transitive matplotlib
dependency; declared directly here since this module imports it itself) only.
"""

from __future__ import annotations

import base64
import io
import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from PIL import Image

from quantized.calc.figure_scale import apply_axis_scale

__all__ = ["apply_panel_insets", "validate_panel_insets"]

_KINDS = frozenset({"dataset", "image", "table"})
_IMAGE_FORMATS = frozenset({"png", "jpeg"})
_MAX_IMAGE_BYTES = 8 * 1024 * 1024  # decoded-bytes guard: a box this small never needs more


def _finite_at(at: Any) -> bool:
    return (
        isinstance(at, (list, tuple))
        and len(at) == 4
        and all(isinstance(n, (int, float)) and math.isfinite(n) for n in at)
        and at[2] > 0
        and at[3] > 0
    )


def _validate_dataset_content(content: Mapping[str, Any]) -> None:
    x = content.get("x")
    if not (isinstance(x, (list, tuple)) and len(x) > 0):
        raise ValueError("panel inset dataset content needs a non-empty 'x'")
    series = content.get("series")
    if not (isinstance(series, (list, tuple)) and len(series) > 0):
        raise ValueError("panel inset dataset content needs at least one series")
    for s in series:
        if not isinstance(s, Mapping):
            raise ValueError("each panel inset dataset series must be an object")
        y = s.get("y")
        if not (isinstance(y, (list, tuple)) and len(y) == len(x)):
            raise ValueError("panel inset dataset series 'y' must be the same length as 'x'")
    for key in ("x_scale", "y_scale"):
        v = content.get(key)
        if v is not None and v not in ("linear", "log"):
            raise ValueError(f"panel inset dataset '{key}' must be 'linear' or 'log'")


def _validate_image_content(content: Mapping[str, Any]) -> None:
    data = content.get("data")
    if not isinstance(data, str) or not data:
        raise ValueError("panel inset image content needs base64 'data'")
    fmt = content.get("format")
    if fmt not in _IMAGE_FORMATS:
        raise ValueError(f"panel inset image 'format' must be one of {sorted(_IMAGE_FORMATS)}")
    try:
        raw = base64.b64decode(data, validate=True)
    except (ValueError, Exception) as exc:  # binascii.Error subclasses ValueError
        raise ValueError("panel inset image 'data' must be valid base64") from exc
    if len(raw) > _MAX_IMAGE_BYTES:
        raise ValueError("panel inset image exceeds the maximum decoded size")


def _validate_table_content(content: Mapping[str, Any]) -> None:
    rows = content.get("rows")
    if not (isinstance(rows, (list, tuple)) and len(rows) > 0):
        raise ValueError("panel inset table content needs at least one row")
    for row in rows:
        if not isinstance(row, (list, tuple)):
            raise ValueError("each panel inset table row must be a list of cells")
    headers = content.get("headers")
    if headers is not None and not isinstance(headers, (list, tuple)):
        raise ValueError("panel inset table 'headers' must be a list")


def validate_panel_insets(items: Any) -> None:
    """Raise ``ValueError`` for a malformed ``overrides["panel_insets"]``."""
    if not items:
        return
    if not isinstance(items, Sequence):
        raise ValueError("panel_insets must be a list")
    for item in items:
        if not isinstance(item, Mapping):
            raise ValueError("each panel_insets entry must be an object")
        if not _finite_at(item.get("at")):
            raise ValueError(
                "panel inset 'at' must be [left, top, width, height] with a positive size"
            )
        content = item.get("content")
        if not isinstance(content, Mapping):
            raise ValueError("panel inset 'content' must be an object")
        kind = content.get("kind")
        if kind not in _KINDS:
            raise ValueError(f"panel inset kind must be one of {sorted(_KINDS)}")
        if kind == "dataset":
            _validate_dataset_content(content)
        elif kind == "image":
            _validate_image_content(content)
        else:
            _validate_table_content(content)


def _draw_dataset_inset(ins: Any, content: Mapping[str, Any]) -> None:
    x = np.asarray(content["x"], dtype=float)
    for s in content["series"]:
        y = np.asarray(s["y"], dtype=float)
        kw: dict[str, Any] = {"label": s.get("label") or "_panel_inset"}
        if s.get("color"):
            kw["color"] = s["color"]
        ins.plot(x, y, **kw)
    apply_axis_scale(ins, "x", content.get("x_scale") or "linear")
    apply_axis_scale(ins, "y", content.get("y_scale") or "linear")
    ins.tick_params(labelsize="small")
    if content.get("legend"):
        ins.legend(fontsize="x-small", frameon=False)
    if content.get("title"):
        ins.set_title(content["title"], fontsize="small")


def _draw_image_inset(ins: Any, content: Mapping[str, Any]) -> None:
    raw = base64.b64decode(content["data"], validate=True)
    with Image.open(io.BytesIO(raw)) as img:
        arr = np.asarray(img.convert("RGBA"))
    ins.imshow(arr, aspect="auto")
    ins.set_xticks([])
    ins.set_yticks([])
    if content.get("title"):
        ins.set_title(content["title"], fontsize="small")


def _draw_table_inset(ins: Any, content: Mapping[str, Any]) -> None:
    ins.axis("off")
    rows = [[str(cell) for cell in row] for row in content["rows"]]
    headers = content.get("headers")
    table = ins.table(
        cellText=rows,
        colLabels=[str(h) for h in headers] if headers else None,
        loc="center",
        cellLoc="center",
    )
    table.auto_set_font_size(False)
    table.set_fontsize(7)
    if content.get("title"):
        ins.set_title(content["title"], fontsize="small", pad=2)


def apply_panel_insets(ax: Any, ov: Mapping[str, Any]) -> None:
    """Draw ``ov["panel_insets"]`` (see the module doc) on ``ax``. Unlike the
    magnifier inset, a panel inset owns its own content, so it draws once
    from a single axes regardless of a dual-Y figure's twin."""
    items = ov.get("panel_insets")
    if not items:
        return
    for item in items:
        content = item["content"]
        left, top, width, height = (float(v) for v in item["at"])
        ins = ax.inset_axes((left, 1.0 - top - height, width, height))
        kind = content["kind"]
        if kind == "dataset":
            _draw_dataset_inset(ins, content)
        elif kind == "image":
            _draw_image_inset(ins, content)
        else:
            _draw_table_inset(ins, content)
