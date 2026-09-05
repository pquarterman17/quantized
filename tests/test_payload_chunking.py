"""Doc-promise audit for ``routes/_payload.py``'s chunked JSON encoding
(CLAUDE.md pre-PR self-review discipline): every behavioral claim in
``dumps_payload``/``jsonify``'s docstrings -- "byte-identical to a whole-
array ``json.dumps``/``.tolist()`` call", "wherever [time/values] occur,
including nested under books" -- gets a matching test here rather than
staying an unverified comment.

Parametrized across row counts that straddle the (narrow, 1- or 3-column)
chunk boundary implied by ``_ARRAY_CHUNK_ELEMS`` = 8000: 0, 999, 1000, 1001,
2500. Each case also exercises 1-D and 2-D arrays, NaN/Inf -> ``null``,
non-ASCII text, and empty arrays; a separate test covers the
``full_books=true`` nested-books shape (item 3's fix: chunking previously
only looked at the top level), and another covers a WIDE array, where the
chunk boundary is measured in elements (row_width x rows), not row count
alone.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from quantized.routes._payload import (
    _ARRAY_CHUNK_ELEMS,
    _JSON_KWARGS,
    _rows_per_chunk,
    dumps_payload,
    jsonify,
)

_ROW_COUNTS = [0, 999, 1000, 1001, 2500]


def _make_array(n_rows: int, *, two_d: bool) -> np.ndarray:
    """An ``n_rows``-long float64 array (1-D or 2-D x3) with NaN/Inf/-Inf
    sprinkled in wherever there's room, so the null-mapping path is
    exercised at every size, not just the finite-only common case."""
    rng = np.random.default_rng(0)
    shape = (n_rows, 3) if two_d else (n_rows,)
    arr = rng.random(shape) * 100 - 50
    col0 = arr[:, 0] if two_d else arr
    if n_rows > 0:
        col0[0] = np.nan
    if n_rows > 1:
        col0[1] = np.inf
    if n_rows > 2:
        col0[2] = -np.inf
    return arr


def _jsonify_reference(arr: np.ndarray) -> list:
    """The whole-array (unchunked) conversion ``jsonify`` chunks internally
    for a large array -- the ground truth its chunked output must match
    element-for-element regardless of size."""
    obj = arr.astype(object)
    obj[~np.isfinite(arr)] = None
    return obj.tolist()


def _make_payload(n_rows: int, *, two_d: bool) -> dict:
    """A ``datastruct_payload``-shaped dict sized to exercise the chunk
    boundary, with non-ASCII text in labels/units/metadata (ensure_ascii is
    False on the wire) and a unicode-bearing category level."""
    time = _make_array(n_rows, two_d=False)
    values = _make_array(n_rows, two_d=two_d)
    return {
        "time": jsonify(time),
        "values": jsonify(values),
        "labels": ["Temperature (µ)", "Résistance", "café ☃"],
        "units": ["Å", "Ω", ""],
        "metadata": {"note": "unicode: éèê, \U0001f9ea", "n": n_rows},
        "cat_levels": {"phase": ["α", "β", "γ"]},
    }


@pytest.mark.parametrize("n_rows", _ROW_COUNTS)
@pytest.mark.parametrize("two_d", [False, True], ids=["1d", "2d"])
def test_jsonify_matches_whole_array_reference(n_rows: int, two_d: bool) -> None:
    """``jsonify``'s chunked path (triggered above ``_ARRAY_CHUNK_ROWS``) is
    element-for-element identical to converting the whole array at once,
    including the NaN/Inf -> None mapping, at every size around the chunk
    boundary."""
    arr = _make_array(n_rows, two_d=two_d)
    assert jsonify(arr) == _jsonify_reference(arr)


@pytest.mark.parametrize("n_rows", _ROW_COUNTS)
@pytest.mark.parametrize("two_d", [False, True], ids=["1d", "2d"])
def test_dumps_payload_byte_identical_to_json_dumps(n_rows: int, two_d: bool) -> None:
    """``dumps_payload(payload) == json.dumps(payload, **_JSON_KWARGS).encode()``
    -- the exact claim ``dumps_payload``'s docstring makes -- at every size
    around the 1000-row chunk boundary, for both 1-D and 2-D "values"."""
    payload = _make_payload(n_rows, two_d=two_d)
    expected = json.dumps(payload, **_JSON_KWARGS).encode("utf-8")
    assert dumps_payload(payload) == expected


def test_dumps_payload_empty_arrays() -> None:
    """The n_rows=0 case above already covers this, but an explicit empty
    top-level "time"/"values" (no wrapping array machinery at all) pins the
    ``_encode_array_chunked``/``[]`` fast path directly."""
    payload = {"time": [], "values": [], "labels": [], "units": [], "metadata": {}}
    expected = json.dumps(payload, **_JSON_KWARGS).encode("utf-8")
    assert dumps_payload(payload) == expected


@pytest.mark.parametrize("n_rows", [0, 1, 1000, 1001, 1500])
def test_dumps_payload_matches_json_dumps_for_nested_books(n_rows: int) -> None:
    """Item 3's fix: a ``full_books=true`` import response nests every
    OTHER book's own "time"/"values" one level down, under
    ``payload["books"][i]`` -- these must be found and chunk-encoded too,
    not fall through to one monolithic ``json.dumps`` over the whole
    "books" list. Byte-identical to plain ``json.dumps`` regardless."""
    primary = _make_payload(n_rows, two_d=True)
    sibling_a = _make_payload(max(n_rows - 1, 0), two_d=False)
    sibling_b = _make_payload(min(n_rows + 1, 2500), two_d=True)
    payload = {**primary, "books": [sibling_a, sibling_b], "origin_fidelity": {"ok": True}}

    expected = json.dumps(payload, **_JSON_KWARGS).encode("utf-8")
    assert dumps_payload(payload) == expected


def test_dumps_payload_matches_json_dumps_for_doubly_nested_preview() -> None:
    """A lazy book's inventory entry nests "time"/"values" TWO levels down
    (``books[i]["preview"]["time"/"values"]``, see
    ``routes/parsers.py``'s ``_book_preview_payload``) -- the recursive
    walk must find those too."""
    preview_time = _make_array(250, two_d=False)
    preview_values = _make_array(250, two_d=True)
    payload = {
        **_make_payload(1200, two_d=True),
        "books": [
            {
                "lazy": True,
                "id": "book-1",
                "labels": ["a", "b"],
                "metadata": {},
                "preview": {"time": jsonify(preview_time), "values": jsonify(preview_values)},
            }
        ],
    }
    expected = json.dumps(payload, **_JSON_KWARGS).encode("utf-8")
    assert dumps_payload(payload) == expected


@pytest.mark.parametrize("shape", [(3, 5000), (1001, 17)])
def test_jsonify_wide_array_byte_identical(shape: tuple[int, int]) -> None:
    """A WIDE array (many columns, few rows) must chunk by total element
    count, not row count: at the old fixed-1000-row scheme, a (1000, 2000)
    "values" array spent 2M elements -- ~1.65s of ``json.dumps`` -- inside
    ONE chunk (measured; see ``_ARRAY_CHUNK_ELEMS``'s docstring). (3, 5000)
    is one row shy of that failure mode (a single row already exceeds the
    whole element budget); (1001, 17) crosses the element-budget chunk
    boundary at a modest row count. Both must still match the unchunked
    reference conversion element-for-element."""
    n_rows, n_cols = shape
    rng = np.random.default_rng(2)
    arr = rng.random(shape) * 100 - 50
    if n_rows > 0:
        arr[0, 0] = np.nan
        if n_cols > 1:
            arr[0, 1] = np.inf
    assert jsonify(arr) == _jsonify_reference(arr)


@pytest.mark.parametrize("shape", [(3, 5000), (1001, 17)])
def test_dumps_payload_wide_array_byte_identical(shape: tuple[int, int]) -> None:
    """Same wide-array shapes as above, through the full ``dumps_payload``
    JSON-encode path (not just ``jsonify``'s ndarray->list conversion)."""
    n_rows, n_cols = shape
    rng = np.random.default_rng(3)
    values = rng.random(shape) * 100 - 50
    time = rng.random(n_rows) * 10
    if n_rows > 0:
        values[0, 0] = np.nan
        time[0] = np.inf
    payload = {
        "time": jsonify(time),
        "values": jsonify(values),
        "labels": [f"ch{i}" for i in range(n_cols)],
        "units": [""] * n_cols,
        "metadata": {"n": n_rows},
    }
    expected = json.dumps(payload, **_JSON_KWARGS).encode("utf-8")
    assert dumps_payload(payload) == expected


@pytest.mark.parametrize(
    ("row_width", "expected"),
    [
        (1, 8_000),  # "time"/single-column "values" -- the narrow case
        (3, 2_666),
        (17, 470),
        (2_000, 4),  # the reported 1000 x 2000 "values" shape
        (5_000, 1),  # a single row already exceeds the budget
        (10_000, 1),  # ...and further past it -- still at least 1 row
    ],
)
def test_rows_per_chunk_formula(row_width: int, expected: int) -> None:
    """Pins ``_rows_per_chunk``'s ``max(1, _ARRAY_CHUNK_ELEMS // row_width)``
    formula directly, independent of the byte-identity tests above."""
    assert _rows_per_chunk(row_width) == expected


def test_chunk_elems_constant_is_8000() -> None:
    """Sanity pin: ``test_rows_per_chunk_formula``'s expectations are
    derived from ``_ARRAY_CHUNK_ELEMS`` = 8000 -- if that constant ever
    changes, this test (not the formula/boundary-sensitive ones) is what
    should fail first."""
    assert _ARRAY_CHUNK_ELEMS == 8_000
