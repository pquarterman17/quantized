"""Graphs embedded in a ``.opju`` workbook (fit-report / sparkline graphs) and
the page attribution of layer anchors (``opju_embedded_graphs``,
``opju_layer_pages``). Synthetic; the corpus / COM-oracle check is
``test_io_origin_opju_embedded_graphs_corpus``."""

from __future__ import annotations

from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_embedded_graphs import (
    embedded_graphs,
    unrecovered_embedded_graphs,
)
from quantized.io.origin_project.tree_opju import window_name_at
from test_io_origin_figures_opju import _column_id_record
from test_io_origin_opju_layer_record import _encode, _layer
from test_io_origin_opju_page_attribution import _ONE, _header

_HEAD = b"CPYUA 4.3811 222\n"
_COLS = _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y", partner=1)


def _embedded(name: str, after: bytes = b"\x0c") -> bytes:
    """An embedded graph header as a report sheet stores it (``40 80 7f``
    lead, ``<namelen+2> 00 00 <name> <trail>``, then ``0c``)."""
    nm = name.encode("ascii")
    return b"\x11\x40\x80\x7f" + bytes([len(nm) + 2]) + b"\x00\x00" + nm + b"\x8d" + after


def _record() -> bytes:
    return b"\xb9\x01" + _encode(_layer()) + b"\x00" * 64


def test_window_name_at_returns_the_trail() -> None:
    b = b"\x00\x00Graph1\x90\x0c"
    assert window_name_at(b, 2, 8) == ("Graph1", 8)
    run = b"\x00\x00Graph\xc0\x31\x8e"  # Graph111, run escape
    assert window_name_at(run, 2, 7) == ("Graph111", 9)


def test_embedded_headers_inside_a_workbook_are_found() -> None:
    book = _header("Book1", _ONE) + _COLS
    b = (
        _HEAD
        + book
        + _embedded("FitLine")
        + b"\x00" * 8
        + _embedded("Residual2")
        + _embedded("FitLine")  # second copy: first occurrence only
        + _header("Graph1", _ONE)
        + b"\x00" * 8
    )
    got = embedded_graphs(b)
    assert [(e.name, e.host) for e in got] == [("FitLine", "Book1"), ("Residual2", "Book1")]
    assert unrecovered_embedded_graphs(b, {"FitLine"}) == (
        1,
        [{"page_name": "Residual2", "host_book": "Book1"}],
    )


def test_embedded_header_gates_fail_closed() -> None:
    book = _header("Book1", _ONE) + _COLS
    for bad in (
        _embedded("FitLine", after=b"\x0d"),  # no 0c after the trail
        b"\x06\x53\x28\x03\x00\x00z\x95\x29",  # a 1-character name (data)
        _embedded("Book1"),  # the host itself
        _embedded("Graph1"),  # one of the project's own pages
    ):
        b = _HEAD + book + bad + _header("Graph1", _ONE) + b"\x00" * 8
        assert embedded_graphs(b) == [], bad
    # a graph page's span is never scanned
    b = _HEAD + _header("Book1", _ONE) + _COLS + _header("Graph1", _ONE) + _embedded("FitLine")
    assert embedded_graphs(b) == []


def test_embedded_record_still_reads_with_the_older_readers_only() -> None:
    """Naming does not change which reader runs: a workbook-page record only
    the fixed-offset reader decodes stays undecoded (fail closed), with or
    without an embedded header before it."""
    book = _header("Book1", _ONE) + _COLS
    assert extract_figures_opju(_HEAD + book + _embedded("FitLine3") + _record()) == []


def test_layer_ordinals_restart_per_embedded_header() -> None:
    from quantized.io.origin_project.opju_figure_curves import column_id_table, opju_pages
    from quantized.io.origin_project.opju_layer_pages import LayerPages

    book = _header("Book1", _ONE) + _COLS
    pre = _HEAD + book + b"\x00" * 4
    a0 = len(pre)
    mid = pre + b"\x00" * 4 + _embedded("FitLine")
    a1 = len(mid)
    tail = mid + b"\x00" * 4 + _embedded("sparkline2")
    a2 = len(tail)
    b = tail + b"\x00" * 8
    pages = opju_pages(b)
    lp = LayerPages(b, pages, column_id_table(b, pages).book_pages, frozenset(), False)
    assert [lp.name_layer(a, lp.page_of(a)) for a in (a0, a1, a1 + 1, a2)] == [
        ("", 1),
        ("FitLine", 1),
        ("FitLine", 2),
        ("sparkline2", 1),
    ]


def test_id_table_less_stream_names_its_cart_pages() -> None:
    """No column-id table: a page whose span holds ``_cart_object`` is a
    graph page (named, numbered); a page without one keeps ""/1."""
    rec = _record()
    graph = _HEAD + _header("Plot1", _ONE) + b"_cart_object\x00" + rec
    figs = extract_figures_opju(graph)
    assert [(f["name"], f["layer"], f["x_to"]) for f in figs] == [("Plot1", 1, 10.0)]
    plain = _HEAD + _header("Data1", _ONE) + b"\x00" * 16 + rec
    assert [(f["name"], f["layer"]) for f in extract_figures_opju(plain)] == [("", 1)]


def test_manifest_reports_filtered_pages_and_embedded_graphs() -> None:
    """The import census: a graph page whose only decoded layer is filtered
    (no curves, no source) is still reported as unrecovered, and a workbook's
    embedded graph header is listed under ``embedded_graphs``."""
    from quantized.io.origin_project.import_manifest import origin_figures_and_fidelity

    b = (
        _HEAD
        + _header("Book1", _ONE)
        + _COLS
        + _embedded("FitLine1")
        + b"\x00" * 8
        + _header("Plot1", _ONE)
        + b"\x00\x0c_cart_object\x00"
        + _record()
    )
    assert [f["name"] for f in extract_figures_opju(b)] == ["Plot1"]  # decoded...
    figs, manifest = origin_figures_and_fidelity(b, ".opju", books=[])
    assert figs == []  # ...but filtered, so not imported
    assert [f["name"] for f in manifest["filtered_figures"]] == ["Plot1"]
    assert manifest.get("unrecovered_graph_count") == 1
    assert [g["page_name"] for g in manifest.get("unrecovered_graphs", [])] == ["Plot1"]
    assert manifest.get("embedded_graph_count") == 1
    assert manifest.get("embedded_graphs") == [{"page_name": "FitLine1", "host_book": "Book1"}]
