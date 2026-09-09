"""Row-indexed metadata sidecars, and the one place that knows which keys those are.

The Python counterpart of ``frontend/src/lib/rowSidecars.ts``: the same module
name, the same key list, and the same per-cell slicing rule.

WHAT "MIRROR" DOES AND DOES NOT MEAN HERE. Only the pieces the backend needs are
mirrored -- ``slice_row_sidecars`` and the cell semantics. ``concatRowSidecars``,
``sidecarRowCount``, ``insertRowIndexes`` and ``SidecarPart`` have no counterpart
here (they serve frontend merge/row-edit paths), and ``drop_row_sidecars`` has
none there. An earlier version of this docstring claimed the two matched
"name-for-name" and that the pair therefore "cannot drift silently"; both were
false -- nothing compared them at all, including for the
``datastruct.is_categorical`` / ``lib/categorical.isCategoricalChannel``
precedent it cited.

The KEY LIST is now actually enforced:
``tests/test_row_sidecars.py::TestMirrorsTheTypeScriptModule`` parses
``ROW_INDEXED_SIDECARS`` out of the ``.ts`` file and fails on any divergence,
because an added row-indexed sidecar that only one side slices is precisely the
bug this module exists to prevent. The CELL SEMANTICS are pinned case-by-case in
``TestMatchesTypeScriptCellSemantics`` (three real divergences were found there
by review after this module was first called a mirror); those are still
hand-kept, so add a case there when you touch either side.

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

from collections.abc import Iterable, Mapping, Sequence
from typing import Any

__all__ = ["ROW_INDEXED_SIDECARS", "drop_row_sidecars", "slice_row_sidecars"]

#: ``text_columns`` and ``origin_text_columns`` are the two spellings of the
#: inline-text sidecar (the frontend's ``lib/columnmeta.ts`` reads
#: ``text_columns ?? origin_text_columns``); ``origin_report_sheets`` is the same
#: ``{name: [cell per row]}`` shape, holding Origin report-sheet references.
ROW_INDEXED_SIDECARS = ("text_columns", "origin_text_columns", "origin_report_sheets")


def _cell(cells: Sequence[Any], i: Any) -> Any:
    """One cell, or ``""`` for anything that is not a real position in ``cells``.

    Mirrors the TypeScript ``cells[i] ?? ""``, and the three ways it can differ
    were all found by review after this module was first called a mirror:

    * ``None`` becomes ``""``. JS ``?? ""`` catches ``null`` as well as
      ``undefined``, and this is not hypothetical -- the TS module's own doc says
      ``??`` exists because ``undefined`` "would serialize to ``null`` and read
      back as a hole", so a ``.dwk``/wire round trip produces exactly this cell.
      Python was handing the ``None`` straight back.
    * A NON-INTEGER index is a miss, not a truncation. ``int(i)`` turned ``1.5``
      into ``1`` and returned a real cell where JS returns ``undefined`` -> ``""``.
    * A non-numeric index is a miss rather than a ``TypeError``.
    """
    if not isinstance(i, int) or isinstance(i, bool):
        return ""
    return cells[i] if 0 <= i < len(cells) and cells[i] is not None else ""


def _is_position(cells: Sequence[Any], i: Any) -> bool:
    """Does ``i`` name a real position in ``cells``? The trailing-trim predicate."""
    return isinstance(i, int) and not isinstance(i, bool) and 0 <= i < len(cells)


def _slice_cells(cells: Sequence[Any], row_indexes: list[Any]) -> list[Any]:
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
    while end > 0 and not _is_position(cells, row_indexes[end - 1]):
        end -= 1
    return [_cell(cells, i) for i in row_indexes[:end]]


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
        # `list` OR `tuple`: DataStruct fields are routinely tuples on this side
        # (`cat_levels` is a tuple of str), and a `list`-only check silently handed
        # a tuple column back UNSLICED at its original length -- a caller of the
        # pure Python API (`apply_corrections`) got misaligned cells with no sign.
        # The TS side has no such split; `Array.isArray` covers its only sequence.
        if not isinstance(cells, (list, tuple)):
            out[name] = cells
            continue
        sliced = _slice_cells(cells, row_indexes)
        if sliced:
            out[name] = sliced
    return out


def slice_row_sidecars(metadata: Mapping[str, Any], row_indexes: Iterable[Any]) -> dict[str, Any]:
    """A copy of ``metadata`` with every row-indexed sidecar sliced to
    ``row_indexes`` (the surviving source row numbers, in output order) and
    everything else carried through unchanged.

    Use this whenever an operation keeps a SUBSET of rows in their original
    identity -- a trim, a mask, a row filter. When rows are instead REPLACED
    (interpolation, aggregation) there is no mapping to slice to and
    :func:`drop_row_sidecars` is the honest answer.
    """
    # NOT `int(i)`: coercing here is what made a non-integer index return a real
    # cell instead of a blank (see `_cell`). Indexes pass through as given and the
    # position checks judge them.
    rows = list(row_indexes)
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
