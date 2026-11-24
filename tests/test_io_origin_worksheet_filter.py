"""Worksheet data filter condition (``opju_worksheet_filter``, ledger F-119).

Synthetic blocks lock the decoded forms and every fail-closed branch; the
realdata half checks the public corpus at run time (no corpus bytes, values
or paths committed).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from origin_corpus import has_project, origin_corpus_dir
from quantized.datastruct import DataStruct
from quantized.io.origin_project import opju_worksheet_filter as wf
from quantized.io.origin_project import read_origin_books
from quantized.io.origin_project.opju_sheet_signals import filtered_books

_HEAD = (
    b"\x04\x01\x50\x02\x60\x00\x00\x00\xf1\x0a\x5a\x11\x11\x11\x01\x00\x01\x00\x10\x00\x00\x00"
    b"\x01\x00\x00\x00\x40\x00\x00\x00\x5c\x11\x11\x11\x03\x0e\x00\x42\x00\x00"
)


def _block(
    op: int = 0x04,
    bridge: bytes = b"\x00\x01\x00\xd3\x05\x00\x00\x00",
    text: bytes = b"0.07",
    name: bytes = b"error",
) -> bytes:
    tail = b"\x00\xff\xff\xff\xff\x14\x00\x02\x23\x00\x13\x02\x04\x00\x15x,\x00\xc0\x01"
    col = b"\x0a" + bytes([len(name) + 2, len(name) + 1]) + name + b"\x00"
    return b"pad" + wf._TAG + _HEAD + bytes([op]) + bridge + text + tail + col + b"\x0a\x00"


def _decode(block: bytes) -> dict[str, object] | None:
    return wf.decode_filter_block(block, block.find(wf._TAG))


def test_uncompressed_less_than_block_decodes() -> None:
    assert _decode(_block()) == {"column": "error", "op": "<", "value": 0.07, "inclusive": None}


def test_compressed_greater_than_block_decodes_strict() -> None:
    got = _decode(_block(op=0x02, bridge=b"\x00\x00\x08\x00\x63", text=b"0", name=b"time"))
    assert got == {"column": "time", "op": ">", "value": 0.0, "inclusive": False}
    got = _decode(_block(bridge=b"\x00\x00\x08\x00\x83", text=b"0.1"))
    assert got is not None and got["value"] == 0.1


@pytest.mark.parametrize(
    "block",
    [
        _block(op=0x03),  # an op byte no oracle has seen
        _block(bridge=b"\x00\x00\x08\x00\x35"),  # a digit before the text: would lengthen it
        _block(text=b"abc"),  # not a number
        _block(text=b"1e999"),  # not finite
        _block(name=b""),  # no column name
    ],
)
def test_unproven_forms_stay_undecoded(block: bytes) -> None:
    assert _decode(block) is None


def test_a_changed_fixed_byte_stays_undecoded() -> None:
    b = bytearray(_block())
    b[b.find(wf._TAG) + len(wf._TAG) + 10] ^= 0xFF
    assert _decode(bytes(b)) is None


def _book(name: str, labels: list[str], shorts: list[str], x_long: str = "x") -> DataStruct:
    n = len(labels)
    return DataStruct(
        time=np.arange(3.0),
        values=np.zeros((3, n)),
        labels=tuple(labels),
        units=("",) * n,
        metadata={
            "origin_book": name,
            "x_column_name": "A",
            "x_column_long": x_long,
            "origin_column_names": shorts,
        },
    )


def test_stamp_goes_to_the_one_sheet_holding_the_column(monkeypatch: pytest.MonkeyPatch) -> None:
    cond = {"column": "error", "op": "<", "value": 0.1, "inclusive": None}
    monkeypatch.setattr(
        wf, "page_filters", lambda raw: {"Book1": cond, "Book2": cond, "Book3": None}
    )
    books = [
        _book("Book1", ["fit", "error"], ["B", "C"]),
        _book("Book1@2", ["N total"], ["A"]),
        _book("Book2", ["error"], ["B"]),
        _book("Book2@2", ["error"], ["B"]),  # two sheets name it: fail closed
        _book("Book3", ["error"], ["B"]),  # undecoded condition
        _book("Book4", ["error"], ["B"]),  # no filter
    ]
    out = wf.mark_worksheet_filters(books, b"")
    stamps = [b.metadata.get(wf.WORKSHEET_FILTER_KEY) for b in out]
    assert stamps == [{**cond, "column_short": "C"}, None, None, None, None, None]
    assert out[0].values is books[0].values  # data untouched


def test_stamp_resolves_the_x_column_by_long_name(monkeypatch: pytest.MonkeyPatch) -> None:
    cond = {"column": "time", "op": ">", "value": 0.0, "inclusive": False}
    monkeypatch.setattr(wf, "page_filters", lambda raw: {"Book1": cond})
    (out,) = wf.mark_worksheet_filters([_book("Book1", ["y"], ["B"], x_long="time")], b"")
    assert out.metadata[wf.WORKSHEET_FILTER_KEY]["column_short"] == "A"


def _tagged_projects() -> list[Path]:
    root = origin_corpus_dir() / "public"
    if not root.is_dir():
        return []
    return sorted(p for p in root.rglob("*.opju") if has_project(p) and wf._TAG in p.read_bytes())


@pytest.mark.realdata
def test_realdata_every_filtered_page_decodes_and_keeps_some_rows() -> None:
    projects = _tagged_projects()
    if not projects:
        pytest.skip("public Origin corpus (with a worksheet filter) not present")
    for path in projects:
        raw = path.read_bytes()
        conds = wf.page_filters(raw)
        assert set(conds) == set(filtered_books(raw)), path.name
        assert all(c is not None for c in conds.values()), path.name
        stamped = 0
        for book in read_origin_books(path):
            stamp = book.metadata.get(wf.WORKSHEET_FILTER_KEY)
            if stamp is None:
                continue
            stamped += 1
            md = book.metadata
            short = stamp["column_short"]
            if short == md.get("x_column_name"):
                col = np.asarray(book.time, dtype=float)
            else:
                col = np.asarray(book.values)[:, list(md["origin_column_names"]).index(short)]
            kept = col < stamp["value"] if stamp["op"] == "<" else col > stamp["value"]
            # a real filter: it keeps some rows and rejects some
            assert 0 < int(kept.sum()) < col.size, (path.name, md["origin_book"])
        assert stamped == len(conds), path.name
