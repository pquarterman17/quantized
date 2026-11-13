"""The structural ``.opju`` worksheet reader (``opju_blocks`` / ``opju_values``
/ ``opju_records`` / ``opju_worksheet`` / ``opju_matrix``) on SYNTHETIC bytes.

Every fixture is built by ``tests/opju_fixture.py`` from the documented layout
(docs/origin_project_format.md §3.5-§3.6) — no real project bytes or values
are committed. The same rules are checked against real third-party projects,
cell for cell, by ``test_io_origin_opju_public_corpus.py`` (``realdata``).
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest

from opju_fixture import (
    CELLS_END,
    block,
    cell_num,
    cell_text,
    dataset,
    fpc,
    header,
    heap,
    project,
    rle,
    run_num,
    run_text,
    seg_fpc,
    seg_repeat,
    spec,
    varint,
    zz,
)
from quantized.io.origin_project import (
    OriginProjectError,
    read_origin_books,
    read_origin_project,
)
from quantized.io.origin_project.opju_blocks import find_headers, lz4_block, rle_expand
from quantized.io.origin_project.opju_codec import scan_columns
from quantized.io.origin_project.opju_matrix import matrix_geometry
from quantized.io.origin_project.opju_records import scan_records
from quantized.io.origin_project.opju_values import read_segments, read_value
from quantized.io.origin_project.opju_worksheet import scan_worksheet

TN, DBL, CPLX, INT = 0x61, 0x60, 0x62, 0x68  # header byte 0x17 storage classes


def _tn(name: str, cells: bytes, *, total: int, used: int, **kw: object) -> bytes:
    return dataset(name, cells + CELLS_END, kind=TN, total=total, used=used, size=10, **kw)  # type: ignore[arg-type]


def _one(blob: bytes, name: str):  # type: ignore[no-untyped-def]
    return next(r for r in scan_records(blob) if r.header.name == name)


# ── run-length blocks and the column header ──────────────────────────────────


def test_rle_expand_literal_zero_and_fill_runs() -> None:
    tokens = bytes([0x02, 0xAA, 0xBB, 0x80, 0xC1, 0xFF, 0x01, 0x07, 0x85])
    assert rle_expand(tokens, 0, len(tokens)) == b"\xaa\xbb" + bytes(
        3
    ) + b"\xff" * 4 + b"\x07" + bytes(8)
    raw = bytes(range(1, 40)) + bytes(70) + b"\x22" * 16 + b"tail"
    assert rle_expand(rle(raw), 0, len(rle(raw))) == raw


@pytest.mark.parametrize(
    "tokens",
    [
        bytes([0x05, 0x01, 0x02]),  # literal count runs past the stream
        bytes([0x00]),  # a zero literal count is not a token
        bytes([0xC0]),  # fill run with no fill byte
    ],
)
def test_rle_expand_rejects_malformed_streams(tokens: bytes) -> None:
    assert rle_expand(tokens, 0, len(tokens)) is None


def test_lz4_block_literals_matches_and_overlap() -> None:
    # 4 literals "abcd", then a match (offset 4, length 8) that overlaps its
    # own output, then 2 trailing literals — the published block format.
    src = bytes([0x44]) + b"abcd" + bytes([0x04, 0x00]) + bytes([0x20]) + b"xy"
    assert lz4_block(src, 14) == b"abcdabcdabcdxy"
    assert lz4_block(src, 13) is None  # wrong expected size
    assert lz4_block(bytes([0x10, 0x41, 0x09, 0x00]), 6) is None  # offset before start


def test_find_headers_reads_fields_and_the_whole_run_length_coded_name() -> None:
    # "runQ444z_A" (invented) holds a run of three '4' — the header codes it as a
    # fill run, so the name's tail ("z_A") is its own length-prefixed literal.
    blob = project(
        _tn("runQ444z_A", run_num(4, seg_fpc([1.5, 2.5, 4.0, 8.5])), total=4, used=4)
    )
    (h,) = find_headers(blob)
    assert (h.name, h.total_rows, h.used_rows, h.value_size) == ("runQ444z_A", 4, 4, 10)
    assert h.is_column and not h.unsigned
    # The frozen marker scan labels the same record by the nearest
    # length-prefixed name and so loses the head of it …
    assert [n for n, _ in scan_columns(blob)] == ["z_A"]
    # … the worksheet scan names it from the header.
    scan = scan_worksheet(blob)
    assert [n for n, _ in scan.columns] == ["runQ444z_A"]


def test_find_headers_ignores_blocks_that_are_not_147_byte_headers() -> None:
    not_header = block(b"\x00\x00Book1\x00" + bytes(60))  # a window-style block
    blob = project(_tn("Book1_A", cell_num(1.0), total=1, used=1), tail=not_header)
    assert [h.name for h in find_headers(blob)] == ["Book1_A"]


# ── value-specs and segment lists ────────────────────────────────────────────


@pytest.mark.parametrize("n", range(1, 9))
def test_value_spec_tag_is_8_plus_9n_top_bytes(n: int) -> None:
    raw = bytes(8 - n) + bytes(range(0x11, 0x11 + n - 1)) + b"\x40"
    (value,) = struct.unpack("<d", raw)
    tag = 8 + 9 * n
    encoded = bytes([tag]) + raw[8 - n :]
    assert encoded == spec(value)  # the fixture encoder agrees on minimality
    assert read_value(encoded, 0) == (value, 1 + n)


def test_value_spec_bare_tags_and_missing_literal() -> None:
    assert read_value(b"\x64", 0) == (0.0, 1)
    got = read_value(b"\x65", 0)
    assert got is not None and np.isnan(got[0]) and got[1] == 1
    sentinel = b"\x50" + bytes.fromhex("0e2c131cfe74aa81")
    lit = read_value(sentinel, 0)
    assert lit is not None and np.isnan(lit[0]) and lit[1] == 9


@pytest.mark.parametrize("tag", [0x00, 0x08, 0x0C, 0x10, 0x12, 0x51, 0x59, 0x63, 0x66, 0xFF])
def test_value_spec_rejects_every_other_tag(tag: int) -> None:
    assert read_value(bytes([tag]) + bytes(8), 0) is None


def test_segments_fpc_repeat_and_single_literal_row() -> None:
    burst = [0.25, 0.5, 0.75]
    body = seg_fpc(burst) + seg_repeat(4, 2.0) + zz(-1) + spec(7.125) + seg_repeat(2, float("nan"))
    got = read_segments(body, 0, 10)
    assert got is not None
    values, end = got
    assert end == len(body)
    assert np.array_equal(
        values, [*burst, 2.0, 2.0, 2.0, 2.0, 7.125, np.nan, np.nan], equal_nan=True
    )


def test_segments_reject_what_is_not_positively_identified() -> None:
    assert read_segments(zz(-2) + spec(1.0) + spec(2.0), 0, 2) is None  # literal rows: only −1
    assert read_segments(seg_repeat(3, 1.0), 0, 2) is None  # overruns the row count
    assert read_segments(zz(2) + b"\x66", 0, 2) is None  # unknown tag
    assert read_segments(zz(0), 0, 1) is None  # empty segment


def test_segments_complex_rows_are_pairs() -> None:
    # two complex rows = ONE stream of four doubles, counted as −2 rows
    body = zz(-2) + fpc([1.5, 0.5, -1.5, 3.5]) + seg_repeat(3, float("nan"), 0.0)
    got = read_segments(body, 0, 5, width=2)
    assert got is not None
    pairs = got[0].reshape(5, 2)
    assert np.array_equal(pairs[:2], [[1.5, 0.5], [-1.5, 3.5]])
    assert np.isnan(pairs[2:, 0]).all() and not pairs[2:, 1].any()


# ── records, by storage class ────────────────────────────────────────────────


def test_text_numeric_short_column_literal_cells_then_empty_run() -> None:
    """The form that used to raise "no worksheet columns": three literal
    cells, then 29 empty cells (a text run of reference 0)."""
    cells = cell_num(1.0) + cell_num(2.0) + cell_num(3.0) + run_text(29, zz(29) + varint(0))
    rec = _one(project(_tn("Book1_A", cells, total=32, used=3)), "Book1_A")
    assert rec.decoded and rec.confidence == "length_checked"
    assert rec.values is not None and rec.values.tolist() == [1.0, 2.0, 3.0]
    assert rec.text is None


def test_text_numeric_leading_empty_rows_are_nan_not_zero() -> None:
    cells = (
        run_text(4, zz(4) + varint(0))
        + cell_num(7.0)
        + cell_num(8.0)
        + run_text(2, zz(2) + varint(0))
    )
    rec = _one(project(_tn("Book1_A@2", cells, total=8, used=6)), "Book1_A@2")
    assert rec.values is not None
    assert np.array_equal(rec.values, [np.nan] * 4 + [7.0, 8.0], equal_nan=True)


def test_text_numeric_mixed_cells_resolve_through_the_string_heap() -> None:
    attach, refs = heap(["first", "last", "ünïcode"])
    cells = (
        cell_text(refs["first"])
        + cell_num(5.5)
        + run_text(3, zz(-2) + varint(refs["ünïcode"]) + varint(0) + zz(1) + varint(refs["last"]))
    )
    blob = project(_tn("Book2_B", cells, total=5, used=5, mode=4, attach=attach))
    rec = _one(blob, "Book2_B")
    assert rec.decoded
    assert rec.values is not None
    assert np.array_equal(rec.values, [np.nan, 5.5, np.nan, np.nan, np.nan], equal_nan=True)
    assert rec.text == ["first", "", "ünïcode", "", "last"]


def test_string_heap_is_found_among_other_attachments_and_at_any_size() -> None:
    """Real columns carry other named attachments before the heap, and a heap
    over 127 bytes has a two-byte length — both must still resolve."""
    words = [f"category number {i:02d}" for i in range(12)]  # a 240-byte heap
    system = b"\x0bSYSTEM\x03\x00\x8e\x02\x01\x00\x00\x00"
    attach, refs = heap(words, before=system)
    assert attach[0] & 0x80  # the block length itself needs two bytes
    picks = (words[11], words[0], words[5])
    cells = run_text(3, zz(-3) + b"".join(varint(refs[w]) for w in picks))
    rec = _one(project(_tn("Cat_A", cells, total=3, used=3, mode=4, attach=attach)), "Cat_A")
    assert rec.text == list(picks)
    # a heap lying beyond the attachment's DECLARED length is not borrowed
    short = varint(4) + attach[2:]
    lost = _one(project(_tn("Cat_A", cells, total=3, used=3, mode=4, attach=short)), "Cat_A")
    assert lost.text is None and lost.extra["text_unresolved"] == 3


def test_text_numeric_unresolvable_text_is_reported_not_invented() -> None:
    cells = cell_text(9) + cell_num(1.0)  # reference 9, but no heap follows
    rec = _one(project(_tn("Book2_A", cells, total=2, used=2, mode=4)), "Book2_A")
    assert rec.decoded and rec.text is None and rec.extra["text_unresolved"] == 1
    scan = scan_worksheet(project(_tn("Book2_A", cells, total=2, used=2, mode=4)))
    assert scan.fidelity["text_unresolved"] == {"count": 1, "examples": ["Book2_A"]}


def test_text_numeric_numeric_run_then_later_cells_are_all_read() -> None:
    """The marker scan stopped at the first numeric run; the record goes on."""
    first, second = [1.0, 1.5, 2.25, 3.0], [10.0, 11.5, 13.25]
    cells = (
        run_num(4, seg_fpc(first)) + run_text(1, zz(1) + varint(0)) + run_num(3, seg_fpc(second))
    )
    blob = project(_tn("Book1_B", cells, total=8, used=8))
    assert scan_columns(blob)[0][1].tolist() == first  # frozen: first run only
    (col,) = scan_worksheet(blob).columns
    assert np.array_equal(col[1], [*first, np.nan, *second], equal_nan=True)


@pytest.mark.parametrize(
    ("cells", "kw", "why"),
    [
        (cell_num(1.0) + cell_num(2.0), {"length": 99}, "declared length"),
        (b"\x02\x00" + spec(1.0) + cell_num(2.0), {}, "unknown cell kind"),
        (b"\xff\xff\x02\x07" + cell_num(2.0), {}, "unknown cell-run kind"),
        (b"\x00\x00\x66" + bytes(8) + cell_num(2.0), {}, "unknown value tag"),
    ],
)
def test_text_numeric_negative_controls_are_undecoded_with_a_reason(
    cells: bytes, kw: dict[str, int], why: str
) -> None:
    rec = _one(project(_tn("Book1_A", cells, total=2, used=2, **kw)), "Book1_A")
    assert not rec.decoded and rec.values is None
    assert why in (rec.reason or "")


def test_text_numeric_without_terminator_is_undecoded() -> None:
    body = cell_num(1.0) + cell_num(2.0)  # no `ce fa`
    blob = project(dataset("Book1_A", body, kind=TN, total=2, used=2, size=10))
    assert "ce fa" in (_one(blob, "Book1_A").reason or "")


def test_double_column_trailing_missing_run_and_used_extent() -> None:
    data = [0.5236, 2463044.59, 3.0]
    body = seg_fpc(data) + seg_repeat(29, float("nan"))
    rec = _one(project(dataset("Book1_A", body, kind=DBL, total=32, used=3, size=8)), "Book1_A")
    assert rec.form == "double" and rec.confidence == "length_checked"
    assert rec.values is not None and rec.values.tolist() == data


def test_stale_cells_beyond_the_used_extent_are_never_data() -> None:
    """Origin leaves old cells behind when a column shrinks: the allocated
    rows past the used-row extent still hold values (here 3 of 4)."""
    stale = [float(v) for v in (-7.5, 3.25, 1.5, 9.0)]
    blob = project(_tn("Shrunk_A@3", run_num(4, seg_fpc(stale)), total=4, used=1))
    rec = _one(blob, "Shrunk_A@3")
    assert rec.values is not None and rec.values.tolist() == [-7.5]
    assert rec.extra["stale_cells"] == 3
    assert scan_columns(blob)[0][1].tolist() == stale  # what the marker scan emitted
    assert scan_worksheet(blob).fidelity["stale_cells_beyond_extent"] == {
        "count": 1,
        "examples": ["Shrunk_A@3"],
    }


def test_complex_column_keeps_real_part_and_reports_imaginary() -> None:
    body = zz(-2) + fpc([1.5, 0.5, -1.5, 3.5]) + seg_repeat(2, float("nan"), 0.0)
    blob = project(dataset("Book1_J", body, kind=CPLX, total=4, used=2, size=16))
    rec = _one(blob, "Book1_J")
    assert rec.values is not None and rec.values.tolist() == [1.5, -1.5]
    assert np.array_equal(rec.extra["imaginary"], [0.5, 3.5])  # type: ignore[arg-type]
    assert scan_worksheet(blob).fidelity["complex_imaginary_omitted"]["count"] == 1  # type: ignore[index]


@pytest.mark.parametrize(
    ("size", "flags", "kind", "raw", "expect"),
    [
        (4, 0, DBL, struct.pack("<3f", 1.5, 10000.0, 0.0), [1.5, 10000.0, 0.0]),
        (2, 0, INT, struct.pack("<3h", 1, -1, 0), [1.0, -1.0, 0.0]),
        (2, 8, INT, struct.pack("<3H", 1, 65535, 0), [1.0, 65535.0, 0.0]),
        (1, 0, INT, struct.pack("<3b", 1, -1, 0), [1.0, -1.0, 0.0]),
        (1, 8, INT, struct.pack("<3B", 1, 255, 0), [1.0, 255.0, 0.0]),
        (4, 0, INT, zz(1) + zz(-1) + zz(0), [1.0, -1.0, 0.0]),
        (4, 8, INT, varint(1) + varint(0xFFFFFFFF) + varint(0), [1.0, 4294967295.0, 0.0]),
    ],
)
def test_fixed_width_and_varint_integer_columns(
    size: int, flags: int, kind: int, raw: bytes, expect: list[float]
) -> None:
    zero = raw[-(len(raw) // 3) :] if not (kind == INT and size == 4) else raw[-1:]
    body = zz(-3) + raw + zz(5) + zero  # 3 elements, then 5 copies of the zero element
    blob = project(
        dataset("Book1_C", body, kind=kind, total=8, used=2, size=size, flags=flags, length=False)
    )
    rec = _one(blob, "Book1_C")
    assert rec.decoded and rec.confidence == "grammar_only"
    assert rec.values is not None and rec.values.tolist() == expect[:2]


def test_text_column_rows_are_length_prefixed() -> None:
    body = b"\x05first\x04last" + bytes(12)
    blob = project(dataset("Text_A", body, kind=DBL, total=14, used=2, size=50, length=False))
    rec = _one(blob, "Text_A")
    assert rec.form == "text" and rec.values is None and rec.text == ["first", "last"]
    over = b"\x40" + b"x" * 0x40 + bytes(13)  # a cell wider than the column
    bad = project(dataset("Text_A", over, kind=DBL, total=14, used=1, size=50, length=False))
    assert not _one(bad, "Text_A").decoded


def test_pre_4_33_record_has_no_length_block_and_is_grammar_only() -> None:
    cells = run_num(3, seg_fpc([10.0, 20.5, 31.25])) + run_text(2, zz(2) + varint(0))
    blob = project(_tn("Old_A", cells, total=5, used=3, length_block=False))
    rec = _one(blob, "Old_A")
    assert rec.decoded and rec.confidence == "grammar_only"
    assert rec.values is not None and rec.values.tolist() == [10.0, 20.5, 31.25]
    fid = scan_worksheet(blob).fidelity
    assert fid["confidence"] == {"grammar_only": 1}


def test_grammar_only_record_must_still_be_plausible_but_length_checked_need_not() -> None:
    tiny = [3.3e-305, 7.1e-303, 4.4e-298]  # tiny, but legitimate doubles
    cells = run_num(3, seg_fpc(tiny))
    checked = _one(project(_tn("G_A", cells, total=3, used=3)), "G_A")
    assert checked.decoded and checked.values is not None and checked.values.tolist() == tiny
    unchecked = _one(project(_tn("G_A", cells, total=3, used=3, length_block=False)), "G_A")
    assert not unchecked.decoded and "plausible" in (unchecked.reason or "")


def test_record_rows_must_match_the_header_and_virtual_datasets_are_named() -> None:
    body = bytes([5]) + varint(1) + b"24.6+1.9*x\x00"  # a function dataset, not a column
    blob = b"CPYUA 4.3380 188\n" + block(header("F1", kind=DBL, total=10, used=10, size=15))
    blob += b"\x18" + (24).to_bytes(8, "little") + b"\x22" * 16 + b"\x0a" + body
    (rec,) = scan_records(blob)
    assert not rec.decoded and "virtual or function dataset" in (rec.reason or "")
    mismatch = project(_tn("Book1_A", cell_num(1.0) + cell_num(2.0), total=2, used=2))
    # header says 2 rows, record says 3: the two must agree
    mismatch = mismatch.replace(b"\x0a\x05\x02\x00\x00", b"\x0a\x05\x03\x00\x00")
    assert "header rows" in (_one(mismatch, "Book1_A").reason or "")


# ── the worksheet scan and the public reader ─────────────────────────────────


def _write(tmp_path: Path, blob: bytes) -> Path:
    path = tmp_path / "synthetic.opju"
    path.write_bytes(blob)
    return path


def test_read_opju_builds_books_text_columns_and_fidelity(tmp_path: Path) -> None:
    attach, refs = heap(["red", "blue"])
    x = [0.5, 1.0, 1.5, 2.0]
    blob = project(
        _tn("Data_A", run_num(4, seg_fpc(x)) + run_text(2, zz(2) + varint(0)), total=6, used=4),
        dataset(
            "Data_B",
            seg_fpc([3.0, 1.0, 4.0, 1.5]) + seg_repeat(2, float("nan")),
            kind=DBL,
            total=6,
            used=4,
            size=8,
        ),
        _tn(
            "Data_C",
            run_text(
                6,
                zz(-3)
                + varint(refs["red"])
                + varint(refs["blue"])
                + varint(refs["red"])
                + zz(3)
                + varint(0),
            ),
            total=6,
            used=3,
            mode=4,
            attach=attach,
        ),
        _tn("Data_D", run_text(6, zz(6) + varint(0)), total=6, used=0),
        _tn("Book1_A", run_text(4, zz(4) + varint(0)), total=4, used=0),  # default empty book
    )
    books = read_origin_books(_write(tmp_path, blob))
    assert [b.metadata["origin_book"] for b in books] == ["Data"]
    (book,) = books
    assert book.time.tolist() == x
    assert book.metadata["origin_column_names"] == ["B", "D"]
    assert book.values[:, 0].tolist() == [3.0, 1.0, 4.0, 1.5]
    assert np.isnan(book.values[:, 1]).all()  # an empty column of a filled book stays
    assert book.metadata["origin_text_columns"] == {"C": ["red", "blue", "red"]}
    fid = book.metadata["origin_worksheet_fidelity"]
    assert fid["datasets_total"] == 5
    assert fid["confidence"] == {"length_checked": 5}
    assert fid["empty_books_omitted"] == ["Book1"]
    assert fid["undecoded"] == []


def test_read_opju_diagnoses_unrecognized_forms_instead_of_no_columns(tmp_path: Path) -> None:
    blob = project(
        _tn("Book1_A", b"\x07\x00" + spec(1.0), total=1, used=1),
        _tn("Book1_B", b"\x07\x00" + spec(2.0), total=1, used=1),
        # complex bit set, but not a 16-byte element: no storage class matches
        dataset("Book1_C", b"\x00", kind=CPLX, total=1, used=1, size=8, length=False),
    )
    with pytest.raises(OriginProjectError) as err:
        read_origin_books(_write(tmp_path, blob))
    message = str(err.value)
    assert "2 x text_numeric (unknown cell kind 0x0007)" in message
    assert "1 x unknown" in message


def test_undecoded_column_is_omitted_and_counted_beside_decoded_ones(tmp_path: Path) -> None:
    blob = project(
        _tn("Book1_A", cell_num(1.0) + cell_num(2.0), total=2, used=2),
        _tn("Book1_B", b"\x07\x00" + spec(1.0) + cell_num(2.0), total=2, used=2),
    )
    (book,) = read_origin_books(_write(tmp_path, blob))
    assert book.time.tolist() == [1.0, 2.0] and book.values.shape == (2, 0)
    assert book.metadata["origin_worksheet_fidelity"]["undecoded"] == [
        {
            "form": "text_numeric",
            "reason": "unknown cell kind 0x0007",
            "count": 1,
            "examples": ["Book1_B"],
        }
    ]


def test_primary_book_has_a_value_series_when_any_book_does(tmp_path: Path) -> None:
    """A tick-label helper book (one numeric column beside its text labels)
    out-sizes one-row data books, but it has no value series to show."""
    attach, refs = heap(["low", "mid", "high"])
    ticks = [1.0, 2.0, 3.0]
    blob = project(
        _tn("Ticks_A", run_num(3, seg_fpc(ticks)), total=3, used=3),
        _tn(
            "Ticks_B",
            run_text(3, zz(-3) + b"".join(varint(refs[w]) for w in ("low", "mid", "high"))),
            total=3,
            used=3,
            mode=4,
            attach=attach,
        ),
        _tn("C0_A", cell_num(37.5), total=1, used=1),
        _tn("C0_B", cell_num(9.0), total=1, used=1),
    )
    path = _write(tmp_path, blob)
    primary = read_origin_project(path)
    assert primary.metadata["origin_book"] == "C0"
    assert primary.values.shape == (1, 1) and primary.values[0, 0] == 9.0
    assert [b.metadata["origin_book"] for b in read_origin_books(path)] == ["Ticks", "C0"]


def test_marker_scan_universe_is_frozen_for_curve_binding() -> None:
    """``opju_curves`` counts its column ordinal over ``scan_columns``'s
    output, so that scan must not learn the new tags/forms (see the FROZEN
    note in ``opju_codec``); the worksheet scan does decode them."""
    three_byte = struct.unpack("<d", bytes(5) + b"\x80\x78\xc0")[0]
    assert spec(three_byte)[0] == 0x23
    blob = project(_tn("Book1_A", run_num(4, seg_repeat(4, three_byte)), total=4, used=4))
    assert scan_columns(blob) == []
    (col,) = scan_worksheet(blob).columns
    assert col[0] == "Book1_A" and col[1].tolist() == [three_byte] * 4


def test_scan_worksheet_survives_garbage() -> None:
    assert scan_worksheet(b"").columns == []
    junk = bytes(range(256)) * 40 + b"\x80\x30" * 200
    scan = scan_worksheet(b"CPYUA 4.3811 222\n" + junk)
    assert scan.columns == [] and scan.text_columns == []


# ── matrix books ─────────────────────────────────────────────────────────────


def _layer(cols: int, rows: int) -> bytes:
    raw = bytearray(120)
    raw[2] = 0xDE
    raw[0x2B:0x2D] = cols.to_bytes(2, "little")
    raw[0x52:0x54] = rows.to_bytes(2, "little")
    return block(bytes(raw))


def _coord(name: str, text: str) -> bytes:
    raw = bytearray(100)
    raw[2] = 0x06
    raw[0x46:0x48] = name.encode()
    return block(bytes(raw)) + b"\x00" + block(text.encode() + bytes(18))


def _matrix_project(
    cols: int,
    rows: int,
    coords: dict[str, str],
    *,
    claim: tuple[int, int],
    complex_cells: bool = False,
) -> bytes:
    n = cols * rows
    values = [float(v) for v in range(n)]
    window = block(b"\x00\x00Mat7\x00" + bytes(40))
    tail = b"\x00\x0a\x00" + window + b"\x00\x02\x01\x00" + _layer(*claim)
    tail += b"".join(b"\x00" + _coord(k, v) for k, v in coords.items())
    if complex_cells:  # (real, imaginary) pairs, imaginary = -10 x real
        pairs = [x for v in values for x in (v, -10.0 * v)]
        record = dataset("Mat7", zz(-n) + fpc(pairs), kind=CPLX, total=n, used=n, size=16)
    else:
        record = dataset("Mat7", seg_fpc(values), kind=DBL, total=n, used=n, size=8)
    return project(record, tail=tail)


def test_matrix_book_shape_ranges_and_row_major_cells(tmp_path: Path) -> None:
    coords = {"X1": "13", "X2": "21", "Y1": "17", "Y2": "37"}
    blob = _matrix_project(4, 3, coords, claim=(4, 3))
    geo = matrix_geometry(blob, "Mat7", 12)
    assert geo is not None and (geo.rows, geo.cols) == (3, 4)
    assert geo.x_range == (13.0, 21.0) and geo.y_range == (17.0, 37.0)
    (book,) = read_origin_books(_write(tmp_path, blob))
    # The same map shape an `.opj` matrix gets: one row per cell, X / Y / Z.
    assert book.labels == ("X", "Y", "Z")
    assert book.values.shape == (12, 3)
    assert book.values[:4, 2].tolist() == [0.0, 1.0, 2.0, 3.0] and book.values[4, 2] == 4.0
    assert book.values[:4, 0].tolist() == [13.0, 15 + 2 / 3, 18 + 1 / 3, 21.0]  # X across a row
    assert book.values[::4, 1].tolist() == [17.0, 27.0, 37.0]  # Y down the rows
    meta = book.metadata
    assert meta["is2D"] is True and meta["map_shape"] == [3, 4]
    assert meta["source_format"] == "origin_opju"
    assert meta["origin_matrix"]["coordinates_recovered"] is True
    assert meta["origin_matrix"]["x_range"] == [13.0, 21.0]
    assert meta["origin_matrix"]["y_range"] == [17.0, 37.0]
    inventory = {e["name"]: e for e in meta["origin_books"]}
    assert inventory["Mat7"]["matrix"] is True


def test_matrix_without_coordinates_uses_cell_indices_and_says_so(tmp_path: Path) -> None:
    blob = _matrix_project(4, 3, {"X1": "13"}, claim=(4, 3))
    (book,) = read_origin_books(_write(tmp_path, blob))
    assert book.metadata["origin_matrix"]["coordinates_recovered"] is False
    assert book.metadata["origin_worksheet_losses"]["matrix_coordinates"]["columns"] == ["Mat7"]
    assert book.values[:4, 0].tolist() == [1.0, 2.0, 3.0, 4.0]
    assert book.values[::4, 1].tolist() == [1.0, 2.0, 3.0]


def test_complex_matrix_keeps_its_imaginary_part(tmp_path: Path) -> None:
    blob = _matrix_project(2, 2, {}, claim=(2, 2), complex_cells=True)
    (book,) = read_origin_books(_write(tmp_path, blob))
    assert book.labels == ("X", "Y", "Z", "Z (imaginary)")
    assert book.values[:, 2].tolist() == [0.0, 1.0, 2.0, 3.0]
    assert book.values[:, 3].tolist() == [-0.0, -10.0, -20.0, -30.0]
    assert "complex_imaginary" not in book.metadata["origin_worksheet_losses"]  # nothing lost


def test_matrix_without_all_four_coordinates_has_unknown_ranges() -> None:
    blob = _matrix_project(4, 3, {"X1": "13", "Y2": "37"}, claim=(4, 3))
    geo = matrix_geometry(blob, "Mat7", 12)
    assert geo is not None and geo.x_range is None and geo.y_range is None


def test_matrix_whose_layer_does_not_multiply_out_is_reported_not_shaped(tmp_path: Path) -> None:
    blob = _matrix_project(4, 3, {}, claim=(5, 3))  # 5 × 3 != 12 cells
    assert matrix_geometry(blob, "Mat7", 12) is None
    scan = scan_worksheet(blob)
    assert scan.matrices == []
    assert scan.fidelity["matrix_datasets"] == [
        {
            "name": "Mat7",
            "cells": 12,
            "imported": False,
            "reason": "matrix shape not located in the windows section",
        }
    ]
    with pytest.raises(OriginProjectError, match="matrix object"):
        read_origin_books(_write(tmp_path, blob))


def test_fpc_fixture_round_trips_through_the_segment_reader() -> None:
    values = [846.551 + 0.517 * i + 1e-9 * (i % 3) for i in range(40)]
    got = read_segments(zz(-40) + fpc(values), 0, 40)
    assert got is not None and got[0].tolist() == values


# ── windows metadata: the validated lookup wins, the wide one only adds ──────


def _fake_lookup(table: dict[tuple[str, ...], dict[str, tuple[str, str]]]):  # type: ignore[no-untyped-def]
    """An ``opju_window_metadata`` stand-in: the answer for a book depends on
    the exact column list asked about — the property the merge guards."""
    from quantized.io.origin_project.windows import BookMeta, ColumnMeta

    def lookup(_b: bytes, book_columns: dict[str, list[str]]) -> dict[str, BookMeta]:
        out: dict[str, BookMeta] = {}
        for book, cols in book_columns.items():
            answer = table.get((book, *cols))
            if answer is not None:
                meta = {c: ColumnMeta(c, d, name) for c, (d, name) in answer.items()}
                out[book] = BookMeta(book, book, meta)
        return out

    return lookup


def test_window_metadata_keeps_validated_labels_and_only_adds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from quantized.io.origin_project import opju as opju_mod

    legacy = [
        ("Good_A", np.zeros(1)),
        ("Good_B", np.zeros(1)),
        ("Drift_A", np.zeros(1)),
        ("Same_A", np.zeros(1)),
    ]
    table = {
        # the marker scan's column lists — the validated answers
        ("Good", "A", "B"): {"A": ("X", "Field"), "B": ("Y", "Moment")},
        ("Drift", "A"): {"A": ("X", "Time")},
        # the full lists: Good agrees and adds C; Drift lands on another run
        ("Good", "A", "B", "C"): {
            "A": ("X", "Field"),
            "B": ("Y", "Moment"),
            "C": ("Y", "Error"),
        },
        ("Drift", "A", "B"): {"A": ("X", "WRONG RUN"), "B": ("Y", "also wrong")},
        ("Fresh", "A"): {"A": ("X", "Angle")},
        ("Same", "A"): {"A": ("X", "Kept")},
    }
    asked: list[dict[str, list[str]]] = []
    lookup = _fake_lookup(table)

    def recording(b: bytes, book_columns: dict[str, list[str]], anchors: object = None) -> object:
        asked.append(dict(book_columns))
        assert isinstance(anchors, dict)  # one anchor cache serves both lookups
        return lookup(b, book_columns)

    monkeypatch.setattr(opju_mod, "opju_window_metadata", recording)
    merged = opju_mod._window_metadata(
        b"",
        legacy,
        {
            "Good": ["A", "B", "C"],
            "Drift": ["A", "B"],
            "Fresh": ["A"],
            "None": ["A"],
            "Same": ["A"],  # nothing the marker scan missed: no second lookup
        },
    )
    assert asked[0] == {"Good": ["A", "B"], "Drift": ["A"], "Same": ["A"]}
    # the full lookup is asked only about the books it can add to
    assert asked[1] == {"Good": ["A", "B", "C"], "Drift": ["A", "B"], "Fresh": ["A"], "None": ["A"]}
    assert merged["Same"].columns["A"].long_name == "Kept"
    assert {c: m.long_name for c, m in merged["Good"].columns.items()} == {
        "A": "Field",
        "B": "Moment",
        "C": "Error",  # added: the wide lookup agreed on A and B
    }
    assert {c: m.long_name for c, m in merged["Drift"].columns.items()} == {"A": "Time"}
    assert merged["Fresh"].columns["A"].long_name == "Angle"  # never resolved before
    assert "None" not in merged


def test_tail_start_is_memoized_per_file_without_changing_its_answer() -> None:
    from quantized.io.origin_project import opju_codec

    blob = project(_tn("Book1_A", run_num(4, seg_fpc([1.0, 2.5, 4.0, 8.5])), total=4, used=4))
    expected = opju_codec._tail_start(blob)
    assert expected > 0
    assert opju_codec.tail_start(blob) == expected
    assert opju_codec.tail_start(bytes(bytearray(blob))) == expected  # equal bytes, new object
    for i in range(3 * opju_codec._TAIL_START_MEMO_MAX):
        opju_codec.tail_start(blob + bytes([i]))
    assert len(opju_codec._TAIL_START_MEMO) <= opju_codec._TAIL_START_MEMO_MAX
