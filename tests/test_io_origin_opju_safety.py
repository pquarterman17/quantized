"""Fail-closed and resource-safety guarantees of the ``.opju`` worksheet reader.

Regression tests for the 2026-11-13 review of the structural reader, all on
SYNTHETIC bytes from ``tests/opju_fixture.py`` (every name and value here is
invented):

* a Y column is never promoted to the X axis (``opju_book_checks``);
* a project that declares far more cells than it stores is refused within a
  per-walk decode budget, and reported (``opju_codec.DecodeBudget``);
* the marker scan's safety net always runs, and a header with a two-byte
  token-stream length is read;
* Text cells past the numeric rows are kept;
* worksheet losses are reported per book, and once per project.
"""

from __future__ import annotations

import time
import tracemalloc
from pathlib import Path

import numpy as np
import pytest

from opju_fixture import (
    CELLS_END,
    cell_num,
    dataset,
    fpc,
    heap,
    project,
    run_num,
    run_text,
    seg_fpc,
    seg_repeat,
    varint,
    zz,
)
from quantized.io.origin_project import OriginProjectError, read_origin_books
from quantized.io.origin_project.opju_blocks import find_headers, lz4_block
from quantized.io.origin_project.opju_book_checks import x_unconfirmed
from quantized.io.origin_project.opju_records import BUDGET_REASON, _string_heap, scan_records
from quantized.io.origin_project.opju_worksheet import scan_worksheet
from quantized.io.origin_project.windows import BookMeta, ColumnMeta

TN, DBL, CPLX = 0x61, 0x60, 0x62


def _tn(name: str, cells: bytes, *, total: int, used: int, **kw: object) -> bytes:
    return dataset(name, cells + CELLS_END, kind=TN, total=total, used=used, size=10, **kw)  # type: ignore[arg-type]


def _text(name: str, words: list[str]) -> bytes:
    """A Text&Numeric column whose cells are all text."""
    attach, refs = heap(words)
    cells = run_text(len(words), zz(-len(words)) + b"".join(varint(refs[w]) for w in words))
    return _tn(name, cells, total=len(words), used=len(words), mode=4, attach=attach)


def _num(name: str, values: list[float]) -> bytes:
    return _tn(name, run_num(len(values), seg_fpc(values)), total=len(values), used=len(values))


def _write(tmp_path: Path, blob: bytes, name: str = "synthetic.opju") -> Path:
    p = tmp_path / name
    p.write_bytes(blob)
    return p


def _by_book(books: list) -> dict:  # type: ignore[type-arg]
    return {b.metadata["origin_book"]: b for b in books}


# ── item 1: a Y is never promoted to X ───────────────────────────────────────


def test_first_numeric_column_is_x_when_it_is_the_first_column(tmp_path: Path) -> None:
    """Control: no designations known and nothing before it — Origin's
    default (the first column is the X) still applies."""
    blob = project(_num("Plain_A", [1.0, 2.0, 3.0]), _num("Plain_B", [5.0, 7.0, 9.5]))
    (book,) = read_origin_books(_write(tmp_path, blob))
    assert book.metadata["x_column_recovered"] is True
    assert book.metadata["x_column_name"] == "A"
    assert book.time.tolist() == [1.0, 2.0, 3.0]


def test_numeric_column_after_a_text_column_is_not_promoted_to_x(tmp_path: Path) -> None:
    """Column A is text (it may well be the X); B and C are numeric. Taking B
    as the X would turn a Y measurement into the independent axis."""
    blob = project(
        _text("Probe_A", ["one", "two", "three"]),
        _num("Probe_B", [0.25, 0.5, 0.75]),
        _num("Probe_C", [4.0, 5.0, 6.5]),
    )
    (book,) = read_origin_books(_write(tmp_path, blob))
    meta = book.metadata
    assert meta["x_column_recovered"] is False
    assert book.time.tolist() == [0.0, 1.0, 2.0]  # the row index
    assert meta["origin_column_names"] == ["B", "C"]  # nothing consumed as X
    assert book.values[:, 0].tolist() == [0.25, 0.5, 0.75]
    assert "column A comes before B" in meta["x_column_unrecovered_reason"]


def test_numeric_column_after_an_undecoded_column_is_not_promoted_to_x(tmp_path: Path) -> None:
    blob = project(
        _tn("Probe_A", b"\x07\x00" + b"\x11\x40" + cell_num(2.0), total=2, used=2),  # unknown cell
        _num("Probe_B", [3.0, 4.5]),
    )
    (book,) = read_origin_books(_write(tmp_path, blob))
    assert book.metadata["x_column_recovered"] is False
    assert "not decoded" in book.metadata["x_column_unrecovered_reason"]
    assert book.values[:, 0].tolist() == [3.0, 4.5]


def test_a_sheet_book_gets_the_same_check(tmp_path: Path) -> None:
    """A second-sheet book (``Book@2``) has no designations of its own, so the
    file-order check is all that protects it."""
    blob = project(
        _num("Probe_A", [1.0, 2.0]),
        _num("Probe_B", [3.0, 4.0]),
        _text("Probe_A@2", ["p", "q"]),
        _num("Probe_B@2", [8.0, 9.0]),
    )
    books = _by_book(read_origin_books(_write(tmp_path, blob)))
    assert books["Probe"].metadata["x_column_recovered"] is True
    assert books["Probe@2"].metadata["x_column_recovered"] is False
    assert books["Probe@2"].values[:, 0].tolist() == [8.0, 9.0]


def test_letter_order_also_counts_as_before(tmp_path: Path) -> None:
    """Records need not be stored in column order: a Text column ``A``
    stored after numeric ``B`` still comes first in the worksheet."""
    blob = project(_num("Probe_B", [1.0, 2.0]), _text("Probe_A", ["u", "v"]))
    (book,) = read_origin_books(_write(tmp_path, blob))
    assert book.metadata["x_column_recovered"] is False


def test_known_y_designation_is_never_the_x() -> None:
    """When the windows section says the first decoded column is a Y (and no
    column is designated X) it is not the X, whatever comes before it."""
    meta = {"Probe": BookMeta("Probe", "Probe", {"B": ColumnMeta("B", "Y", "Signal")})}
    cols = [("B", np.zeros(2)), ("C", np.zeros(2))]
    reason = x_unconfirmed("Probe", cols, meta, [("B", "numeric"), ("C", "numeric")])
    assert reason is not None and "designated Y" in reason
    # A designated X anywhere leaves the choice to `_build_book`.
    meta_x = {"Probe": BookMeta("Probe", "Probe", {"C": ColumnMeta("C", "X", "Time")})}
    assert x_unconfirmed("Probe", cols, meta_x, [("B", "numeric")]) is None


def test_truncated_windows_section_does_not_silently_change_the_x(tmp_path: Path) -> None:
    """The designations live in the windows section at the END of the file;
    a truncation that loses it must not flip the X onto a Y column."""
    good = project(_text("Probe_A", ["k1", "k2"]), _num("Probe_B", [2.0, 3.0]))
    for cut in (len(good), len(good) - 1):
        books = read_origin_books(_write(tmp_path, good[:cut], f"cut{cut}.opju"))
        assert all(b.metadata["x_column_recovered"] is False for b in books)


# ── item 2: decompression bombs ──────────────────────────────────────────────


def test_row_count_bomb_is_refused_within_bounded_memory_and_time(tmp_path: Path) -> None:
    """Four 20-million-row repeat runs fit in a few hundred bytes; decoded
    they would need gigabytes. Each walk refuses what does not fit its
    budget before allocating it, and says so."""
    n = 20_000_000
    blob = project(
        *(_tn(f"Bomb_{c}", run_num(n, seg_repeat(n, 1.0)), total=n, used=n) for c in "ABCD")
    )
    assert len(blob) < 1000
    tracemalloc.start()
    t0 = time.perf_counter()
    with pytest.raises(OriginProjectError) as err:
        read_origin_books(_write(tmp_path, blob))
    elapsed = time.perf_counter() - t0
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert BUDGET_REASON in str(err.value)
    assert peak < 64 * 2**20
    assert elapsed < 30  # loose backstop; the memory bound is the property


def test_decode_budget_refuses_the_column_that_does_not_fit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from quantized.io.origin_project import opju_budget

    monkeypatch.setattr(opju_budget, "DECODE_BUDGET_CELLS", 1000)
    blob = project(
        _tn("Fit_A", run_num(600, seg_repeat(600, 1.0)), total=600, used=600),
        _tn("Fit_B", run_num(600, seg_repeat(600, 2.0)), total=600, used=600),
    )
    scan = scan_worksheet(blob)
    assert [n for n, _ in scan.columns] == ["Fit_A"]
    assert scan.fidelity["over_decode_budget"] == {"count": 1, "examples": ["Fit_B"]}
    assert scan.losses["Fit"]["undecoded"] == ["B"]
    # a rejected record gives its cells back: nothing else is refused
    rejected = project(
        _tn("Fit_A", b"\x07\x00", total=900, used=900),
        _tn("Fit_B", run_num(600, seg_repeat(600, 2.0)), total=600, used=600),
    )
    assert [n for n, _ in scan_worksheet(rejected).columns] == ["Fit_B"]


def test_repeated_text_reference_shares_one_string() -> None:
    n = 5000
    attach, refs = heap(["same text"])
    blob = project(
        _tn(
            "Txt_A",
            run_text(n, zz(n) + varint(refs["same text"])),
            total=n,
            used=n,
            mode=4,
            attach=attach,
        )
    )
    (rec,) = scan_records(blob)
    assert rec.text is not None and len(rec.text) == n
    assert all(t is rec.text[0] for t in rec.text)


def _lz4_run(seed: bytes, total: int) -> bytes:
    """One LZ4 sequence: ``seed`` as literals, then a match repeating it up
    to ``total`` bytes (valid LZ4 — it really expands that far)."""
    lit, mlen = len(seed), total - len(seed)
    head = bytearray([(min(lit, 15) << 4) | 15])
    if lit >= 15:
        rest = lit - 15
        head += b"\xff" * (rest // 255) + bytes([rest % 255])
    ext = mlen - 4 - 15
    tail = b"\xff" * (ext // 255) + bytes([ext % 255])
    return bytes(head) + seed + len(seed).to_bytes(2, "little") + tail


def _heap_attachment(lz4: bytes, size: int) -> bytes:
    payload = (
        b"\x01#_MSER_STRINGS_PSET\x05\x01"
        + varint(4 + len(lz4))
        + b"\x00"
        + size.to_bytes(4, "little")
        + lz4
        + b"\x00"
    )
    return varint(len(payload)) + payload


def test_string_heap_size_is_bounded() -> None:
    """A heap is materialized only up to an absolute cap and only when its
    declared size is one LZ4 can reach from its compressed bytes."""
    seed = b"\x77\x11\x11\x11" + bytes(12) + (8).to_bytes(4, "little") + bytes(4) + b"txt\x00"
    small = 4096
    heap_bytes = _string_heap(_heap_attachment(_lz4_run(seed, small), small), 0)
    assert heap_bytes == b"txt\x00" + seed[:4]
    huge = 70 * 2**20  # a valid 70 MiB expansion of ~290 kB
    t0 = time.perf_counter()
    assert _string_heap(_heap_attachment(_lz4_run(seed, huge), huge), 0) is None
    assert time.perf_counter() - t0 < 1.0
    # a declared size past 255x the compressed bytes is not attempted at all
    forged = _heap_attachment(_lz4_run(seed, small), 255 * 2**20)
    assert _string_heap(forged, 0) is None


def test_lz4_long_matches_are_copied_in_slices() -> None:
    """A 20 MB overlapping match from a 2-byte seed: correct, and fast enough
    that a long match is no longer a CPU bomb."""
    mlen = 20_000_000
    ext = mlen - 4 - 15
    src = bytes([0x2F]) + b"ab" + b"\x02\x00" + b"\xff" * (ext // 255) + bytes([ext % 255])
    t0 = time.perf_counter()
    out = lz4_block(src, 2 + mlen)
    assert time.perf_counter() - t0 < 1.0
    assert out is not None and len(out) == 2 + mlen and out[:6] == b"ababab" and out[-2:] == b"ab"
    # non-overlapping match
    assert lz4_block(bytes([0x40]) + b"wxyz" + b"\x04\x00", 8) == b"wxyzwxyz"


def test_used_extent_values_do_not_keep_the_allocation_alive() -> None:
    blob = project(
        _tn("Ext_A", run_num(8, seg_fpc([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0])), total=8, used=2)
    )
    (rec,) = scan_records(blob)
    assert rec.values is not None and rec.values.tolist() == [1.0, 2.0]
    assert rec.values.base is None


# ── item 5: missed headers ───────────────────────────────────────────────────


def test_header_with_a_two_byte_token_stream_length_is_read() -> None:
    blob = project(
        dataset("Wide_A", seg_fpc([1.0, 2.0, 3.0]), kind=DBL, total=3, used=3, size=8, noise=True)
    )
    (h,) = find_headers(blob)
    assert h.end - h.start > 0x80  # the token stream really is > 127 bytes
    (rec,) = scan_records(blob)
    assert rec.values is not None and rec.values.tolist() == [1.0, 2.0, 3.0]


def test_column_without_a_recognized_header_is_imported_and_reported() -> None:
    """Every header that WAS found decodes, yet one column's header is not
    recognized: the marker scan still finds its record, and the import says
    it came without a header."""
    orphan_name = b"Pair_B"
    orphan = (
        bytes([len(orphan_name)])
        + orphan_name
        + b"\x0a\x05"
        + varint(3)
        + b"\xff\xff"
        + varint(3)
        + b"\x00"
        + seg_fpc([7.0, 8.0, 9.0])
    )
    blob = project(_num("Pair_A", [1.0, 2.0, 3.0]), orphan)
    scan = scan_worksheet(blob)
    assert [n for n, _ in scan.columns] == ["Pair_A", "Pair_B"]
    assert scan.fidelity["columns_without_header"] == {"count": 1, "examples": ["Pair_B"]}
    assert scan.losses["Pair"]["no_header"] == ["B"]


# ── item 6: text past the numeric rows ───────────────────────────────────────


def test_text_cells_past_the_numeric_rows_are_kept(tmp_path: Path) -> None:
    blob = project(
        _num("Tall_A", [1.0, 2.0]),
        _num("Tall_B", [3.0, 4.0]),
        _text("Tall_C", ["r1", "r2", "r3", "r4"]),
    )
    (book,) = read_origin_books(_write(tmp_path, blob))
    assert book.metadata["origin_text_columns"] == {"C": ["r1", "r2", "r3", "r4"]}
    assert book.time.shape == (4,) and book.values.shape == (4, 1)
    assert book.time[:2].tolist() == [1.0, 2.0] and np.isnan(book.time[2:]).all()
    assert np.isnan(book.values[2:, 0]).all()


# ── item 3: losses are reported where the user looks ─────────────────────────


def test_losses_are_per_book_and_the_project_report_is_on_the_primary_only(
    tmp_path: Path,
) -> None:
    blob = project(
        _num("Main_A", [1.0, 2.0, 3.0, 4.0]),
        _num("Main_B", [1.0, 4.0, 9.0, 16.0]),
        _tn("Main_C", b"\x07\x00", total=4, used=4),  # not a known cell kind
        dataset("Side_A", zz(-2) + fpc([1.0, 0.5, 2.0, 0.25]), kind=CPLX, total=2, used=2, size=16),
    )
    books = _by_book(read_origin_books(_write(tmp_path, blob)))
    main, side = books["Main"], books["Side"]
    assert main.metadata["origin_worksheet_losses"] == {"undecoded": {"count": 1, "columns": ["C"]}}
    assert side.metadata["origin_worksheet_losses"]["complex_imaginary"]["columns"] == ["A"]
    assert "origin_worksheet_fidelity" in main.metadata
    assert "origin_worksheet_fidelity" not in side.metadata


def test_dataset_with_an_unknown_name_form_is_reported_not_skipped() -> None:
    """A 147-byte header whose name is not a worksheet column name (a dotted
    attachment such as ``Book_B.Y2``) is not read — and says so."""
    blob = project(
        _num("Aux_A", [1.0, 2.0]),
        dataset("Aux_B.Y2", seg_fpc([5.0, 6.0]), kind=DBL, total=2, used=2, size=8),
    )
    scan = scan_worksheet(blob)
    assert [n for n, _ in scan.columns] == ["Aux_A"]
    assert {
        "form": "dataset",
        "reason": "name is not a worksheet column name",
        "count": 1,
        "examples": ["Aux_B.Y2"],
    } in scan.fidelity["undecoded"]  # type: ignore[operator]
    assert scan.losses["Aux"]["unread_dataset"] == ["B.Y2"]
    assert scan.fidelity["records_without_header"] == 0


def test_record_whose_header_is_damaged_is_counted() -> None:
    """A damaged header leaves no header to report against; its record's own
    length block still shows a record was there."""
    good = _num("Dmg_A", [1.0, 2.0])
    damaged = bytearray(dataset("Dmg_B", seg_fpc([3.0, 4.0]), kind=DBL, total=2, used=2, size=8))
    damaged[1] -= 1  # the token-stream length no longer matches its tokens
    scan = scan_worksheet(project(good, bytes(damaged)))
    assert [n for n, _ in scan.columns] == ["Dmg_A"]
    assert scan.fidelity["records_without_header"] == 1


def test_import_route_folds_the_worksheet_summary_into_origin_fidelity(tmp_path: Path) -> None:
    from quantized.routes import parsers as parsers_mod

    blob = project(
        _num("Main_A", [1.0, 2.0, 3.0]),
        _num("Main_B", [2.0, 4.0, 8.0]),
        _tn("Main_C", b"\x07\x00", total=3, used=3),
    )
    body, _ = parsers_mod._import_with_books(_write(tmp_path, blob))
    summary = body["origin_fidelity"]["worksheet"]
    assert summary["status"] == "partial"
    assert summary["columns_imported"] == 2
    assert summary["losses"] == [
        {"code": "columns_not_decoded", "count": 1, "examples": ["Main_C"]}
    ]
    # the full report is not sent a second time inside the book's metadata
    assert "origin_worksheet_fidelity" not in body["metadata"]
    assert body["metadata"]["origin_worksheet_losses"]["undecoded"]["columns"] == ["C"]


def test_worksheet_summary_status_and_bounds() -> None:
    from quantized.io.origin_project.worksheet_fidelity import worksheet_fidelity_summary

    clean = {"columns_numeric": 3, "columns_text": 1, "confidence": {"length_checked": 4}}
    assert worksheet_fidelity_summary(clean)["status"] == "complete"
    old = {"columns_numeric": 2, "confidence": {"grammar_only": 2}}
    assert worksheet_fidelity_summary(old) == {
        "version": 1,
        "status": "unverified",
        "columns_imported": 2,
        "unverified_columns": 2,
        "losses": [],
    }
    many = {
        "undecoded": [
            {"form": "text", "reason": "r1", "count": 40, "examples": [f"B_{i}" for i in range(5)]},
            {"form": "double", "reason": "r2", "count": 2, "examples": ["C_A", "C_B"]},
        ],
        "matrix_datasets": [{"name": "M1", "imported": False}, {"name": "M2", "imported": True}],
        "complex_imaginary_omitted": {"count": 1, "examples": ["D_A"]},
    }
    losses = worksheet_fidelity_summary(many)["losses"]
    assert losses[0] == {
        "code": "columns_not_decoded",
        "count": 42,
        "examples": ["B_0", "B_1", "B_2", "B_3", "B_4"],
    }
    assert [x["code"] for x in losses] == [  # type: ignore[index]
        "columns_not_decoded",
        "matrices_not_imported",
        "complex_imaginary_omitted",
    ]


def test_window_lookup_shares_each_books_anchor_search(monkeypatch: pytest.MonkeyPatch) -> None:
    """Asked twice about a book with no window section, the label lookup
    searches the file for its anchor once (item 4: import time)."""
    from quantized.io.origin_project import opju as opju_mod
    from quantized.io.origin_project import windows_opju

    searched: list[str] = []
    real = windows_opju._book_anchor

    def counting(b: bytes, short: str, start: int, hits: list) -> object:  # type: ignore[type-arg]
        searched.append(short)
        return real(b, short, start, hits)

    monkeypatch.setattr(windows_opju, "_book_anchor", counting)
    blob = project(_num("Lone_A", [1.0, 2.0]), _text("Lone_B", ["p", "q"]))
    marked = [("Lone_A", np.array([1.0, 2.0]))]
    opju_mod._window_metadata(blob, marked, {"Lone": ["A", "B"]})
    assert searched == ["Lone"]


def test_report_form_record_the_report_reader_skips_is_reported() -> None:
    """A record whose header says "report sheet" used to be counted as read
    whether or not the report reader read it."""
    from quantized.io.origin_project.opju_reports import scan_marked_report_columns

    strings = ["cell://Fit.B.Value", "", "cell://Fit.C.Value"]
    cells = b"".join(bytes([len(s)]) + s.encode() for s in strings)
    blob = project(
        _num("Rep_A", [1.0, 2.0, 3.0]),
        dataset(
            "Rep_B",
            b"\xff\xff" + varint(3) + b"\x01" + zz(-3) + cells,
            kind=TN,
            total=3,
            used=3,
            size=21,
        ),
        dataset("Rep_C", b"\x07\x00\x00", kind=TN, total=3, used=3, size=21),
    )
    reports = scan_marked_report_columns(blob)
    assert [(n, rows) for _, n, rows in reports] == [("Rep_B", strings)]
    scan = scan_worksheet(blob, None, [m for m, _, _ in reports])
    assert scan.fidelity["report_columns"] == 1
    assert {
        "form": "report",
        "reason": "report-sheet record not read",
        "count": 1,
        "examples": ["Rep_C"],
    } in scan.fidelity["undecoded"]  # type: ignore[operator]
    assert scan.losses["Rep"]["undecoded"] == ["C"]


def test_a_designated_text_x_is_explained_as_text() -> None:
    from quantized.io.origin_project.opju_book_checks import text_x_reason

    meta = {"Lab": BookMeta("Lab", "Lab", {"A": ColumnMeta("A", "X", "Sample")})}
    reason = text_x_reason("Lab", meta, [("A", ["s1", "s2"])])
    assert reason is not None and "holds text, not numbers" in reason
    assert text_x_reason("Lab", meta, [("C", ["s1"])]) is None  # the X is not a text column
    assert text_x_reason("Lab@2", meta, [("A", ["s1"])]) is None  # sheet 1's X says nothing here
