"""``.opju`` id chunks of every literal length (plan item 68) and the column
display range (item 71: rows above Origin's begin row are missing).

Synthetic bytes only (invented names) for the shapes; the ``realdata``
anchors check the decode against what Origin 2026b COM reported
(``%(i,@D)`` per plot, ``get <ds> -b``, per-row ``== NANUM``; 2026-11-15)
and auto-skip without the corpus.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_blocks import DatasetHeader, find_headers
from quantized.io.origin_project.opju_curve_token import CURVE_TOKEN, column_id_chunks, token_id
from quantized.io.origin_project.opju_display_range import before_begin_missing
from quantized.io.origin_project.opju_figure_curves import column_id_table, opju_pages
from quantized.io.origin_project.opju_records import DatasetRecord, decode_record
from test_io_origin_figures_opju import _column_id_record, _layer_bytes, _opju_page_header

_MAGIC = b"CPYUA 4.3811 222\n"


def _token(cid: int, length: int, flag: int = 0xBA) -> bytes:
    """A curve record whose id chunk is ``80 <length>`` (offset 4 on)."""
    lits = cid.to_bytes(2, "little") + b"\x09" + b"\x0c" * 8
    if length == 1:
        lits = bytes([cid])
    return bytes([flag, 1, 1, 1, 0x80, length]) + lits[:length] + b"\x00"


def test_token_id_reads_every_chunk_length() -> None:
    for length, cid in ((1, 0x41), (2, 0x0935), (3, 0x0935), (4, 0x0057), (9, 0x0123)):
        tok = _token(cid, length)
        m = CURVE_TOKEN.search(tok)
        assert m is not None and token_id(tok, m) == cid
    assert CURVE_TOKEN.search(bytes([0xBA, 1, 1, 1, 0x80, 0x00])) is None  # no literal


def test_token_id_runs_off_the_buffer() -> None:
    tok = bytes([0xBA, 1, 1, 1, 0x80, 0x02, 0x35])
    m = CURVE_TOKEN.search(tok)
    assert m is not None and token_id(tok, m) is None


def _wide_record(cid: int, name: str, partner: int) -> bytes:
    """A form-A column record whose id chunk is ``80 04 <id> <pb> 0c``."""
    nm = name.encode("latin1")
    return (
        b"\x80\x32\x01\x10\x80\x04"
        + cid.to_bytes(2, "little")
        + b"\x0b\x0c"
        + bytes([0x80, len(nm)])
        + nm
        + b"\x88\x01\x09\x81\x04"
        + partner.to_bytes(2, "little")
        + b"\x21\x61"
    )


def test_column_id_chunks_give_the_fields_offset() -> None:
    rec = _wide_record(0x57, "I", 1)
    [(cid, fields, width)] = column_id_chunks(rec, 0, len(rec))
    assert (cid, width) == (0x57, 4)
    assert rec[fields : fields + 2] == b"\x80\x01"


def _blob(*tokens: bytes) -> bytes:
    recs = (
        _column_id_record(1, "A", "X")
        + _column_id_record(3, "C", "Y", partner=1)
        + _wide_record(0x57, "I", 1)
    )
    layer = _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
    return (
        _MAGIC
        + _opju_page_header("WBook")
        + recs
        + _opju_page_header("Graph1")
        + layer
        + b"".join(tokens)
    )


def test_wide_column_record_enters_the_id_table() -> None:
    blob = _blob()
    table = column_id_table(blob, opju_pages(blob))
    assert table.ids[0x57] == ("WBook", "I")
    assert table.x_partner[0x57] == 1


def test_tokens_of_length_two_and_four_bind_their_curves() -> None:
    figs = extract_figures_opju(_blob(_token(3, 2), _token(0x57, 4)))
    assert [(c["book"], c["x"], c["y"]) for c in figs[0]["curves"]] == [
        ("WBook", "A", "C"),
        ("WBook", "A", "I"),
    ]


def test_unknown_id_of_a_new_length_is_still_dropped() -> None:
    figs = extract_figures_opju(_blob(_token(0x0935, 2)))
    assert figs[0]["curves"] == []


# ── item 71: the display range ────────────────────────────────────────────────


def _rec(values: list[float], first: int) -> DatasetRecord:
    h = DatasetHeader("B_C", 0, 0, 0x10, len(values), len(values), 10, 0, first_row=first)
    return DatasetRecord(h, "double", 0, values=np.array(values))


def test_rows_above_the_begin_row_are_missing() -> None:
    got = before_begin_missing(_rec([1e-58, 2e-58, 3.0, 4.0], 2))
    assert got.values is not None
    assert np.isnan(got.values[:2]).all() and list(got.values[2:]) == [3.0, 4.0]
    assert got.extra["hidden_leading_rows"] == 2


def test_begin_zero_and_past_the_end() -> None:
    rec = _rec([1.0, 2.0], 0)
    assert before_begin_missing(rec) is rec
    got = before_begin_missing(_rec([1.0, 2.0], 5))
    assert got.values is not None and np.isnan(got.values).all()


# ── realdata anchors (Origin 2026b COM, 2026-11-15) ───────────────────────────

_DWS = "origin/public/Swicano_Origin_scripts/Heat transfer simulation stuff/Discretewithsum.opju"


def _path(corpus_dir: Path, rel: str) -> Path:
    path = corpus_dir / rel
    if not path.is_file():
        pytest.skip(f"{rel} not present")
    return path


@pytest.mark.realdata
def test_realdata_begin_row_13_reads_missing_above(corpus_dir: Path) -> None:
    """Origin: ``get Mid1_I@5 -b`` = 13, rows 1-12 ``== NANUM``, 429 values."""
    b = _path(corpus_dir, _DWS).read_bytes()
    hs = {h.name: h for h in find_headers(b)}
    for name in ("Mid1_I@5", "Mid2_I@3"):
        rec = decode_record(b, hs[name])
        assert rec.values is not None
        assert hs[name].first_row == 12
        assert np.isnan(rec.values[:12]).all()
        assert int(np.isfinite(rec.values).sum()) == 429
    assert hs["Mid1_H@5"].first_row == 0  # a sibling with no begin row


@pytest.mark.realdata
def test_realdata_length_four_token_binds_mid1_i(corpus_dir: Path) -> None:
    """Origin plots ``Mid1_I@5`` in Graph1 (``80 04`` token and record)."""
    figs = extract_figures_opju(_path(corpus_dir, _DWS).read_bytes())
    g1 = next(f for f in figs if (f["name"], f["layer"]) == ("Graph1", 1))
    assert ("Mid1@5", "I") in {(c["book"], c["y"]) for c in g1["curves"]}
