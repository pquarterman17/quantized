"""Which sheet a graph curve's column is recorded on — a diagnostic only.

An ``.opj`` curve anchor names the column it plots by a u16 object id
(``opj_curves.column_id_map``), and the curve binding reports that column
as ``(book, column letter)``: the WORKBOOK, not the sheet. The same object id
sits at 0x04 of the column's property block, and ``opj_sheets`` binds those
property blocks to the sheet ids the datasets carry (``Book_A@N``). So the
file does record a sheet for every curve column; the binding ignores it.

That is not used to re-bind anything. No independent oracle states which
sheet a curve plots (Altaxo and liborigin have no multi-sheet graph test;
LabPlot's column-path assertions are all on single-sheet books — see
``docs/origin_re/validation_log.md``), and changing a binding would move
figure results that cannot be re-checked. It is reported instead: wherever
the recorded sheet is not the one the binding uses, the figure carries a
``curve_sheet_notes`` entry and the import's fidelity says so, so the user
can check the curve or choose the sheet in Recover.

Public corpus (49 unique ``.opj``): 13 curve anchors carry such a note —
12 in ``DO.opj`` (book ``Book1`` is not imported at all; its data is
``Book1@6`` / ``Book1@7``) and 1 in ``strings_testing.opj`` (bound to
``NLFit1`` column B, recorded on ``NLFit1@2``).
"""

from __future__ import annotations

import struct
from collections.abc import Collection, Mapping, Sequence

from quantized.io.origin_project.opj_curves import _CURVE_PREFIX, _DATAPLOT_MAGIC
from quantized.io.origin_project.opj_datasets import parse_dataset_header
from quantized.io.origin_project.opj_sheets import (
    bind_worksheets,
    sole_sheet_books,
    window_sheets,
)

__all__ = ["curve_sheet_keys", "layer_sheet_notes"]


def curve_sheet_keys(blocks: Sequence[tuple[int, bytes]]) -> tuple[dict[int, str], set[str]]:
    """``(column object id -> the book key of the sheet it is on, every
    bound book key)`` over the whole project.

    ``blocks`` is the FULL walk, NULL blocks included (``window_sheets``
    reads a NULL as "this column has no label"). A column whose sheet the
    dataset binding could not place has no entry: nothing is said about it.
    """
    headers = [h for size, p in blocks if size and (h := parse_dataset_header(p)) is not None]
    if not headers:
        return {}, set()
    sheets = window_sheets(blocks)
    bound, _unbound = bind_worksheets(headers, sheets)
    # The reader names a book that is down to one sheet as the book
    # (`opj.py`), so its curves are on the sheet their binding names.
    renamed = sole_sheet_books((h.name for h in headers), sheets)
    keys: dict[int, str] = {}
    for key, sheet in bound.items():
        for object_id in sheet.object_ids:
            keys[object_id] = renamed.get(key, key)
    return keys, {renamed.get(key, key) for key in bound}


def layer_sheet_notes(
    blocks: Sequence[tuple[int, bytes]],
    start: int,
    end: int,
    id_map: Mapping[int, tuple[str, str]],
    sheet_keys: Mapping[int, str],
    curves: Sequence[Mapping[str, object]],
    imported: Collection[str] = (),
) -> list[dict[str, str]]:
    """One note per curve of this layer whose column is recorded on a sheet
    other than the one its binding uses: ``{book, x, y, recorded,
    plotted_from}``, where ``plotted_from`` is the binding's book when that
    is an imported sheet (``imported``, the bound book keys) and ``""`` when
    the binding names a book that has no imported sheet of that name.

    Walks the same anchors as ``opj_curves.extract_curves`` over
    ``blocks[start:end)`` and keeps only those that produced a curve (matched
    by book and column), so a note always names a curve the figure has.
    """
    bound = {(str(c.get("book")), str(c.get("y"))): str(c.get("x")) for c in curves}
    notes: list[dict[str, str]] = []
    last = min(end, len(blocks) - 1)
    for j in range(start, last):
        payload = blocks[j][1]
        if len(payload) < 6 or payload[:4] != _CURVE_PREFIX:
            continue
        if blocks[j + 1][1][:8] != _DATAPLOT_MAGIC:
            continue
        cid = struct.unpack_from("<H", payload, 4)[0]
        info = id_map.get(cid)
        recorded = sheet_keys.get(cid)
        if info is None or recorded is None or info not in bound or recorded == info[0]:
            continue
        book, column = info
        note = {
            "book": book,
            "x": bound[info],
            "y": column,
            "recorded": recorded,
            "plotted_from": book if book in imported else "",
        }
        if note not in notes:
            notes.append(note)
    return notes
