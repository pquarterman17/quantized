"""Region-shape graphic objects (``Rect*``) in ``.opj`` graph layers
(decode-plan item 41 — the Graph1 SLD-profile "layer bands").

Origin lets a user drop filled rectangles onto a graph layer — the corpus
uses them as vertical film-stack region bands (PNR.opj ``Graph1``:
SiO2/Pt/YIG/Py/Ru/Air, each a full-height pastel band). These are a
distinct graph-child object class the figure decoder previously routed to
"ignore":

* the universal **133-byte object header** (``figures.py``) with type tag
  ``0x31`` at payload offset 2 (a previously-undocumented value — the known
  tags were 0x00 text / 0x07 curve / 0x22 line / 0x23 storage) and the
  object's own name (``Rect``, ``Rect1``…) at offset 70;
* followed by one **130-byte body block** holding the geometry + fill:

  ========  =====================================================
  offset    field
  ========  =====================================================
  7         fill colour low byte (mirrors the u32 at 66; equal for
            every palette-type instance corpus-wide)
  10 (f64)  left edge, layer-frame fraction (== the header's own
            anchor fraction at header offset 19)
  18 (f64)  top edge fraction (from the frame TOP — the same
            convention as text-object anchors, ``frac_to_data``)
  26 (f64)  width fraction
  34 (f64)  height fraction
  66 (u32)  fill colour, on-disk **ocolor** encoding — high byte
            0x00 = 0-BASED classic-palette index (the same disk
            convention as curve colours, ``curve_style_color``),
            0x01 = direct COLORREF ``0x01BBGGRR``
  ========  =====================================================

Corpus evidence (2026-07-11 sweep, all local ``.opj`` + ``.otp``): 329
instances across 4 files (PNR 156, SuperlatticeFits 151, MnN_Diffusion_PNR
16, SLD_DoubleY.otp 6) — every one named ``Rect*``, every body exactly 130
bytes, every fraction quad plausible. The width fraction reproduces the
header's page-unit box width / the layer frame width exactly (PNR Graph1
Rect5: 207/4913 = 0.04213 = the offset-26 double). Fill colours validated
against the live-Origin PNG oracle on PNR ``Graph1`` — 6/6 bands match
(Ru=1 red, Air/SiO2=0x12 light gray, Py=0x0b olive, YIG=3 blue, Pt=0x0e
orange, all 0-based palette); 29 corpus instances carry direct-RGB type-1
values (e.g. ``0x012DAFE6`` → #E6AF2D) — the same two-type ocolor model
``ocolor_to_rgb`` already decodes for curves. No ``Circle*``/other shape
name exists anywhere in the corpus, and the real ``.opju`` corpus has no
shape objects at all (only the ``SLDdouble.otpu`` template twin) — so this
module decodes exactly what is evidenced: the CPYA rectangle record.

**Known-not-decoded (honest gaps, see docs/origin_project_format.md):** a
fill *transparency* field could not be isolated (all instances within any
one graph share whatever it is; no body byte reads like an alpha across
files) — rendering opacity is a frontend presentation choice, documented
as such, not a decoded value. The rare non-zero bytes at body offsets
49-65 (6 instances) and the 3-value field at 114-115 are uncharacterized;
nothing here reads them.

Pure library: bytes in → dicts out. No fastapi/pydantic/routes imports.
"""

from __future__ import annotations

from struct import unpack_from
from typing import Any

from quantized.io.origin_project.annotation_marks import frac_to_data
from quantized.io.origin_project.curve_style_color import ORIGIN_PALETTE, ocolor_to_rgb

__all__ = ["SHAPE_TYPE", "build_region_shade", "rect_fill_color", "rect_shape_fractions"]

# The 133-byte object header's type tag for closed-shape graphic objects.
SHAPE_TYPE = 0x31

_FRAC_LEFT_OFF = 10
_FRAC_TOP_OFF = 18
_FRAC_WIDTH_OFF = 26
_FRAC_HEIGHT_OFF = 34
_FILL_COLOR_OFF = 66
_BODY_MIN_LEN = _FILL_COLOR_OFF + 4

# Same plausibility bound as annotation anchors (annotation_marks): a shape
# can legitimately hang outside its layer frame (MnN's cross-panel bands
# reach height fraction ~2.0), but a misread double is astronomical.
_FRAC_BOUND = 50.0


def rect_shape_fractions(body: bytes) -> tuple[float, float, float, float] | None:
    """``(left, top, width, height)`` layer-frame fractions from a shape
    object's body block, or ``None`` when the block is too short or any
    double is implausible (dropped, never guessed)."""
    if len(body) < _BODY_MIN_LEN:
        return None
    left = float(unpack_from("<d", body, _FRAC_LEFT_OFF)[0])
    top = float(unpack_from("<d", body, _FRAC_TOP_OFF)[0])
    width = float(unpack_from("<d", body, _FRAC_WIDTH_OFF)[0])
    height = float(unpack_from("<d", body, _FRAC_HEIGHT_OFF)[0])
    values = (left, top, width, height)
    if not all(abs(v) <= _FRAC_BOUND for v in values):
        return None
    if width <= 0 or height <= 0:
        return None
    return values


def rect_fill_color(body: bytes) -> str | None:
    """The shape's fill as ``"#RRGGBB"`` from the body's ocolor u32 (offset
    66), or ``None`` for auto/unrecognized encodings (never guessed).

    The on-disk field uses the SAME two-type ocolor model as curve colours
    (``curve_style_color``): high byte 0x00 = 0-based classic-palette index
    (converted to the 1-based form ``ocolor_to_rgb`` takes), 0x01 = direct
    COLORREF."""
    if len(body) < _BODY_MIN_LEN:
        return None
    field = int(unpack_from("<I", body, _FILL_COLOR_OFF)[0])
    kind = field >> 24
    if kind == 0:
        return ocolor_to_rgb(field + 1) if field < len(ORIGIN_PALETTE) else None
    return ocolor_to_rgb(field) if kind == 1 else None


def build_region_shade(
    body: bytes,
    x_from: float,
    x_to: float,
    y_from: float,
    y_to: float,
    x_log: bool,
    y_log: bool,
) -> dict[str, Any] | None:
    """One region-shade dict ``{"x1","x2","y1","y2","fill"}`` in DATA
    coordinates (``x1 < x2``, ``y1 < y2``; log axes interpolate in log10
    space via :func:`frac_to_data`, the confirmed position model), or
    ``None`` when the geometry never decoded. ``fill`` is ``"#RRGGBB"`` or
    ``None`` (colour undecoded — the shape still ships so the extent isn't
    lost, but a renderer should skip a fill-less shade rather than guess a
    colour)."""
    fracs = rect_shape_fractions(body)
    if fracs is None:
        return None
    left, top, width, height = fracs
    xa, ya = frac_to_data(left, top, x_from, x_to, y_from, y_to, x_log, y_log)
    xb, yb = frac_to_data(left + width, top + height, x_from, x_to, y_from, y_to, x_log, y_log)
    return {
        "x1": min(xa, xb),
        "x2": max(xa, xb),
        "y1": min(ya, yb),
        "y2": max(ya, yb),
        "fill": rect_fill_color(body),
    }
