"""DataStruct contract tests: construction, validation, immutability, round-trip."""

from __future__ import annotations

import json

import numpy as np
import pytest
from numpy.testing import assert_array_equal

from quantized.datastruct import DataStruct, is_categorical, level_labels, level_of


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


# ── P1.4 categorical representation contract ─────────────────────────────────


def _cat_ds() -> DataStruct:
    return DataStruct.create(
        time=[0.0, 1.0, 2.0, 3.0],
        values=[[10.0, 0.0], [20.0, 1.0], [30.0, np.nan], [40.0, 0.0]],
        labels=["Moment", "Region"],
        units=["emu", ""],
        cat_levels={1: ("North", "South")},
    )


def test_cat_levels_absent_is_additive_byte_identical() -> None:
    """A pure-numeric DataStruct's to_dict() must carry no `cat_levels` key at
    all -- ADDITIVE means an existing golden fixture (never carrying one) is
    unaffected by this field's mere existence."""
    ds = _sample()
    assert ds.cat_levels is None
    assert "cat_levels" not in ds.to_dict()
    assert "cat_levels" not in json.loads(ds.to_json())


def test_cat_levels_stored_and_frozen() -> None:
    ds = _cat_ds()
    assert ds.cat_levels == {1: ("North", "South")}
    with pytest.raises(TypeError):
        ds.cat_levels[1] = ("X",)  # type: ignore[index]


def test_cat_levels_out_of_range_index_raises() -> None:
    with pytest.raises(ValueError, match="out of range"):
        DataStruct.create(time=[0, 1], values=[[1.0], [2.0]], cat_levels={5: ("a",)})


def test_cat_levels_empty_tuple_raises() -> None:
    with pytest.raises(ValueError, match="non-empty tuple"):
        DataStruct.create(time=[0, 1], values=[[1.0], [2.0]], cat_levels={0: ()})


def test_cat_levels_non_str_entries_raise() -> None:
    with pytest.raises(ValueError, match="non-empty tuple"):
        DataStruct.create(time=[0, 1], values=[[1.0], [2.0]], cat_levels={0: (1, 2)})  # type: ignore[dict-item]


def test_cat_levels_dict_round_trip() -> None:
    ds = _cat_ds()
    back = DataStruct.from_dict(ds.to_dict())
    assert back.cat_levels == ds.cat_levels


def test_cat_levels_json_round_trip() -> None:
    """The JSON boundary stringifies dict keys (P1.4's documented quirk);
    from_dict/from_json must accept that and recover int keys losslessly."""
    ds = _cat_ds()
    payload = ds.to_dict()
    assert payload["cat_levels"] == {"1": ["North", "South"]}  # str keys on the wire
    back = DataStruct.from_json(ds.to_json())
    assert back.cat_levels == ds.cat_levels
    assert list(back.cat_levels)[0] == 1  # int key recovered, not "1"


def test_cat_levels_lossless_invertible() -> None:
    """The core P1.4 invariant: levels[code] recovers the ORIGINAL string for
    every non-missing cell."""
    ds = _cat_ds()
    levels = level_labels(ds, 1)
    codes = ds.column("Region")
    originals = ["North", "South", None, "North"]
    for code, expected in zip(codes, originals, strict=True):
        if expected is None:
            assert np.isnan(code)
        else:
            assert levels[int(code)] == expected


class TestCategoricalAccessors:
    def test_is_categorical(self) -> None:
        ds = _cat_ds()
        assert is_categorical(ds, 1) is True
        assert is_categorical(ds, "Region") is True
        assert is_categorical(ds, 0) is False
        assert is_categorical(_sample(), 0) is False  # no cat_levels at all

    def test_level_labels(self) -> None:
        ds = _cat_ds()
        assert level_labels(ds, 1) == ("North", "South")
        assert level_labels(ds, "Region") == ("North", "South")
        assert level_labels(ds, 0) == ()  # non-categorical -> empty, not an error

    def test_level_of_resolves_codes(self) -> None:
        ds = _cat_ds()
        assert level_of(ds, 1, 0.0) == "North"
        assert level_of(ds, 1, 1.0) == "South"

    def test_level_of_never_raises_on_bad_input(self) -> None:
        ds = _cat_ds()
        assert level_of(ds, 1, float("nan")) is None  # missing
        assert level_of(ds, 1, 99.0) is None  # out of range
        assert level_of(ds, 1, 0.5) is None  # non-integer code
        assert level_of(ds, 0, 0.0) is None  # non-categorical channel
