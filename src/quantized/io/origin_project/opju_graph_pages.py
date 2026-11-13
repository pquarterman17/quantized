"""``.opju`` graph pages the figure decoder did NOT recover — diagnosed, with
Origin's own saved image where one is attributable.

The figure decoder (``figures_opju``) reads a graph from its layer/axis
records and drops anything it cannot read exactly (fail closed). That leaves
real graph windows silently absent from an import. This module finds them
without decoding them, so the import can say "graph present, not recovered":

* a page is a **workbook/report page** when it owns columns in the global
  column-id table (``opju_figure_curves.column_id_table`` — the classifier the
  saved-preview attribution, item #51, already relies on);
* any other page whose own span holds a ``_cart_object`` record (a Cartesian
  layer object) is a **graph page**.

Evidence (274-file public corpus, 2026-11-14): 979 of the 980 pages the
figure decoder does recover carry ``_cart_object`` in their span (the one
exception is a layout page, which this rule therefore never reports); the
Altaxo worksheet/matrix test projects and the synthetic fixtures — none of
which has a graph — carry none; of the 319 non-workbook pages it flags as
unrecovered graphs, 281 are named ``Graph<N>`` (Origin's default graph name)
and the rest carry graph-like names (``Figure``, ``Boxplot…``, ``band``…);
none is an imported workbook. Workbook pages are never flagged however much
graph content their span holds (spans can include a following graph's
objects), because the column-id table classifies them first. In 17 more
files graph objects exist but no graph was recovered and no non-workbook
page holds them (the graph's window is not isolated by the page
enumeration); those are reported at file level as ``unattributed``.

Origin's saved PNG thumbnail of such a page is attached under the same rule
``graph_preview`` uses for recovered graphs: exactly one structurally and
CRC-valid PNG inside a non-workbook page's span. The curve bindings, axes
and styles of these graphs are NOT decoded here — curve binding is
untouched.
"""

from __future__ import annotations

from typing import NamedTuple, TypedDict

from quantized.io.origin_project.graph_preview import SavedGraphPreview, _pngs_in
from quantized.io.origin_project.opju_figure_curves import column_id_table, opju_pages

__all__ = [
    "MAX_PREVIEWS",
    "MAX_REPORTED",
    "GraphPageReport",
    "UnrecoveredGraph",
    "unrecovered_graph_pages",
]

_GRAPH_OBJECT = b"_cart_object"
MAX_REPORTED = 50  # pages listed per project (the count is exact)
MAX_PREVIEWS = 12  # saved images attached per project (payload bound)


class UnrecoveredGraph(TypedDict, total=False):
    page_name: str
    saved_preview: SavedGraphPreview


class GraphPageReport(NamedTuple):
    """``missing`` graph pages not recovered (the first ``pages`` listed);
    ``unattributed``: the file holds graph objects although no graph was
    recovered and no non-workbook page holds one — a graph whose window the
    page enumeration does not isolate (reported, never guessed at)."""

    missing: int
    pages: list[UnrecoveredGraph]
    unattributed: bool = False


def unrecovered_graph_pages(b: bytes, recovered: set[str]) -> GraphPageReport:
    """Graph pages whose name is not among ``recovered`` (the figure
    decoder's graph names), in file order."""
    pages = opju_pages(b)
    has_objects = _GRAPH_OBJECT in b
    if not pages:
        return GraphPageReport(0, [], has_objects and not recovered)
    table = column_id_table(b, pages)
    bounds = [*pages, (len(b), "")]
    found: list[UnrecoveredGraph] = []
    count = previews = 0
    for (start, name), (end, _next) in zip(bounds, bounds[1:], strict=False):
        if name in table.book_pages or name in recovered:
            continue
        if b.find(_GRAPH_OBJECT, start, end) < 0:
            continue
        count += 1
        if len(found) >= MAX_REPORTED:
            continue
        entry: UnrecoveredGraph = {"page_name": name}
        if previews < MAX_PREVIEWS:
            assets = _pngs_in(b, start, end, name)
            if len(assets) == 1:
                entry["saved_preview"] = assets[0]
                previews += 1
        found.append(entry)
    return GraphPageReport(count, found, has_objects and not recovered and not count)
