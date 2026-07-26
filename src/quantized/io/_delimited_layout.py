"""Row-classification + layout-detection helpers for the delimited-text
parser (:mod:`quantized.io.delimited`).

Split out of ``delimited.py`` to keep both modules under the 500-line
ceiling after P0.4 vectorized `_detect_layout`'s per-cell numeric scoring
(cProfile on a 1M x 8 CSV showed ~9 s of a 14.6 s profiled import inside
this scoring path -- ``float()`` called on every one of 8M cells just to
find the header/data-start row). Pure layer: strings in -> floats/bools/
row-indices out. No fastapi/pydantic/`quantized.routes` imports.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterator, Sequence
from datetime import UTC, datetime

import numpy as np

__all__ = [
    "_datetime_epoch",
    "_detect_layout",
    "_is_numeric",
    "_looks_like_units_row",
    "_numeric_score",
]

_SCORE_CHUNK_ROWS = 4096


def _is_numeric(token: str) -> bool:
    """True if token parses to a number; NaN counts as non-numeric (str2double parity)."""
    try:
        value = float(token)
    except ValueError:
        return False
    return not math.isnan(value)


def _datetime_epoch(token: str) -> float | None:
    """Conservatively parse common ISO/lab timestamp forms as UTC seconds.

    ISO 8601 is tried first and is unambiguous. The slash-format fallback
    assumes US month/day/year order (the common lab-instrument convention).
    KNOWN LIMITATION: a ``DD/MM/YYYY`` file whose day is ≤ 12 on every row
    parses with month and day swapped rather than failing — where day > 12,
    ``strptime`` correctly rejects it. There is no locale-free way to
    disambiguate a bare ``03/04/2026``; ISO is the safe input format.
    """
    value = token.strip()
    if not value:
        return None
    parsed: datetime | None = None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y"):
            try:
                parsed = datetime.strptime(value, fmt)
                break
            except ValueError:
                continue
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.timestamp()


def _numeric_score(row: Sequence[str]) -> float:
    if not row:
        return 0.0
    recognized = sum(
        1 for token in row if _is_numeric(token.strip()) or _datetime_epoch(token) is not None
    )
    return recognized / len(row)


def _looks_like_units_row(row: Sequence[str], n_data_cols: int) -> bool:
    n = len(row)
    if n < max(n_data_cols * 0.5, 2):
        return False
    n_unit_like = 0
    n_non_empty = 0
    for cell in row:
        token = cell.strip()
        if not token:
            n_unit_like += 1
            continue
        n_non_empty += 1
        if re.match(r"^[(\[{].*[)\]}]$", token):
            n_unit_like += 1
        elif " " not in token and not _is_numeric(token):
            has_non_alpha = re.search(r"[^a-zA-Z]", token) is not None
            if (has_non_alpha and len(token) <= 10) or (not has_non_alpha and len(token) <= 4):
                n_unit_like += 1
    return n_non_empty > 0 and (n_unit_like / max(n, 1)) >= 0.6


def _numeric_mask_column(cells: Sequence[str]) -> np.ndarray | None:
    """Vectorized equivalent of ``[_is_numeric(c.strip()) for c in cells]``.

    Returns ``None`` -- never a partially-correct answer -- whenever the
    column can't be PROVEN equivalent to numpy's parser; the caller then
    falls back to the exact per-cell loop for just that column. Same
    fast-path contract as ``delimited._convert_column``: attempt the
    C-speed ``np.asarray(..., dtype=float)`` parse and let any cell numpy
    rejects (an NA-token spelling other than "nan"/"inf", stray text, a
    genuinely malformed number, ...) raise and trigger the fallback.

    Where it succeeds, every cell WAS numpy-float-parseable; the only way
    it can disagree with ``_is_numeric`` is if numpy's parser and Python's
    ``float()`` produced different values for the same string. Verified
    empirically for this project's numpy floor (>=1.26; tested against
    2.4.2) across >20,000 randomized numeric strings plus every case/sign
    spelling of nan/inf, underscore-grouped literals ("1_000"), and
    whitespace padding: zero disagreements -- the same bet already shipped
    in ``_convert_column``.
    """
    try:
        parsed = np.asarray([c.strip() for c in cells], dtype=np.float64)
    except (ValueError, TypeError):
        return None
    # A parseable cell only comes out NaN if it literally spelled some
    # sign/case variant of "nan" -- and no such token can ALSO satisfy
    # `_datetime_epoch` (ISO/slash date patterns are all digit-shaped), so
    # `~isnan` alone reproduces `_is_numeric(...) or _datetime_epoch(...)`
    # exactly for every cell that reaches this fast path.
    return ~np.isnan(parsed)


def _score_chunk(chunk: Sequence[Sequence[str]]) -> list[float]:
    """Vectorized equivalent of ``[_numeric_score(row) for row in chunk]``
    for one block of rows.

    Rows of uniform, nonzero width -- the shape of an actual data region --
    transpose into columns (mirrors ``delimited._tokens_to_columns``) and
    dispatch each column through `_numeric_mask_column` (fast) or the
    exact per-cell ``_is_numeric(...) or _datetime_epoch(...)`` test
    (fallback), then recombine per row. A ragged or all-empty block -- in
    practice only ever the file's header/preamble, a handful of rows --
    falls back to `_numeric_score` row-by-row exactly as before.
    """
    if not chunk:
        return []
    width = len(chunk[0])
    if width == 0 or any(len(row) != width for row in chunk):
        return [_numeric_score(row) for row in chunk]
    recognized = np.zeros(len(chunk), dtype=np.int64)
    for col_cells in zip(*chunk, strict=True):
        mask = _numeric_mask_column(col_cells)
        if mask is None:
            mask = np.array(
                [_is_numeric(c.strip()) or _datetime_epoch(c) is not None for c in col_cells]
            )
        recognized += mask
    return [float(x) for x in recognized / width]


def _iter_row_scores(tokens: Sequence[Sequence[str]]) -> Iterator[float]:
    """Lazily yield ``_numeric_score(row)`` for every row in ``tokens``,
    `_SCORE_CHUNK_ROWS` rows at a time via `_score_chunk`.

    `_detect_layout` only ever needs a PREFIX of these scores in the
    common case (see there), so a consumer that stops early pays for at
    most one vectorized chunk; a consumer that must exhaust the sequence
    (no row ever crosses the layout threshold) still gets C-speed batch
    scoring instead of one Python-level ``float()`` call per cell.
    """
    for start in range(0, len(tokens), _SCORE_CHUNK_ROWS):
        yield from _score_chunk(tokens[start : start + _SCORE_CHUNK_ROWS])


def _detect_layout(tokens: Sequence[Sequence[str]]) -> tuple[int, int, int]:
    """Return 0-based (header_row, data_start, units_row); -1 when absent.

    P0.4: row scores used to be computed eagerly for EVERY row
    (``[_numeric_score(row) for row in tokens]``) even though the scans
    below only ever consume a PREFIX of that list -- on an 8M-cell,
    1M-row file that eager pass alone cost ~9 s of per-cell ``float()``
    calls. Scores are now pulled lazily from `_iter_row_scores`, so the
    first scan stops the moment it finds a match (the near-universal
    case: a numeric-majority row appears within the first few rows,
    right after the header) instead of scoring the whole file. `computed`
    retains every score pulled so far; that is always enough to answer
    the backward-looking checks further down (``scores[first_data - 1]``,
    ``scores[first_data - 2]``) since both indices are < first_data and
    therefore already present in `computed` by the time first_data is
    known -- this is a pure laziness refactor, not an approximation, so
    it reproduces the eager version's output bit-for-bit on every input.
    """
    computed: list[float] = []
    first_data = -1
    for i, s in enumerate(_iter_row_scores(tokens)):
        computed.append(s)
        if s > 0.5:
            first_data = i
            break
    if first_data < 0:
        # The loop above ran to exhaustion without a match, so `computed`
        # already holds the full per-row score list (identical to the old
        # eager `scores`) -- reuse it instead of rescoring.
        #
        # MAIN_PLAN #33. The `> 0.5` rule needs a strict NUMERIC MAJORITY, so a
        # file with as many text columns as numeric ones (T, M, Sample, Operator
        # -> exactly 0.5) matched no row at all and fell back to treating the
        # HEADER as data. That is precisely the mixed text+numeric shape that
        # preserving text columns makes worth importing, so it had to be fixed
        # alongside.
        #
        # Fallback rule: a header is LESS numeric than the data under it. Take
        # the first row that is strictly more numeric than row 0 and still has
        # some numbers. This only runs when the primary rule already failed, so
        # it cannot change any file that parses correctly today.
        first_data = next(
            (i for i, s in enumerate(computed) if i > 0 and s > computed[0] and s > 0),
            0,
        )
    scores = computed
    header_row = -1
    units_row = -1
    if (
        first_data >= 2
        and scores[first_data - 1] < 0.5
        and scores[first_data - 2] < 0.5
        and _looks_like_units_row(tokens[first_data - 1], len(tokens[first_data]))
    ):
        units_row = first_data - 1
        header_row = first_data - 2
    elif first_data >= 1 and scores[first_data - 1] < 0.5:
        header_row = first_data - 1
    return header_row, first_data, units_row
