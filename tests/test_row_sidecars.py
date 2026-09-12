"""BUG-006 in the backend: the row-indexed metadata sidecars must move with the rows.

`quantized.row_sidecars` is the hand-kept mirror of
`frontend/src/lib/rowSidecars.ts`; these tests pin the shared rules on this side
plus the two `calc/` sites that change a row count.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from quantized.calc.corrections import apply_corrections
from quantized.calc.resample import resample_data
from quantized.datastruct import DataStruct
from quantized.io.origin_project.preview import decimate_with_alignment
from quantized.routes.parsers import _book_preview_payload
from quantized.row_sidecars import (
    ROW_INDEXED_SIDECARS,
    drop_row_sidecars,
    slice_row_sidecars,
)


class TestMirrorsTheTypeScriptModule:
    """The claim "kept in sync BY HAND" needs something that FAILS on drift.

    The Group P review pointed out there was no such check anywhere — not for
    this pair and not for the `is_categorical`/`isCategoricalChannel` precedent
    it cited — so "cannot drift silently" was unsupported. The key list is the
    part that matters (an added row-indexed sidecar that only one side slices is
    the bug this module exists to prevent), and it is mechanically comparable.
    """

    def test_the_key_list_matches_lib_rowsidecars_ts(self) -> None:
        ts = Path(__file__).resolve().parents[1] / "frontend/src/lib/rowSidecars.ts"
        src = ts.read_text(encoding="utf-8")
        block = re.search(
            r"export const ROW_INDEXED_SIDECARS = \[(.*?)\] as const;", src, re.S
        )
        assert block, f"could not find ROW_INDEXED_SIDECARS in {ts}"
        # Strip comments BEFORE matching string literals: the first version
        # scanned the raw body, so an ordinary `// the Origin "report sheet"
        # refs` would have failed this test — a false positive, reported by
        # review. Single quotes are accepted too, so a Prettier reformat of the
        # array is not a failure either.
        body = re.sub(r"//[^\n]*", "", block.group(1))
        body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
        ts_keys = tuple(
            m.group(1) if m.group(1) is not None else m.group(2)
            for m in re.finditer(r"\"([^\"]+)\"|'([^']+)'", body)
        )
        assert ts_keys == ROW_INDEXED_SIDECARS, (
            "row-indexed sidecar keys have DRIFTED between "
            f"{ts.name} ({ts_keys}) and row_sidecars.py ({ROW_INDEXED_SIDECARS}). "
            "Both sides must slice the same keys."
        )


class TestMatchesTypeScriptCellSemantics:
    """The three divergences the Group P review measured. Each of these returned
    something different from the TypeScript `cells[i] ?? ""` before the fix."""

    def test_a_none_cell_becomes_a_blank_like_js_nullish_coalescing(self) -> None:
        # `?? ""` catches null as well as undefined, and a .dwk/wire round trip
        # really does produce None here. Python was returning None.
        out = slice_row_sidecars({"text_columns": {"A": ["a0", None, "a2"]}}, [0, 1, 2])
        assert out["text_columns"] == {"A": ["a0", "", "a2"]}

    def test_a_non_integer_index_yields_a_BLANK_and_is_not_trimmed(self) -> None:
        # Two separate rules, and an earlier version of this test conflated them.
        # `cells[1.5]` is `undefined` -> "" (the VALUE), but the trim predicate
        # `hit(i)` is a bare NUMERIC range check that 1.5 PASSES, so JS keeps the
        # slot: `["a0", ""]`, length 2. Asserting `["a0"]` here was pinning a
        # divergence I had introduced, not the contract. Measured against the TS
        # module directly.
        out = slice_row_sidecars({"text_columns": {"A": ["a0", "a1"]}}, [0, 1.5])
        assert out["text_columns"] == {"A": ["a0", ""]}

    def test_an_INTEGRAL_FLOAT_is_a_real_index(self) -> None:
        # JS stringifies the key, so `cells[2.0]` is `cells["2"]` — the real cell.
        # A wire/JSON round trip makes every number a double, so this is the shape
        # an index list actually arrives in.
        out = slice_row_sidecars({"text_columns": {"A": ["a0", "a1", "a2"]}}, [0, 2.0])
        assert out["text_columns"] == {"A": ["a0", "a2"]}

    def test_an_out_of_range_or_non_numeric_index_IS_trimmed(self) -> None:
        # The other half of `hit`: 99 and "x" fail the range check, so the trailing
        # slot goes away entirely rather than becoming a blank.
        meta = {"text_columns": {"A": ["a0", "a1"]}}
        assert slice_row_sidecars(meta, [0, 99])["text_columns"] == {"A": ["a0"]}
        assert slice_row_sidecars(meta, [0, "x"])["text_columns"] == {"A": ["a0"]}

    def test_a_non_numeric_index_is_a_miss_rather_than_raising(self) -> None:
        # Leading (non-trailing) so the trim doesn't remove it — this pins the
        # VALUE rule, and the test above pins the TRIM rule.
        out = slice_row_sidecars({"text_columns": {"A": ["a0", "a1"]}}, ["x", 0])
        assert out["text_columns"] == {"A": ["", "a0"]}

    def test_a_TUPLE_column_is_sliced_like_a_list(self) -> None:
        # A `list`-only check handed a tuple back UNSLICED at its original
        # length — misaligned cells, silently, for a pure-Python-API caller.
        out = slice_row_sidecars({"text_columns": {"A": ("a0", "a1", "a2")}}, [2, 0])
        assert out["text_columns"] == {"A": ["a2", "a0"]}

    def test_a_NUMPY_index_is_a_REAL_index_not_a_miss(self) -> None:
        """The one this module's own guard got wrong, found by probing rather than
        by review. ``np.int64`` is not a subclass of ``int``, so an
        ``isinstance(i, int)`` guard made every index from ``np.flatnonzero`` a
        miss and the empty-column prune then deleted the ENTIRE column. Silent,
        total data loss — and `np.flatnonzero` is exactly how
        `calc/corrections.py` derives its surviving rows."""
        meta = {"text_columns": {"A": ["a0", "a1", "a2"]}}
        raw = np.flatnonzero(np.array([True, False, True]))
        assert not isinstance(raw[0], int)  # the premise, so this cannot rot
        assert slice_row_sidecars(meta, raw)["text_columns"] == {"A": ["a0", "a2"]}

    def test_a_BOOL_index_is_a_blank_VALUE_but_still_in_RANGE(self) -> None:
        # `operator.index(True)` is 1, but JS `cells[true]` is `cells["true"]` ->
        # undefined -> "". Its trim behaviour differs from its value behaviour,
        # exactly like 1.5: `true >= 0 && true < 2` coerces to `1 < 2` -> in range,
        # so a TRAILING `true` is NOT trimmed. Both halves asserted.
        meta = {"text_columns": {"A": ["a0", "a1"]}}
        assert slice_row_sidecars(meta, [True, 0])["text_columns"] == {"A": ["", "a0"]}
        assert slice_row_sidecars(meta, [0, True])["text_columns"] == {"A": ["a0", ""]}

    def test_a_NUMPY_BOOLEAN_is_a_blank_not_index_1(self) -> None:
        """`np.bool_` is not a subclass of `bool` and DOES implement `__index__` —
        the same isinstance-vs-numpy trap `np.int64` fell into two rounds earlier.
        A boolean MASK passed where an index list belongs returned plausible-looking
        WRONG cells (`['a1','a0']`) instead of blanks."""
        meta = {"text_columns": {"A": ["a0", "a1", "a2"]}}
        assert slice_row_sidecars(meta, [np.True_, 0])["text_columns"] == {"A": ["", "a0"]}
        # A whole mask degrades to BLANKS rather than to a plausible wrong answer.
        # Not to an absent column: `float(np.True_)` is 1.0, which is in range, so
        # `_in_range` keeps the slot and only the VALUE lookup blanks it. Measured,
        # after asserting `{}` here from memory and being wrong — the same
        # unmeasured-expectation habit this file keeps catching.
        assert slice_row_sidecars(meta, np.array([True, False, True]))["text_columns"] == {
            "A": ["", "", ""]
        }

    def test_a_raising_item_does_not_escape_as_an_exception(self) -> None:
        """Every predicate here is TOTAL — `""` for anything that is not a real
        position. `_is_boolean`'s unguarded `.item()` broke that: `ndarray.item()`
        raises for size != 1, so a multi-element array turned a previously fail-soft
        input into a public-API crash (`slice_row_sidecars` is in `__all__`)."""

        class Boom:
            def item(self) -> object:
                raise RuntimeError("nope")

        meta = {"text_columns": {"A": ["a0", "a1", "a2"]}}
        assert slice_row_sidecars(meta, [np.array([1, 2]), 0])["text_columns"] == {"A": ["", "a0"]}
        assert slice_row_sidecars(meta, [Boom(), 0])["text_columns"] == {"A": ["", "a0"]}

    def test_BYTES_are_rejected_by_both_halves_like_a_string(self) -> None:
        # `float(b"1") == 1.0`, so without the bytes branch a bytes key resolves to a
        # REAL cell. Round 5 found this branch live but untested: narrowing both
        # rejections to `str` alone left the whole file green.
        meta = {"text_columns": {"A": ["a0", "a1", "a2"]}}
        assert slice_row_sidecars(meta, [b"1", 0])["text_columns"] == {"A": ["", "a0"]}
        assert slice_row_sidecars(meta, [0, b"1"])["text_columns"] == {"A": ["a0"]}

    def test_a_numeric_string_is_rejected_by_BOTH_halves(self) -> None:
        """The two halves must agree. `_in_range` called `"1"` out of range while
        `_as_index`'s float() fallback returned `cells[1]` for it — one function
        trimming what the other resolved."""
        meta = {"text_columns": {"A": ["a0", "a1", "a2"]}}
        assert slice_row_sidecars(meta, ["1", 0])["text_columns"] == {"A": ["", "a0"]}
        assert slice_row_sidecars(meta, [0, "1"])["text_columns"] == {"A": ["a0"]}

    def test_a_NEGATIVE_index_is_a_blank_not_the_last_cell(self) -> None:
        # The TS side pins this (`[0,-1,1]`); the Python mirror's only
        # out-of-range test used a POSITIVE index, so `cells[-1]` returning the
        # LAST cell would have gone unnoticed. Sabotage-verified.
        out = slice_row_sidecars({"text_columns": {"A": ["a0", "a1"]}}, [0, -1, 1])
        assert out["text_columns"] == {"A": ["a0", "", "a1"]}


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


class TestDecimateWithAlignment:
    """The ``sampled`` flag the frontend gates BUG-006 site 9 on.

    Added because a sabotage exposed that nothing pinned it: making
    ``_decimate`` return ``True`` unconditionally left all 594 preview/parser
    tests green, so the flag the whole fix depends on was unverified.
    """

    @staticmethod
    def _book(rows: int, channels: int = 1, trailing_zero_rows: int = 0) -> DataStruct:
        n = rows + trailing_zero_rows
        time = np.arange(float(n))
        col = np.arange(1.0, n + 1).reshape(n, 1)
        values = np.tile(col, (1, channels)) if channels else np.zeros((n, 0))
        if trailing_zero_rows:
            # Origin's "allocated but unfilled" tail: x == 0 and every y == 0.
            time[rows:] = 0.0
            values[rows:, :] = 0.0
        return DataStruct.create(
            time,
            values,
            labels=[f"Y{i}" for i in range(channels)],
            units=[""] * channels,
            metadata={},
        )

    def test_a_small_book_has_NO_row_map(self) -> None:
        preview, source_rows = decimate_with_alignment(self._book(50), target_points=200)
        assert source_rows is None
        assert preview.n_points == 50

    def test_a_book_with_no_channels_has_NO_row_map(self) -> None:
        preview, source_rows = decimate_with_alignment(
            self._book(500, channels=0), target_points=200
        )
        assert source_rows is None

    def test_a_large_book_IS_sampled_and_reports_WHICH_rows_it_kept(self) -> None:
        """The map has to be usable, not merely present: every entry must name the
        source row whose numbers the preview actually carries. Asserted by reading
        the source back THROUGH the map, which is the only check that fails if the
        indices are off by one, unsorted, or taken before the padding trim."""
        book = self._book(1000)
        preview, source_rows = decimate_with_alignment(book, target_points=200)
        assert source_rows is not None
        assert preview.n_points < 1000
        assert len(source_rows) == preview.n_points
        assert source_rows == sorted(source_rows)  # output order, ascending
        assert len(set(source_rows)) == len(source_rows)  # no row twice
        assert all(0 <= i < book.n_points for i in source_rows)
        # The load-bearing assertion: the preview IS those source rows.
        assert preview.time.tolist() == [book.time[i] for i in source_rows]
        for c in range(book.n_channels):
            assert preview.values[:, c].tolist() == [book.values[i, c] for i in source_rows]

    def test_a_PADDING_TRIMMED_book_has_NO_row_map_though_it_SHRANK(self) -> None:
        """The distinction the whole field exists for, and the one a row-count
        comparison cannot make: the trim shortens the preview while leaving it a
        strict PREFIX, so its sidecar cells still line up and no map is needed."""
        preview, source_rows = decimate_with_alignment(
            self._book(161, trailing_zero_rows=19), target_points=200
        )
        assert source_rows is None
        assert preview.n_points == 161  # it DID shrink from 180 ...
        # ... and is still a prefix, which is why the cells remain aligned.
        assert preview.time.tolist() == list(range(161))

    def test_the_map_is_taken_AFTER_the_padding_trim(self) -> None:
        """A book big enough to sample AND padded: the indices must address the
        trimmed rows, not the original allocation. Taking them before the trim
        would shift every label by however many rows the trim removed — silently,
        since both lengths still look plausible."""
        # 1000 real rows PLUS 40 padding rows — `_book`'s second argument is
        # additional, not a share of the first. (I asserted `< 960` first, off by
        # exactly that misreading; the code was right.)
        book = self._book(1000, trailing_zero_rows=40)
        assert book.n_points == 1040
        preview, source_rows = decimate_with_alignment(book, target_points=200)
        assert source_rows is not None
        # Every index must address a REAL row: the padding occupies 1000..1039,
        # and `time[i] == i` holds only below that.
        assert max(source_rows) < 1000
        assert preview.time.tolist() == source_rows

    def test_decimate_datastruct_still_returns_just_the_preview(self) -> None:
        from quantized.io.origin_project.preview import decimate_datastruct

        assert decimate_datastruct(self._book(1000), target_points=200).n_points < 1000


class TestPreviewSampledReachesTheWire:
    """The `preview_sampled` PLUMBING, which nothing pinned.

    Round 4 deleted each of the three lines carrying this flag from backend to
    persisted state and the suite stayed green every time — 4,711 backend and 9,784
    frontend tests. Any of those regressions silently reverts every lazy Origin book
    to fail-closed (text columns hidden, edits refused), which is the regression the
    flag exists to remove. `grep -rn preview_sampled tests/` returned nothing.

    This covers the BACKEND hop; the import and persistence hops are covered in
    `frontend/src/store/importDatasets.test.ts` and `lib/workspace.test.ts`.
    """

    @staticmethod
    def _ds(rows: int, trailing_zero_rows: int = 0) -> DataStruct:
        n = rows + trailing_zero_rows
        time = np.arange(float(n))
        values = np.arange(1.0, n + 1).reshape(n, 1)
        if trailing_zero_rows:
            time[rows:] = 0.0
            values[rows:, :] = 0.0
        return DataStruct.create(time, values, labels=["Y"], units=[""], metadata={})

    def test_a_sampled_book_reports_it(self) -> None:
        payload = _book_preview_payload(self._ds(1000))
        assert payload["preview_sampled"] is True

    def test_a_small_book_reports_NOT_sampled(self) -> None:
        payload = _book_preview_payload(self._ds(20))
        assert payload["preview_sampled"] is False

    def test_a_PADDING_TRIMMED_book_reports_NOT_sampled_end_to_end(self) -> None:
        """The distinction the flag exists for, through the route helper: `rows` is
        the pre-trim count while the preview is a shorter, ALIGNED prefix — the exact
        pair a row-count proxy got wrong."""
        payload = _book_preview_payload(self._ds(161, trailing_zero_rows=19))
        assert payload["preview_sampled"] is False
        assert payload["rows"] == 180  # pre-trim, so rows > len(preview.time) ...
        assert len(payload["preview"]["time"]) == 161  # ... yet perfectly aligned

    def test_a_SAMPLED_book_also_sends_WHICH_rows_it_kept(self) -> None:
        """Group T. Without this the frontend can only refuse a sampled preview's
        row-indexed sidecars, so a large book's category labels read as formatted
        numbers until the whole book arrives."""
        payload = _book_preview_payload(self._ds(1000))
        rows = payload["preview_rows"]
        assert isinstance(rows, list)
        assert len(rows) == len(payload["preview"]["time"])
        # Usable, not merely present: the preview's own numbers must be the source
        # rows these indices name. `time` is 0..999, so time[i] == i.
        assert payload["preview"]["time"] == [float(i) for i in rows]
        assert rows == sorted(set(rows))

    def test_an_UNSAMPLED_payload_OMITS_the_row_map_entirely(self) -> None:
        """Not an identity map, not `null` — absent. This entry exists to keep a
        project's book inventory light, so an unsampled payload has to stay
        byte-identical to what it was before the field existed; a `preview_rows`
        that is always present would add `_PREVIEW_POINTS` integers to every book
        in a project to say nothing at all."""
        for ds in (self._ds(20), self._ds(161, trailing_zero_rows=19)):
            payload = _book_preview_payload(ds)
            assert payload["preview_sampled"] is False
            assert "preview_rows" not in payload
