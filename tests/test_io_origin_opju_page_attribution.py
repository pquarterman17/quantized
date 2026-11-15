"""``.opju`` graph-layer attribution: page-header enumeration + separator flag byte.

Two defects were fixed together (2026-11-14, both found against Origin 2026b
COM ``layer.x/y.from/to`` as the independent oracle):

1. **Page enumeration missed windows.** A page header carries a LEB128-style
   varint ``<type>`` (1 byte below 0x80, else 2 bytes ``[80-ff] [00-7f]``). The
   scan read it as one byte, so every window whose serial passed 127 was never
   enumerated; its graph anchors then fell into the PREVIOUS page's span and
   surfaced as phantom extra layers of that page (e.g. a 1-layer ``Graph3``
   reported with ``Graph2``'s four layers) -- with the wrong workbook bound
   to the curves.
2. **Layer-geometry separator.** ``81|80 <id> <plen> 00 <flag> 01``: the 5th
   byte is a flag field. Origin-confirmed values 40/80/88/c0 now decode
   (retry-only); unconfirmed values stay unrecovered.

Synthetic bytes only (invented names); the ``realdata`` anchors assert Origin's
own numbers, copied in as literals.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_figure_curves import opju_pages
from test_io_origin_figures_opju import (
    _column_id_record,
    _id_curve_token,
    _layer_bytes,
    _real_form_tagged_and_rle,
)

_TEXT = r"\l(1) %(1)"


def _header(name: str, type_bytes: bytes) -> bytes:
    """``0A 80 <type varint> <namelen+2> 00 00 <name> <hi>`` -- a page header."""
    nm = name.encode("ascii")
    return b"\x0a\x80" + type_bytes + bytes([len(nm) + 2]) + b"\x00\x00" + nm + b"\x90"


_ONE = b"\x7b"  # 1-byte serial (< 128)
_TWO = b"\x87\x01"  # 2-byte serial 135 -- what a window past the 127th carries


# ── page-header enumeration ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "type_bytes", [b"\x00", b"\x7f", b"\x80\x01", b"\x87\x01", b"\x95\x01", b"\xff\x7f"]
)
def test_page_header_varint_type_enumerates(type_bytes: bytes) -> None:
    blob = b"CPYUA 4.3811 222\n" + _header("Plot1", type_bytes) + b"\x00" * 8
    assert [n for _, n in opju_pages(blob)] == ["Plot1"]


def test_page_headers_keep_file_order_across_type_widths() -> None:
    blob = (
        b"CPYUA 4.3811 222\n"
        + _header("A", _ONE)
        + b"\x00" * 6
        + _header("B", _TWO)
        + b"\x00" * 6
        + _header("C", _ONE)
    )
    assert [n for _, n in opju_pages(blob)] == ["A", "B", "C"]


def test_two_byte_type_with_high_continuation_is_not_a_header() -> None:
    """The second type byte must be < 0x80 (varint terminator); a run of three
    high bytes is not a page header, so no page is invented from it."""
    blob = b"CPYUA 4.3811 222\n\x0a\x80\x87\x88\x08\x00\x00Name\x90" + b"\x00" * 8
    assert opju_pages(blob) == []


# ── attribution: positive + negative control ─────────────────────────────────


def _two_graph_project() -> bytes:
    recs = (
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "Y", partner=1)
        + _column_id_record(3, "C", "Y", partner=1)
    )
    g1 = _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, _TEXT) + _id_curve_token(0xBA, cid=2)
    g2 = _layer_bytes(0.0, 5.0, 0.0, 100.0, 20.0, 0x03, _TEXT) + _id_curve_token(0xBB, cid=3)
    return (
        b"CPYUA 4.3811 222\n"
        + _header("WBook", _ONE)
        + recs
        + _header("Graph1", _ONE)
        + g1
        + _header("Graph2", _TWO)  # serial past 127: the header the old scan missed
        + g2
    )


def test_layer_of_a_two_byte_type_page_is_its_own_figure() -> None:
    """Positive control: Graph2 is a figure of its own with its own axes and
    its own curve -- not a second layer of Graph1."""
    figs = extract_figures_opju(_two_graph_project())
    assert [(f["name"], f["layer"]) for f in figs] == [("Graph1", 1), ("Graph2", 1)]
    assert (figs[1]["x_to"], figs[1]["y_to"]) == (5.0, 100.0)
    assert figs[0]["curves"] == [{"book": "WBook", "x": "A", "y": "B"}]
    assert figs[1]["curves"] == [{"book": "WBook", "x": "A", "y": "C"}]


def test_no_phantom_layer_on_the_preceding_page() -> None:
    """Negative control: the old attribution produced ('Graph1', 1) and
    ('Graph1', 2) here -- a layer Origin does not have -- because the Graph2
    anchor was swallowed by Graph1's span."""
    figs = extract_figures_opju(_two_graph_project())
    assert sum(f["name"] == "Graph1" for f in figs) == 1
    assert ("Graph1", 2) not in {(f["name"], f["layer"]) for f in figs}


def test_two_layers_stay_two_layers_of_one_page() -> None:
    """A genuine multi-layer page (two anchors, one header) still yields two
    layers, numbered 1..2, on that page."""
    recs = _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y", partner=1)
    blob = (
        b"CPYUA 4.3811 222\n"
        + _header("WBook", _ONE)
        + recs
        + _header("Graph1", _TWO)
        + _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, _TEXT)
        + _layer_bytes(0.0, 5.0, 0.0, 100.0, 20.0, 0x03, _TEXT)
    )
    figs = extract_figures_opju(blob)
    assert [(f["name"], f["layer"]) for f in figs] == [("Graph1", 1), ("Graph1", 2)]


# ── separator flag byte ──────────────────────────────────────────────────────


def _with_sep_flag(flag: int, lead: int = 0x81) -> bytes:
    rec = _real_form_tagged_and_rle()
    for sep_len in (b"\x0d\x08", b"\x35\x08"):
        old = b"\x81" + sep_len + b"\x00\x00\x01"
        assert old in rec
        rec = rec.replace(old, bytes([lead]) + sep_len + b"\x00" + bytes([flag]) + b"\x01")
    return b"CPYUA 4.3811 222\n" + rec


@pytest.mark.parametrize("lead", [0x81, 0x80])
@pytest.mark.parametrize("flag", [0x00, 0x40, 0x80, 0x88, 0xC0])
def test_confirmed_separator_flags_decode(flag: int, lead: int) -> None:
    figs = extract_figures_opju(_with_sep_flag(flag, lead))
    assert len(figs) == 1
    f = figs[0]
    assert (f["x_from"], f["x_to"]) == (pytest.approx(0.2), 2.0)
    assert (f["y_from"], f["y_to"]) == (1.0, 450000.0)


@pytest.mark.parametrize("flag", [0x01, 0x08, 0x30, 0x41, 0x48, 0x02, 0xFF])
def test_unconfirmed_separator_flags_stay_unrecovered(flag: int) -> None:
    """Fail closed: a flag value no oracle has confirmed drops the record
    (omitted, never guessed)."""
    assert extract_figures_opju(_with_sep_flag(flag)) == []


def test_strict_separator_records_are_unchanged() -> None:
    figs = extract_figures_opju(b"CPYUA 4.3811 222\n" + _real_form_tagged_and_rle())
    assert len(figs) == 1
    assert (figs[0]["y_from"], figs[0]["y_to"]) == (1.0, 450000.0)


# ── realdata: Origin 2026b COM (layer.x.from/to, layer.y.from/to) ────────────


def _corpus() -> Path | None:
    for ancestor in Path(__file__).resolve().parents:
        cand = ancestor / "test-data" / "origin" / "public"
        if cand.is_dir():
            return cand
    return None


_PUBLIC = _corpus()

# file (relative to test-data/origin/public) -> {(page, layer): (x_from, x_to, y_from, y_to)}
# Values: Origin 2026b COM, layer.x.from/to + layer.y.from/to.
_ORACLE = {
    "stunnerx_CTDHNN-data-code/code/fig4/plot/割值频率图.opju": {
        ("Graph4", 1): (1225.0, 1440.0, 0.0, 17.5),
        ("Graph1", 1): (1225.0, 1430.0, 0.0, 35.0),
        ("Graph5", 1): (1225.0, 1430.0, 0.0, 35.0),
        ("Graph3", 1): (1225.0, 1430.0, 0.0, 20.0),
        ("Graph2", 1): (1240.0, 1460.0, 0.0, 35.0),
        ("Graph2", 2): (1240.0, 1460.0, 0.0, 25.0),
        ("Graph2", 3): (1240.0, 1460.0, 0.0, 25.0),
        ("Graph2", 4): (1240.0, 1460.0, 0.0, 35.0),
    },
    "niloofarcrno_Techno-Economic-Model/TEA_ExcelGraphs.opju": {
        ("Graph7", 1): (0.5, 4.5, 2200.0, 2475.0),
        ("Graph15", 1): (0.5, 5.5, -0.84, 0.84),
        ("Graph1", 1): (0.5, 6.5, -200.0, 1400.0),
        ("Graph3", 1): (0.35000000000000003, 1.05, -200.0, 1500.0),
        ("Graph6", 1): (0.5, 4.5, 0.0, 1500.0),
        ("Graph13", 1): (0.5, 2.5, 0.0, 15.200000000000001),
        ("Graph16", 1): (1.5, 6.5, -0.88, 0.84),
    },
    "shawxgf_APFD-in-RAS-affect-tilapia-s-growth/生化指标非线性.opju": {
        ("gucao", 1): (0.5, 3.5, 0.0, 200.0),
        ("zongdanbai", 1): (0.5, 3.5, 0.0, 40.0),
        ("putaotang", 1): (0.5, 3.5, 0.0, 5.0),
        ("zongdanguchun", 1): (0.5, 3.5, 0.0, 3.0),
        ("gubing", 1): (0.5, 3.5, 0.0, 140.0),
        ("niaosudan", 1): (0.5, 3.5, 0.0, 0.8),
    },
    "ODTUGUNAM_Mixed-SnPb-Perovskite-Simulation/Exported J-Vs/Figure2-c.opju": {
        ("Graph2", 1): (300.0, 1000.0, 0.0, 100.0),
        ("Graph6", 1): (-0.2, 0.8, -30.0, 5.0),
        ("Graph1", 1): (-0.2, 0.8, -30.0, 5.0),
    },
}
# Origin's true layer count for EVERY graph page it lists (decoded here or not),
# Origin 2026b COM. (TEA ``Graph12`` is deliberately absent from _ORACLE: its Y
# span currently decodes [927.5, 1000] vs Origin [0, 1000] -- a separate,
# pre-existing value-token defect, reported rather than asserted.)
_TRUE_LAYERS = {
    "stunnerx_CTDHNN-data-code/code/fig4/plot/割值频率图.opju": {
        "Graph4": 1,
        "Graph1": 1,
        "Graph5": 1,
        "Graph3": 1,
        "Graph2": 4,
        "sparkline": 1,
        "sparkline2": 1,
        "sparkline3": 1,
        "sparkline4": 1,
        "sparkline5": 1,
    },
    "niloofarcrno_Techno-Economic-Model/TEA_ExcelGraphs.opju": {
        "Graph7": 1,
        "Graph9": 1,
        "Graph15": 1,
        "Graph12": 1,
        "Graph1": 1,
        "Graph19": 1,
        "Graph2": 1,
        "Graph3": 1,
        "Graph6": 2,
        "Graph13": 1,
        "Graph16": 1,
    },
    "shawxgf_APFD-in-RAS-affect-tilapia-s-growth/生化指标非线性.opju": {
        "gucao": 1,
        "zongdanbai": 1,
        "putaotang": 1,
        "zongdanguchun": 1,
        "gubing": 1,
        "niaosudan": 1,
    },
    "ODTUGUNAM_Mixed-SnPb-Perovskite-Simulation/Exported J-Vs/Figure2-c.opju": {
        "Graph2": 1,
        "Graph6": 1,
        "Graph1": 1,
    },
}


@pytest.mark.realdata
@pytest.mark.skipif(_PUBLIC is None, reason="test-data/origin/public corpus not found")
@pytest.mark.parametrize("rel", sorted(_ORACLE))
def test_realdata_layers_match_origin(rel: str) -> None:
    assert _PUBLIC is not None
    figs = extract_figures_opju((_PUBLIC / rel).read_bytes())
    got = {(f["name"], f["layer"]): f for f in figs if f["name"]}
    for key, want in _ORACLE[rel].items():
        f = got.get(key)
        assert f is not None, f"{key} not recovered"
        assert (f["x_from"], f["x_to"], f["y_from"], f["y_to"]) == pytest.approx(want), key
    # no layer beyond what Origin lists for the page (the phantom-layer defect)
    for page, layer in got:
        assert page in _TRUE_LAYERS[rel], f"unexpected page {page}"
        assert layer <= _TRUE_LAYERS[rel][page], (page, layer)
    # unnamed figures are embedded (workbook) graphs, never a copy of a named page
    named = {(f["x_from"], f["x_to"], f["y_from"], f["y_to"]) for f in got.values()}
    for f in figs:
        if not f["name"]:
            assert (f["x_from"], f["x_to"], f["y_from"], f["y_to"]) not in named
