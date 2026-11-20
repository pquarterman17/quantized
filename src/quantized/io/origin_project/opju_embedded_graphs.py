"""``.opju`` graphs embedded inside a workbook: fit-report and sparkline graphs.

Origin lists every graph page in a project through LabTalk ``doc -e P``,
including graphs that live INSIDE a workbook: the fit-report graphs an
analysis writes into its report sheet (``FitLine<N>``, ``Residual<N>``),
the per-column sparklines (``sparkline<N>``), and graphs a user placed in a
sheet cell. Their page headers sit inside the host workbook's span and are
mostly not ``0a``-framed, so the page enumeration (``tree_opju``,
``opju_figure_curves.opju_pages``) does not list them as pages, and their
layer anchors decoded as unnamed (``""``) figures.

**The header.** Inside a workbook span, an embedded graph keeps the page
header's name field, ``<namelen+2> 00 00 <name> <trail >= 80>``
(``tree_opju.window_name_at``), and the byte after the trail is ``0c`` --
as it is after the trail of an ordinary graph page header (``Graph1 90 0c``).
What precedes the length byte varies (``40 80 7f``, ``80 89 01``,
``0a 80 01``, or a sparse-coded run), so it is not used. Three gates, all
required: a name of at least 2 characters (the 1-character matches are
data), the ``0c`` (or ``c1``) after the trail, and a name that is not one of
the project's own pages.

**Evidence** (COM oracle ``ground_truth_public/axis_ranges.json``, Origin
2026b, 113 public projects, 2026-11-20). Of the 782 oracle graph pages with
no decoded layer, 771 are embedded graphs: 102 ``FitLine*``, 102
``Residual*`` and 567 ``sparkline*``. The gate finds 243 headers in those
projects: every one is an oracle page (no extras), and they are every
``FitLine`` and ``Residual`` page plus 39 sparklines. The other 528
sparklines are not in the file at all (no name bytes, no layer record):
Origin draws them again from the column data when it loads the workbook,
so they cannot be listed from the bytes. Over both corpora (351 public +
the owner's 104 files) the gate finds 655 headers: FitLine 229, Residual
224, sparkline 196, and 6 ``Graph<N>`` (one project's cell-embedded
graphs). The byte after the trail is ``0c`` 648 times and ``c1`` 7 times.

**Layers.** Every record-length-prefixed layer anchor inside a workbook
span follows one of these headers (427 of 427 over both corpora; 0 such
anchors precede the first header), and each ``FitLine``/``sparkline``
header is followed by exactly one anchor, as the oracle lists one layer for
each. ``Residual`` pages (4 oracle layers) have no layer anchor after their
header. ``figures_opju`` names an embedded anchor after the header before
it, so the decoded layer is scored by name: all 12 such layers the oracle
lists agree with Origin's X/Y from/to.
"""

from __future__ import annotations

import re
from typing import NamedTuple

from quantized.io.origin_project.opju_figure_curves import column_id_table, opju_pages
from quantized.io.origin_project.tree_opju import window_name_at

__all__ = ["EmbeddedGraph", "embedded_graphs", "unrecovered_embedded_graphs"]

_HEADER = re.compile(rb"(.)\x00\x00(?=[A-Za-z0-9])", re.DOTALL)
_MIN_LENGTH_BYTE = 4  # namelen + 2: names of 2+ characters
_AFTER_TRAIL = frozenset({0x0C, 0xC1})


class EmbeddedGraph(NamedTuple):
    offset: int  # the header's length byte
    name: str
    host: str  # the workbook whose span holds it


def embedded_graphs(
    b: bytes,
    pages: list[tuple[int, str]] | None = None,
    book_pages: frozenset[str] | None = None,
) -> list[EmbeddedGraph]:
    """Every embedded graph header (module docstring), in file order, first
    occurrence per name. ``pages`` / ``book_pages`` may be passed when the
    caller already has them."""
    if pages is None:
        pages = opju_pages(b)
    if book_pages is None:
        book_pages = column_id_table(b, pages).book_pages
    names = {name for _, name in pages}
    bounds = [*(start for start, _ in pages), len(b)]
    out: list[EmbeddedGraph] = []
    seen: set[str] = set()
    for i, (start, host) in enumerate(pages):
        if host not in book_pages:
            continue
        for m in _HEADER.finditer(b, start + 1, bounds[i + 1]):
            length = m.group(1)[0]
            if length < _MIN_LENGTH_BYTE:
                continue
            found = window_name_at(b, m.end(), length)
            if found is None:
                continue
            name, trail = found
            if trail < 0 or trail + 1 >= len(b) or b[trail + 1] not in _AFTER_TRAIL:
                continue
            if name in names or name in seen:
                continue
            seen.add(name)
            out.append(EmbeddedGraph(m.start(), name, host))
    return out


def unrecovered_embedded_graphs(
    b: bytes, recovered: set[str], limit: int = 50
) -> tuple[int, list[dict[str, str]]]:
    """``(count, the first `limit` as {page_name, host_book})`` of the
    embedded graphs whose name is not among ``recovered`` (figure names)."""
    missed = [e for e in embedded_graphs(b) if e.name not in recovered]
    return len(missed), [{"page_name": e.name, "host_book": e.host} for e in missed[:limit]]
