"""A third ``.opju`` sheet signal: the sheet a column record is written under.

``opju_curve_sheets`` proves a column id's sheet by rank and
``opju_sheet_signals`` by the dataset header's column reference (H) and the
stored X partner (P). Both leave ids unproven when a ``(book, column)`` name
has fewer ids than datasets -- report sheets (``FitNL1``, ``FitLinear1``)
store their columns without the id records the other sheets have, so
``Book_B`` / ``@3`` / ``@2`` / ``@5`` / ``@4`` datasets face 3 ids -- and
neither H nor P names them.

**S -- the window's own sheet list.** A book's window section writes its
sheets in window order, each opened by a sheet (layer) header and followed
by that sheet's column records. The header's sparse stream carries the
2-byte ``Pd`` field that precedes every sheet name in the ``.opj`` layer
header (``origin_project_format`` section 4.1), written ``82 02 50 64``
(skip 5 zero bytes, then ``P d``). Every column record between one such
marker and the next belongs to the same sheet. Over the 32 multi-sheet books
of the 16 COM-checked files (Origin 2026b, 2026-11-15) the marker count
equals the book's sheet count and every segment holds that sheet's name.

A segment names no sheet NUMBER (sheet ``@N`` ids are creation ids, not
window positions: ``Catchment A``'s second sheet is ``@7``). It is anchored by
the ids in it whose sheet is already proven (rank, H or P): when they all
agree, every other id of the segment is on that sheet. Fail closed:

* a book whose span has a column record before its first marker, or no
  marker, is not segmented;
* a segment whose proven ids name two sheets, or a sheet two segments of
  the book name, proves nothing (in either segment);
* the dataset ``Book_Col[@N]`` must exist, and no other id of the same
  ``(book, column)`` may be on that sheet (the same checks as signals H/P).

Corpus (359 ``.opju``, 2026-11-15): 3,598 segments holding 35,128 ids
already proven by rank / H / P: 0 segments whose proven ids disagree, 0
sheets claimed by two segments of a book. An id S places joins
``SheetGates.newly``, so its curves face the same X / plot-type checks as
H/P-placed ones. COM evidence: ``ORIGIN_FILE_DECODE_PLAN`` item 67.
"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Mapping

from quantized.io.origin_project.opju_column_fixed import fixed_column_record
from quantized.io.origin_project.opju_curve_token import column_id_records
from quantized.io.origin_project.opju_figure_curves import (
    ColumnIdTable,
    _parse_column_record,
    opju_pages,
)
from quantized.io.origin_project.opju_sheet_signals import SheetGates, header_column_refs, sheet_map

__all__ = ["SHEET_MARK", "record_segments", "resolve_by_segments", "sheet_map_with_segments"]

SHEET_MARK = re.compile(rb"\x82\x02\x50\x64")  # skip 5 zeros, "Pd"


def record_segments(
    b: bytes, ids: Mapping[int, tuple[str, str]]
) -> dict[tuple[str, int], list[int]]:
    """``{(book, segment index): [column id, ...]}`` for every book whose
    window section is cleanly segmented (module docstring); a record whose
    id the table does not hold as that ``(book, name)`` is ignored."""
    pages = opju_pages(b)
    bounds = [*pages, (len(b), "")]
    out: dict[tuple[str, int], list[int]] = {}
    for (start, book), (end, _next) in zip(bounds, bounds[1:], strict=False):
        marks = [m.start() for m in SHEET_MARK.finditer(b, start, end)]
        if not marks:
            continue
        recs: list[tuple[int, int]] = []
        for off, cid, fields in column_id_records(b, start, end):  # every id form
            parsed = _parse_column_record(b, fields - 1) or fixed_column_record(b, off)
            if parsed is None or ids.get(cid) != (book, parsed[0]):
                continue
            recs.append((off, cid))
        if not recs or min(o for o, _ in recs) < marks[0]:
            continue  # a column before the first sheet header: not understood
        segs: dict[tuple[str, int], list[int]] = defaultdict(list)
        for off, cid in sorted(recs):
            k = sum(1 for m in marks if m < off) - 1
            segs[(book, k)].append(cid)
        out.update(segs)
    return out


def resolve_by_segments(
    b: bytes,
    ids: Mapping[int, tuple[str, str]],
    off_sheet: Mapping[int, str],
) -> dict[int, str]:
    """``off_sheet`` with every unknown (``""``) id that signal S proves set
    to its sheet key (``"Book"`` / ``"Book@N"``); the rest unchanged."""
    if not any(not s for s in off_sheet.values()):
        return dict(off_sheet)
    _refs, names = header_column_refs(b)

    def proven(cid: int) -> str:
        return off_sheet.get(cid, ids[cid][0])

    segs = record_segments(b, ids)
    anchor: dict[tuple[str, int], str] = {}
    claims: dict[tuple[str, str], list[tuple[str, int]]] = defaultdict(list)
    for seg, cids in segs.items():
        sheets = {proven(c) for c in cids} - {""}
        if len(sheets) == 1:
            sheet = sheets.pop()
            anchor[seg] = sheet
            claims[(seg[0], sheet)].append(seg)
        elif sheets:
            claims[(seg[0], "")].append(seg)  # contradictory segment
    for (_book, _sheet), owners in claims.items():
        if len(owners) > 1:
            for seg in owners:
                anchor.pop(seg, None)

    found: dict[int, str] = {}
    for seg, sheet in anchor.items():
        for cid in segs[seg]:
            if proven(cid):
                continue
            book, col = ids[cid]
            if (book, col, sheet.partition("@")[2]) in names:
                found[cid] = sheet

    holders: dict[tuple[str, str, str], list[int]] = defaultdict(list)
    for cid, key in ids.items():
        sheet = found.get(cid) or proven(cid)
        if sheet:
            holders[(*key, sheet)].append(cid)
    out = dict(off_sheet)
    for cid, sheet in found.items():
        if len(holders[(*ids[cid], sheet)]) == 1:
            out[cid] = sheet
    return out


def sheet_map_with_segments(b: bytes, table: ColumnIdTable) -> tuple[dict[int, str], SheetGates]:
    """``opju_sheet_signals.sheet_map`` plus signal S: the ids S places join
    ``gates.newly`` (the curves plotting them face the same
    ``newly_proven_reason`` checks as H/P-placed ones)."""
    off_sheet, gates = sheet_map(b, table)
    after = resolve_by_segments(b, table.ids, off_sheet)
    added = frozenset(c for c, s in after.items() if s and not off_sheet.get(c))
    if not added:
        return off_sheet, gates
    return after, gates._replace(newly=gates.newly | added)
