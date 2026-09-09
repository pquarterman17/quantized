"""BUG-006 in the backend: the row-indexed metadata sidecars must move with the rows.

`quantized.row_sidecars` is the hand-kept mirror of
`frontend/src/lib/rowSidecars.ts`; these tests pin the shared rules on this side
plus the two `calc/` sites that change a row count.
"""

from __future__ import annotations

import numpy as np

from quantized.calc.corrections import apply_corrections
from quantized.calc.resample import resample_data
from quantized.datastruct import DataStruct
from quantized.row_sidecars import (
    ROW_INDEXED_SIDECARS,
    drop_row_sidecars,
    slice_row_sidecars,
)


def _ds(rows: int, meta: dict[str, object]) -> DataStruct:
    return DataStruct.create(
        np.arange(float(rows)),
        np.arange(float(rows)).reshape(rows, 1),
        labels=["Y"],
        units=[""],
        metadata=meta,
    )


class TestSliceRowSidecars:
    def test_slices_every_allowlisted_spelling(self) -> None:
        meta = {k: {"A": ["c0", "c1", "c2"]} for k in ROW_INDEXED_SIDECARS}
        out = slice_row_sidecars(meta, [2, 0])
        for key in ROW_INDEXED_SIDECARS:
            assert out[key] == {"A": ["c2", "c0"]}, key

    def test_leaves_a_non_row_indexed_key_alone(self) -> None:
        # The mirror-image bug: slicing anything shaped like {name: list} would
        # corrupt the channel-indexed collections. The allowlist is the gate.
        meta = {"per_channel_notes": {"A": ["ch0", "ch1"]}, "all_column_names": ["x", "Y"]}
        out = slice_row_sidecars(meta, [1])
        assert out["per_channel_notes"] == {"A": ["ch0", "ch1"]}
        assert out["all_column_names"] == ["x", "Y"]

    def test_blanks_a_gap_inside_the_kept_range(self) -> None:
        out = slice_row_sidecars({"text_columns": {"A": ["a0", "a1"]}}, [0, 5, 1])
        assert out["text_columns"] == {"A": ["a0", "", "a1"]}

    def test_does_not_pad_trailing_misses(self) -> None:
        # Matches the TS side: a short column stays short rather than growing on
        # every operation.
        out = slice_row_sidecars({"text_columns": {"A": ["a0"]}}, [0, 1, 2])
        assert out["text_columns"] == {"A": ["a0"]}

    def test_drops_a_column_the_slice_emptied(self) -> None:
        out = slice_row_sidecars({"text_columns": {"A": ["a0"]}}, [1, 2])
        assert out["text_columns"] == {}

    def test_returns_a_corrupted_sidecar_untouched(self) -> None:
        bare = ["a", "b"]
        out = slice_row_sidecars({"text_columns": bare}, [1])
        assert out["text_columns"] is bare

    def test_never_mutates_the_input(self) -> None:
        meta = {"text_columns": {"A": ["a0", "a1", "a2"]}}
        slice_row_sidecars(meta, [0])
        assert meta == {"text_columns": {"A": ["a0", "a1", "a2"]}}


class TestDropRowSidecars:
    def test_removes_every_allowlisted_key_and_nothing_else(self) -> None:
        meta: dict[str, object] = {k: {"A": ["c"]} for k in ROW_INDEXED_SIDECARS}
        meta["source"] = "run.dat"
        out = drop_row_sidecars(meta)
        assert not any(k in out for k in ROW_INDEXED_SIDECARS)
        assert out["source"] == "run.dat"


class TestCorrectionsXTrim:
    """The site the Group N review found: xTrim masks rows, metadata rode through."""

    def test_xtrim_slices_the_text_sidecar_to_the_surviving_rows(self) -> None:
        ds = _ds(10, {"text_columns": {"Operator": [f"o{i}" for i in range(10)]}})
        out = apply_corrections(ds, {"xTrimMin": 5.0})
        # Rows 5..9 survive, so their operators must be the ones that survive.
        assert out.time.tolist() == [5.0, 6.0, 7.0, 8.0, 9.0]
        assert out.metadata["text_columns"] == {"Operator": ["o5", "o6", "o7", "o8", "o9"]}

    def test_a_trim_from_both_ends_keeps_the_middle(self) -> None:
        ds = _ds(10, {"text_columns": {"Operator": [f"o{i}" for i in range(10)]}})
        out = apply_corrections(ds, {"xTrimMin": 3.0, "xTrimMax": 5.0})
        assert out.metadata["text_columns"] == {"Operator": ["o3", "o4", "o5"]}

    def test_no_trim_leaves_the_sidecar_exactly_as_it_was(self) -> None:
        cells = [f"o{i}" for i in range(4)]
        ds = _ds(4, {"text_columns": {"Operator": list(cells)}})
        out = apply_corrections(ds, {"xOff": 1.0})
        assert out.metadata["text_columns"] == {"Operator": cells}

    def test_trim_ordering_is_measured_against_x_scale(self) -> None:
        # xScale runs BEFORE the trim, so the mask is taken on scaled x. Pinning
        # this makes the kept-row list provably the one the numbers used.
        ds = _ds(6, {"text_columns": {"Operator": [f"o{i}" for i in range(6)]}})
        out = apply_corrections(ds, {"xScale": 2.0, "xTrimMin": 6.0})
        assert out.time.tolist() == [6.0, 8.0, 10.0]
        assert out.metadata["text_columns"] == {"Operator": ["o3", "o4", "o5"]}


class TestResampleDropsSidecars:
    def test_resample_drops_them_because_rows_are_interpolated_not_kept(self) -> None:
        ds = _ds(5, {"text_columns": {"Operator": [f"o{i}" for i in range(5)]}})
        out = resample_data(ds, n_points=9)
        # Every output row is a new interpolated point, so no output row IS an
        # input row and there is nothing to slice to.
        assert "text_columns" not in out.metadata
        assert out.metadata["resampled"] is True

    def test_resample_keeps_file_level_metadata(self) -> None:
        ds = _ds(5, {"source": "run.dat", "text_columns": {"A": ["a"] * 5}})
        out = resample_data(ds, n_points=9)
        assert out.metadata["source"] == "run.dat"
