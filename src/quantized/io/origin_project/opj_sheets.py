"""Bind an ``.opj`` dataset's ``@N`` to the sheet of its window that owns it.

A worksheet column is the dataset ``<Book>_<Col>`` on the book's first
sheet and ``<Book>_<Col>@N`` on another; a matrix sheet is ``<Book>`` /
``<Book>@N``. **N is a sheet ID, not a position.** Origin numbers sheets as
they are created and never renumbers: delete a sheet and its id is gone,
drag a tab and the window's sheet order changes while the ids stay. Public
specimens show all three shapes — a single-sheet book whose only sheet is
id 3, a two-sheet book with ids 6 and 7, and a 24-sheet book whose ids run
1-23 with gaps and whose first sheet in the window is id 20. Reading N as
"the Nth sheet of the window" gives those books another sheet's column
names, units and designations — or none.

The sheet sub-header carries no id this reader has found. What does bind a
dataset to its sheet is the **column object id**:

* every column-property block of a window has a u16 object id at 0x04,
  unique within the window (no duplicate in the public corpus);
* a dataset header names, at 0x52, the object id of the column it is
  plotted against (a Y names its X, a Y-error its Y; 0 = none).

So a dataset of sheet id N that names object id K puts id N on the sheet
whose property blocks include K. Measured on the public corpus: 1058
references resolve, the named column is a dataset of the same sheet id
every time (one 11-character truncation aside), no sheet id resolves to
two sheets, and on every book whose ids are 1..n with n sheets the binding
equals the position (56 of 56) — which is the one case independent oracles
cover (Altaxo's two-sheet workbook, LabPlot's ``Book2`` / ``MBook2``).

Rules, in order, per window; anything left over is NOT bound (the caller
omits that sheet's column metadata and says so — never a positional guess):

1. **reference** — the sheet named by the id's column references, when
   they all name one sheet and no other id claims it;
2. **dense** — ids exactly 1..n on an n-sheet window: id k is sheet k (the
   oracle-covered case), for ids rule 1 left unbound;
3. **elimination** — exactly one id and one sheet remain.

Matrix datasets carry no column reference, so a matrix window binds by
rules 2 and 3 only (``bind_ids``).
"""

from __future__ import annotations

import struct
from collections import Counter
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from quantized.io.origin_project.opj_datasets import DatasetHeader
from quantized.io.origin_project.windows import (
    _DESIGNATION,
    _VALUE_FORMAT,
    ColumnMeta,
    _cstring,
    _is_column_block,
    _is_sheet_header,
    _is_window_header,
    _label_rows,
)

__all__ = ["WindowSheet", "bind_ids", "bind_worksheets", "book_key", "window_sheets"]

_OBJECT_ID_OFFSET = 0x04
_SHORT_NAME_LIMIT = 11  # a property block truncates a short name to this


@dataclass
class WindowSheet:
    """One sheet of a worksheet window: its columns, by short name, and the
    object id of each (``object_ids``: id -> short name)."""

    name: str
    columns: dict[str, ColumnMeta] = field(default_factory=dict)
    object_ids: dict[int, str] = field(default_factory=dict)


def window_sheets(blocks: Sequence[tuple[int, bytes]]) -> dict[str, list[WindowSheet]]:
    """Window short name -> its sheets in window order, each with its columns.

    The walk is ``windows.window_metadata``'s (a property block, then its
    label slot: the very next block, a NULL when the column has no label
    text), kept for EVERY sheet instead of the first. A window whose
    columns sit under no ``Pd<Name>`` sub-header (the oldest container, and
    older synthetic fixtures) gets one unnamed sheet; a repeated short name
    there starts the next, as every sheet restarts at column A.
    """
    out: dict[str, list[WindowSheet]] = {}
    sheets: list[WindowSheet] | None = None
    sheet: WindowSheet | None = None
    pending: tuple[int, ColumnMeta] | None = None

    def commit(long_name: str = "", unit: str = "", comment: str = "") -> None:
        nonlocal pending, sheet
        if pending is None or sheets is None:
            pending = None
            return
        object_id, col = pending
        pending = None
        if sheet is None or (not sheet.name and col.short in sheet.columns):
            sheet = WindowSheet("")
            sheets.append(sheet)
        if col.short in sheet.columns:
            return
        sheet.columns[col.short] = ColumnMeta(
            col.short, col.designation, long_name, unit, comment, col.value_format
        )
        sheet.object_ids[object_id] = col.short

    for size, payload in blocks:
        if size == 0:
            commit()
            continue
        header = _is_window_header(payload)
        sheet_name = _is_sheet_header(payload) if header is None else None
        is_col = header is None and sheet_name is None and _is_column_block(payload)
        if pending is not None:
            if header is None and sheet_name is None and not is_col:
                commit(*_label_rows(payload))
                continue
            commit()
        if header is not None:
            sheets, sheet = out.setdefault(header, []), None
        elif sheet_name is not None and sheets is not None:
            # A named sheet; "\x00" keeps an unnamed real sub-header (CPYA
            # 4.26xx) distinct from the implicit sheet of a marker-less one.
            sheet = WindowSheet(sheet_name or "\x00")
            sheets.append(sheet)
        elif is_col and sheets is not None:
            short = _cstring(payload, 0x12, 20) or "?"
            object_id = struct.unpack_from("<H", payload, _OBJECT_ID_OFFSET)[0]
            value_format = _VALUE_FORMAT.get(payload[0x1E] & 0x0F, "")
            pending = (
                object_id,
                ColumnMeta(short, _DESIGNATION[payload[0x11]], "", "", "", value_format),
            )
    commit()
    return {name: found for name, found in out.items() if found}


def book_key(name: str) -> tuple[str, str, int] | None:
    """A worksheet dataset name as ``(book, book key, sheet id)``, or None.

    The book key is the pseudo-book ``opj_books._group_named`` files the
    column under: ``<Book>`` for the bare name, ``<Book>@N`` otherwise.
    """
    stem, _, sheet = name.partition("@")
    book, _, column = stem.rpartition("_")
    if not book or not column or (sheet and not sheet.isdigit()):
        return None
    return book, f"{book}@{sheet}" if sheet else book, int(sheet) if sheet else 1


def bind_ids(ids: Collection[int], n_sheets: int, bound: dict[int, int]) -> dict[int, int]:
    """Extend ``bound`` (sheet id -> sheet position) by the dense and
    elimination rules of the module docstring. Ids left out are unbound."""
    out = dict(bound)
    taken = set(out.values())
    free_ids = [i for i in ids if i not in out]
    free_sheets = [k for k in range(n_sheets) if k not in taken]
    if sorted(ids) == list(range(1, n_sheets + 1)):
        out.update({i: i - 1 for i in free_ids if i - 1 in free_sheets})
    elif len(free_ids) == 1 and len(free_sheets) == 1:
        out[free_ids[0]] = free_sheets[0]
    return out


def _names_column(short: str, columns: Collection[str]) -> bool:
    if short in columns:
        return True
    return len(short) >= _SHORT_NAME_LIMIT and any(c.startswith(short) for c in columns)


def bind_worksheets(
    headers: Iterable[DatasetHeader], sheets: Mapping[str, list[WindowSheet]]
) -> tuple[dict[str, WindowSheet], list[str]]:
    """``(book key -> its sheet, book keys that could not be bound)``.

    Only books that have a window with sheets take part: a dataset with no
    window has no column metadata to bind and appears in neither result.
    """
    # book -> sheet id -> (its book keys, its column names, its references).
    # Two keys for one id only if a file spells sheet 1 both ways.
    groups: dict[str, dict[int, tuple[set[str], set[str], set[int]]]] = {}
    for h in headers:
        parsed = book_key(h.name)
        if parsed is None or parsed[0] not in sheets:
            continue
        book, key, sheet_id = parsed
        keys, columns, refs = groups.setdefault(book, {}).setdefault(
            sheet_id, (set(), set(), set())
        )
        keys.add(key)
        columns.add(h.name.partition("@")[0].rpartition("_")[2])
        if h.x_ref:
            refs.add(h.x_ref)
    bound_books: dict[str, WindowSheet] = {}
    unbound: list[str] = []
    for book, by_id in groups.items():
        window = sheets[book]
        by_reference: dict[int, int] = {}
        disputed: set[int] = set()
        for sheet_id, (_keys, columns, refs) in by_id.items():
            targets = {
                k
                for k, s in enumerate(window)
                for ref in refs
                if (short := s.object_ids.get(ref)) is not None
                and _names_column(short, columns)
            }
            if len(targets) == 1:
                by_reference[sheet_id] = targets.pop()
            elif targets:
                disputed.add(sheet_id)
        claims = Counter(by_reference.values())
        for sheet_id, k in list(by_reference.items()):
            if claims[k] > 1:  # two ids on one sheet: neither is proven
                del by_reference[sheet_id]
                disputed.add(sheet_id)
        undisputed = [i for i in by_id if i not in disputed]
        if disputed:
            # A disputed id still occupies one of the sheets: only the
            # reference rule's own findings stand.
            bound = by_reference
        else:
            bound = bind_ids(undisputed, len(window), by_reference)
        for sheet_id, (keys, _columns, _refs) in by_id.items():
            for key in sorted(keys):
                if sheet_id in bound:
                    bound_books[key] = window[bound[sheet_id]]
                else:
                    unbound.append(key)
    return bound_books, unbound


def sole_sheet_books(
    names: Iterable[str], sheets: Mapping[str, Sequence[WindowSheet]]
) -> dict[str, str]:
    """``Book@N`` -> ``Book`` for a workbook that has exactly one sheet.

    A book whose earlier sheets were deleted keeps only ``<Book>_<Col>@N``
    datasets. When its window has ONE sheet and every dataset carries the
    one id, that sheet is the book — not an "extra sheet" of it — and it is
    named as the book. That is also the name a graph curve uses for it
    (``opj_curves`` reports the book, without the sheet), so the book's
    graphs bind to it instead of to a ``Book`` that does not exist.
    """
    keys: dict[str, set[str]] = {}
    for name in names:
        if (parsed := book_key(name)) is not None:
            keys.setdefault(parsed[0], set()).add(parsed[1])
    return {
        key: book
        for book, found in keys.items()
        if len(found) == 1 and len(sheets.get(book, [])) == 1
        for key in found
        if key != book
    }
