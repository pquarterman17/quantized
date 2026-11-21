"""Header cells of a whitespace-aligned table whose NAMES contain spaces.

``"Temperature (K)   Moment (emu)"`` over two numeric columns split on every
whitespace run is four tokens, so the importer kept the first ones it could
fit (``"Temperature"``, ``"(K)"``) and labelled the columns wrong. The data rows
carry no spaces inside a cell, so the data fixes the column count; the header is
regrouped only when that yields exactly that many names. Pure layer.
"""

from __future__ import annotations

import re

__all__ = ["regroup_space_header"]

_WIDE_GAP = re.compile(r"\s{2,}|\t")


def regroup_space_header(line: str, n_cols: int) -> list[str] | None:
    """Header names for ``n_cols`` columns, or None when no unambiguous grouping.

    Tries (1) a split on 2+ spaces or tabs (aligned exports), then (2) a split on
    single spaces that glues a bracketed unit token (``(K)`` / ``[Oe]``) to the name
    before it.
    """
    gap = [c.strip() for c in _WIDE_GAP.split(line.strip()) if c.strip()]
    if len(gap) == n_cols:
        return gap
    merged: list[str] = []
    for tok in line.split():
        if merged and tok[0] in "([" and tok[-1] in ")]":
            merged[-1] = f"{merged[-1]} {tok}"
        else:
            merged.append(tok)
    return merged if len(merged) == n_cols else None
