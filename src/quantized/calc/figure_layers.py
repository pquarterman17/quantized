"""Graph layers in the publication renderer (origin gap audit 3 #15).

Origin draws an inset as a second LAYER of the graph page: a small graph of
any data with its own axes, sitting over the main one -- a hysteresis loop
with a dM/dH inset, or the low-field region of another sample. The screen
(``frontend/src/components/Stage/GraphLayers.tsx``) draws those layers, and
inserted images and tables, from ``PlotView.layers``; the request carries
them as ``overrides["layers"]`` (``frontend/src/lib/graphLayersWire.ts``)::

    {"kind": "inset", "at": [left, top, width, height], "mark": "line",
     "x": {"lim": [lo, hi], "scale": "linear", "label": "...",
           "ticks": [...], "tick_labels": [...]},
     "y": {...},
     "curves": [{"x": [...], "y": [...], "color": "#rrggbb"}],
     "notice": "No curves: their sources are missing"}      # optional
    {"kind": "image", "at": [...], "src": "data:image/png;base64,..."}
    {"kind": "table", "at": [...], "rows": [["T", "Hc"], ...], "header": true}

``at`` is the main axes' fraction rect, top-origin -- the magnifier inset's
convention (:mod:`quantized.calc.figure_inset`). For an inset it is the
inset's PLOT AREA (``inset_axes`` bounds), so its tick labels hang outside it
as on screen; an image is fitted inside it keeping its aspect (the screen's
``object-fit: contain``); a table fills it. The frontend resolves each inset
axis completely -- range, tick positions AND tick text -- so nothing here
autoscales or picks ticks: what the export draws is what the screen drew.
A ``notice`` (every curve's source is gone) is written inside the inset
instead of curves -- the screen's text, never a rebound curve.

Pure layer: matplotlib + numpy only.
"""

from __future__ import annotations

import base64
import binascii
import io
import math
import re
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from matplotlib.ticker import FixedLocator, NullLocator

__all__ = ["apply_layers", "validate_layers"]

_KINDS = ("inset", "image", "table")
_MARKS = ("line", "scatter", "linesymbol")
_IMAGE_URL = re.compile(r"^data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)$")
_MAX_IMAGE_CHARS = 4_000_000  # frontend lib/graphLayers.ts MAX_IMAGE_CHARS
_MAX_LAYERS = 32
_MAX_ROWS, _MAX_COLS = 50, 20  # MAX_TABLE_ROWS / MAX_TABLE_COLS
_MAX_PIXELS = 25_000_000  # frontend MAX_IMAGE_PIXELS: refused before any decode
_LINE_WIDTH = 1.1  # pt: the screen's 1.5 px line
_MARKER_SIZE = 3.0  # pt
_TEXT_SIZE = 7.0  # pt: the screen's compact inset text
_NOTICE_INK = "0.4"
_ZORDER = 6  # over the main axes' own artists (an inset axes' default is 5)


def _finite(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _check_at(at: Any, i: int) -> None:
    if not (
        isinstance(at, (list, tuple))
        and len(at) == 4
        and all(_finite(n) for n in at)
        and at[2] > 0
        and at[3] > 0
    ):
        raise ValueError(f"layers[{i}].at must be [left, top, width, height] with a positive size")


def _check_axis(ax: Any, where: str) -> None:
    if not isinstance(ax, Mapping):
        raise ValueError(f"{where} must be an object")
    lim = ax.get("lim")
    if not (isinstance(lim, (list, tuple)) and len(lim) == 2 and all(_finite(n) for n in lim)
            and lim[0] < lim[1]):
        raise ValueError(f"{where}.lim must be a [lo, hi] pair with lo < hi")
    if ax.get("scale") not in ("linear", "log"):
        raise ValueError(f"{where}.scale must be 'linear' or 'log'")
    if ax.get("scale") == "log" and lim[0] <= 0:
        raise ValueError(f"{where}.lim must be positive on a log axis")
    ticks, labels = ax.get("ticks"), ax.get("tick_labels")
    if not (isinstance(ticks, list) and all(_finite(t) for t in ticks)):
        raise ValueError(f"{where}.ticks must be a list of numbers")
    if not (isinstance(labels, list) and len(labels) == len(ticks)
            and all(isinstance(s, str) for s in labels)):
        raise ValueError(f"{where}.tick_labels must be one string per tick")
    if not isinstance(ax.get("label", ""), str):
        raise ValueError(f"{where}.label must be a string")


def _check_inset(spec: Mapping[str, Any], i: int) -> None:
    _check_axis(spec.get("x"), f"layers[{i}].x")
    _check_axis(spec.get("y"), f"layers[{i}].y")
    if spec.get("mark", "line") not in _MARKS:
        raise ValueError(f"layers[{i}].mark must be one of {', '.join(_MARKS)}")
    curves = spec.get("curves")
    if not isinstance(curves, list):
        raise ValueError(f"layers[{i}].curves must be a list")
    for c in curves:
        xs, ys = (c.get(k) if isinstance(c, Mapping) else None for k in ("x", "y"))
        if not (isinstance(xs, list) and isinstance(ys, list) and len(xs) == len(ys)
                and isinstance(c.get("color"), str)):
            raise ValueError(f"layers[{i}].curves entries need x and y of equal length and a color")
    if "notice" in spec and not isinstance(spec["notice"], str):
        raise ValueError(f"layers[{i}].notice must be a string")


def _check_image(spec: Mapping[str, Any], i: int) -> None:
    src = spec.get("src")
    if not (isinstance(src, str) and len(src) <= _MAX_IMAGE_CHARS and _IMAGE_URL.match(src)):
        raise ValueError(f"layers[{i}].src must be a PNG or JPEG data URL")


def _ok_row(r: Any) -> bool:
    return isinstance(r, list) and len(r) <= _MAX_COLS and all(isinstance(c, str) for c in r)


def _check_table(spec: Mapping[str, Any], i: int) -> None:
    rows = spec.get("rows")
    if not (isinstance(rows, list) and 0 < len(rows) <= _MAX_ROWS and all(map(_ok_row, rows))):
        raise ValueError(
            f"layers[{i}].rows must be up to {_MAX_ROWS} rows of up to {_MAX_COLS} strings"
        )


def validate_layers(layers: Any) -> None:
    """Raise ``ValueError`` for a malformed ``overrides["layers"]``."""
    if not isinstance(layers, list) or len(layers) > _MAX_LAYERS:
        raise ValueError(f"layers must be a list of at most {_MAX_LAYERS} objects")
    for i, spec in enumerate(layers):
        if not isinstance(spec, Mapping) or spec.get("kind") not in _KINDS:
            raise ValueError(f"layers[{i}].kind must be one of {', '.join(_KINDS)}")
        _check_at(spec.get("at"), i)
        {"inset": _check_inset, "image": _check_image, "table": _check_table}[spec["kind"]](spec, i)


def _bounds(at: Sequence[float]) -> tuple[float, float, float, float]:
    """``at`` (top-origin) as ``inset_axes`` bounds (y-up)."""
    left, top, width, height = (float(v) for v in at)
    return left, 1.0 - top - height, width, height


def _literal(text: str) -> str:
    """``text`` as matplotlib must print it to match the screen, which shows
    layer text literally: every ``$`` escaped, so none starts mathtext (an
    unpaired one used to fail the whole export; a pair turned into math)."""
    return text.replace("$", r"\$")


def _axis(ins: Any, which: str, spec: Mapping[str, Any]) -> None:
    axis = ins.xaxis if which == "x" else ins.yaxis
    (ins.set_xscale if which == "x" else ins.set_yscale)(spec["scale"])
    (ins.set_xlim if which == "x" else ins.set_ylim)(float(spec["lim"][0]), float(spec["lim"][1]))
    axis.set_major_locator(FixedLocator([float(t) for t in spec["ticks"]]))
    axis.set_minor_locator(NullLocator())
    axis.set_ticklabels([_literal(s) for s in spec["tick_labels"]])  # the screen's text
    label = spec.get("label") or ""
    if label:
        (ins.set_xlabel if which == "x" else ins.set_ylabel)(_literal(label), fontsize=_TEXT_SIZE)


def _draw_inset(host: Any, spec: Mapping[str, Any]) -> Any:
    ins = host.inset_axes(_bounds(spec["at"]))
    if "notice" in spec:
        # No curve to draw: the screen's framed box, no axes, and its notice
        # when every curve's source is gone ("" = none bound yet: empty frame).
        ins.set_xticks([])
        ins.set_yticks([])
        if spec["notice"]:
            ins.text(0.5, 0.5, _literal(spec["notice"]), transform=ins.transAxes, ha="center",
                     va="center", fontsize=_TEXT_SIZE, color=_NOTICE_INK, wrap=True)
        return ins
    mark = spec.get("mark", "line")
    log_x, log_y = spec["x"]["scale"] == "log", spec["y"]["scale"] == "log"
    for c in spec["curves"]:
        x = np.asarray([np.nan if v is None else v for v in c["x"]], dtype=float)
        y = np.asarray([np.nan if v is None else v for v in c["y"]], dtype=float)
        # A point a log axis cannot show is a gap, as on screen (the wire
        # already sends it as null; a direct caller gets the same rule).
        y[(log_y & (y <= 0)) | (log_x & (x <= 0))] = np.nan
        ins.plot(
            x, y, color=c["color"],
            linestyle="none" if mark == "scatter" else "-",
            linewidth=_LINE_WIDTH,
            marker="o" if mark != "line" else "",
            markersize=_MARKER_SIZE,
            label="_layer",
        )
    _axis(ins, "x", spec["x"])
    _axis(ins, "y", spec["y"])
    ins.tick_params(labelsize=_TEXT_SIZE, which="both")
    ins.grid(False)
    return ins


def _decode_image(src: str) -> np.ndarray:
    """The pixels of a PNG/JPEG data URL. The bytes are SNIFFED (a JPEG called
    PNG is refused, never guessed at) and the pixel count is checked from the
    header before anything is decoded, so a tiny crafted file cannot cost
    gigabytes."""
    from PIL import Image  # matplotlib's own image backend

    m = _IMAGE_URL.match(src)
    if m is None:  # validated upstream; kept for direct callers
        raise ValueError("image layer src must be a PNG or JPEG data URL")
    try:
        raw = base64.b64decode(m.group(2), validate=True)
        with Image.open(io.BytesIO(raw)) as im:
            if (im.format or "").lower() != m.group(1):
                raise ValueError("image layer is not the format its data URL names")
            w, h = im.size
            if w * h > _MAX_PIXELS:
                raise ValueError(f"image layer is too large ({w}x{h} pixels)")
            return np.asarray(im.convert("RGBA"))
    except ValueError as exc:
        if "image layer" in str(exc):
            raise
        raise ValueError("image layer src is not a readable PNG or JPEG") from exc
    except Image.DecompressionBombError as exc:
        raise ValueError("image layer is too large") from exc
    except (binascii.Error, OSError, SyntaxError) as exc:
        raise ValueError("image layer src is not a readable PNG or JPEG") from exc


def _draw_image(host: Any, spec: Mapping[str, Any]) -> Any:
    img = _decode_image(spec["src"])
    ins = host.inset_axes(_bounds(spec["at"]))
    ins.imshow(img, aspect="equal", interpolation="antialiased")
    ins.set_anchor("C")  # fitted and centred, as the screen's object-fit: contain
    ins.set_axis_off()
    return ins


def _draw_table(host: Any, spec: Mapping[str, Any]) -> Any:
    rows = [list(r) for r in spec["rows"]]
    width = max(1, *(len(r) for r in rows))
    cells = [[_literal(c) for c in r] + [""] * (width - len(r)) for r in rows]
    table = host.table(cellText=cells, cellLoc="center", bbox=list(_bounds(spec["at"])))
    table.auto_set_font_size(False)
    table.set_fontsize(_TEXT_SIZE)
    if spec.get("header", True):
        for j in range(width):
            table[0, j].set_text_props(fontweight="bold")
    return table


def apply_layers(host: Any, ov: Mapping[str, Any]) -> list[Any]:
    """Draw ``ov["layers"]`` (see the module doc) over ``host``, in order
    (a later layer on top); returns the artists drawn. ``host`` is the main
    axes -- a dual-Y figure's twin, so no y2 curve draws over a layer."""
    out: list[Any] = []
    # Over the legend too (Origin: a later layer is above layer 1 and its
    # legend), as the screen mounts the layers after the legend.
    legend = host.get_legend()
    base = max(_ZORDER, legend.get_zorder() + 1 if legend is not None else 0)
    for i, spec in enumerate(ov.get("layers") or []):
        draw = {"inset": _draw_inset, "image": _draw_image, "table": _draw_table}[spec["kind"]]
        artist = draw(host, spec)
        artist.set_zorder(base + i)  # stacked in list order, as the screen's boxes are
        out.append(artist)
    return out
