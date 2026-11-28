"""Worksheet export to PDF: the sheet as a printed table (matplotlib, no new dependency).

Same cells as the CSV / Excel export (``io.table_export``: the frontend decides
which cells; ``_cell_text`` formats them, so a number reads the same in all
three). Layout, in order:

* one section per sheet, landscape US-Letter pages, the sheet name as the page
  title ("name - page k of n" when it runs over several pages);
* a header of the Long Name and, when any column has one, the Units row
  (``io.table_export._header_rows``); the header repeats on every page;
* at most :data:`ROWS_PER_PAGE` data rows per page; a table wider than
  :data:`COLS_PER_BLOCK` columns is cut into column blocks, each its own run of
  pages, and every page says which columns ("columns 13-24 of 30") and which
  rows it shows, numbered as in the sheet (1-based export rows);
* a cell wider than :data:`CELL_CHARS` characters is cut with an ellipsis (a
  printed cell has no room to scroll): the cut is the PDF's only loss, and the
  CSV / Excel export keeps the whole text.

Cell notes have no place on a page and are dropped, as CSV drops them. Pure
``io``; matplotlib is a lazy import and no pyplot (no global state, any thread).
"""

from __future__ import annotations

import io
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from quantized.heavy_import import heavy_imports
from quantized.io.table_export import (
    ExportSheet,
    _cell_text,
    _check,
    _date_only,
    _header_rows,
)

__all__ = ["CELL_CHARS", "COLS_PER_BLOCK", "ROWS_PER_PAGE", "PdfPage", "format_pdf", "page_plan"]

ROWS_PER_PAGE = 40
COLS_PER_BLOCK = 12
CELL_CHARS = 24
_PAGE = (11.0, 8.5)  # inches, landscape


def _cut(text: str) -> str:
    return text if len(text) <= CELL_CHARS else text[: CELL_CHARS - 1] + "…"


def _pages(n_rows: int, n_cols: int) -> list[tuple[int, int, int, int]]:
    """``(row0, row1, col0, col1)`` per page: column blocks outer, row pages inner."""
    out: list[tuple[int, int, int, int]] = []
    for c0 in range(0, n_cols, COLS_PER_BLOCK):
        c1 = min(c0 + COLS_PER_BLOCK, n_cols)
        starts = range(0, max(n_rows, 1), ROWS_PER_PAGE)
        out += [(r0, min(r0 + ROWS_PER_PAGE, n_rows), c0, c1) for r0 in starts]
    return out


@dataclass(frozen=True)
class PdfPage:
    """One printed page: its title, the note on the right (which rows / columns), the
    header rows and the data rows exactly as drawn (already cut to :data:`CELL_CHARS`)."""

    title: str
    note: str
    head: list[list[str]]
    body: list[list[str]]


def page_plan(sheet: ExportSheet, *, header: bool = True) -> list[PdfPage]:
    """The pages of ``sheet``: what :func:`format_pdf` draws, as plain text."""
    n_rows = _check(sheet)
    only = [_date_only(c) for c in sheet.columns]
    cells = [
        [_cell_text(c, c.cells[r], d) for c, d in zip(sheet.columns, only, strict=True)]
        for r in range(n_rows)
    ]
    head = _header_rows(sheet) if header else []
    n_cols = len(sheet.columns)
    spans = _pages(n_rows, n_cols)
    out: list[PdfPage] = []
    for k, (r0, r1, c0, c1) in enumerate(spans, 1):
        notes = []
        if n_cols > COLS_PER_BLOCK:
            notes.append(f"columns {c0 + 1}-{c1} of {n_cols}")
        if n_rows:
            notes.append(f"rows {r0 + 1}-{r1}")
        title = sheet.name if len(spans) == 1 else f"{sheet.name} - page {k} of {len(spans)}"
        out.append(
            PdfPage(
                title,
                ", ".join(notes),
                [[_cut(v) for v in row[c0:c1]] for row in head],
                [[_cut(v) for v in row[c0:c1]] for row in cells[r0:r1]],
            )
        )
    return out


def _draw(fig: Any, page: PdfPage) -> None:
    ax = fig.add_axes((0.03, 0.05, 0.94, 0.85))
    ax.axis("off")
    fig.text(0.03, 0.94, page.title, fontsize=11, fontweight="bold", va="center")
    if page.note:
        fig.text(0.97, 0.94, page.note, fontsize=8, ha="right", va="center")
    rows = [*page.head, *page.body]
    if not rows:
        return
    width = len(rows[0])
    table = ax.table(cellText=rows, loc="upper center", cellLoc="right")
    table.auto_set_font_size(False)
    table.set_fontsize(7 if width <= 8 else 6)
    table.auto_set_column_width(list(range(width)))
    for (r, _), cell in table.get_celld().items():
        cell.set_linewidth(0.3)
        if r < len(page.head):
            cell.set_text_props(fontweight="bold")
            cell.set_facecolor("#e8e8e8")


def format_pdf(sheets: Sequence[ExportSheet], *, header: bool = True) -> bytes:
    """``sheets`` as one PDF (layout: module doc)."""
    if not sheets:
        raise ValueError("nothing to export")
    plans = [page_plan(s, header=header) for s in sheets]
    with heavy_imports("matplotlib.backends.backend_pdf", "matplotlib.figure"):
        from matplotlib.backends.backend_pdf import PdfPages
        from matplotlib.figure import Figure

    buf = io.BytesIO()
    with PdfPages(buf, metadata={"Title": "Worksheet export", "Creator": "Quantized"}) as pdf:
        for plan in plans:
            for page in plan:
                fig = Figure(figsize=_PAGE)
                _draw(fig, page)
                pdf.savefig(fig)
    return buf.getvalue()
