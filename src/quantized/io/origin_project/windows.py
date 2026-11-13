"""Extract per-column metadata from the ``.opj`` windows section.

Worksheet *window definitions* live in the same block stream as the column
data, after the datasets section. Each worksheet window opens with a header
block (``00 00 <BookShort> 00 …``; its label, when it has one, starts at the
end of the 195-byte fixed region and runs to a NUL or the ``@${`` storage
marker) and contains, per column, a **property block** (482-519 B by Origin
version; designation at ``0x11``, NUL-terminated short name at ``0x12``,
the column's two type bytes at ``0x25``-``0x26``) immediately followed by
its **label slot**: a text block (``LongName\\r\\nUnit\\r\\nComment``, cut at
``@${``) or a NULL when the column has no label.
Column ``S`` of book ``B`` maps to the dataset named ``"B_S"``.

A property block's byte 0x06 is a flag byte that varies with the column's
storage flavour -- ``0x09`` for a plain sheet-1 column, ``0x0B`` for a
formula/derived column *and* for every column of an auto-generated report
sheet (FitLinear/FitNL's "Parameters"/"Notes"/etc. sheets), ``0x02``/``0x03``
on Text and numeric-typed columns -- so it does not distinguish sheet
identity (plan item: report-sheet leak fix; see ``_is_column_block``).

**Multi-sheet books** (a workbook with a report/curve sheet appended after
the real data, e.g. Origin's FitLinear auto-adds "FitLinear1"/
"FitLinearCurve1" siblings to the sheet it fits) restart column lettering at
"A" for each extra sheet, and *also* reuse the very same 0x0B property-block
shape as a real formula column -- so neither the storage-flavour byte nor a
short-name repeat is a reliable, early sheet-boundary signal on its own (a
report sheet's own property/label blocks can front-run a repeat detection
by many columns). The real signal is the **sheet/layer sub-header** block
(365 bytes at CPYA 4.3380; 255-409 across versions -- see
``_is_sheet_header``) carrying ``Pd<Name>\\0`` at a constant offset (0xD0) --
one appears at the very start of every worksheet sheet (and every graph
layer, tagged ``Pd1``/``Pd2``/…) inside a window's block span. The *second*
one seen since the enclosing window header is the true start of sheet 2+;
everything from there on (property blocks, labels, formulas) is excluded.
Validated against Moke.opj's ``Book4`` (Sheet1 / FitLinear1 /
FitLinearCurve1 — three ``Pd...`` markers, one per sheet, exactly bracketing
each sheet's real column-property-block run) and every single-sheet corpus
book (exactly one marker, at the window's very start). The
short-name-repeat guard is kept as a fallback for a container with no such
marker (the note that CPYA 4.3227 files carry none predates the size-agnostic
detector and has not been re-measured on that corpus file).

Byte layout validated against the local corpus — see
``docs/origin_re/opj_windows_section.md`` (plan item 1) — and, for the
version spread and the Numeric/Text column kinds, the public specimen corpus
(``docs/origin_project_format.md`` §4.1).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from quantized.io.origin_project.container import walk_blocks

__all__ = ["BookMeta", "ColumnMeta", "window_metadata"]

# Origin's plot-designation enum. 0-6 are the published X/Y/Z/error/label
# set; 7 (Group) and 8 (Subject) are the factor designations of the
# statistics tools, confirmed by Altaxo's WksDifferentDiagramAssoc oracle
# (one column of each of the nine designations, in four books). The strings
# are a wire contract shared with the frontend
# (tests/fixtures/wire/origin_designations.json).
_DESIGNATION = {
    0: "Y",
    1: "disregard",
    2: "Y-error",
    3: "X",
    4: "label",
    5: "Z",
    6: "X-error",
    7: "group",
    8: "subject",
}
_DESIGNATION_CODES = frozenset(range(9))

# The column's Origin FORMAT (Column Properties > Format), low nibble of
# property-block byte 0x1E. Only the calendar formats are surfaced: their
# cells are ordinary float64 numbers that mean something else (see
# ``opj_books.column_format_hint``). The other codes are 0 Numeric, 1 Text
# and 9 Text & Numeric — in the public corpus those agree, column for
# column, with the cell kind the dataset header declares (1297 columns) —
# and the high nibble is the numeric display (decimal / scientific / ...).
# Oracle: Altaxo's ValueType assertions in DateTimeColumns and
# WksDifferentColumnTypes (Time, Date, Month, Day) and OneWorksheet /
# WksDifferentNumericFormattings (TextNumeric, Numeric).
_VALUE_FORMAT = {2: "time", 3: "date", 4: "month", 5: "day_of_week"}


@dataclass(frozen=True)
class ColumnMeta:
    short: str
    designation: str
    long_name: str = ""
    unit: str = ""
    comment: str = ""
    # "time" | "date" | "month" | "day_of_week" for a calendar-formatted
    # column (``_VALUE_FORMAT``), else "".
    value_format: str = ""


@dataclass
class BookMeta:
    short: str
    long_name: str
    columns: dict[str, ColumnMeta] = field(default_factory=dict)


def _cstring(payload: bytes, start: int, limit: int = 48) -> str | None:
    """Printable NUL-terminated ASCII at ``start``, or None."""
    end = payload.find(b"\x00", start, start + limit)
    if end <= start:
        return None
    raw = payload[start:end]
    if not all(0x20 <= c < 0x7F for c in raw):
        return None
    return raw.decode("latin1")


def _is_window_header(payload: bytes) -> str | None:
    """A window-header block starts ``00 00 <Name> 00``; return the name.

    Digit-led names are real (``tree.py``'s module docstring documents
    ``30nmADPNR`` and six digit-led graph names in the corpus, COM-verified),
    so the first-char gate is ``isalnum``, not ``isalpha`` — the old
    alpha-first check silently hid digit-led graph windows from
    ``figures.py`` AND let their internal blocks poison
    ``opj_curves.column_id_map`` (a digit-led graph was not recognized as a
    graph, so its 519-byte curve records were scanned as column storage)."""
    if len(payload) < 150 or payload[0] or payload[1]:
        return None
    name = _cstring(payload, 2, 64)
    return name if name and name[0].isalnum() else None


_LABEL_OFFSET = 0xC3  # 195: where a window header's fixed region ends


def _book_long_name(payload: bytes, short: str) -> str:
    """The window's label (its long name / display title), else ``short``.

    The header's fixed region is 195 bytes (the u16 at 0x6F states it, in
    every header of every CPYA version in the specimen corpus, 4.2656
    through 4.3778); the label follows it, ended by a NUL or by the
    ``@${...}`` storage blob. A header with nothing there has no label, and
    the short name is the title -- liborigin reports exactly that (an empty
    ``Label:``) for those books.

    The earlier fallback ("last printable run after 0x60") is gone: on a
    label-less header it returned ``"BA"``, the two printable tail bytes of
    the creation / modification timestamps at 0x73 and 0x7B (float64 Julian
    days ~2.45e6, bit pattern ``.. 42 41``), for 82 of 123 corpus windows.
    A header without the 0x6F marker (the synthetic fixtures) keeps only the
    ``@${`` anchor rule -- no marker, no anchor: no label.
    """
    if len(payload) > _LABEL_OFFSET and payload[0x6F] == _LABEL_OFFSET and payload[0x70] == 0:
        raw = payload[_LABEL_OFFSET:].split(b"\x00", 1)[0].split(b"@${", 1)[0]
    else:
        anchor = payload.find(b"@${")
        if anchor < 0:
            return short
        raw = payload[payload.rfind(b"\x00", 0, anchor) + 1 : anchor]
    # A label can be typed on several lines; a title is one line. Line
    # breaks and tabs become single spaces rather than disqualify the label.
    # (Nothing else about the label changes: only the breaks.)
    raw = re.sub(rb"[\r\n\t]+", b" ", raw).strip(b" ") if re.search(rb"[\r\n\t]", raw) else raw
    if raw and all(0x20 <= c < 0x7F or c >= 0xA0 for c in raw):
        return raw.decode("latin1")
    return short


def _is_column_block(payload: bytes) -> bool:
    """Version-independent column-property block detector.

    A property block is 482 B (CPYA 4.2656), 486 (4.2673), 489 (4.2878),
    493 (4.2946), 515 (4.3116-4.3295) or 519 (4.3380 on) in the specimen
    corpus; designation at 0x11, short name at 0x12,
    and at 0x25-0x26 a copy of the dataset header's two type bytes
    (``opj_datasets``: 0x26's high nibble is the designation class, its low
    nibble the value kind — informative, deliberately NOT a gate: a column
    of a value kind the data reader cannot decode is still a column, and
    its designation is what tells the book its X was lost). The gates:

    * ``0x06`` is a flag byte -- ``0x09`` plain sheet-1 column, ``0x0B``
      formula/report column, ``0x02``/``0x03`` Text / numeric-typed columns,
      plus ``0x80``; only those four flag bits ever appear, and never zero;
    * ``0x11`` is a designation code (0-8);
    * ``0x12`` starts a printable NUL-terminated short name.

    The old test (``0x06 in (9, 0x0B)`` and ``0x25 in (0x21, 0x30)``, size
    >= 500) was fitted to Text & Numeric columns of one Origin version: it
    missed every Numeric/Date/Time column (``0x25`` is 0x00/0x01/0x03/0x10
    there), so those lost their designation, long name, unit and comment,
    and it missed every column of a project older than CPYA 4.3116 (their
    blocks are under 500 B). Graph curve records are
    the look-alike to keep out -- same size, a short "name" at 0x12 -- and
    they carry 0x0F/0x11/0x69/0xE9 at 0x11, or a zero 0x06.

    Measured on the public corpus: all 1297 blocks that pass sit under a
    worksheet (or Excel) sheet sub-header, and 1295 of them name a dataset
    that exists in the same file; all 38 same-sized blocks that fail sit in
    a graph layer or outside any window.
    """
    return (
        480 <= len(payload) <= 600
        and payload[0x06] != 0
        and payload[0x06] & ~0x8B == 0
        and payload[0x11] in _DESIGNATION_CODES
        and _cstring(payload, 0x12, 20) is not None
    )


_SHEET_NAME_OFFSET = 0xD0  # 208: fixed offset of the "Pd<Name>" marker


def _is_sheet_header(payload: bytes) -> str | None:
    """A per-sheet (or per-graph-layer) sub-header: the real sheet-boundary
    signal (see module docstring). Returns the sheet name (``""`` when the
    sheet is unnamed, as at CPYA 4.26xx), or None when ``payload`` is not one.

    The marker is ``Pd`` at the constant offset 0xD0. The block's SIZE is
    not constant -- 255 B (CPYA 4.2656), 261, 341, 345, 361, 365 (4.3380,
    4.3386), 385, 393, 409 (4.3778) across the specimen corpus -- so the old
    ``== 365`` test saw no sheet boundary at all in a file of any other
    version. Bounded below a column-property block (>= 482 B) and above a
    window header's fixed region so neither can be mistaken for one.
    """
    if not 250 <= len(payload) < 480 or payload[0] or payload[1]:
        return None
    if payload[_SHEET_NAME_OFFSET : _SHEET_NAME_OFFSET + 2] != b"Pd":
        return None
    end = payload.find(b"\x00", _SHEET_NAME_OFFSET + 2, _SHEET_NAME_OFFSET + 42)
    if end < 0:
        return None
    raw = payload[_SHEET_NAME_OFFSET + 2 : end]
    if not all(0x20 <= c < 0x7F or c >= 0xA0 for c in raw):
        return None
    return raw.decode("latin1")


def _label_rows(payload: bytes) -> tuple[str, str, str]:
    """Parse a label-text block: LongName / Unit / Comment (missing -> "").

    The comment is every line from the third on, joined with ``\\n``
    (Origin's Comments cell is multi-line; Altaxo's ``DateTimeColumns``
    oracle expects a two-line comment). Text that is not printable is not a
    label: all three come back empty.
    """
    text = payload.split(b"\x00", 1)[0]
    cut = text.find(b"@${")
    if cut >= 0:
        text = text[:cut]
    if not all(c >= 0x20 or c in (0x09, 0x0A, 0x0D) for c in text):
        return "", "", ""
    rows = text.decode("latin1", errors="replace").split("\r\n")
    rows += ["", "", ""]
    return rows[0], rows[1], "\n".join(rows[2:]).rstrip("\n")


def window_metadata(b: bytes) -> dict[str, BookMeta]:
    """Map book short name → :class:`BookMeta` with per-column names/units.

    Only primary-sheet columns are mapped for now (multi-sheet ``@N`` datasets
    are plan item 5). Graph windows contain no column blocks and drop out
    naturally.

    A report/curve sheet appended after the primary sheet (Origin's
    FitLinear/FitNL auto-add, e.g. "FitLinear1"/"FitLinearCurve1") must never
    reach ``current.columns`` — that dict is the *primary-sheet* map. The
    ``Pd<Name>`` sheet sub-header (`_is_sheet_header`) is the precise
    boundary: the second one seen since the enclosing window header closes
    collection immediately, before that sheet's first property block. The
    short-name-repeat check stays as a fallback for the older container
    version that carries no such marker (plan item 5's original guard).
    """
    books: dict[str, BookMeta] = {}
    current: BookMeta | None = None
    pending: tuple[str, str, str] | None = None  # (short, designation, format) awaiting label
    closed = False  # set once the current window moves past its primary sheet
    sheets_seen = 0  # count of Pd<Name> markers since the current window header

    def commit(long_name: str = "", unit: str = "", comment: str = "") -> None:
        nonlocal pending, closed
        if pending is not None and current is not None and not closed:
            short, desig, value_format = pending
            if short in current.columns:
                # A repeated short means sheet 2+ started (every sheet restarts
                # at column A); only the primary sheet maps to plain
                # "<Book>_<Col>" datasets, so stop collecting (plan item 5;
                # fallback for containers with no Pd<Name> marker).
                closed = True
            else:
                current.columns[short] = ColumnMeta(
                    short, desig, long_name, unit, comment, value_format
                )
        pending = None

    for size, payload in walk_blocks(b):
        if size == 0:
            # A property block is followed by its label slot: a text block,
            # or a NULL when the column has no label text. Committing here
            # (instead of carrying ``pending`` across the spacer) keeps a
            # later, unrelated small block from being read as this column's
            # label.
            commit()
            continue
        header_name = _is_window_header(payload)
        sheet_name = _is_sheet_header(payload) if header_name is None else None
        is_col = (
            _is_column_block(payload) if header_name is None and sheet_name is None else False
        )
        if pending is not None:
            if header_name is None and sheet_name is None and not is_col:
                commit(*_label_rows(payload))  # the label slot of the pending column
                continue
            commit()  # structural block follows — column had no label text
        if header_name is not None:
            current = books.setdefault(
                header_name, BookMeta(header_name, _book_long_name(payload, header_name))
            )
            closed = False
            sheets_seen = 0
        elif sheet_name is not None:
            sheets_seen += 1
            if sheets_seen > 1:  # the 2nd+ sheet/layer marker: stop mapping columns
                closed = True
        elif current is not None and is_col and not closed:
            short = _cstring(payload, 0x12, 20) or "?"
            value_format = _VALUE_FORMAT.get(payload[0x1E] & 0x0F, "")
            pending = (short, _DESIGNATION[payload[0x11]], value_format)
    commit()
    return books
