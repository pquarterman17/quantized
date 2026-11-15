"""A second ``.opju`` sheet signal: the dataset header's column reference.

``opju_curve_sheets.off_sheet_ids`` proves a column id's sheet by RANK: the
k-th smallest id of a ``(book, column)`` name is the k-th ``Book_Col[@N]``
dataset in file order. When the id and dataset counts of a name differ
(a deleted sheet, a column record that did not parse) no id of that name is
proven and every curve plotting one is omitted as ``sheet_unknown``. This
module recovers the ones a second, independent signal proves.

**H -- the dataset header names a column on its own sheet.** Bytes
``0x52-0x53`` of the 147-byte column-storage header (``opju_blocks``) are a
little-endian column id, 0 when unset. On a Y dataset it is usually the
column's X (``Book1_B@7`` -> 17, the id of ``A@7``); on others a
neighbouring column (``Book33_E@5`` -> the id of ``C``). Whatever it names,
that id is on the dataset's sheet: over all 359 corpus ``.opju`` files,
8,642 referenced ids whose sheet the rank alignment proves sit on the
referencing dataset's sheet, 0 elsewhere (19,893 same-book references in
all, 0 to a rank-proven other sheet). A reference to another book's id is
ignored (the ``Residual*`` report pages alias source-book ids, plan
item 69), and an id referenced from two sheets of its book proves nothing.

**P -- a Y column is on its stored X partner's sheet.** The id record's
``<x_partner_id> 21 61`` field (``opju_figure_curves``) names the X the
column was designated against; Origin designates X per sheet. Over the
same corpus 15,556 rank-proven (Y, partner) pairs share a sheet, 0 differ.

An id still unproven after the rank alignment takes the sheet H names for
it directly, else the sheet of its stored partner (rank-proven or
H-proven). H and P never disagree in the corpus; if they ever do, the id
stays unknown. The result is accepted only when it is coherent with what
the file stores, else the id stays unknown (fail closed):

* the dataset ``Book_Col[@N]`` exists (the importer's ``Book@N`` can only
  hold a column it read);
* no other id of the same ``(book, column)`` is on that sheet -- a name
  occurs once per sheet, so a collision means a signal is wrong; every
  id involved in it stays unknown.

**Evidence (Origin 2026b COM, 2026-11-15).** See
``ORIGIN_FILE_DECODE_PLAN`` item 67: the curves this re-binds were compared
with Origin's own ``%Z`` per layer and with the data Origin plots.
"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Collection, Mapping
from typing import TYPE_CHECKING

from quantized.io.origin_project.opju_blocks import HEADER_LEN, find_headers, rle_expand
from quantized.io.origin_project.opju_curve_sheets import off_sheet_ids

if TYPE_CHECKING:  # opju_figure_curves imports this module
    from quantized.io.origin_project.opju_figure_curves import ColumnIdTable

__all__ = ["header_column_refs", "newly_proven_reason", "resolve_unknown_sheets", "sheet_map"]

_REF_OFF = 0x52  # u16 LE column id in the expanded 147-byte header


def header_column_refs(
    b: bytes,
) -> tuple[dict[int, set[tuple[str, str]]], set[tuple[str, str, str]]]:
    """``({column id: {(book, sheet key)}}, {(book, column, suffix)})``.

    The first map is signal H: every non-zero header reference, with the
    referencing dataset's book and sheet key (``"Book"`` for the unsuffixed
    sheet, ``"Book@N"``). The second is every worksheet column dataset the
    file stores, ``suffix`` ``""`` for the unsuffixed one.
    """
    refs: dict[int, set[tuple[str, str]]] = defaultdict(set)
    names: set[tuple[str, str, str]] = set()
    for h in find_headers(b):
        if not h.is_column:
            continue
        base, _, sheet = h.name.partition("@")
        book, _, col = base.rpartition("_")
        if not book:
            continue
        names.add((book, col, sheet))
        lead = 3 if b[h.start + 1] & 0x80 else 2  # 80 <clen varint>
        raw = rle_expand(b, h.start + lead, h.end - h.start - lead, HEADER_LEN)
        if raw is None or len(raw) != HEADER_LEN:
            continue
        ref = int.from_bytes(raw[_REF_OFF : _REF_OFF + 2], "little")
        if ref:
            refs[ref].add((book, f"{book}@{sheet}" if sheet else book))
    return refs, names


def resolve_unknown_sheets(
    b: bytes,
    ids: Mapping[int, tuple[str, str]],
    x_partner: Mapping[int, int],
    off_sheet: Mapping[int, str],
) -> dict[int, str]:
    """``off_sheet`` with every unknown (``""``) id that signal H or P
    proves set to its sheet key (``"Book"`` for the unsuffixed sheet,
    ``"Book@N"`` otherwise); the rest stay ``""`` (module docstring)."""
    unknown = [cid for cid, s in off_sheet.items() if not s and cid in ids]
    if not unknown:
        return dict(off_sheet)
    refs, names = header_column_refs(b)

    def proven(cid: int) -> str:
        book = ids[cid][0]
        return off_sheet.get(cid, book)

    def by_header(cid: int) -> str:
        book = ids[cid][0]
        sheets = {key for bk, key in refs.get(cid, ()) if bk == book}
        return next(iter(sheets)) if len(sheets) == 1 else ""

    found: dict[int, str] = {}
    for cid in unknown:
        book = ids[cid][0]
        h = by_header(cid)
        p = ""
        partner = x_partner.get(cid)
        if partner is not None and partner in ids and ids[partner][0] == book:
            p = proven(partner) or by_header(partner)
        if h and p and h != p:
            continue  # the two signals disagree: nothing is proven
        sheet = h or p
        if not sheet:
            continue
        col = ids[cid][1]
        if (book, col, sheet.partition("@")[2]) not in names:
            continue
        found[cid] = sheet

    # A (book, column) name occurs once per sheet: any collision voids the
    # newly found ids involved in it.
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


def sheet_map(b: bytes, table: ColumnIdTable) -> tuple[dict[int, str], frozenset[int]]:
    """``(off_sheet, newly)`` for ``opju_figure_curves.extract_curves_by_id``.

    ``off_sheet`` is the rank alignment (``off_sheet_ids``) with the unknown
    ids signal H or P proves filled in (``resolve_unknown_sheets``);
    ``newly`` is the ids that only this second signal proves. A curve
    plotting one of them is drawn only if ``newly_proven_reason`` finds
    nothing against its X.
    """
    before = off_sheet_ids(b, table.ids)
    after = resolve_unknown_sheets(b, table.ids, table.x_partner, before)
    newly = frozenset(c for c, s in after.items() if s and not before.get(c))
    return after, newly


# A column id right before the Y designation marker: inside a curve token's
# record, the X the plot itself stores (plan item 70; not decoded yet).
_TOKEN_X = re.compile(rb"(?=(..)\x21\x61)", re.DOTALL)


def newly_proven_reason(
    b: bytes,
    cid: int,
    x_col: str,
    token_span: tuple[int, int],
    layer_span: tuple[int, int],
    ids: Mapping[int, tuple[str, str]],
    x_ids: Collection[int],
) -> str:
    """Why a curve whose column only the second signal places is NOT drawn
    (``""`` = draw it), checked against Origin 2026b COM (plan item 67):

    * ``y_is_x_column``: the plotted column is itself X-designated, so the
      curve's X is the one its token stores (item 70) -- of the 4 such
      curves in the COM data check, 3 drew the wrong X, 1 drew nothing;
    * ``x_token_differs``: the token's own record (``token_span``, up to the
      next curve token) names, before a ``21 61`` marker, a column of the
      same book other than ``x_col`` -- Origin plots against that column
      (2x glass Epoxy Graph1 ``C`` -> ``B@2``, Catchment Graph6 ``I`` ->
      ``D``), which the decoder does not use yet; or the token names none
      and another token of the layer (``layer_span``) stores a different X.

    Curves the rank alignment proves are not subject to this check (their
    X mechanism is item 70's, unchanged here).
    """
    if cid in x_ids:
        return "y_is_x_column"
    book = ids[cid][0]

    def stored(span: tuple[int, int]) -> set[str]:
        out = set()
        for m in _TOKEN_X.finditer(b, *span):
            ref = int.from_bytes(m.group(1), "little")
            if ref in ids and ids[ref][0] == book:
                out.add(ids[ref][1])
        return out

    own = stored(token_span)
    # A token storing no X of its own may still be drawn against one another
    # token of the layer stores (2x glass Epoxy Graph2 O/Q -> N@2): any
    # other X of this book stored in the layer withholds it too.
    if own - {x_col} or (not own and stored(layer_span) - {x_col}):
        return "x_token_differs"
    return ""
