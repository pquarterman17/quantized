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
    "_detect_delimiter",
    "_detect_layout",
    "_is_numeric",
    "_is_numeric_like",
    "_looks_like_units_row",
    "_numeric_score",
    "_to_float",
]

_SCORE_CHUNK_ROWS = 4096

# Shared across every delimited-text reader (delimited.py, sims.py, qd.py,
# lakeshore.py): a `,`/tab/`;`/space plurality vote over the first 10 lines.
_DELIM_CANDIDATES = (",", "\t", ";", " ")


def _detect_delimiter(raw_lines: Sequence[str]) -> str:
    """Pick the delimiter whose per-line count is both present on every
    sampled line and least variable -- a plurality vote, not a strict
    majority, so a ragged preamble line doesn't disqualify the real
    delimiter by itself (see the ``std < mean * 0.5`` consistency check).
    Defaults to comma when nothing qualifies (e.g. every candidate is
    absent from at least one of the first 10 lines)."""
    test = raw_lines[:10]
    best_delim = ","
    best_score = 0.0
    for ch in _DELIM_CANDIDATES:
        counts = [line.count(ch) for line in test]
        if counts and all(c > 0 for c in counts):
            mean = sum(counts) / len(counts)
            std = (sum((c - mean) ** 2 for c in counts) / len(counts)) ** 0.5
            if std < mean * 0.5 and mean > best_score:
                best_score = mean
                best_delim = ch
    return best_delim


def _to_float(token: str) -> float:
    """Best-effort ``str`` -> ``float``; never raises.

    Anything ``float()`` rejects -- an empty cell, an NA spelling ("na",
    "-", "n/a", ...), stray text -- becomes NaN. A literal "nan"/"inf"
    spelling is handled by ``float()`` itself, so no separate NA-token
    table is needed: every spelling a hand-rolled pre-check could catch is,
    by construction, also one ``float()`` itself rejects (verified for the
    5 near-identical copies this consolidates: ``delimited._to_float``'s
    former ``_NA_TOKENS`` pre-check, ``sims``/``qd``/``lakeshore``'s bare
    empty-string guard, and ``ncnr``'s former ``_safe_float`` with no guard
    at all -- all four were behaviourally this exact function already).
    """
    try:
        return float(token.strip())
    except ValueError:
        return float("nan")


def _is_numeric(token: str) -> bool:
    """True if token parses to a number; NaN counts as non-numeric (str2double parity)."""
    try:
        value = float(token)
    except ValueError:
        return False
    return not math.isnan(value)


def _is_numeric_like(token: str) -> bool:
    """Like ``_is_numeric``, but a NaN spelling ("nan", "-nan", "NaN", ...)
    also counts as numeric here.

    D5 (2026-08-27 bug hunt): ``_is_numeric`` deliberately excludes NaN for
    str2double CONVERSION parity with MATLAB's ``+parser/importCSV.m``
    (``detectLayout``, line 401) -- but that same exclusion, reused for
    ``_numeric_score``'s row-CLASSIFICATION heuristic, meant a data row
    with one missing numeric cell scored as if that cell were text. This
    app's own writers emit literal ``"nan"`` for a missing value
    (``_to_float`` above, ``io.origin_project.writer``), so the reader's
    layout scorer must accept its own output. Used ONLY by
    ``_numeric_score``/``_score_chunk`` below -- never by the actual
    string -> float data conversion path (``delimited._convert_column``/
    ``_to_float``), which still must turn "nan" into NaN, not reject it,
    and never by ``_looks_like_units_row``, which keeps the original
    str2double-parity ``_is_numeric``.
    """
    try:
        float(token)
    except ValueError:
        return False
    return True


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
    """Fraction of the row's cells that are numeric.

    D5 (2026-08-27 bug hunt): a NaN/Inf spelling now counts as numeric
    (``_is_numeric_like``, not ``_is_numeric``) -- see its docstring for
    why. A data row with one cell spelled "nan" (``"0.05,nan"``, exactly
    what this app's own ``/api/export/xrd-csv`` writer emits for a missing
    value) now scores 1.0 instead of exactly 0.5 -- the boundary value that
    used to tie with the strict ``> 0.5`` majority rule below and silently
    drop the row (and, via the header check in ``_detect_layout``, the
    header above it too, since 0.5 is also not ``< 0.5``). A header row
    (``"Temp,Moment"``) or units row (``"K,emu"``) is unaffected: neither
    cell parses as a number either way, so both still score 0.0.

    The denominator is deliberately still ``len(row)`` -- EXCLUDING empty
    cells from it (so a truly blank cell, not a "nan" string, also scored
    1.0) was tried and reverted: it regressed a pre-existing, legitimate
    case a real corpus/test already covers -- a genuinely categorical/text
    column with one blank row (``"Time,Tag" / "1,A" / "2," / "3,A"``, see
    ``test_categorical_missing_cell_encodes_as_nan_not_a_level``) -- by
    inflating that row's lone leftover cell to a 1.0 score the row-level
    scorer has no column-type context to justify; it ate both the header
    and the first real data row. The narrower fix here still resolves the
    concretely-proven bug (the round-trip test below), because the app's
    own writers emit the literal string "nan" for a missing numeric cell,
    never a truly empty one.
    """
    if not row:
        return 0.0
    recognized = sum(
        1 for token in row if _is_numeric_like(token.strip()) or _datetime_epoch(token) is not None
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


def _numeric_like_mask_column(cells: Sequence[str]) -> np.ndarray | None:
    """Vectorized equivalent of ``[_is_numeric_like(c.strip()) for c in cells]``.

    Returns ``None`` -- never a partially-correct answer -- whenever the
    column can't be PROVEN equivalent to numpy's parser; the caller then
    falls back to the exact per-cell loop for just that column. Same
    fast-path contract as ``delimited._convert_column``: attempt the
    C-speed ``np.asarray(..., dtype=float)`` parse and let any cell numpy
    rejects (an NA-token spelling other than "nan"/"inf", stray text, a
    genuinely malformed number, an empty cell, ...) raise and trigger the
    fallback.

    D5 (2026-08-27 bug hunt): unlike the old ``_numeric_mask_column``, does
    NOT exclude a NaN-parsed cell (``~np.isnan(parsed)``) -- D5 counts a
    NaN/Inf spelling as numeric, so every cell that parses at all is
    numeric-like here. Where it succeeds, every cell WAS numpy-float-
    parseable; the only way it can disagree with ``_is_numeric_like`` is if
    numpy's parser and Python's ``float()`` produced different values for
    the same string, or disagreed on whether it parses at all -- verified
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
    return np.ones_like(parsed, dtype=bool)


def _score_chunk(chunk: Sequence[Sequence[str]]) -> list[float]:
    """Vectorized equivalent of ``[_numeric_score(row) for row in chunk]``
    for one block of rows.

    Rows of uniform, nonzero width -- the shape of an actual data region --
    transpose into columns (mirrors ``delimited._tokens_to_columns``) and
    dispatch each column through `_numeric_like_mask_column` (fast) or the
    exact per-cell ``_is_numeric_like(...) or _datetime_epoch(...)`` test
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
        mask = _numeric_like_mask_column(col_cells)
        if mask is None:
            mask = np.array(
                [
                    _is_numeric_like(c.strip()) or _datetime_epoch(c) is not None
                    for c in col_cells
                ]
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
