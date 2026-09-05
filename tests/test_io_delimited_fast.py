"""P0.4-perf4: the `_delimited_fast` bulk-parse path must never change a
result -- only skip the tokenize/transpose/convert stages when it can prove
that's safe. Every case here asserts the fast path (default) and the forced
slow path (``_force_slow=True``, the original tokenize/transpose/convert
code, unchanged) produce a BIT-IDENTICAL ``DataStruct`` on the same file.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io import _delimited_fast
from quantized.io._delimited_fast import LazyTokenRows, try_fast_parse_matrix
from quantized.io.delimited import import_csv
from quantized.io.registry import resolve_parser


def _assert_identical(fast: DataStruct, slow: DataStruct) -> None:
    assert np.array_equal(fast.time, slow.time, equal_nan=True)
    assert fast.time.dtype == slow.time.dtype
    assert np.array_equal(fast.values, slow.values, equal_nan=True)
    assert fast.values.shape == slow.values.shape
    assert fast.labels == slow.labels
    assert fast.units == slow.units
    assert dict(fast.metadata) == dict(slow.metadata)
    fast_cat = fast.cat_levels or {}
    slow_cat = slow.cat_levels or {}
    assert fast_cat == slow_cat


def _assert_fast_and_slow_agree(path: Path, **kwargs: object) -> DataStruct:
    ds_fast = import_csv(path, **kwargs)  # type: ignore[arg-type]
    ds_slow = import_csv(path, _force_slow=True, **kwargs)  # type: ignore[arg-type]
    _assert_identical(ds_fast, ds_slow)
    return ds_fast


# --- (a) parity across every delimited fixture in the repo ------------------


def _delimited_fixtures(fixtures_dir: Path) -> list[Path]:
    paths: set[Path] = set()
    for pattern in ("**/*.csv", "**/*.txt", "**/*.tsv", "**/*.dat"):
        paths.update(fixtures_dir.glob(pattern))
    routed = []
    for p in sorted(paths):
        try:
            if resolve_parser(p) is import_csv:
                routed.append(p)
        except ValueError:
            continue
    return routed


def test_fast_and_slow_agree_on_every_delimited_fixture(fixtures_dir: Path) -> None:
    fixtures = _delimited_fixtures(fixtures_dir)
    assert fixtures, "expected at least one fixture routed to import_csv"
    for path in fixtures:
        _assert_fast_and_slow_agree(path)


def test_fast_path_actually_engages_on_a_clean_numeric_file(tmp_path: Path) -> None:
    """Guard against the parity tests passing vacuously because the fast
    path silently never fires: a plain, clean numeric CSV must be one
    `try_fast_parse_matrix` itself accepts (not merely one where fast and
    slow happen to agree)."""
    path = tmp_path / "clean.csv"
    rng = np.random.default_rng(0)
    header = "Time (s),A (V),B (V)\n"
    rows = "\n".join(
        f"{t:.6f},{a:.6f},{b:.6f}"
        for t, a, b in zip(range(500), rng.normal(size=500), rng.normal(size=500), strict=True)
    )
    path.write_text(header + rows + "\n", encoding="utf-8")
    raw_lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    matrix = try_fast_parse_matrix(raw_lines, 1, 3, ",")
    assert matrix is not None
    assert matrix.shape == (500, 3)
    _assert_fast_and_slow_agree(path)


# --- (b) fallback cases: fast and slow must still agree ---------------------


def test_ragged_rows_fallback(tmp_path: Path) -> None:
    path = tmp_path / "ragged.csv"
    path.write_text("T,M1,M2\n1,10,11\n2,20\n3,30,31,99\n", encoding="utf-8")
    _assert_fast_and_slow_agree(path)


def test_text_column_fallback(tmp_path: Path) -> None:
    path = tmp_path / "text_col.csv"
    path.write_text(
        "T,M,Operator\n1,10,alice\n2,20,bob\n3,30,alice\n4,40,carol\n",
        encoding="utf-8",
    )
    ds = _assert_fast_and_slow_agree(path)
    assert "Operator" in ds.metadata.get("text_columns", {})


def test_na_spelling_cells_fallback(tmp_path: Path) -> None:
    path = tmp_path / "na_cells.csv"
    path.write_text("T,M\n1,10\n2,na\n3,n/a\n4,-\n5,50\n", encoding="utf-8")
    ds = _assert_fast_and_slow_agree(path)
    assert np.isnan(ds.values[1, 0])
    assert np.isnan(ds.values[2, 0])
    assert np.isnan(ds.values[3, 0])


def test_datetime_column_fallback(tmp_path: Path) -> None:
    path = tmp_path / "dated.csv"
    path.write_text(
        "Timestamp,Signal\n2026-07-19T12:00:00Z,1\n2026-07-19T12:01:00Z,2\n"
        "2026-07-19T12:02:00Z,3\n2026-07-19T12:03:00Z,4\n",
        encoding="utf-8",
    )
    ds = _assert_fast_and_slow_agree(path)
    assert ds.metadata["time_is_datetime"] is True


def test_windows_crlf_fallback_or_fast(tmp_path: Path) -> None:
    path = tmp_path / "crlf.csv"
    path.write_bytes(b"T,M\r\n1,10\r\n2,20\r\n3,30\r\n4,40\r\n")
    _assert_fast_and_slow_agree(path)


def test_trailing_blank_line(tmp_path: Path) -> None:
    path = tmp_path / "trailing_blank.csv"
    path.write_text("T,M\n1,10\n2,20\n3,30\n\n\n", encoding="utf-8")
    _assert_fast_and_slow_agree(path)


def test_semicolon_delimited_fallback_or_fast(tmp_path: Path) -> None:
    path = tmp_path / "semi.csv"
    path.write_text("T;M\n1;10\n2;20\n3;30\n4;40\n", encoding="utf-8")
    _assert_fast_and_slow_agree(path)


def test_multi_header_units_row_fast(tmp_path: Path) -> None:
    path = tmp_path / "units.csv"
    path.write_text("Temp,Moment\n(K),(emu)\n1,10\n2,20\n3,30\n", encoding="utf-8")
    _assert_fast_and_slow_agree(path)


def test_blank_leading_column_fallback(tmp_path: Path) -> None:
    """A blank x-column (leading delimiter) can't bulk-parse (an empty
    cell isn't float-parseable) -- must fall back and still match."""
    path = tmp_path / "blank_x.csv"
    path.write_text(",M\n,10\n,20\n,30\n", encoding="utf-8")
    _assert_fast_and_slow_agree(path)


def test_forced_slow_flag_actually_changes_nothing_observable(tmp_path: Path) -> None:
    """Sanity check on the test harness itself: `_force_slow` must be a
    pure internal routing switch, invisible in the returned DataStruct."""
    path = tmp_path / "plain.csv"
    path.write_text("T,M\n1,10\n2,20\n3,30\n", encoding="utf-8")
    ds = import_csv(path, _force_slow=True)
    assert "_force_slow" not in ds.metadata


# --- (c) LazyTokenRows indexing correctness ---------------------------------


def test_lazy_token_rows_negative_index_matches_list_semantics() -> None:
    raw = ["a,b", "1,2", "3,4"]
    lz = LazyTokenRows(raw, ",")
    ref = [line.split(",") for line in raw]
    assert lz[-1] == ref[-1]
    assert lz[-len(raw)] == ref[-len(raw)]


def test_lazy_token_rows_out_of_range_negative_index_raises() -> None:
    raw = ["a,b", "1,2", "3,4"]
    lz = LazyTokenRows(raw, ",")
    with pytest.raises(IndexError):
        lz[-len(raw) - 1]


def test_lazy_token_rows_out_of_range_positive_index_raises() -> None:
    raw = ["a,b", "1,2", "3,4"]
    lz = LazyTokenRows(raw, ",")
    with pytest.raises(IndexError):
        lz[len(raw)]


def test_lazy_token_rows_negative_index_caches_under_normalized_key() -> None:
    """The old bare `index += len(self)` cached an out-of-range negative
    index under its ORIGINAL (still-negative) value; a subsequent in-range
    access could then read a stale/foreign cache entry. The normalized
    `range(len(self))[index]` key must be the only key ever written."""
    raw = ["a,b", "1,2", "3,4"]
    lz = LazyTokenRows(raw, ",")
    row = lz[-1]
    assert lz._cache == {2: row}


def test_lazy_token_rows_slice_semantics_match_list() -> None:
    raw = ["a,b", "1,2", "3,4", "5,6"]
    lz = LazyTokenRows(raw, ",")
    ref = [line.split(",") for line in raw]
    assert lz[1:3] == ref[1:3]
    assert lz[:-1] == ref[:-1]
    assert lz[::-1] == ref[::-1]
    assert lz[10:20] == ref[10:20]  # out-of-range slice bounds: empty, no error


# --- (d) tail-failure probe: start/middle/end sampling (item 5) -------------


def test_tail_only_na_cell_skips_full_loadtxt_attempt(monkeypatch: pytest.MonkeyPatch) -> None:
    """A stray NA cell on the LAST row of a block far bigger than the probe
    window must be caught by the cheap start/middle/end probe -- the
    expensive whole-block ``np.loadtxt`` parse must never even be attempted
    (previously: a prefix-only probe missed it, so the full ~100 MB-at-scale
    join and parse ran anyway before falling back)."""
    n_rows = 5000
    rows = [f"{i}.0,{i}.5" for i in range(n_rows)]
    rows[-1] = "n/a,1.0"
    calls: list[int] = []
    real_loadtxt = _delimited_fast.np.loadtxt

    def spy_loadtxt(*args: object, **kwargs: object) -> object:
        calls.append(1)
        return real_loadtxt(*args, **kwargs)  # type: ignore[no-any-return]

    monkeypatch.setattr(_delimited_fast.np, "loadtxt", spy_loadtxt)
    matrix = try_fast_parse_matrix(rows, 0, 2, ",")
    assert matrix is None
    assert calls == [], "np.loadtxt must not be attempted once the probe catches the tail cell"


def test_tail_only_na_cell_fast_and_slow_agree(tmp_path: Path) -> None:
    n_rows = 5000
    lines = [f"{i}.0,{i}.5" for i in range(n_rows)]
    lines[-1] = "n/a,1.0"
    path = tmp_path / "tail_na.csv"
    path.write_text("T,M\n" + "\n".join(lines) + "\n", encoding="utf-8")
    _assert_fast_and_slow_agree(path)
