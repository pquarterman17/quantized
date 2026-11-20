"""Which ``.opju`` page a graph-layer anchor belongs to, and its name / layer.

Split out of ``figures_opju`` (module ceiling). Three cases:

* **graph page** -- a page that owns no column records (needs the column-id
  table to tell book pages apart). Its figures take the page's window name
  and the anchor's 1-based ORDINAL within the page, counted before any
  decode attempt, so an undecodable record leaves a gap in the layer
  numbers instead of shifting later layers (fail closed).
* **id-table-less stream** (no column-id table): a page whose span holds a
  ``_cart_object`` (a Cartesian layer object, the rule
  ``opju_graph_pages`` already counts graph pages by) is a graph page too.
  Evidence (COM oracle, 2026-11-20): in the three such oracle projects
  (``BD_SC_all``, ``BD_TC_all``, ``RSOS_SC_all``) every page is a graph page
  with one layer, and all 9 decoded layers match Origin's X/Y from/to once
  named; before, they were unnamed and the pages read as unrecovered. A
  page without ``_cart_object`` (``F72_Femtosecond...``'s ``F72AC``) keeps
  ``""`` / 1.
* **embedded graph** -- an anchor inside a workbook page that follows an
  embedded graph header (``opju_embedded_graphs``: fit-report and sparkline
  graphs) takes that header's name and its ordinal after the header.
  Anything else on a workbook page keeps ``""`` / 1, as before.

On a graph page whose anchors carry the record-length varint, a bare 4-byte
match without it is a coincidence inside another block (an id table
``03 00 00 1f 03 00 00 20 ...``, a style block), not a layer. It is removed
BEFORE the figure loop: left in the anchor list it would still be the
``next_anchor`` that ends the previous REAL layer's window and truncate that
layer's curves, frame, text and axis record. A graph page with no such
anchor (legacy/synthetic streams) keeps every match.
"""

from __future__ import annotations

from bisect import bisect_right

from quantized.io.origin_project.figure_geometry import opju_anchor_has_length_prefix
from quantized.io.origin_project.opju_embedded_graphs import embedded_graphs

__all__ = ["LayerPages"]

_GRAPH_OBJECT = b"_cart_object"


class LayerPages:
    """Page attribution of the layer anchors of one byte stream."""

    def __init__(
        self,
        b: bytes,
        pages: list[tuple[int, str]],
        workbooks: frozenset[str],
        matrix_books: frozenset[str],
        legacy: bool,
    ) -> None:
        self._b = b
        self.pages = pages
        self.starts = [off for off, _name in pages]
        self._legacy = legacy
        self._graph: list[bool] = []
        for i, (start, name) in enumerate(pages):
            if legacy:
                end = self.starts[i + 1] if i + 1 < len(pages) else len(b)
                self._graph.append(b.find(_GRAPH_OBJECT, start, end) >= 0)
            else:
                self._graph.append(name not in workbooks | matrix_books)
        self._embedded = [] if legacy else embedded_graphs(b, pages, workbooks)
        self._emb_offsets = [e.offset for e in self._embedded]
        self._page_layers: dict[int, int] = {}
        self._embedded_layers: dict[str, int] = {}

    def page_of(self, anchor: int) -> int:
        return bisect_right(self.starts, anchor) - 1

    def is_graph_page(self, pi: int) -> bool:
        return pi >= 0 and self._graph[pi]

    def end_of(self, pi: int) -> int:
        return self.starts[pi + 1] if pi + 1 < len(self.pages) else len(self._b)

    def kept_anchors(self, anchors: list[int]) -> tuple[list[tuple[int, int]], list[int]]:
        """``(kept (anchor, page index) pairs, dropped anchors)`` (module
        docstring: coincidental matches on prefixed graph pages)."""
        anchor_pages = [self.page_of(a) for a in anchors]
        prefixed = [opju_anchor_has_length_prefix(self._b, a) for a in anchors]
        prefixed_pages = {
            pi
            for pi, ok in zip(anchor_pages, prefixed, strict=True)
            if ok and self.is_graph_page(pi)
        }
        kept = [
            (a, pi)
            for a, pi, ok in zip(anchors, anchor_pages, prefixed, strict=True)
            if ok or pi not in prefixed_pages
        ]
        return kept, sorted(set(anchors) - {a for a, _ in kept})

    def name_layer(self, anchor: int, pi: int) -> tuple[str, int]:
        """The figure ``(name, layer)`` of the anchor at ``anchor`` on page
        ``pi``. Call once per kept anchor, in file order: the ordinal is
        counted here, before any decode attempt."""
        if self.is_graph_page(pi):
            self._page_layers[pi] = self._page_layers.get(pi, 0) + 1
            return self.pages[pi][1], self._page_layers[pi]
        k = bisect_right(self._emb_offsets, anchor) - 1
        if pi >= 0 and k >= 0 and self._emb_offsets[k] > self.starts[pi]:
            name = self._embedded[k].name
            self._embedded_layers[name] = self._embedded_layers.get(name, 0) + 1
            return name, self._embedded_layers[name]
        return "", 1
