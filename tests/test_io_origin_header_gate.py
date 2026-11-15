"""Dataset-header gate and per-book lost-column marker (``opj_datasets`` / ``opj_lost``).

``parse_dataset_header`` used to reject any header with a non-zero byte at
0x12 or 0x40-0x47 -- a statistic about the 1358 headers then in the corpus,
not a property of the format. SuperlatticeFits ``Book12_C`` is a valid
Text & Numeric header with 0x12 set, and its column silently vanished. Only
0x12 is ungated -- that is all the specimen proves; 0x40-0x47 stays gated
until a specimen proves otherwise. A header that still cannot be decoded is
reported on its own book (``origin_columns_lost``), never dropped without a
trace.
"""

from __future__ import annotations

import struct

from quantized.io.origin_project.opj_datasets import decode_dataset, parse_dataset_header
from quantized.io.origin_project.opj_lost import lost_columns_by_book
from quantized.io.origin_project.opj_scan import Problem, scan_datasets


def _header(name: str, *, rows: int = 3, elem: int = 8, b12: int = 0, b40: bytes = b"") -> bytes:
    p = bytearray(0x58 + len(name) + 8)
    p[0x12] = b12
    p[0x16] = 0x00  # numeric
    p[0x17] = 0x00
    struct.pack_into("<III", p, 0x19, rows, 0, rows)
    p[0x3D] = elem
    p[0x40 : 0x40 + len(b40)] = b40
    p[0x58 : 0x58 + len(name) + 1] = name.encode() + b"\x00"
    return bytes(p)


def test_header_with_byte_0x12_set_is_still_a_header() -> None:
    plain = parse_dataset_header(_header("Book1_A"))
    assert plain is not None and plain.name == "Book1_A"
    got = parse_dataset_header(_header("Book1_A", b12=0x02))  # the Book12_C shape
    assert got is not None and (got.name, got.total_rows, got.elem_size) == ("Book1_A", 3, 8)


def test_unproven_zero_byte_gate_at_0x40_still_holds() -> None:
    # No specimen sets 0x40-0x47, so the gate there is not relaxed on spec.
    assert parse_dataset_header(_header("Book1_A", b40=b"\xfc\x01\x00\x00\x08\x00\x00\x00")) is None


def test_structurally_invalid_header_is_still_rejected() -> None:
    assert parse_dataset_header(_header("Book1_A", elem=0, b12=0x02)) is None  # no element size
    assert parse_dataset_header(_header("Bo\x01k1_A", b12=0x02)) is None  # unprintable name
    assert parse_dataset_header(b"\x00" * 0x40) is None  # too short for a name


def test_set_byte_header_with_wrong_data_length_fails_closed() -> None:
    h = parse_dataset_header(_header("Book1_A", b12=0x02))
    assert h is not None
    got = decode_dataset(h, b"\x00" * 7)  # 3 rows * 8 B expected
    assert got.problem is not None and got.numeric is None


def test_undecodable_column_is_reported_on_its_own_book() -> None:
    good = _header("Book1_B")
    bad = _header("Book1_C", elem=0)  # no element size: not a header
    blocks = [
        (8, b"x" * 8), (0, b""),
        (len(good), good), (24, struct.pack("<3d", 1.0, 2.0, 3.0)), (0, b""),
        (len(bad), bad), (24, b"y" * 24), (0, b""),
        (0, b""),
    ]  # fmt: skip
    scan = scan_datasets(blocks, ())
    assert [n for n, _ in scan.numeric] == ["Book1_B"]
    lost = lost_columns_by_book(scan.problems)
    assert list(lost) == ["Book1"] and list(lost["Book1"]) == ["C"]
    assert lost["Book1"]["C"]  # carries the reason


def test_lost_columns_key_by_sheet_and_ignore_unowned() -> None:
    probs = [
        Problem("column", "Book2_B@3", "r1"),
        Problem("unknown", "(unnamed dataset 1)", "r2"),
        Problem("cells", "Book2_B@3", "r3"),
        Problem("column", "noseparator", "r4"),
    ]
    assert lost_columns_by_book(probs) == {"Book2@3": {"B": "r1"}}
    assert lost_columns_by_book(probs, {"Book2@3": "Book2"}) == {"Book2": {"B": "r1"}}
