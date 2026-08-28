"""P0.4: differential coverage for the vectorized layout-detection scorer.

`io/_delimited_layout.py` replaced `_detect_layout`'s eager
``[_numeric_score(row) for row in tokens]`` (a per-cell ``float()`` call
across every cell in the file -- ~9 s of a 14.6 s profiled 1M-row import)
with a lazily-pulled, chunk-vectorized score sequence. These tests pin the
new fast path against the exact per-cell logic it replaces: `_score_chunk`
(and its `_numeric_like_mask_column` fast path) must reproduce `_numeric_score`
bit-for-bit on every row shape, and `_detect_layout` must reproduce the
original eager algorithm (reimplemented here from `_numeric_score` alone,
independent of the new module's internals) on every layout shape.
"""

from __future__ import annotations

from collections.abc import Sequence

import pytest

from quantized.io import _delimited_layout as layout

# --- ground truth: the pre-P0.4 eager algorithm, reimplemented from -------
# --- `_numeric_score` alone so it does not share any code path with the ---
# --- lazy/vectorized `_detect_layout` it is being compared against. -------


def _reference_detect_layout(tokens: Sequence[Sequence[str]]) -> tuple[int, int, int]:
    scores = [layout._numeric_score(row) for row in tokens]
    first_data = next((i for i, s in enumerate(scores) if s > 0.5), -1)
    if first_data < 0:
        first_data = next(
            (i for i, s in enumerate(scores) if i > 0 and s > scores[0] and s > 0),
            0,
        )
    header_row = -1
    units_row = -1
    if (
        first_data >= 2
        and scores[first_data - 1] < 0.5
        and scores[first_data - 2] < 0.5
        and layout._looks_like_units_row(tokens[first_data - 1], len(tokens[first_data]))
    ):
        units_row = first_data - 1
        header_row = first_data - 2
    elif first_data >= 1 and scores[first_data - 1] < 0.5:
        header_row = first_data - 1
    return header_row, first_data, units_row


# --- battery of nasty single rows: mixed text/numeric, every NA-token -----
# --- spelling, numeric-looking headers, underscore numbers, nan/inf case --
# --- variants, empty cells, ragged/single-column rows. --------------------

_NASTY_ROWS: list[list[str]] = [
    ["1", "2", "3"],
    ["a", "b", "c"],
    ["1", "b", "3"],
    ["", "", ""],
    ["nan", "NaN", "NAN"],
    ["-nan", "+nan", "inf"],
    ["Inf", "INFINITY", "-Infinity"],
    ["1_000", "2_500.5", "x"],
    ["na", "n/a", "-"],
    ["2026-07-19", "07/19/2026", "not-a-date"],
    ["2026-07-19T12:00:00Z", "1", "2"],
    ["1e500", "-1e500", "1.5e10"],
    ["  12.5  ", "12.5\t", "5"],
    ["1,234", "1.2.3", "5"],
    ["T", "M", "Sample"],
    ["1", "10", "A"],
    ["5"],
    [],
    ["(K)", "(emu)", "(emu)"],
    ["0x1p3", "5", "6"],
]


@pytest.mark.parametrize("row", _NASTY_ROWS, ids=range(len(_NASTY_ROWS)))
def test_score_chunk_matches_numeric_score_per_row(row: list[str]) -> None:
    exact = layout._numeric_score(row)
    (fast,) = layout._score_chunk([row])
    assert fast == exact


def test_score_chunk_matches_numeric_score_on_a_uniform_block() -> None:
    """The columnar vectorized fast path runs on a whole rectangular block
    in one shot -- exercise it with a mix of clean, NaN-spelled, and
    non-numeric-text columns together."""
    block = [
        ["1", "2", "x", "nan"],
        ["3", "4", "y", "5"],
        ["nan", "6", "z", "inf"],
        ["7", "-nan", "w", "8"],
    ]
    assert layout._score_chunk(block) == [layout._numeric_score(row) for row in block]


def test_score_chunk_falls_back_exactly_on_a_ragged_block() -> None:
    """Mixed row widths can't transpose into columns; must fall back to the
    exact per-row `_numeric_score`, not approximate it."""
    block = [["1", "2", "3"], ["a"], ["1", "2"], []]
    assert layout._score_chunk(block) == [layout._numeric_score(row) for row in block]


def test_score_chunk_empty_chunk_is_empty_list() -> None:
    assert layout._score_chunk([]) == []


def test_numeric_like_mask_column_falls_back_on_underscore_and_na_tokens() -> None:
    """Regardless of whether numpy's parser agrees with float() on a given
    token (verified empirically -- see the docstring), a column mixing a
    non-numpy-parseable NA spelling with numbers must still classify every
    cell exactly like `_is_numeric_like` (D5's fast-path contract), or fall
    back to ``None`` rather than answer wrong."""
    for cells in (["1", "2", "-"], ["1", "n/a", "3"], ["1", "", "3"]):
        mask = layout._numeric_like_mask_column(cells)
        expected = [layout._is_numeric_like(c.strip()) for c in cells]
        if mask is None:
            # Fell back -- the caller (`_score_chunk`) applies the exact
            # per-cell OR-datetime test itself; nothing to check here
            # beyond "did not silently misclassify" (there is no value).
            continue
        assert list(mask) == expected


# --- battery of nasty full files (token grids) for `_detect_layout` -------


def _tok(*rows: str, delim: str = ",") -> list[list[str]]:
    return [r.split(delim) for r in rows]


_NASTY_FILES: list[list[list[str]]] = [
    _tok("T,M", "1,10", "2,20"),
    _tok("T,M,Sample,Operator", "1,10,A,pq", "2,20,B,pq"),  # MAIN_PLAN #33: exact 0.5
    _tok("a,b,c", "d,e,f", "g,h,i"),  # never crosses 0.5 anywhere -- full scan
    _tok("Temp,M1,M2,M3", "(K),(emu),(emu),(emu)", ",NbAu-1,NbAu-2,NbAu-3", "1,10,11,12"),
    _tok("1,2,3", "4,5,6"),  # no header at all
    _tok("T,M", "nan,10", "2,NaN", "3,30"),  # NA tokens inside the data region
    _tok("T,M", "1_000,10", "2_000,20"),  # underscore numbers as data
    _tok("Timestamp,Signal", "2026-07-19T12:00:00Z,1", "2026-07-19T12:01:00Z,2"),
    _tok("T,M1,M2", "(K)", ",a,b", "1,10,11", "2,20,21"),  # ragged descriptive row
]


@pytest.mark.parametrize("tokens", _NASTY_FILES, ids=range(len(_NASTY_FILES)))
def test_detect_layout_matches_reference_eager_algorithm(
    tokens: list[list[str]],
) -> None:
    assert layout._detect_layout(tokens) == _reference_detect_layout(tokens)


def test_detect_layout_matches_reference_across_a_chunk_boundary() -> None:
    """Force `_iter_row_scores` to serve rows from more than one vectorized
    chunk before the layout scan finds its answer, by padding the
    non-numeric preamble past `_SCORE_CHUNK_ROWS` rows."""
    pad = layout._SCORE_CHUNK_ROWS + 5
    preamble = [["junk", "text", "row"] for _ in range(pad)]
    tokens = [*preamble, ["T", "M"], ["1", "10"], ["2", "20"]]
    assert layout._detect_layout(tokens) == _reference_detect_layout(tokens)


def test_detect_layout_no_row_ever_crosses_threshold_across_chunks() -> None:
    """The exhaustive (no s > 0.5 anywhere) fallback path must also agree
    with the reference when it spans multiple vectorized chunks."""
    pad = layout._SCORE_CHUNK_ROWS + 5
    tokens = [["a", "b", "c"] for _ in range(pad)]
    assert layout._detect_layout(tokens) == _reference_detect_layout(tokens)


# --- laziness / early-exit: prove the common case does not score the ------
# --- whole file, not just that the answer is correct. ---------------------


def test_detect_layout_early_exit_scores_only_the_first_chunk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """For a well-formed file (numeric-majority row right after the header),
    `_detect_layout` must stop pulling scores after the first chunk -- this
    is the actual P0.4 fix; a correctness-only test could pass while still
    silently scoring all 1,000,000 rows."""
    calls: list[int] = []
    real_score_chunk = layout._score_chunk

    def counting_score_chunk(chunk: Sequence[Sequence[str]]) -> list[float]:
        calls.append(len(chunk))
        return real_score_chunk(chunk)

    monkeypatch.setattr(layout, "_score_chunk", counting_score_chunk)

    # A header followed by ~200,000 numeric rows -- far more than one
    # `_SCORE_CHUNK_ROWS` chunk, but first_data should be found at row 1.
    tokens = [["Time", "Signal"], *([["1.0", "2.0"]] * 200_000)]
    header_row, data_start, units_row = layout._detect_layout(tokens)

    assert (header_row, data_start, units_row) == (0, 1, -1)
    assert len(calls) == 1, f"expected exactly one chunk to be scored, got {len(calls)}"
    assert calls[0] <= layout._SCORE_CHUNK_ROWS
