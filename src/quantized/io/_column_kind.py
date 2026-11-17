"""Is a delimited column numbers or text? One rule for direct import and the wizard.

Shared by :mod:`quantized.io.delimited` (``import_csv``'s automatic column
selection) and :mod:`quantized.io.import_parse` (the Import Wizard's role
guess), which used to disagree: a column ``nan, nan, nan, red, 6`` was a
categorical channel with "nan" as a level on direct import and a ``y``
column in the wizard. Pure layer: strings / arrays in, verdicts out; no
fastapi/pydantic/``quantized.routes`` imports.

The rule (`numeric_column`): a column holds numbers when

* more than a tenth of its rows hold a real number (not NaN), and
* number-like cells are a strict majority of its filled cells.

A NaN spelling ("NaN", "nan", "-NaN") is number-like -- it is how this
app's own writers spell a missing value -- and a missing-value token ("",
"n/a", "-", ...) is not filled at all. A text cell in a numeric column
becomes NaN, and `dropped_text_notes` says which (``red`` above), so no
cell disappears silently. In a CATEGORICAL column a NaN spelling is a
missing value, not a level (`encode_categorical`).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Sequence

import numpy as np

from quantized.io import _delimited_layout as layout
from quantized.io._fortran_float import parse_float

__all__ = [
    "column_counts",
    "dropped_text_notes",
    "encode_categorical",
    "is_nan_word",
    "levels_only",
    "nan_words_and_filled",
    "numeric_column",
]


def is_nan_word(cell: str) -> bool:
    """A NaN spelling ("nan", "-NaN"): a number-like missing value."""
    try:
        return math.isnan(parse_float(cell))
    except ValueError:
        return False


def _is_missing(cell: str) -> bool:
    return cell.lower() in layout._MISSING_TOKENS


def numeric_column(n_real: int, n_like: int, n_filled: int, n_rows: int) -> bool:
    """The shared verdict from the counts: real numbers (not NaN), number-like
    cells (NaN spellings too), filled cells (not blank / a missing token)."""
    return n_real > 0.1 * max(n_rows, 1) and 2 * n_like > n_filled


def column_counts(
    cells: Iterable[str], is_number: Callable[[str], bool] = layout._is_numeric_like
) -> tuple[int, int, int]:
    """``(n_real, n_like, n_filled)`` for raw ``cells`` (already stripped).

    ``is_number`` is the caller's "this cell is a number" test (the wizard
    also counts a comma number as one); default: it parses as a float."""
    n_real = n_like = n_filled = 0
    for cell in cells:
        if _is_missing(cell):
            continue
        n_filled += 1
        if is_nan_word(cell):
            n_like += 1
        elif is_number(cell):
            n_like += 1
            n_real += 1
    return n_real, n_like, n_filled


def nan_words_and_filled(cells: Iterable[str]) -> tuple[int, int]:
    """``(n_nan_words, n_filled)``: for a caller that counts its real numbers
    from already-converted values (direct import's decimal-comma columns)."""
    _, n_nan, n_filled = column_counts(cells, _never)
    return n_nan, n_filled


def _never(_cell: str) -> bool:
    return False


def encode_categorical(cells: Sequence[str]) -> tuple[np.ndarray, tuple[str, ...]]:
    """P1.4: encode raw text cells as float codes ``0..n-1`` plus the ordered
    level table that inverts them (``levels[code] == original string``,
    LOSSLESS). NaN = a missing cell: blank, or a NaN spelling ("nan" is how
    a missing value is written, not a category). Level order is
    first-appearance order in the file."""
    levels: list[str] = []
    seen: dict[str, int] = {}
    codes = np.full(len(cells), np.nan, dtype=np.float64)
    for i, raw in enumerate(cells):
        text = raw.strip()
        if not text or is_nan_word(text):
            continue
        idx = seen.get(text)
        if idx is None:
            idx = len(levels)
            seen[text] = idx
            levels.append(text)
        codes[i] = idx
    return codes, tuple(levels)


def levels_only(cells: Sequence[str]) -> tuple[str, ...]:
    """The level table `encode_categorical` would build, without the codes."""
    levels: dict[str, None] = {}
    for raw in cells:
        text = raw.strip()
        if text and text not in levels and not is_nan_word(text):
            levels[text] = None
    return tuple(levels)


_EXAMPLES = 3


def dropped_text_notes(
    names: Sequence[str],
    matrix: np.ndarray,
    data_tokens: Sequence[Sequence[str]],
    columns: Sequence[int],
) -> list[str]:
    """Notes on numeric columns in ``columns`` whose text cells were read as
    NaN (``red`` in ``nan, nan, nan, red, 6``), naming up to three.

    One affected column gets its own note. Several get ONE combined note
    (``19 columns: text cells read as missing (e.g. 'CONC.', ...)``): a file
    whose header rows landed in the data has the same few words in every
    column, and a note apiece buried everything else the importer said.

    A missing-value token or NaN spelling was missing already, and a comma
    cell has its own note (`_decimal_comma.stray_comma_notes`); only columns
    with a NaN are inspected, so a clean file pays nothing."""
    found: list[tuple[str, list[str]]] = []
    for c in columns:
        if c >= matrix.shape[1] or not np.isnan(matrix[:, c]).any():
            continue
        dropped: list[str] = []
        for r, row in enumerate(data_tokens):
            if r >= matrix.shape[0]:
                break
            cell = row[c].strip() if c < len(row) else ""
            if not np.isnan(matrix[r, c]) or not cell or "," in cell:
                continue
            if _is_missing(cell) or is_nan_word(cell):
                continue
            dropped.append(cell)
        if dropped:
            found.append((names[c], dropped))
    if not found:
        return []
    if len(found) > 1:
        distinct = list(dict.fromkeys(d for _, cells in found for d in cells))
        shown = ", ".join(f"'{d}'" for d in distinct[:_EXAMPLES])
        more = "" if len(distinct) <= _EXAMPLES else ", ..."
        return [f"{len(found)} columns: text cells read as missing (e.g. {shown}{more})."]
    name, dropped = found[0]
    distinct = list(dict.fromkeys(dropped))
    shown = ", ".join(f"'{d}'" for d in distinct[:_EXAMPLES])
    more = "" if len(distinct) <= _EXAMPLES else ", ..."
    n = len(dropped)
    return [
        f"Column '{name}' is numeric; {n} text cell{'' if n == 1 else 's'} "
        f"({shown}{more}) {'was' if n == 1 else 'were'} read as missing (NaN)."
    ]
