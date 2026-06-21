"""DataStruct contract tests: construction, validation, immutability, round-trip."""

from __future__ import annotations

import numpy as np
import pytest
from numpy.testing import assert_array_equal

from quantized.datastruct import DataStruct


def _sample() -> DataStruct:
    return DataStruct.create(
        time=[1.0, 2.0, 3.0],
        values=[[10.0, 0.1], [20.0, 0.2], [30.0, 0.3]],
        labels=["Field", "Moment"],
        units=["Oe", "emu"],
        metadata={"source": "test.dat"},
    )


def test_basic_fields_and_shape() -> None:
    ds = _sample()
    assert ds.n_points == 3
    assert ds.n_channels == 2
    assert ds.labels == ("Field", "Moment")
    assert ds.units == ("Oe", "emu")
    assert ds.metadata["source"] == "test.dat"
    assert_array_equal(ds.column("Moment"), [0.1, 0.2, 0.3])
    assert_array_equal(ds.column(0), [10.0, 20.0, 30.0])


def test_default_labels_and_units() -> None:
    ds = DataStruct.create(time=[0, 1], values=[[1, 2, 3], [4, 5, 6]])
    assert ds.labels == ("ch1", "ch2", "ch3")
    assert ds.units == ("", "", "")


def test_label_deduplication() -> None:
    ds = DataStruct.create(
        time=[0, 1],
        values=[[1, 2, 3, 4], [5, 6, 7, 8]],
        labels=["A", "B", "A", "A"],
    )
    assert ds.labels == ("A", "B", "A (2)", "A (3)")


def test_1d_values_becomes_single_column() -> None:
    ds = DataStruct.create(time=[1, 2, 3], values=[10, 20, 30])
    assert ds.n_channels == 1
    assert_array_equal(ds.column(0), [10, 20, 30])


def test_empty_placeholder() -> None:
    ds = DataStruct.create(time=[], values=[])
    assert ds.n_points == 0
    assert ds.n_channels == 0
    assert ds.labels == ()


def test_row_count_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="time length"):
        DataStruct.create(time=[1, 2, 3], values=[[1], [2]])


def test_three_d_values_raises() -> None:
    with pytest.raises(ValueError, match="2-D"):
        DataStruct.create(time=[1, 2], values=np.zeros((2, 2, 2)))


def test_label_count_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="labels"):
        DataStruct.create(time=[0, 1], values=[[1, 2], [3, 4]], labels=["only_one"])


def test_arrays_are_read_only() -> None:
    ds = _sample()
    with pytest.raises(ValueError):
        ds.values[0, 0] = 999.0
    with pytest.raises(ValueError):
        ds.time[0] = 999.0


def test_metadata_is_immutable() -> None:
    ds = _sample()
    with pytest.raises(TypeError):
        ds.metadata["x"] = 1  # type: ignore[index]


def test_metadata_copied_from_input() -> None:
    meta = {"k": 1}
    ds = DataStruct.create(time=[0], values=[[1]], metadata=meta)
    meta["k"] = 999  # mutating the source must not affect the struct
    assert ds.metadata["k"] == 1


def test_dict_round_trip() -> None:
    ds = _sample()
    back = DataStruct.from_dict(ds.to_dict())
    assert_array_equal(back.time, ds.time)
    assert_array_equal(back.values, ds.values)
    assert back.labels == ds.labels
    assert back.units == ds.units
    assert back.metadata == ds.metadata


def test_json_round_trip_with_nan() -> None:
    ds = DataStruct.create(
        time=[1.0, 2.0],
        values=[[1.0, np.nan], [np.inf, 4.0]],
        labels=["a", "b"],
    )
    back = DataStruct.from_json(ds.to_json())
    assert_array_equal(back.values, ds.values)  # assert_array_equal treats nan==nan
    assert back.labels == ds.labels
