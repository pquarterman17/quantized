"""Bulk-numeric fast path for the delimited-text parser (:mod:`quantized.io.delimited`).

P0.4-perf4: on a 1M x 7 numeric CSV, ``delimited.py``'s per-row
``line.split(delim)`` tokenize + ``_tokens_to_columns``'s transpose +
``_convert_column``'s per-column ``np.asarray`` together cost ~6.8s of a
7.3s ``import_auto`` (measured via cProfile). ``np.loadtxt`` parses the
identical file (tokenize + convert, C-level) in ~0.69s. This module gives
the REGULAR-file case -- no ragged rows, no text/NA cells, a clean
rectangular numeric block -- straight to ``np.loadtxt`` on the raw text,
skipping the Python-level tokenize/transpose/convert stages entirely.

Pure library: strings/ndarrays in, an ndarray (or ``None``) out. No
fastapi/pydantic/``quantized.routes`` imports (see CLAUDE.md layering
rule) -- this module answers only "can the data block be bulk-parsed",
never how the surrounding file is laid out or what the result MEANS.

Correctness contract: `try_fast_parse_matrix` returns ``None`` -- never a
wrong or partial answer -- whenever it cannot PROVE the bulk parse is
safe (the cheap prefix probe) or the real parse fails for any reason (a
stray NA spelling/text cell anywhere past the probe window, a ragged row,
a blank cell, ...). The caller (`delimited.import_csv`) always falls back
to the exact original tokenize/transpose/convert path on ``None``, so this
module can only ever skip an optimization, never change a result.
"""

from __future__ import annotations

import io as _io
from collections.abc import Iterator, Sequence
from typing import overload

import numpy as np

__all__ = ["LazyTokenRows", "try_fast_parse_matrix"]


class LazyTokenRows(Sequence[Sequence[str]]):
    """A ``Sequence[Sequence[str]]`` over ``raw_lines`` that tokenizes
    (``line.split(delim)``) each row ONLY the first time it is accessed,
    memoizing the result.

    ``_delimited_layout._detect_layout`` already reads its rows lazily
    (`_iter_row_scores` stops at the first numeric-majority row, almost
    always within the first few lines) -- but that laziness was wasted
    when its caller pre-tokenized every line of the file up front before
    ever calling it. Passing this wrapper instead means layout detection
    on a well-formed file (header + a handful of preamble rows, then a
    million data rows it never has to look at) tokenizes only the rows it
    actually reads, not the whole file -- the same 1M-row file whose
    eager ``[line.split(delim) for line in raw_lines]`` alone cost ~2.8s
    (cProfile, P0.4-perf4) tokenizes a few rows here instead.

    A pathological file (no row ever reaches the numeric-majority
    threshold) still visits every row -- exactly the cost the old eager
    tokenize always paid, so this is a pure laziness refactor with no
    regression on the worst case, not a heuristic that can under-detect.
    """

    __slots__ = ("_raw_lines", "_delim", "_cache")

    def __init__(self, raw_lines: Sequence[str], delim: str) -> None:
        self._raw_lines = raw_lines
        self._delim = delim
        self._cache: dict[int, list[str]] = {}

    def __len__(self) -> int:
        return len(self._raw_lines)

    def _row(self, index: int) -> list[str]:
        row = self._cache.get(index)
        if row is None:
            row = self._raw_lines[index].split(self._delim)
            self._cache[index] = row
        return row

    @overload
    def __getitem__(self, index: int) -> list[str]: ...
    @overload
    def __getitem__(self, index: slice) -> list[list[str]]: ...

    def __getitem__(self, index: int | slice) -> list[str] | list[list[str]]:
        if isinstance(index, slice):
            return [self._row(i) for i in range(*index.indices(len(self)))]
        # `range(len(self))[index]` reproduces exactly the semantics a real
        # `list` gives a single integer index -- negative indices counted
        # from the end, an out-of-range index (positive OR negative) raises
        # `IndexError` -- rather than the bare `index += len(self)` this
        # replaced, which left an out-of-range negative index still negative
        # (e.g. `lz[-4]` on a 3-row sequence silently wrapped to `lz[-1]`,
        # the last row, instead of raising) and, worse, cached the row under
        # that un-normalized key, so a later in-range access could collide
        # with it. Normalizing here means `_row` is only ever called with a
        # canonical `0 <= index < len(self)` cache key.
        index = range(len(self))[index]
        return self._row(index)


class _DeferredDataTokens(Sequence[Sequence[str]]):
    """Row-token access to the DATA block, materialized only on first use.

    When `try_fast_parse_matrix` succeeds, ``delimited.import_csv`` never
    needs a per-row string-token list for the data block at all -- but a
    handful of RARE branches downstream (a near-all-NaN time column that
    needs a datetime re-parse, an all-text data set falling back to
    categorical, the ``text_columns``/``label_rows`` sidecars) still read
    raw cells row by row. Deferring the tokenize (and caching it once
    built) means the common, fully-numeric-parse case never pays for it,
    while any of those rare branches still gets the exact same rows the
    original eager tokenize would have produced.

    The fallback tokenize/transpose/convert path already builds this exact
    row list itself (``data_tokens_list``), so it is assigned to
    ``data_tokens`` directly there instead of being handed to this class --
    this wrapper exists only for the fast-parse branch, where no such list
    has been built.
    """

    __slots__ = ("_raw_lines", "_start", "_delim")

    def __init__(self, raw_lines: Sequence[str], start: int, delim: str) -> None:
        self._raw_lines = raw_lines
        self._start = start
        self._delim = delim

    def _materialize(self) -> list[list[str]]:
        return [line.split(self._delim) for line in self._raw_lines[self._start :]]

    def __len__(self) -> int:
        return len(self._raw_lines) - self._start

    @overload
    def __getitem__(self, index: int) -> list[str]: ...
    @overload
    def __getitem__(self, index: slice) -> list[list[str]]: ...

    def __getitem__(self, index: int | slice) -> list[str] | list[list[str]]:
        return self._materialize()[index]

    def __iter__(self) -> Iterator[list[str]]:
        return iter(self._materialize())


# Total rows sampled to decide whether the real (whole-file) bulk parse is
# even worth attempting. Cheap relative to a million-row file, generous
# enough to catch the common failure shapes (a ragged preamble leftover, a
# stray text/NA column).
_PROBE_ROWS = 2000


def _probe_sample(raw_lines: Sequence[str], data_start: int, n_rows: int) -> list[str]:
    """Up to `_PROBE_ROWS` lines drawn from the START, MIDDLE, and END of the
    data block (roughly a third each) instead of only the start.

    A prefix-only probe never sees an ineligible cell placed past
    `_PROBE_ROWS` from the top -- a lone "n/a" on the very last row of an
    otherwise-clean million-row block, say -- so it would pass every time
    and the expensive path would run anyway: join the whole block into one
    ~100 MB string and run `np.loadtxt` over it, only to have that fail on
    the very last row and fall back regardless, having paid for the full
    join and parse first. Splitting the same `_PROBE_ROWS` budget across the
    start, middle, and end catches that shape too, while staying the same
    O(`_PROBE_ROWS`) total cost regardless of how large the block is.
    """
    if n_rows <= _PROBE_ROWS:
        return list(raw_lines[data_start : data_start + n_rows])
    third = _PROBE_ROWS // 3
    start = data_start
    middle = data_start + n_rows // 2 - third // 2
    end = data_start + n_rows - third
    return [
        *raw_lines[start : start + third],
        *raw_lines[middle : middle + third],
        *raw_lines[end : end + (_PROBE_ROWS - 2 * third)],
    ]


def _probe_all_numeric(sample_lines: Sequence[str], delim: str, n_cols: int) -> bool:
    """True if every sampled line splits to exactly ``n_cols`` tokens and
    every token is ``float()``-parseable (so also accepts the "nan"/"inf"
    spellings ``float()`` itself understands -- same tokens the real
    ``np.loadtxt`` call below will accept).

    An approximate, CHEAP gate only: it exists to skip attempting the
    expensive whole-file parse on a file that is obviously ragged or
    carries a text/NA column, not to prove correctness -- that proof is
    the try/except around the actual parse in `try_fast_parse_matrix`.
    A token this probe misses (elsewhere in the file) simply means the
    real parse raises and the caller falls back; it can never produce a
    wrong answer.
    """
    for line in sample_lines:
        tokens = line.split(delim)
        if len(tokens) != n_cols:
            return False
        for tok in tokens:
            try:
                float(tok)
            except ValueError:
                return False
    return True


def try_fast_parse_matrix(
    raw_lines: Sequence[str], data_start: int, n_cols: int, delim: str
) -> np.ndarray | None:
    """Bulk-parse ``raw_lines[data_start:]`` straight from text into a
    ``(n_rows, n_cols)`` float64 matrix via ``np.loadtxt`` -- one C-level
    pass, no Python-level per-row tokenize, no ``zip`` transpose, no
    per-column ``np.asarray`` call.

    Returns ``None`` (never a partial or altered result) when:
    * the block is empty or ``n_cols <= 0``;
    * the cheap `_probe_all_numeric` check fails on the `_probe_sample`
      (a ragged row or a text/NA cell anywhere in the sampled start/middle/end
      of the data block) -- skips even attempting the expensive whole-file
      parse on an obviously-ineligible file;
    * the real ``np.loadtxt`` call raises for ANY reason -- a stray NA
      spelling ("na", "-", "n/a", ...) or text cell past the probe window,
      a ragged row past it, a blank cell (double delimiter), an encoding
      surprise, ... -- caught and reported as ineligible rather than
      allowed to propagate, so the caller's fallback is the only path that
      ever runs on such a file;
    * the parsed shape doesn't match the expected ``(n_rows, n_cols)``
      (defensive; guards against a numpy version silently squeezing a
      degenerate shape).
    """
    n_rows = len(raw_lines) - data_start
    if n_rows <= 0 or n_cols <= 0:
        return None
    sample = _probe_sample(raw_lines, data_start, n_rows)
    if not _probe_all_numeric(sample, delim, n_cols):
        return None
    block = "\n".join(raw_lines[data_start:])
    try:
        matrix = np.loadtxt(
            _io.StringIO(block),
            delimiter=delim,
            dtype=np.float64,
            ndmin=2,
            comments=None,
        )
    except (ValueError, TypeError, UnicodeDecodeError):
        return None
    if matrix.shape != (n_rows, n_cols):
        return None
    return matrix
