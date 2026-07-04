"""Round-trip tests for the native ``.opj`` writer (plan items 24 + 30).

quantized → ``opj_bytes`` → our own reader must reproduce data, names,
units, and designations exactly. Opening the output in real Origin is the
manual trial-window check (plan item 31); these tests pin the container
structure the reader (and the RE docs) define.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io.origin_project import read_origin_books, read_origin_project
from quantized.io.origin_project.writer import opj_bytes, write_opj


def _ds(**over):
    base = dict(
        time=np.array([1.0, 2.0, 3.0, 4.0]),
        values=np.column_stack([[10.0, 20.0, 30.0, 40.0], [0.1, 0.2, np.nan, 0.4]]),
        labels=("Moment", "Error"),
        units=("emu", "emu"),
        metadata={
            "origin_book": "Loop1",
            "origin_book_long": "30 nm sample",
            "x_column_long": "Field",
            "x_unit": "Oe",
        },
    )
    base.update(over)
    return DataStruct(**base)


def test_roundtrip_single_book(tmp_path) -> None:
    p = tmp_path / "out.opj"
    write_opj([_ds()], p)
    ds = read_origin_project(p)
    assert list(ds.time) == [1.0, 2.0, 3.0, 4.0]
    assert list(ds.values[:, 0]) == [10.0, 20.0, 30.0, 40.0]
    assert np.isnan(ds.values[2, 1]) and ds.values[3, 1] == 0.4  # NaN → sentinel → NaN
    assert ds.labels == ("Moment", "Error")
    assert ds.units == ("emu", "emu")
    assert ds.metadata["x_column_long"] == "Field"
    assert ds.metadata["x_unit"] == "Oe"
    assert ds.metadata["column_designations"]["A"] == "X"
    assert ds.metadata["origin_book"] == "Loop1"
    assert ds.metadata["origin_books"][0]["long_name"] == "30 nm sample"


def test_roundtrip_multi_book(tmp_path) -> None:
    b2 = _ds(
        time=np.array([5.0, 6.0]),
        values=np.array([[1.5], [2.5]]),
        labels=("I",),
        units=("arb. units",),
        metadata={"origin_book": "Scan2", "x_column_long": "2Theta", "x_unit": "degrees"},
    )
    p = tmp_path / "two.opj"
    write_opj([_ds(), b2], p)
    books = {b.metadata["origin_book"]: b for b in read_origin_books(p)}
    assert set(books) == {"Loop1", "Scan2"}
    assert books["Scan2"].labels == ("I",)
    assert books["Scan2"].units == ("arb. units",)
    assert list(books["Scan2"].time) == [5.0, 6.0]


def test_book_name_sanitization_and_collisions(tmp_path) -> None:
    a = _ds(metadata={"origin_book": "My data!"})
    b = _ds(metadata={"origin_book": "My data!"})
    p = tmp_path / "col.opj"
    write_opj([a, b], p)
    names = [x.metadata["origin_book"] for x in read_origin_books(p)]
    assert len(set(names)) == 2  # unique short names despite the collision


def test_value_only_dataset_roundtrips(tmp_path) -> None:
    ds = DataStruct(
        time=np.array([0.0, 1.0]),
        values=np.empty((2, 0)),
        labels=(),
        units=(),
        metadata={},
    )
    p = tmp_path / "xonly.opj"
    write_opj([ds], p)
    back = read_origin_project(p)
    assert list(back.time) == [0.0, 1.0]
    assert back.values.shape == (2, 0)


def test_writer_rejects_empty_and_too_wide() -> None:
    with pytest.raises(ValueError):
        opj_bytes([])
    wide = DataStruct(
        time=np.zeros(2),
        values=np.zeros((2, 26)),
        labels=tuple(f"c{i}" for i in range(26)),
        units=tuple("" for _ in range(26)),
        metadata={},
    )
    with pytest.raises(ValueError):
        opj_bytes([wide])
