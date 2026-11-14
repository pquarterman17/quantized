"""``.opj`` graph windows that are present in the file but not recovered.

``figures.extract_figures`` recognises a graph window by the block right
after its header: a layer-continuation block whose head byte is one of
``figure_layers._LAYER_HEAD_BYTES`` (0x1f / 0x17 / 0x5f). A graph window
whose first block carries any other head is skipped there, silently — the
user then sees "no graph records" for a project that has graphs.

This module only REPORTS such windows; it decodes nothing from them (no
layer layout has been established for another head byte, so recovering one
would be a guess — the Origin graph-recovery safety rule).

What says a window is a graph, independently of the layer gate: the u8 at
``0x42`` of the window header. Public specimen corpus (49 unique ``.opj``,
2026-11-13), every real window header (fixed region 0xC3 at ``0x6F``):

* all 77 worksheet, matrix and notes/Excel windows (first block head
  ``0x5e`` / ``0xde`` / ``0x7e``) carry ``2``;
* all 43 graph windows the layer gate recovers carry ``0`` or ``6``;
* one window (``3dband-origin.opj``'s ``Graph2``, first block head ``0x47``)
  carries ``0`` — and its span has the same 58-block shape and a curve
  anchor, like its recovered sibling ``Graph1``.

The u8 at ``0x32`` separates the same way (``80``-``84`` for every
worksheet/matrix/notes window, ``0``/``16``/``18`` for graphs, ``0`` for
the unrecovered one), but only ``0x42`` is used. No oracle names either
field; they are the corpus distribution above, with the 77 non-graph
windows as the negative control and the 43 recovered graphs as the
positive one. A window whose field is anything but ``2`` and whose first
block is not a recognised layer is reported as "graph present but not
recovered" — by name, never decoded.
"""

from __future__ import annotations

from quantized.io.origin_project.container import walk_blocks
from quantized.io.origin_project.figure_layers import _is_layer_block
from quantized.io.origin_project.windows import _is_window_header

__all__ = ["unrecovered_graph_windows"]

_FIXED_REGION = 0xC3  # a real window header states it at 0x6F
_KIND_OFFSET = 0x42
_NOT_A_GRAPH = 2  # every worksheet / matrix / notes window in the corpus
# First-block heads of the window kinds that are not graphs: worksheet,
# matrix, notes/Excel (``00 00 <head> 00``).
_SHEET_HEADS = frozenset({0x5E, 0xDE, 0x7E})


def unrecovered_graph_windows(b: bytes) -> list[str]:
    """Names of the graph windows in ``b`` that ``extract_figures`` skips."""
    blocks = [(size, payload) for size, payload in walk_blocks(b) if size]
    names: list[str] = []
    for i, (_size, payload) in enumerate(blocks):
        if len(payload) < _FIXED_REGION or payload[0x6F] != _FIXED_REGION:
            continue
        name = _is_window_header(payload)
        if name is None or payload[_KIND_OFFSET] == _NOT_A_GRAPH:
            continue
        nxt = blocks[i + 1][1] if i + 1 < len(blocks) else b""
        if _is_layer_block(nxt):
            continue  # recovered by extract_figures
        if len(nxt) < 4 or nxt[0] or nxt[1] or nxt[3] or nxt[2] in _SHEET_HEADS:
            continue  # not shaped like a window's first block, or a sheet
        names.append(name)
    return names
