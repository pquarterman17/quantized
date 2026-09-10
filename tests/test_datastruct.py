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


class TestCatLevelsPayloadHardening:
    """P2-1 (Sol's Day-6 audit): `from_dict`'s `cat_levels` payload is
    UNTRUSTED wire data -- a malformed shape must degrade (drop the bad
    entry/field), never raise `AttributeError`/`ValueError` out of
    `from_dict` itself."""

    def _payload(self, cat_levels: object) -> dict[str, object]:
        return {
            "time": [0.0, 1.0],
            "values": [[10.0, 0.0], [20.0, 1.0]],
            "labels": ["Moment", "Region"],
            "units": ["emu", ""],
            "cat_levels": cat_levels,
        }

    def test_string_payload_degrades_instead_of_attributeerror(self) -> None:
        # Previously `"abc".items()` -> uncaught AttributeError (a 500 at
        # the route boundary). Must degrade to cat_levels=None.
        ds = DataStruct.from_dict(self._payload("abc"))
        assert ds.cat_levels is None

    def test_list_payload_degrades_instead_of_attributeerror(self) -> None:
        ds = DataStruct.from_dict(self._payload([1, 2, 3]))
        assert ds.cat_levels is None

    def test_string_value_is_dropped_not_char_split(self) -> None:
        # Previously `tuple("abc")` silently split a string VALUE into
        # `('a', 'b', 'c')` -- a wrong-but-successful level table. Must be
        # dropped instead.
        ds = DataStruct.from_dict(self._payload({"0": "abc"}))
        assert ds.cat_levels is None

    def test_non_int_key_is_dropped_not_valueerror(self) -> None:
        # Previously `int("not-a-number")` -> uncaught ValueError.
        ds = DataStruct.from_dict(self._payload({"not-a-number": ["a", "b"]}))
        assert ds.cat_levels is None

    def test_well_formed_entries_survive_alongside_dropped_malformed_ones(self) -> None:
        ds = DataStruct.from_dict(
            self._payload({"1": ["North", "South"], "0": "abc", "not-a-number": ["x"]})
        )
        assert ds.cat_levels == {1: ("North", "South")}

    def test_well_formed_payload_round_trips_identically(self) -> None:
        ds = _cat_ds()
        back = DataStruct.from_dict(ds.to_dict())
        assert back.cat_levels == ds.cat_levels


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

    def test_construction_validates_table_shape_only_not_value_coherence(self) -> None:
        """P1.4 review P2-3/P3-1 ruling: __post_init__ validates cat_levels'
        SHAPE (in-range index, non-empty str tuple) -- it does NOT cross-check
        every VALUES cell against its channel's level table. A downstream
        row-edit/merge/recode gone wrong can leave an out-of-range, negative,
        non-integer, or NaN code in a categorical column, and construction
        must still succeed -- coherence degrades at READ time (level_of ->
        None), never at construction time (no raise)."""
        ds = DataStruct.create(
            time=[0.0, 1.0, 2.0, 3.0],
            # channel 1 ("Region") is categorical with 2 levels, but its cells
            # carry a valid code (0), an out-of-range code (99), a negative
            # code (-1), and NaN -- all structurally legal float64 values.
            values=[[1.0, 0.0], [2.0, 99.0], [3.0, -1.0], [4.0, np.nan]],
            labels=["Moment", "Region"],
            cat_levels={1: ("North", "South")},
        )  # must not raise
        assert level_of(ds, 1, 0.0) == "North"
        assert level_of(ds, 1, 99.0) is None
        assert level_of(ds, 1, -1.0) is None
        assert level_of(ds, 1, float("nan")) is None
        assert level_of(ds, 0, 0.0) is None  # non-categorical channel


# ── level_order (JMP_GAP J1, Group O-2c) ────────────────────────────────────
# The frontend has carried this since Group O-2a; the backend did not, so it
# was SILENTLY DROPPED on every API round trip — `from_dict` ignores unknown
# keys, so there was no 422 to notice, just a preference that vanished.


def test_level_order_round_trips_through_to_dict_and_from_dict() -> None:
    ds = DataStruct.create(
        time=[1.0, 2.0, 3.0],
        values=[[0.0], [1.0], [0.0]],
        labels=("sample",),
        units=("",),
        cat_levels={0: ("lo", "hi")},
        level_order={0: (1, 0)},
    )
    assert ds.to_dict()["level_order"] == {"0": [1, 0]}
    assert dict(DataStruct.from_dict(ds.to_dict()).level_order or {}) == {0: (1, 0)}
    # ...and through JSON, where object keys become strings.
    assert dict(DataStruct.from_json(ds.to_json()).level_order or {}) == {0: (1, 0)}


def test_level_order_absent_is_additive_byte_identical() -> None:
    """Same additive contract `cat_levels` has: no key at all when no order was
    chosen, so every existing payload and golden fixture is untouched."""
    ds = DataStruct.create(time=[1.0], values=[[0.0]])
    assert ds.level_order is None
    assert "level_order" not in ds.to_dict()
    assert "level_order" not in json.loads(ds.to_json())


def test_level_order_keeps_channel_minus_one_the_x_column() -> None:
    """-1 is the x/time column under the `-1 = x, 0.. = a value channel`
    convention the frontend uses, and it DOES order a categorical x axis.
    Rejecting it would make the API drop a preference the client holds."""
    ds = DataStruct.from_dict(
        {"time": [1.0, 2.0], "values": [[0.0], [1.0]], "level_order": {"-1": [2, 1]}}
    )
    assert dict(ds.level_order or {}) == {-1: (2, 1)}


def test_level_order_wire_payload_degrades_instead_of_raising() -> None:
    """The untrusted boundary's documented contract: a malformed entry is
    DROPPED so a corrupted body still constructs a DataStruct."""
    ds = DataStruct.from_dict(
        {
            "time": [1.0, 2.0],
            "values": [[0.0, 0.0], [1.0, 1.0]],
            "level_order": {"0": [1, "x", True, 0], "1": "nope", "z": [0]},
        }
    )
    # Unusable codes are filtered -- bools included, since they ARE ints in
    # Python and `True` would otherwise land as the code 1 a second time. The
    # string VALUE and the unparseable KEY are dropped whole. Channel 1 is in
    # range here deliberately: on a one-channel fixture it would be rejected
    # for its INDEX and would prove nothing about the str/bytes value filter.
    assert dict(ds.level_order or {}) == {0: (1, 0)}


def test_level_order_entry_whose_every_code_is_junk_collapses_to_absent() -> None:
    """Covers the parser's `if codes:` guard. Without it an all-junk entry
    reaches the normalizer as an EMPTY tuple, which it rejects -- so deleting
    that one line turns a documented degrade into a raise. Nothing covered it:
    the degrade test above leaves two usable codes behind."""
    ds = DataStruct.from_dict(
        {"time": [1.0], "values": [[0.0]], "level_order": {"0": ["a", "b"]}}
    )
    assert ds.level_order is None


def test_level_order_accepts_finite_non_integer_codes() -> None:
    """The frontend contract this field mirrors keeps every `Number.isFinite`
    value (`sanitizeLevelOrder`) and matches through a Set of plain numbers
    (`orderLevels`), and `build_grouped_series` groups by ANY channel -- so an
    int-only rule would silently drop a legitimate order for a group column
    whose distinct values are {0.5, 1.5}: the user's order on screen, ascending
    in the exported PDF, which is the divergence _ordered_levels exists to
    prevent."""
    ds = DataStruct.from_dict(
        {"time": [1.0, 2.0], "values": [[0.5], [1.5]], "level_order": {"0": [1.5, 0.5]}}
    )
    assert dict(ds.level_order or {}) == {0: (1.5, 0.5)}


def test_level_order_integral_codes_stay_int_on_the_wire() -> None:
    """Integral inputs normalize to `int`, so the overwhelmingly common integer
    order still serializes as [1, 0] and not [1.0, 0.0]. This is also what
    admits np.int64 -- which `isinstance(c, int)` REJECTS, and which any
    producer building an order from np.unique hands us."""
    ds = DataStruct.create(
        time=[1.0], values=[[0.0]], level_order={0: (np.int64(1), np.int64(0))}
    )
    # Asserted on the SERIALIZED TEXT, not on the dict: `[1.0, 0.0] == [1, 0]`
    # is True in Python, so an equality check cannot tell the two apart and
    # stays green when the int normalization is removed (measured).
    assert '"level_order": {"0": [1, 0]}' in ds.to_json()
    assert all(isinstance(c, int) for c in (ds.level_order or {})[0])


def test_level_order_still_rejects_a_non_finite_code() -> None:
    with pytest.raises(ValueError, match="finite numbers"):
        DataStruct.create(time=[1.0], values=[[0.0]], level_order={0: (float("nan"),)})
    with pytest.raises(ValueError, match="finite numbers"):
        DataStruct.create(time=[1.0], values=[[0.0]], level_order={0: ()})


def test_level_order_empty_mapping_is_absent_not_an_empty_object() -> None:
    """An empty mapping must collapse to None: `{}` would be EMITTED on the way
    out (both to_dict and routes/_payload.py key off `is not None`) and parsed
    back to None on the way in, making the very first round trip lossy."""
    ds = DataStruct.create(time=[1.0], values=[[0.0]], level_order={})
    assert ds.level_order is None
    assert "level_order" not in ds.to_dict()


def test_from_dict_infinite_float_key_is_dropped_not_an_overflowerror() -> None:
    """`int(float("inf"))` raises OverflowError which -- unlike ValueError and
    TypeError -- is NOT in routes/_errors.py's CALC_ERRORS, so it would be a
    genuine 500. Unreachable from JSON (its object keys are strings) but not
    from the callers that hand `from_dict` a plain Python dict:
    plugins/loader.py's `_wrap_read` and client.py."""
    ds = DataStruct.from_dict(
        {"time": [1.0], "values": [[0.0]], "level_order": {float("inf"): [1]}}
    )
    assert ds.level_order is None


def test_out_of_range_channel_index_raises_which_a_route_turns_into_a_422() -> None:
    """An out-of-range index in EITHER channel-keyed map reaches the normalizer
    and raises -- deliberately, and NOT a 500. `ValueError` is in
    routes/_errors.py's CALC_ERRORS and every `from_dict` call site in routes/
    sits inside an `except CALC_ERRORS`, so the client gets a 422 naming the
    offending index.

    An earlier draft of this commit filtered these entries out at `from_dict`
    on the belief they 500'd. Measured on the real app they do not, and the
    filter was strictly worse: a descriptive 422 became a silent 200 whose
    response quietly lacked the client's level table."""
    for payload in (
        {"time": [1.0], "values": [[0.0]], "cat_levels": {"5": ["a", "b"]}},
        {"time": [1.0], "values": [[0.0]], "level_order": {"9": [1, 0]}},
    ):
        with pytest.raises(ValueError, match="out of range|cat_levels"):
            DataStruct.from_dict(payload)


def test_from_dict_keeps_cat_levels_for_every_values_SHAPE_post_init_accepts() -> None:
    """Regression guard for the dropped range filter. It computed the channel
    count as `len(values[0]) if isinstance(values[0], (list, tuple)) else 0`,
    which is 0 for a 1-D `values`, an ndarray, and a list of ndarray rows --
    all three of which `__post_init__` reshapes and accepts. Every one of them
    therefore lost its level table SILENTLY, and a plugin parser returning a
    numpy `values` through plugins/loader.py's `_wrap_read` is the live
    vector."""
    for values in (
        [10.0, 20.0],
        np.array([[1.0], [2.0]]),
        [np.array([1.0]), np.array([2.0])],
        [[1.0], [2.0]],
    ):
        ds = DataStruct.from_dict(
            {"time": [1.0, 2.0], "values": values, "cat_levels": {"0": ["a", "b"]}}
        )
        assert dict(ds.cat_levels or {}) == {0: ("a", "b")}, f"lost for {values!r}"


def test_create_still_raises_loudly_on_a_bad_channel_index() -> None:
    """`create()` is the INTERNAL contract, where a bad index is a programming
    error and must be loud -- as it is at the wire boundary too, per the test
    above."""
    with pytest.raises(ValueError, match="out of range"):
        DataStruct.create(time=[1.0], values=[[0.0]], cat_levels={5: ("a",)})
    with pytest.raises(ValueError, match="out of range"):
        DataStruct.create(time=[1.0], values=[[0.0]], level_order={9: (1, 0)})
