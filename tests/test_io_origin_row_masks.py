"""Row masks (``opju_row_masks``, ledger F-120).

Synthetic blocks lock the decoded form and the fail-closed branches; the
realdata half checks the public corpus at run time (no corpus bytes, values
or paths committed).
"""

from __future__ import annotations

import numpy as np
import pytest

from origin_corpus import has_project, origin_corpus_dir
from quantized.datastruct import DataStruct
from quantized.io.origin_project import opju_row_masks as rm
from quantized.io.origin_project import read_origin_books


def _rle(data: bytes) -> bytes:
    """Encode ``data`` with the header codec: zero runs as ``80|k``, else literals."""
    out = bytearray()
    k = 0
    while k < len(data):
        run = 0
        while k + run < len(data) and data[k + run] == 0 and run < 66:
            run += 1
        if run >= 3:
            out.append(0x80 | (run - 3))
            k += run
            continue
        n = 1
        while k + n < len(data) and n < 127 and data[k + n : k + n + 3] != bytes(3):
            n += 1
        out += bytes([n]) + data[k : k + n]
        k += n
    return bytes(out)


def _stream(rows: int, masked: list[int], lead: int = 0x81, pad: bytes = bytes(28)) -> bytes:
    """A mask's RLE token stream: lead + u16, the 28-byte pad, one byte per row (+4)."""
    body = bytearray(rows + 4)
    for r in masked:
        body[r] = 1
    return _rle(bytes([lead]) + b"\x26\x02" + pad + bytes(body))


def _block(stream: bytes) -> bytes:
    return bytes([len(stream) + 6, 0x06]) + b"\x40\xd8\x04\x0d\x61" + stream


def test_mask_block_decodes_its_flagged_rows() -> None:
    b = b"xx" + _block(_stream(309, [0, 60]))
    assert rm.mask_rows(b, 2, 309) == [0, 60]


@pytest.mark.parametrize(
    "stream, rows",
    [
        (_stream(309, [0], lead=0x82), 309),  # another lead byte
        (_stream(309, [0], pad=b"\x01" + bytes(27)), 309),  # non-zero pad byte
        (_stream(309, [0]), 310),  # length is not rows + 4
        (_stream(309, []), 309),  # no flagged row
    ],
)
def test_unproven_forms_are_not_masks(stream: bytes, rows: int) -> None:
    b = b"xx" + _block(stream)
    assert rm.mask_rows(b, 2, rows) is None


def test_a_row_byte_other_than_0_or_1_is_not_a_mask() -> None:
    body = bytearray(24)
    body[3] = 2
    stream = _rle(b"\x81\x26\x02" + bytes(28) + bytes(body))
    assert rm.mask_rows(b"xx" + _block(stream), 2, 20) is None


def _book(name: str, shorts: list[str]) -> DataStruct:
    n = len(shorts)
    return DataStruct(
        time=np.arange(3.0),
        values=np.zeros((3, n)),
        labels=tuple(shorts),
        units=("",) * n,
        metadata={"origin_book": name, "x_column_name": "A", "origin_column_names": shorts},
    )


def test_stamp_goes_to_the_book_and_sheet_named_by_the_dataset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    masks = {"Book1_C@2": [0], "Book1_B": [0, 5], "Book1_Z": [1], "Loose": [2], "Gone_B": [1]}
    monkeypatch.setattr(rm, "dataset_masks", lambda raw: masks)
    books = [_book("Book1", ["B", "C"]), _book("Book1@2", ["C"]), _book("Book2", ["B"])]
    out = rm.mark_row_masks(books, b"")
    assert [b.metadata.get(rm.MASKED_ROWS_KEY) for b in out] == [{"B": [0, 5]}, {"C": [0]}, None]
    assert out[0].values is books[0].values  # data untouched


@pytest.mark.realdata
def test_realdata_stamped_masks_name_real_columns_and_rows() -> None:
    root = origin_corpus_dir() / "public"
    projects = sorted(p for p in root.rglob("*.opju") if has_project(p)) if root.is_dir() else []
    projects = [p for p in projects if rm.dataset_masks(p.read_bytes())]
    if not projects:
        pytest.skip("public Origin corpus (with a row mask) not present")
    for path in projects:
        found = rm.dataset_masks(path.read_bytes())
        stamped = 0
        for book in read_origin_books(path):
            cols = book.metadata.get(rm.MASKED_ROWS_KEY)
            if not cols:
                continue
            for col, rows in cols.items():
                stamped += 1
                # strictly increasing storage rows inside the column's used rows
                assert rows == sorted(set(rows)) and rows[0] >= 0, (path.name, col)
                assert rows[-1] < len(book.values), (path.name, col)
        # every decoded mask reaches its book (none dropped by the name split)
        assert stamped == len(found), path.name


def _filled_book(**md: object) -> DataStruct:
    """X ``A`` and values ``B`` / ``C`` over 4 rows; ``C`` is empty on row 3."""
    return DataStruct(
        time=np.arange(4.0),
        values=np.array([[1.0, 1.0], [2.0, 2.0], [3.0, 3.0], [4.0, np.nan]]),
        labels=("b", "c"),
        units=("", ""),
        metadata={
            "origin_book": "Book1",
            "x_column_name": "A",
            "origin_column_names": ["B", "C"],
            **md,
        },
    )


def test_only_a_row_masked_in_every_filled_column_is_excluded() -> None:
    """B-38: a whole-row exclusion is exact only where every cell holding a
    value is masked (row 0 here; row 3's C is empty). Row 1 (A unmasked) and
    row 2 (C unmasked) stay: excluding them would hide unmasked cells."""
    masks = {"A": [0, 2, 3], "B": [0, 1, 2, 3], "C": [0, 1]}
    assert rm.fully_masked_rows(_filled_book(), masks) == [0, 3]
    assert rm.fully_masked_rows(_filled_book(), {"B": [0], "C": [0]}) == []  # X unmasked


def test_a_filled_text_cell_blocks_the_exclusion_and_a_loss_stamps_nothing() -> None:
    masks = {"A": [0], "B": [0], "C": [0]}
    text = {"D": ["note", ""]}
    assert rm.fully_masked_rows(_filled_book(origin_text_columns=text), masks) == []
    assert rm.fully_masked_rows(_filled_book(origin_text_columns={"D": ["", "x"]}), masks) == [0]
    lossy = _filled_book(origin_worksheet_losses={"columns": ["E"]})
    assert rm.fully_masked_rows(lossy, masks) == []


def test_mark_stamps_excluded_rows_only_when_fully_masked(monkeypatch: pytest.MonkeyPatch) -> None:
    masks = {"Book1_A": [0], "Book1_B": [0, 2], "Book1_C": [0]}
    monkeypatch.setattr(rm, "dataset_masks", lambda raw: masks)
    (out,) = rm.mark_row_masks([_filled_book()], b"")
    assert out.metadata[rm.EXCLUDED_ROWS_KEY] == [0]
    monkeypatch.setattr(rm, "dataset_masks", lambda raw: {"Book1_B": [0]})
    (out,) = rm.mark_row_masks([_filled_book()], b"")
    assert rm.EXCLUDED_ROWS_KEY not in out.metadata


@pytest.mark.realdata
def test_realdata_excluded_rows_are_only_fully_masked_rows() -> None:
    """Every stamped exclusion is a row masked in each filled column (the
    public masks are all partial on 2026-11-24, so none is expected, but the
    test recomputes rather than pins that)."""
    root = origin_corpus_dir() / "public"
    projects = sorted(p for p in root.rglob("*.opju") if has_project(p)) if root.is_dir() else []
    projects = [p for p in projects if rm.dataset_masks(p.read_bytes())]
    if not projects:
        pytest.skip("public Origin corpus (with a row mask) not present")
    for path in projects:
        for book in read_origin_books(path):
            cols = book.metadata.get(rm.MASKED_ROWS_KEY)
            got = book.metadata.get(rm.EXCLUDED_ROWS_KEY)
            if not cols:
                assert got is None, path.name
                continue
            assert (got or []) == rm.fully_masked_rows(book, cols), path.name
