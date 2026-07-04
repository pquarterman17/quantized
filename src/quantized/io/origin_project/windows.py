"""Extract per-column metadata from the ``.opj`` windows section.

Worksheet *window definitions* live in the same block stream as the column
data, after the datasets section. Each worksheet window opens with a header
block (``00 00 <BookShort> 00 …``, long name ending at the ``@${`` storage
marker) and contains, per column, a **property block** (≥500 B; designation at
``0x11``, NUL-terminated short name at ``0x12``) immediately followed by a
**label-text block** (``LongName\\r\\nUnit\\r\\nComment``, cut at ``@${``).
Column ``S`` of book ``B`` maps to the dataset named ``"B_S"``.

Byte layout validated against the local corpus — see
``docs/origin_re/opj_windows_section.md`` (plan item 1).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from quantized.io.origin_project.container import walk_blocks

__all__ = ["BookMeta", "ColumnMeta", "window_metadata"]

# Origin's published plot-designation enum (format fact).
_DESIGNATION = {
    0: "Y",
    1: "disregard",
    2: "Y-error",
    3: "X",
    4: "label",
    5: "Z",
    6: "X-error",
}


@dataclass(frozen=True)
class ColumnMeta:
    short: str
    designation: str
    long_name: str = ""
    unit: str = ""
    comment: str = ""


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
    """A window-header block starts ``00 00 <Name> 00``; return the name."""
    if len(payload) < 150 or payload[0] or payload[1]:
        return None
    name = _cstring(payload, 2, 32)
    return name if name and name[0].isalpha() else None


def _book_long_name(payload: bytes, short: str) -> str:
    """The display title, stored in the header tail.

    v4.3380 headers end the title at an ``@${…}<OriginStorage>`` marker;
    v4.3227 headers have no storage blob — the title is simply the last
    printable run after the fixed-format region (offset > 0x60).
    """
    anchor = payload.find(b"@${")
    if anchor >= 0:
        start = payload.rfind(b"\x00", 0, anchor) + 1
        raw = payload[start:anchor]
        if raw and all(0x20 <= c < 0x7F for c in raw):
            return raw.decode("latin1")
        return short
    runs = [m for m in re.finditer(rb"[\x20-\x7e]{2,}", payload) if m.start() > 0x60]
    if runs:
        cand = runs[-1].group().decode("latin1")
        if cand != short:
            return cand
    return short


def _is_column_block(payload: bytes) -> bool:
    """Robust, version-independent column-property block detector."""
    return (
        len(payload) >= 500
        and payload[0x06] == 0x0B
        and payload[0x25] in (0x21, 0x30)  # 0x30 observed on Y-error columns
        and _cstring(payload, 0x12, 8) is not None
    )


def _label_rows(payload: bytes) -> tuple[str, str, str]:
    """Parse a label-text block: LongName / Unit / Comment (missing → "")."""
    text = payload.split(b"\x00", 1)[0]
    cut = text.find(b"@${")
    if cut >= 0:
        text = text[:cut]
    rows = text.decode("latin1", errors="replace").split("\r\n")
    rows += ["", "", ""]
    return rows[0], rows[1], rows[2]


def window_metadata(b: bytes) -> dict[str, BookMeta]:
    """Map book short name → :class:`BookMeta` with per-column names/units.

    Only primary-sheet columns are mapped for now (multi-sheet ``@N`` datasets
    are plan item 5). Graph windows contain no column blocks and drop out
    naturally.
    """
    books: dict[str, BookMeta] = {}
    current: BookMeta | None = None
    pending: tuple[str, str] | None = None  # (short, designation) awaiting label
    closed = False  # set once the current window moves past its primary sheet

    def commit(long_name: str = "", unit: str = "", comment: str = "") -> None:
        nonlocal pending, closed
        if pending is not None and current is not None and not closed:
            short, desig = pending
            if short in current.columns:
                # A repeated short means sheet 2+ started (every sheet restarts
                # at column A); only the primary sheet maps to plain
                # "<Book>_<Col>" datasets, so stop collecting (plan item 5).
                closed = True
            else:
                current.columns[short] = ColumnMeta(short, desig, long_name, unit, comment)
        pending = None

    for size, payload in walk_blocks(b):
        if size == 0:
            continue
        header_name = _is_window_header(payload)
        is_col = _is_column_block(payload)
        if pending is not None:
            if header_name is None and not is_col and size < 500:
                commit(*_label_rows(payload))  # the label block for the pending column
                continue
            commit()  # structural block follows — column had no label text
        if header_name is not None:
            current = books.setdefault(
                header_name, BookMeta(header_name, _book_long_name(payload, header_name))
            )
            closed = False
        elif current is not None and is_col and not closed:
            short = _cstring(payload, 0x12, 8) or "?"
            pending = (short, _DESIGNATION.get(payload[0x11], "Y"))
    commit()
    return books
