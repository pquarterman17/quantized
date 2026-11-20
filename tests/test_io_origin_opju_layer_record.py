"""``opju_layer_record``: the ``.opju`` layer axis record read as the sparse-
encoded ``.opj`` layer block (synthetic; the corpus check is
``test_io_origin_opju_layer_record_corpus``)."""

from __future__ import annotations

import struct

import pytest

from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_layer_record import expand_sparse, layer_record
from test_io_origin_figures_opju import _column_id_record
from test_io_origin_opju_page_attribution import _ONE, _header


def _encode(buf: bytes) -> bytes:
    """A sparse token stream for ``buf``: zero runs of 3+ as ``0x80+k``,
    other runs of 3+ as ``0xc0+k <b>``, the rest as literal runs."""
    out = bytearray()
    lit = bytearray()
    i = 0

    def flush() -> None:
        while lit:
            out.append(min(len(lit), 0x7F))
            out.extend(lit[:0x7F])
            del lit[:0x7F]

    while i < len(buf):
        j = i
        while j < len(buf) and buf[j] == buf[i] and j - i < 66:
            j += 1
        run = j - i
        if run >= 3:
            flush()
            out += bytes([0x80 + run - 3]) if buf[i] == 0 else bytes([0xC0 + run - 3, buf[i]])
            i = j
        else:
            lit.append(buf[i])
            i += 1
    flush()
    return bytes(out)


def _layer(
    x: tuple[float, float, float] = (0.0, 10.0, 2.0),
    y: tuple[float, float, float] = (-1.0, 1.0, 0.5),
    xs: bytes = b"\x01\x00",
    ys: bytes = b"\x01\x00",
    head: int = 0x1F,
) -> bytes:
    buf = bytearray(120)
    buf[2] = head
    struct.pack_into("<3d", buf, 15, *x)
    struct.pack_into("<3d", buf, 58, *y)
    buf[55:57] = xs
    buf[98:100] = ys
    buf[100:110] = b"\x11" * 10  # trailing fields
    return bytes(buf)


def test_grammar_tokens() -> None:
    # literal run, zero run, repeat -- and a zero run directly followed by a
    # repeat (``87 c3 66``), which a "zero run + literal count" reading misparses
    stream = bytes([0x02, 0xAA, 0xBB, 0x81, 0xC3, 0x66, 0x01, 0x3F])
    assert expand_sparse(stream, 0, 13) == b"\xaa\xbb" + bytes(4) + b"\x66" * 6 + b"\x3f"
    assert expand_sparse(stream, 0, 14) is None  # stream ends first
    assert expand_sparse(bytes([0x01, 0x05, 0x00, 0x01]), 0, 3) is None  # a 00 token


@pytest.mark.parametrize(
    ("xs", "ys", "x_log", "y_log"),
    [
        (b"\x01\x00", b"\x01\x00", False, False),
        (b"\x08\x01", b"\x08\x01", True, True),
    ],
)
def test_layer_record_fields(xs: bytes, ys: bytes, x_log: bool, y_log: bool) -> None:
    b = b"\xb9\x01" + _encode(_layer(xs=xs, ys=ys))
    assert layer_record(b, 2) == (0.0, 10.0, -1.0, 1.0, x_log, y_log, 2.0, 0.5)


def test_unknown_scale_field_falls_back_to_heuristic() -> None:
    rec = _layer(x=(1.0, 1e5, 1.0), xs=b"\x00\x00", ys=b"\x00\x00")
    got = layer_record(_encode(rec), 0)
    assert got is not None and got[4] is True and got[5] is False


def test_reversed_axis_is_read() -> None:
    got = layer_record(_encode(_layer(x=(1800.0, 1000.0, -100.0))), 0)
    assert got is not None and got[:2] == (1800.0, 1000.0) and got[6] == -100.0


@pytest.mark.parametrize(
    "rec",
    [
        _layer(xs=b"\x80\xe9"),  # unadmitted scale field
        _layer(ys=b"\x04\x01"),
        _layer(x=(0.0, 10.0, -2.0)),  # step against the span
        _layer(y=(1.0, 1.0, 0.5)),  # empty span
        _layer(y=(0.0, 1.0, 0.0)),  # no step
        _layer(y=(0.0, 1e300, 1.0)),  # implausible value
        _layer(head=0x20),  # not a layer head
    ],
)
def test_layer_record_fails_closed(rec: bytes) -> None:
    assert layer_record(_encode(rec), 0) is None


def test_extract_figures_reads_record_no_other_form_decodes() -> None:
    """A lone anchor whose record only this reader decodes becomes a figure
    (legacy stream: no id table, so unnamed, layer 1)."""
    b = b"\x00" * 16 + b"\xb9\x01" + _encode(_layer()) + b"\x00" * 64
    figs = extract_figures_opju(b)
    assert len(figs) == 1
    f = figs[0]
    got = (f["x_from"], f["x_to"], f["y_from"], f["y_to"], f["x_step"], f["y_step"])
    assert got == (0.0, 10.0, -1.0, 1.0, 2.0, 0.5)
    assert (f["x_log"], f["y_log"]) == (False, False)


def test_record_on_a_workbook_page_is_not_read() -> None:
    """Fixed offsets are read on GRAPH pages only. A workbook page's embedded
    graphs (owner corpus: one per book, X spanning the ROW count, Y a column's
    range) would otherwise become figures whose curve binds a column as X,
    which they do not plot -- so a book-page record stays with the older
    readers (none of which reads this one), exactly as before."""
    recs = _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y", partner=1)
    rec = b"\xb9\x01" + _encode(_layer()) + b"\x00" * 64
    head = b"CPYUA 4.3811 222\n" + _header("WBook", _ONE) + recs
    assert extract_figures_opju(head + rec) == []
    figs = extract_figures_opju(head + _header("Graph1", _ONE) + rec)
    assert [(f["name"], f["layer"], f["x_to"], f["y_to"]) for f in figs] == [
        ("Graph1", 1, 10.0, 1.0)
    ]
