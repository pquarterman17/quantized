"""Per-curve visual style (color / symbol kind / plot type) for Origin
graph curves -- shared by BOTH containers (solved 2026-07-06 against the
4-stem ``curve_style.json`` oracle: ``hc2convert`` (.opj), ``Hc2 data``,
``RockingCurve``, ``UnpolPlots`` (.opju)).

**The key structural fact.** The ``.opj`` (CPYA) curve-anchor record (the
519/515-byte block ``opj_curves.py`` reads the column id from) and the
``.opju`` (CPYUA) curve token are the SAME fixed-layout record: CPYUA stores
it as a sparse serialization that elides zero runs. The grammar (derived by
aligning ``hc2convert.opj`` against ``Hc2 data.opju`` -- the same project in
both containers -- and validated byte-exact through record offset 310+):

```
<tag 0x80..0xbf> <len:u8> <payload:len>   skip (tag-0x80)+3 zero bytes, then
                                          write len literal bytes
<0xc0..0xc3> <rep:1>                      write (tag-0xc0)+3 copies of rep
                                          (the same count law the axis-record
                                          RLE uses: c2=5, c3=6)
<len 0x01..0x7f> <payload:len>            bare literal continuation
```

Reconstructing the record from the token's own ``80 01/03 <id>`` chunk
(position 1 before it; the id lands at offset 4, exactly the ``.opj``
anchor's layout) reproduces the ``.opj`` record byte-for-byte, and the
stream always completes the record to exactly 519 bytes (chained zero-len
skip chunks, e.g. ``9a 00``, pad the tail) before the DataPlot body object
(``58 80 09 98 03 40 b3``) begins.

**Style fields inside the record** (same offsets in both containers;
landmark constants at 370/378/386/394/404/420/440/448/456/472/480/488
verified at identical offsets for both the 519- and 515-byte ``.opj``
variants -- the 4-byte size difference sits past offset 492):

* offset 23 -- **symbol kind** (Origin's symbol-gallery index; 0 = none).
  Oracle-verified 49/49 (.opj) + 43/43 (.opju).
* offset 76 -- the **plot-type byte** (``0xc8`` line / ``0xc9``
  scatter -- the very byte ``opju_codec.curve_plot_style``'s
  ``8f 01 <style> 83`` tag writes: that tag is this record's sparse chunk
  for offset 76). ``0xca`` is line + symbol: OriginLab's official ``plotxy``
  reference maps plot ids 200/201/202 to line/scatter/line+symbol, matching
  these bytes exactly. ``0xe7``/``0xe9`` (PNR corpus) remain unmapped --
  omitted, never guessed.
* offsets 302-305 -- a constant ``0xFFFFFFF7`` "auto" sentinel u32.
* offsets 306-309 -- the **symbol color** (ocolor u32 LE), terminator
  ``0xff`` at 310 (the validity gate: hc2convert's 24 non-oracle anchors
  carrying ``0x1e`` there get no color, fail-closed).
* offsets 362-365 -- the **line color** (ocolor u32 LE, no terminator).

The plot's *effective* color (what the oracle's COM capture reports) is the
symbol color when symbol kind > 0, else the line color -- verified 48/49 on
``hc2convert`` reachable plots (the 49th is the palette case below) and
39/43 on the ``.opju`` stems (the other 4 are honestly auto-on-disk: error-
bar curves whose oracle reports the inherited effective black).

**On-disk ocolor encoding** (the low-level u32; three cases):

* high byte ``0x01`` -- direct RGB, COLORREF byte order: ``0x01BBGGRR``.
  Verified: every one of the oracle's 96 type-1 plots decodes to its
  ``color_rgb`` under this model.
* high byte ``0x00`` -- a **0-based** index into Origin's classic 24-color
  palette. The oracle/LabTalk convention is 1-based (``1`` = black); disk
  stores ``index-1`` (verified: hc2convert Graph2's black plot stores 0
  where the oracle says 1; UnpolPlots' orange line stores 0x0e where the
  oracle says 0x0f). :func:`raw_color` returns the ORACLE (1-based) form so
  callers and tests compare against the oracle int directly.
* ``0xFFFFFFF7`` -- "auto/increment" (Origin assigns by plot order). The
  oracle reports the *effective* resolved color (e.g. ``-4`` or an
  inherited black); that resolution is Origin-side state we cannot decode,
  so auto yields ``None`` -- the frontend palette default stands.

**Line width + symbol size (SOLVED 2026-07-06, 92/92 oracle-exact both
containers):**

* offset 21 -- **line width** u16 LE, in units of 1/500 pt (``1500`` = 3.0pt,
  ``250`` = 0.5pt).
* offset 25 -- **symbol size** u16 LE, same 1/500-pt units (``4500`` = 9pt).

Both store the value LabTalk itself reports: when the user resizes a graph
window Origin *bakes* the rescale into these stored values (``795`` = 1.59pt
shown as "1.6"), so there is NO separate print-factor field to decode -- the
2026-07-05 "layer print factor" model (§13.2 #1's old blocker) was an
artifact of reading two CONSTANT fields (the DataPlot-body 213-236 triple
and record offset 282, both fixed boilerplate corpus-wide) and mistaking
oracle/constant ratios for a scale. Exhaustive per-offset search across all
31 width-varying oracle plots isolated offsets 21/25 as the only fields
that group plots exactly by width/size.

See ``tests/test_io_origin_curve_style.py`` for the synthetic + oracle
verification suite.
"""

from __future__ import annotations

import struct

__all__ = [
    "ORIGIN_PALETTE",
    "SYSTEM_COLOR_LIST",
    "apply_increment_colors",
    "ocolor_to_rgb",
    "opju_style_record",
    "raw_color",
    "style_fields",
]

_RECORD_LEN = 519  # the .opj curve-anchor record length (515 variant differs past 492)
_AUTO = 0xFFFFFFF7  # the on-disk "auto/increment" color sentinel (-9 as i32)
_SYMBOL_COLOR_OFF = 306
_COLOR_TERM_OFF = 310
_LINE_COLOR_OFF = 362
_SYMBOL_KIND_OFF = 23
_STYLE_BYTE_OFF = 76
_LINE_WIDTH_OFF = 21  # u16 LE, 1/500 pt (see module docstring)
_SYMBOL_SIZE_OFF = 25  # u16 LE, 1/500 pt
_PT500_MAX = 50_000  # plausibility ceiling: 100 pt — reject junk, never guess

# Origin's classic 24-color list (LabTalk ``color()`` indices 1-24, here
# 0-indexed 0-23): black, red, green, blue, cyan, magenta, yellow, dark
# yellow, navy, purple, wine, olive, dark cyan, royal, orange, violet, pink,
# white, light gray, gray, light yellow, light cyan, light magenta, dark
# gray. Ported verbatim from Origin's documented default color list -- the
# calibrated values are intentional, do not "fix".
ORIGIN_PALETTE: tuple[str, ...] = (
    "#000000",  # 1  black
    "#FF0000",  # 2  red
    "#00FF00",  # 3  green
    "#0000FF",  # 4  blue
    "#00FFFF",  # 5  cyan
    "#FF00FF",  # 6  magenta
    "#FFFF00",  # 7  yellow
    "#808000",  # 8  dark yellow
    "#000080",  # 9  navy
    "#800080",  # 10 purple
    "#800000",  # 11 wine
    "#008000",  # 12 olive
    "#008080",  # 13 dark cyan
    "#0000A0",  # 14 royal
    "#FF8000",  # 15 orange
    "#8000FF",  # 16 violet
    "#FF0080",  # 17 pink
    "#FFFFFF",  # 18 white
    "#C0C0C0",  # 19 light gray
    "#808080",  # 20 gray
    "#FFFF80",  # 21 light yellow
    "#80FFFF",  # 22 light cyan
    "#FF80FF",  # 23 light magenta
    "#404040",  # 24 dark gray
)

# Origin's symbol-gallery indices (LabTalk ``set -k``): 1 square, 2 circle,
# 3 up-triangle, 4 down-triangle, 5 diamond, 6 cross(+), 7 cross(x),
# 8 star. Indices 1-3 are oracle-verified; 4-8 port the documented gallery
# order. Names match the frontend MarkerShape union so they pass through.
_SYMBOL_SHAPES = {
    1: "square",
    2: "circle",
    3: "triangle",
    4: "downtriangle",
    5: "diamond",
    6: "plus",
    7: "cross",
    8: "star",
}

# Same byte table opju_codec._STYLE_BYTES validated (fig_pairs oracle).
# 0xca = Origin plot:=202, officially documented as line + symbol:
# https://docs.originlab.com/x-function/ref/plotxy/
# 0xe7/0xe9 remain unmapped -- never guessed.
_CONNECT_STYLE = {0xC8: "line", 0xC9: "scatter", 0xCA: "line_symbol"}
_LINE_CONNECT_OFF = 17
_LINE_CONNECT = {0: "straight", 1: "segment2"}

# ── auto/increment colours (2026-07-06, §13.2 #2) ────────────────────────────
#
# A curve whose colour field holds the EXACT u32 ``0x81010151`` is an
# "increment placeholder": Origin resolves it at render time by walking its
# active colour list. Pinned by-construction (style_group/style_ungrouped/
# style_group12 specimens, generate_specimens_style.py) with a RENDER-PIXEL
# oracle (expGraph PNG, sampled line colours — the COM ``layer.plotN.color``
# property reports only the group-level colour, so pixels are the only
# per-member ground truth):
#
# * record byte 6 carries the plot's group role: ``0x09`` standalone,
#   ``0x29`` group head, ``0x19`` group member (byte-diff of the grouped vs
#   ungrouped specimens, otherwise identical records).
# * a GROUPED placeholder takes SYSTEM_COLOR_LIST[k], k = index within its
#   group (verified for k=0..11, twelve distinct colours, no wrap);
# * an UNGROUPED placeholder always renders the list's FIRST colour.
#
# SYSTEM_COLOR_LIST is Origin's default "System Color List" (2018+); the 12
# entries below are the pixel-verified ones. A project using a CUSTOM colour
# list is Origin-side state we cannot see — any 0x81-typed value OTHER than
# the observed 0x81010151 payload is left unresolved (None) rather than
# guessed, and members past index 11 are likewise left unresolved.
# Values are calibrated/verified — do not "fix".
SYSTEM_COLOR_LIST: tuple[str, ...] = (
    "#515151", "#F14040", "#1A6FDF", "#37AD6B", "#B177DE", "#CC9900",
    "#00CBCC", "#7D4E4E", "#8E8E00", "#FB6501", "#6699CC", "#6FB802",
)  # fmt: skip

_INCREMENT_PLACEHOLDER = 0x81010151
_GROUP_ROLE_OFF = 6
_GROUP_ROLES = {0x09: "standalone", 0x29: "head", 0x19: "member"}


def ocolor_to_rgb(raw: int) -> str | None:
    """An Origin ocolor int (ORACLE/LabTalk form) -> ``"#RRGGBB"``, or
    ``None`` for auto/unrecognized (never guessed).

    Type 1 (high byte ``0x01``) is a direct COLORREF: ``0x01BBGGRR``.
    Type 0 (high byte ``0x00``) is a 1-based classic-palette index (1-24) --
    the LabTalk convention the ground-truth oracle uses; the on-disk field
    is 0-based and :func:`raw_color` converts before returning.
    """
    raw &= 0xFFFFFFFF
    kind = raw >> 24
    if kind == 1:  # direct RGB (COLORREF low 24 bits, BGR order)
        r, g, b = raw & 0xFF, (raw >> 8) & 0xFF, (raw >> 16) & 0xFF
        return f"#{r:02X}{g:02X}{b:02X}"
    if kind == 0 and 1 <= raw <= len(ORIGIN_PALETTE):  # classic palette, 1-based
        return ORIGIN_PALETTE[raw - 1]
    return None  # auto/increment or an unrecognized type: no color, never guess


def raw_color(record: bytes) -> int | None:
    """The plot's effective ocolor from a curve-anchor record, in ORACLE
    (1-based-palette) form, or ``None`` (auto on disk / gates failed).

    Reads the symbol color (offset 306) for symbol plots (kind > 0) and the
    line color (offset 362) otherwise -- the rule the oracle verified 87/92.
    Gated on the color-group terminator byte (``0xff`` at 310); a record
    that fails it (or is too short) yields ``None``, never a guess.
    """
    if len(record) < _LINE_COLOR_OFF + 4 or record[_COLOR_TERM_OFF] != 0xFF:
        return None
    off = _SYMBOL_COLOR_OFF if record[_SYMBOL_KIND_OFF] > 0 else _LINE_COLOR_OFF
    field = struct.unpack_from("<I", record, off)[0]
    if field == _AUTO:
        return None  # auto/increment: resolved Origin-side, not decodable here
    kind = field >> 24
    if kind == 0:
        return field + 1 if field < len(ORIGIN_PALETTE) else None  # disk is 0-based
    return field if kind == 1 else None


def style_fields(record: bytes) -> dict[str, str | float]:
    """Decoded per-curve style keys from one curve-anchor record (raw ``.opj``
    payload or :func:`opju_style_record` reconstruction): any of ``color``
    (``"#RRGGBB"``), ``symbol`` (marker shape name), ``style``
    (``"line"``/``"scatter"``/``"line_symbol"``), ``lineWidth`` /
    ``symbolSize`` (points, the
    1/500-pt u16 fields at offsets 21/25 — 92/92 oracle-exact). Undecodable
    or implausible fields are simply absent, never defaulted."""
    out: dict[str, str | float] = {}
    if len(record) < _LINE_COLOR_OFF + 4:
        return out
    style = _CONNECT_STYLE.get(record[_STYLE_BYTE_OFF])
    if style:
        out["style"] = style
        if style != "scatter":
            connect = _LINE_CONNECT.get(record[_LINE_CONNECT_OFF])
            if connect:
                out["connect"] = connect
    shape = _SYMBOL_SHAPES.get(record[_SYMBOL_KIND_OFF])
    if shape:
        out["symbol"] = shape
    width500 = struct.unpack_from("<H", record, _LINE_WIDTH_OFF)[0]
    if 0 < width500 <= _PT500_MAX:
        out["lineWidth"] = width500 / 500.0
    size500 = struct.unpack_from("<H", record, _SYMBOL_SIZE_OFF)[0]
    if 0 < size500 <= _PT500_MAX:
        out["symbolSize"] = size500 / 500.0
    raw = raw_color(record)
    if raw is not None:
        rgb = ocolor_to_rgb(raw)
        if rgb:
            out["color"] = rgb
    return out


def _effective_color_field(record: bytes) -> int | None:
    """The raw u32 of the plot's effective colour field (symbol colour for
    symbol plots, line colour otherwise), or ``None`` on a short record."""
    if len(record) < _LINE_COLOR_OFF + 4:
        return None
    off = _SYMBOL_COLOR_OFF if record[_SYMBOL_KIND_OFF] > 0 else _LINE_COLOR_OFF
    return int(struct.unpack_from("<I", record, off)[0])


def apply_increment_colors(
    curves: list[dict[str, str | float]], records: list[bytes | None]
) -> None:
    """Resolve auto/increment placeholder colours in-place for one layer's
    curves (plot order). See the SYSTEM_COLOR_LIST block comment for the
    verified rule. ``records[i]`` is curve ``i``'s style record (``None``
    when unavailable). Only a curve with NO decoded ``color``, whose
    effective colour field is the exact ``0x81010151`` placeholder, and
    whose group role byte is recognized, is filled — everything else is
    left untouched (never guessed).
    """
    group_index: int | None = None  # None = not inside a group
    for curve, record in zip(curves, records, strict=True):
        if record is None or len(record) <= _GROUP_ROLE_OFF:
            group_index = None
            continue
        role = _GROUP_ROLES.get(record[_GROUP_ROLE_OFF])
        if role == "head":
            group_index = 0
        elif role == "member":
            group_index = group_index + 1 if group_index is not None else None
        else:  # standalone or unrecognized: any open group ends here
            group_index = None
        if "color" in curve or _effective_color_field(record) != _INCREMENT_PLACEHOLDER:
            continue
        if role == "standalone":
            curve["color"] = SYSTEM_COLOR_LIST[0]
        elif role in ("head", "member") and group_index is not None:
            if group_index < len(SYSTEM_COLOR_LIST):
                curve["color"] = SYSTEM_COLOR_LIST[group_index]
            # past the verified list: leave unresolved, never wrap-guess


def opju_style_record(b: bytes, tag_pos: int) -> bytes | None:
    """Reconstruct the 519-byte curve-anchor record from the CPYUA sparse
    stream whose id chunk (``80 01/03 <id>``) starts at ``tag_pos``.

    Follows the chunk grammar in the module docstring. Returns ``None``
    unless the stream demonstrably completes the record (reaches offset
    519 exactly, as every validated real stream does) -- a partial
    reconstruction could misread an unreached zero region as palette black,
    which is exactly the wrong-color failure this gate forbids."""
    buf = bytearray(_RECORD_LEN)
    pos = 1  # the id chunk's skip starts after the record's offset-0 byte
    p = tag_pos
    n = len(b)
    while p < n and pos < _RECORD_LEN:
        t = b[p]
        if 0x80 <= t <= 0xBF:  # tagged chunk: skip zeros, then literal bytes
            if p + 2 > n:
                return None
            ln = b[p + 1]
            if p + 2 + ln > n:
                return None
            pos += (t - 0x80) + 3
            payload = b[p + 2 : p + 2 + ln]
            end = min(pos + ln, _RECORD_LEN)
            if pos < _RECORD_LEN:
                buf[pos:end] = payload[: end - pos]
            pos += ln
            p += 2 + ln
        elif 0xC0 <= t <= 0xC3:  # RLE run: (t-0xc0)+3 copies of the next byte
            if p + 2 > n:
                return None
            run = (t - 0xC0) + 3
            end = min(pos + run, _RECORD_LEN)
            if pos < _RECORD_LEN:
                buf[pos:end] = bytes([b[p + 1]]) * (end - pos)
            pos += run
            p += 2
        elif 0 < t < 0x80:  # bare literal continuation
            if p + 1 + t > n:
                return None
            end = min(pos + t, _RECORD_LEN)
            if pos < _RECORD_LEN:
                buf[pos:end] = b[p + 1 : p + 1 + (end - pos)]
            pos += t
            p += 1 + t
        else:  # 0x00 / unknown escape: the stream ended before the record did
            return None
    return bytes(buf) if pos >= _RECORD_LEN else None
