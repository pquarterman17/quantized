"""``.opju`` graph-layer axis record read as the ``.opj`` layer block it is.

The ``03 00 00 1f`` / ``03 00 00 5f`` layer anchor is not a marker in front of
an axis record: it is the FIRST CHUNK of the layer record itself, written in
CPYUA's zero-eliding sparse grammar (``opju_column_fixed``,
``curve_style_color``) -- ``03`` = three literals ``00 00 1f``, the ``.opj``
layer-continuation head ``00 00 1f 00`` (``figure_layers._LAYER_HEAD_BYTES``).
Expanded, the record carries the ``.opj`` layer fields at the ``.opj``
offsets (``figure_layers._build_layer``):

```
15/23/31   f64  X from / to / major-tick step
55         u16  X scale field   (01 00 linear, 08 01 log10)
58/66/74   f64  Y from / to / major-tick step
98         u16  Y scale field   (the .opj ``_y_scale_flag``)
```

**The grammar, token by token.** ``0x01..0x7f`` = that many literal bytes;
``0x80..0xbf`` = ``t - 0x80 + 3`` zero bytes; ``0xc0..0xff`` + one byte =
that byte repeated ``t - 0xc0 + 3`` times; ``0x00`` is not a token here
(fail closed). The value "encodings" the real-form reader
(``opju_axis_real_form``) recognises are this grammar seen through one
double at a time: its "tagged compact ``8T nn``" is a zero run plus a
literal run, its ``c2``/``c3`` "RLE with a context byte" is a repeat plus
the length of the literal run that follows (which may run on into the next
field -- why that byte looked like an unexplained 01/02/03/0a).
``opju_column_fixed.expand_record`` pairs every zero run with the byte after
it as a literal count; that holds for column records but not here, where a
zero run is often followed by a repeat (``87 c3 66 ...``). This reader keeps
the tokens independent.

**Evidence (public corpus, 351 files, 2026-11-20).** Positive control: all
2,937 layer records the specimen / real-form readers decode pass this
reader's authentication, and 2,934 give the identical X/Y from/to (and,
wherever those readers have them, identical steps). Every disagreement was
checked against Origin's own saved page preview, and the fixed offsets were
right each time: ``ExtFig4`` Graph2 (both copies) X 0..2 with step 5 vs
0..32.5 (preview ticks 0..30); ``heatbudget`` Graph1 X 2459730.5..-2.6875
vs ..2459823.5 (preview: Jun..Sep 2022); ``optimal_MOI…fig5`` Graph2/Graph5
X linear vs ``08 01`` log (preview ticks 1E-4 .. 1); ``SOP_meas`` Graph4 /
Graph70 layers 3/5/11 Y linear vs ``08 01`` log (log-log parity panels whose
X is log in both readers). Negative control: none of the 222 coincidental
``03 00 00 1f/5f`` matches (no record-length prefix,
``figure_geometry.opju_anchor_has_length_prefix``) is accepted. The scale
fields at 55 and 98 are the authenticators: over the agreeing records they
read only ``01 00`` / ``00 00`` / ``08 01`` (+ one ``03 00``) and ``01 00`` /
``00 00`` / ``04 00`` / ``08 01``; every ``08 01`` the other readers isolate
is log and every ``01 00`` linear; in all 5,868 axes the step's sign is the
span's. Newly decoded records (423 that no other form reads) were checked
against previews across 12 projects (stacked / merged panels, violins,
histograms with a cumulative layer, date axes, a reversed log axis 1..1e-13,
Mott-Schottky 1e9 values): ranges and tick steps match the drawn axes.

**Use.** ``figures_opju`` tries this reader before the real-form reader (the
specimen form, which carries its own scale byte, is still tried first) and
falls back to the real-form / hybrid readers only when a record fails here.
A record is read only when it expands without an unknown token through
offset 100, opens with a layer head, both scale fields are among the values
above, every double is finite and within 1e-20..1e20 (or zero), each span
is non-empty and each step is non-zero with the span's sign. Anything else
is left to the other readers or stays undecoded (the page is then still
reported, with Origin's saved preview, by ``opju_graph_pages``). A scale
field other than ``01 00`` / ``08 01`` / ``04 01`` (Y) leaves that axis to the decade
heuristic, as ``.opj`` does.

**Y scale field ``04 01`` = log10** (admitted 2026-11-20). Over every
record-length-prefixed graph-page record of both corpora (public 351 +
owner 104), the field at 98 reads ``01 00`` / ``00 00`` / ``04 00`` /
``02 00`` (byte 99 = ``00``) or ``08 01`` / ``04 01`` (byte 99 = ``01``).
Origin 2026b's COM ``layer.y.type`` (``axis_ranges.json``) is linear for
every listed ``xx 00`` record (2,772) and log10 for every listed ``08 01``
(16) and ``04 01`` (9) record: byte 99 is the log flag, byte 98 something
else. ``04 01`` occurs only in ``figures.opju`` (falcon-sqh), 9 records,
all listed by the oracle; their X/Y from/to match it, the Y step is 1
(the value 21 of the 26 other decoded log-Y layers in the oracle projects
carry), and the saved preview draws a log Y 1e-4..10. Admitted as
``04 01`` only (not "any ``xx 01``"): no other ``xx 01`` value occurs.

**Not admitted (owner COM check wanted):** the X scale field ``02 00``
(12 records, both copies of the owner's ``Hc2 data``; no oracle) and the
Y ``02 00`` of one record (``Sample_OriginPro_ResonatorData``); the
``80 e9`` / other values some records carry at 98 (their fields then do not
sit at these offsets, or the field means something else); the embedded
(workbook-page) layer records of ``electric_field_proj_median.opju``, whose
Y block does not align.
"""

from __future__ import annotations

import math
import struct

from quantized.io.origin_project.figure_layers import _log_heuristic

__all__ = ["expand_sparse", "layer_record"]

_LENGTH = 100  # through the Y scale field
_X_FIELDS = (15, 23, 31)
_Y_FIELDS = (58, 66, 74)
_X_SCALE, _Y_SCALE = 55, 98
_X_SCALES = frozenset({b"\x01\x00", b"\x00\x00", b"\x08\x01", b"\x03\x00"})
_Y_SCALES = frozenset({b"\x01\x00", b"\x00\x00", b"\x04\x00", b"\x08\x01", b"\x04\x01"})
_LIN = b"\x01\x00"
_LOGS = frozenset({b"\x08\x01", b"\x04\x01"})  # log10 (module docstring)
_HEADS = frozenset({b"\x00\x00\x1f\x00", b"\x00\x00\x5f\x00"})

LayerRecord = tuple[float, float, float, float, bool, bool, float, float]


def expand_sparse(b: bytes, off: int, length: int) -> bytes | None:
    """The first ``length`` bytes of the sparse record starting at ``off``,
    or ``None`` when the stream ends or meets a ``00`` token first."""
    out = bytearray()
    p, n = off, len(b)
    while len(out) < length:
        if p >= n:
            return None
        t = b[p]
        if t == 0:
            return None
        if t < 0x80:
            if p + 1 + t > n:
                return None
            out += b[p + 1 : p + 1 + t]
            p += 1 + t
        elif t < 0xC0:
            out += bytes(t - 0x80 + 3)
            p += 1
        else:
            if p + 2 > n:
                return None
            out += bytes([b[p + 1]]) * (t - 0xC0 + 3)
            p += 2
    return bytes(out[:length])


def _plausible(v: float) -> bool:
    return math.isfinite(v) and (v == 0.0 or 1e-20 <= abs(v) <= 1e20)


def _axis(buf: bytes, fields: tuple[int, int, int]) -> tuple[float, float, float] | None:
    lo, hi, step = (struct.unpack_from("<d", buf, o)[0] for o in fields)
    if not all(_plausible(v) for v in (lo, hi, step)) or lo == hi or step == 0.0:
        return None
    if (hi > lo) != (step > 0):
        return None
    return lo, hi, step


def _scale(flag: bytes, lo: float, hi: float) -> bool:
    if flag in _LOGS:
        return True
    if flag == _LIN:
        return False
    return _log_heuristic(lo, hi)


def layer_record(b: bytes, anchor: int) -> LayerRecord | None:
    """``(xf, xt, yf, yt, x_log, y_log, x_step, y_step)`` of the layer record
    whose first chunk is the anchor at ``anchor``, or ``None`` (module
    docstring: every authentication must pass)."""
    buf = expand_sparse(b, anchor, _LENGTH)
    if buf is None or buf[:4] not in _HEADS:
        return None
    xs, ys = buf[_X_SCALE : _X_SCALE + 2], buf[_Y_SCALE : _Y_SCALE + 2]
    if xs not in _X_SCALES or ys not in _Y_SCALES:
        return None
    x, y = _axis(buf, _X_FIELDS), _axis(buf, _Y_FIELDS)
    if x is None or y is None:
        return None
    return (
        x[0],
        x[1],
        y[0],
        y[1],
        _scale(xs, x[0], x[1]),
        _scale(ys, y[0], y[1]),
        x[2],
        y[2],
    )
