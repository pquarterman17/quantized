"""Text & Numeric X-error column records enter the ``.opju`` id table
(ledger F-119, decode-plan item 68 "rise-time Graph66 ``Book56_C``").

The id record's name field carries the offset-17 designation code as a
leading literal when the code is not 0 (``82 02 <code> <name>``). The field
walk stripped only ``03`` (X) and ``02`` (Y-error), so an X-error column
(code ``06``, marker ``30 61``) never entered the table and its X-error plot
was silently dropped. Synthetic bytes use invented names; the realdata test
computes its expectation from the file at run time.
"""

from __future__ import annotations

import pytest

from origin_corpus import has_project, origin_corpus_dir
from quantized.io.origin_project.opju_column_fixed import record_code
from quantized.io.origin_project.opju_figure_curves import column_id_table, opju_pages
from test_io_origin_figures_opju import _opju_page_header

_MAGIC = b"CPYUA 4.3811 222\n"


def _tn_record(cid: int, name: str, code: int, assoc: int, marker: bytes) -> bytes:
    """A Text & Numeric column record in the sparse layout Origin writes:
    id at 4, ``<pb>`` at 6, rows at 11, code at 17 + name at 18 (one
    literal run), then offsets 30..38 (format 09 .. assoc id, marker)."""
    head = bytes([code]) + name.encode("ascii")
    tail = b"\x09\x00\x13\x00\x00" + assoc.to_bytes(2, "little") + marker
    return (
        b"\x01\x10\x80\x03"
        + cid.to_bytes(2, "little")
        + b"\x09\x81\x01\x1d"
        + bytes([0x82, len(head)])
        + head
        + bytes([0x80 + 30 - (18 + len(name)) - 3, len(tail)])
        + tail
        + b"\x89\x01\x01\x82\x01\x20"
    )


def _book(records: bytes) -> bytes:
    page = _opju_page_header("Wbk") + b"\x00" * 64 + records + b"\x00" * 64
    return _MAGIC + page + _opju_page_header("Graph1") + b"\x00" * 32


def test_x_error_record_enters_the_id_table_as_x_error() -> None:
    rec = _tn_record(20, "Dx", 6, 21, b"\x30\x61")
    assert record_code(rec, 0) == 6  # the prefix byte IS offset 17
    b = _book(rec)
    table = column_id_table(b, opju_pages(b))
    assert table.ids == {20: ("Wbk", "Dx")}
    assert 20 not in table.yerr_ids and 20 not in table.x_ids and not table.x_partner


def test_y_error_record_still_reads_y_error() -> None:
    b = _book(_tn_record(20, "Dy", 2, 21, b"\x30\x61"))
    table = column_id_table(b, opju_pages(b))
    assert table.ids == {20: ("Wbk", "Dy")} and table.yerr_ids == {20}


@pytest.mark.parametrize("marker", [b"\x21\x61", b"\x21\x51"])
def test_x_error_code_behind_a_non_error_marker_fails_closed(marker: bytes) -> None:
    b = _book(_tn_record(20, "Dx", 6, 21, marker))
    assert column_id_table(b, opju_pages(b)).ids == {}


@pytest.mark.parametrize("code", [1, 4, 5])
def test_other_codes_stay_out(code: int) -> None:
    # disregard / label / Z prefixes are not admitted by this change
    b = _book(_tn_record(20, "Q", code, 21, b"\x30\x61"))
    assert column_id_table(b, opju_pages(b)).ids == {}


_RISE = "public/MeyerJackson_Minis-JGP-2024/Figure 3 and 4 amplitude - rise time data.opju"


@pytest.mark.realdata
def test_realdata_rise_time_graph66_x_error_plots_attach() -> None:
    """Graph66 (Origin's preview: horizontal bars on both panels' points)
    plots an X-error column per layer whose record carries code 6; each
    now attaches as ``xErr`` to the curve it decorates."""
    path = origin_corpus_dir() / _RISE
    if not has_project(path):
        pytest.skip("rise-time project not present")
    from quantized.routes.parsers import _import_with_books

    b = path.read_bytes()
    table = column_id_table(b, opju_pages(b))
    payload, _ = _import_with_books(path)
    layers = [f for f in payload["figures"] if f.get("name") == "Graph66"]
    assert len(layers) == 2
    for fig in layers:
        bars = [c for c in fig["curves"] if c.get("xErr")]
        assert len(bars) == 1
        book, col = bars[0]["book"], bars[0]["xErr"]
        cids = [cid for cid, bc in table.ids.items() if bc == (book, col)]
        assert cids and all(cid not in table.yerr_ids for cid in cids)
