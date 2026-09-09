"""Row-indexed metadata sidecars, and the one place that knows which keys those are.

The Python mirror of ``frontend/src/lib/rowSidecars.ts`` -- deliberately the same
module name, the same key list and the same slicing rule, because the two are
kept in sync BY HAND (the same arrangement ``datastruct.is_categorical`` /
``lib/categorical.isCategoricalChannel`` already use). Changing one without the
other is the bug this module exists to prevent.

Most of ``DataStruct.metadata`` is structural or file-level and survives a row
operation untouched. THREE keys are not: they hold one cell per ROW, so any
operation that keeps a subset of rows has to keep the same subset of their cells,
or every cell describes a different measurement than the one beside it -- a
sample id or an operator read against the wrong row, silently.

The keys are ENUMERATED, not inferred. "Slice anything shaped like
``{name: list}``" would also hit the channel-indexed collections and be the
mirror-image bug: ``label_rows``' cells are per-CHANNEL, ``all_column_names`` is
the column roster, ``comments``/``source`` are file-level.

WHY THIS IS ITS OWN MODULE, not a helper in ``calc/``: ``calc/`` and ``io/`` are
pure libraries and both need this, and a metadata contract belongs beside the
data contract rather than inside one consumer of it.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

__all__ = ["ROW_INDEXED_SIDECARS", "drop_row_sidecars", "slice_row_sidecars"]

#: ``text_columns`` and ``origin_text_columns`` are the two spellings of the
#: inline-text sidecar (the frontend's ``lib/columnmeta.ts`` reads
#: ``text_columns ?? origin_text_columns``); ``origin_report_sheets`` is the same
#: ``{name: [cell per row]}`` shape, holding Origin report-sheet references.
ROW_INDEXED_SIDECARS = ("text_columns", "origin_text_columns", "origin_report_sheets")


def _slice_cells(cells: list[Any], row_indexes: list[int]) -> list[Any]:
    """Slice one column's cells to ``row_indexes``.

    A gap inside the kept range yields ``""`` -- the blank the worksheet already
    renders for a missing cell -- rather than ``None``, which serializes to
    ``null`` and reads back as a hole.

    TRAILING misses are dropped rather than materialized, matching the
    TypeScript side: a column shorter than the grid already reads as blank for
    the rows it does not cover, so padding it out changes nothing on screen while
    growing every saved copy.
    """
    end = len(row_indexes)
    while end > 0 and not (0 <= row_indexes[end - 1] < len(cells)):
        end -= 1
    return [cells[i] if 0 <= i < len(cells) else "" for i in row_indexes[:end]]


def _slice_one(raw: Any, row_indexes: list[int]) -> Any:
    """Slice one ``{column: [cell per row]}`` sidecar.

    A value that is not a mapping of lists is a corrupted sidecar and is returned
    UNTOUCHED: reshaping data we failed to understand is worse than leaving it
    alone. A column the slice empties is REMOVED rather than kept as ``[]``,
    since several readers test only for a key's presence.
    """
    if not isinstance(raw, Mapping):
        return raw
    out: dict[str, Any] = {}
    for name, cells in raw.items():
        if not isinstance(cells, list):
            out[name] = cells
            continue
        sliced = _slice_cells(cells, row_indexes)
        if sliced:
            out[name] = sliced
    return out


def slice_row_sidecars(metadata: Mapping[str, Any], row_indexes: Iterable[int]) -> dict[str, Any]:
    """A copy of ``metadata`` with every row-indexed sidecar sliced to
    ``row_indexes`` (the surviving source row numbers, in output order) and
    everything else carried through unchanged.

    Use this whenever an operation keeps a SUBSET of rows in their original
    identity -- a trim, a mask, a row filter. When rows are instead REPLACED
    (interpolation, aggregation) there is no mapping to slice to and
    :func:`drop_row_sidecars` is the honest answer.
    """
    rows = [int(i) for i in row_indexes]
    out = dict(metadata)
    for key in ROW_INDEXED_SIDECARS:
        if key in out:
            out[key] = _slice_one(out[key], rows)
    return out


def drop_row_sidecars(metadata: Mapping[str, Any]) -> dict[str, Any]:
    """A copy of ``metadata`` with the row-indexed sidecars REMOVED.

    For an operation whose output rows are not a subset of its input rows -- x
    resampling interpolates onto a new grid, so no output row IS any input row.
    There is nothing to slice to, so the sidecars fail closed. The same reasoning
    already governs ``cat_levels`` on those paths: carrying a per-row cell
    against rows it cannot describe is worse than not carrying it.
    """
    out = dict(metadata)
    for key in ROW_INDEXED_SIDECARS:
        out.pop(key, None)
    return out
