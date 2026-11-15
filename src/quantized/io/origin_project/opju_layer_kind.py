"""Graph layers whose kind quantized does not rebuild, told by the page template.

A curve's own record says only line or scatter: Origin's
``DataPlot::GetPlotType()`` reads 200 for a polar plot and an offset-stacked
("waterfall") line plot and 201 for a bubble or colour-mapped scatter
(``tools/plot_corpus`` oracle, Origin 2026b Student, 2026-11-15). What makes
them polar / offset / bubble / colour-mapped is a layer property or a symbol
modifier, neither decoded. Drawn as plain Cartesian lines, a polar or
offset-stacked layer puts curves where Origin does not, so those curves are
LEFT OUT (``curve_sheet_omitted``, reason ``layer_kind_not_decoded``);
bubble and colour-mapped scatters keep their (correct) X/Y and the figure
carries ``marker_encoding_not_decoded``.

**The signal: the page's template name.** A graph page's header record (the
CPYUA sparse record right after the ``0a``-framed window name, expanded as in
``opju_column_fixed.record_prefix``) carries the name of the template the
graph was made from, NUL-terminated and cut to 9 characters, at record offset
61 (63 in one corpus file): ``Line``, ``SCATTER``, ``OffsetSta``, ``Polar``,
``bubble``, ``colormapp`` ... Every plot-corpus specimen of these kinds carries
its template's name (8 offset-stacked, 1 polar, 7 bubble, 7 colour-mapped).

It is a SUFFICIENT signal, not a necessary one: a graph re-typed after it was
made may keep its old template name, and a polar graph made from a user
template is not seen. Both directions are safe-or-unchanged -- a false hit
only leaves curves out (or adds a note); a miss draws what ``main`` drew.
Real corpus (359 ``.opju``): 4 graph pages in 2 files carry ``OffsetSta``
(``cleaned_data.opju`` Graph2/3/5, ``template.opju`` IAST); none carries a
polar, waterfall, bubble or colour-map template name.
"""

from __future__ import annotations

import re
from typing import Any

from quantized.io.origin_project.opju_column_fixed import record_prefix
from quantized.io.origin_project.opju_curve_sheets import without_captions
from quantized.io.origin_project.opju_figure_curves import opju_pages

__all__ = [
    "LAYER_KIND_NOT_DECODED",
    "MARKER_ENCODING_NOT_DECODED",
    "apply_layer_kinds",
    "page_layer_kind",
]

LAYER_KIND_NOT_DECODED = "layer_kind_not_decoded"
MARKER_ENCODING_NOT_DECODED = "marker_encoding_not_decoded"
_SCAN = (55, 80)  # record offsets searched for the template name (61 / 63 seen)
_KINDS = (
    (re.compile(rb"(?i)polar"), "polar"),
    (re.compile(rb"(?i)offsetst|waterfal"), "offset_stack"),
    (re.compile(rb"(?i)bubble"), "bubble"),
    (re.compile(rb"(?i)colormap"), "color_mapped"),
)
_OMIT = frozenset({"polar", "offset_stack"})


def page_layer_kind(b: bytes, off: int, name: str) -> str | None:
    """The undecoded layer kind the graph page at ``off`` (window ``name``)
    was made as, from its template name; ``None`` when none is named."""
    p = b.find(name.encode("utf-8"), off, off + 16 + len(name.encode("utf-8")))
    if p < 0:
        return None
    got = record_prefix(b, p + len(name.encode("utf-8")), _SCAN[1] + 9, partial=True)
    if got is None:
        return None
    buf, lit = got
    for pat, kind in _KINDS:
        m = pat.search(buf, *_SCAN)
        if m and all(lit[m.start() : m.end()]):
            return kind
    return None


def apply_layer_kinds(figs: list[dict[str, Any]], b: bytes) -> list[dict[str, Any]]:
    """``figs`` with each named figure of a polar / offset-stacked page's
    curves moved to ``curve_sheet_omitted`` (and their legend captions
    dropped), and each bubble / colour-mapped page's figure flagged
    ``marker_encoding_not_decoded`` (module docstring)."""
    names = {str(f.get("name")) for f in figs if f.get("name")}
    if not names:
        return figs
    kinds: dict[str, str] = {}
    for off, name in opju_pages(b):
        if name in names and name not in kinds and (kind := page_layer_kind(b, off, name)):
            kinds[name] = kind
    if not kinds:
        return figs
    out: list[dict[str, Any]] = []
    for fig in figs:
        kind = kinds.get(str(fig.get("name") or ""))
        curves = list(fig.get("curves") or [])
        if kind is None or not curves:
            out.append(fig)
        elif kind in _OMIT:
            notes = list(fig.get("curve_sheet_omitted") or [])
            notes += [
                {
                    "book": str(c.get("book", "")).rpartition("@")[0] or str(c.get("book", "")),
                    "x": str(c.get("x", "")),
                    "y": str(c.get("y", "")),
                    "recorded": str(c.get("book", "")),
                    "reason": LAYER_KIND_NOT_DECODED,
                }
                for c in curves
            ]
            out.append(
                {
                    **fig,
                    "curves": [],
                    "legend_labels": without_captions(
                        fig.get("legend_labels") or [], set(range(len(curves)))
                    ),
                    "curve_sheet_omitted": notes,
                }
            )
        else:
            out.append({**fig, MARKER_ENCODING_NOT_DECODED: kind})
    return out
