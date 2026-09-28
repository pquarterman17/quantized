"""Shared dataset + SVG helpers for the P4.2 rendered-output regression suite
(PRIMARY_SOFTWARE_AUDIT_PLAN, ~line 9519: "Visual (rendered-output)
equivalence for the same nine fixtures").

The nine canonical figures live in the frontend as
``frontend/src/lib/regressionMatrixFixtures.testkit.ts``'s
``MATRIX_FIXTURES`` (plain/errors/group/facet/y2/break/waterfall/decor/
hidden), built from one shared dataset (``matrixData()`` there). This module
is the BACKEND-WIRE translation of that same dataset into the plain dict
``/api/export/figure``'s ``FigureRequest.dataset`` expects -- not a port of
the frontend's ``FigureDocument`` builder (categorical ``cat_levels``/
``level_order`` are frontend-only display concerns with no backend
counterpart), so the numbers below are reproduced by hand from that file's
``matrixData()`` and must stay in sync with it if it changes.

Not collected by pytest (module name has no ``test_``/``_test`` in it, so it
never matches ``python_files``) -- same convention as ``tests/unc_fakes.py``.
"""

from __future__ import annotations

import re

# ``matrixData()``'s six rows, verbatim: Signal/Reference/dSignal/dRefPlus/
# dRefMinus/dX/Batch/Site/Temp -- see that function's own per-channel doc.
_ROWS = 6


def matrix_dataset() -> dict[str, object]:
    """The nine fixtures' shared dataset, as a ``FigureRequest.dataset``
    dict. Channel map (identical to the frontend's ``matrixData()``): 0
    Signal, 1 Reference, 2 dSignal (sym y-err for 0), 3 dRefPlus / 4
    dRefMinus (asymmetric y-err for 1), 5 dX (x-err), 6 Batch (categorical,
    codes 0/1/2), 7 Site (categorical, codes 0/1), 8 Temp (y2)."""
    values = [
        [
            r * 0.5,  # 0 Signal
            2 + r * 0.25,  # 1 Reference
            0.1,  # 2 dSignal
            0.2,  # 3 dRefPlus
            0.05,  # 4 dRefMinus
            0.15,  # 5 dX
            r % 3,  # 6 Batch
            0 if r < 3 else 1,  # 7 Site
            300 - r * 4,  # 8 Temp
        ]
        for r in range(_ROWS)
    ]
    return {
        "time": list(range(_ROWS)),
        "values": values,
        "labels": [
            "Signal", "Reference", "dSignal", "dRefPlus", "dRefMinus",
            "dX", "Batch", "Site", "Temp",
        ],
        "units": ["au", "au", "au", "au", "au", "au", "", "", "K"],
        "metadata": {},
    }


# ---------------------------------------------------------------------------
# SVG structural helpers (same depth-aware `<g id="...">` extraction as
# tests/test_export_vector_structure.py -- duplicated rather than imported so
# each test module here stays independently readable and under the 500-line
# ceiling the task asked for; the regex itself is stable matplotlib-SVG-
# backend behaviour, not project-specific logic worth a shared dependency).
# ---------------------------------------------------------------------------


def extract_group(svg: str, gid: str) -> str:
    """The full ``<g id="{gid}">...</g>`` subtree, matched by nesting DEPTH so
    a group containing child groups (legend entries, axis ticks, ...) is
    returned whole rather than truncated at the first unrelated ``</g>``."""
    m = re.search(rf'<g id="{re.escape(gid)}">', svg)
    assert m, f'<g id="{gid}"> not found in SVG'
    depth = 1
    pos = m.end()
    for tm in re.finditer(r"<g\b|</g>", svg[pos:]):
        if tm.group() == "</g>":
            depth -= 1
            if depth == 0:
                return svg[m.start() : pos + tm.end()]
        else:
            depth += 1
    raise AssertionError(f"unbalanced <g> nesting for {gid!r}")


def legend_entries(svg: str, gid: str = "legend_1") -> list[str]:
    return re.findall(r"<text[^>]*>([^<]*)</text>", extract_group(svg, gid))


def axes_minus_legend(svg: str, axes_gid: str = "axes_1", legend_gid: str = "legend_1") -> str:
    """``axes_gid``'s subtree with its nested ``legend_gid`` cut away --
    matplotlib draws a second copy of every series' style as that series'
    legend handle, so counting drawn CURVES (not legend swatches) requires
    excluding it, exactly as ``test_export_vector_structure.py``'s
    ``_grouped_plot_area`` does."""
    axes = extract_group(svg, axes_gid)
    cut = axes.find(f'<g id="{legend_gid}">')
    return axes if cut < 0 else axes[:cut]


_RECT_PATH_RE = re.compile(
    r"<path d=\"M\s+([\d.]+)\s+([\d.]+)\s*\n"
    r"L\s+([\d.]+)\s+([\d.]+)\s*\n"
    r"L\s+([\d.]+)\s+([\d.]+)\s*\n"
    r"L\s+([\d.]+)\s+([\d.]+)\s*\n"
    r"z"
)


def axes_bbox_px(axes_block: str) -> tuple[float, float, float, float]:
    """(x0, y0, x1, y1) pixel rect of an axes group's OWN background patch
    (``ax.patch``, the first child path) -- SVG pixel coords, y downward."""
    m = _RECT_PATH_RE.search(axes_block)
    assert m, "axes background rect (ax.patch) not found in this axes block"
    xs = [float(m.group(i)) for i in (1, 3, 5, 7)]
    ys = [float(m.group(i)) for i in (2, 4, 6, 8)]
    return min(xs), min(ys), max(xs), max(ys)


def flatten(svg: str) -> str:
    """Collapse all whitespace (incl. the newlines matplotlib's SVG backend
    puts inside multi-point ``d="..."`` path data) to single spaces, so a
    marker-glyph path literal can be matched as one contiguous substring."""
    return " ".join(svg.split())


# A dashed/dotted/etc. line's drawn style: colour + optional width (mpl omits
# `stroke-width` at its own SVG default of 1) + the dash pattern when present.
STYLED_OR_PLAIN_LINE_RE = re.compile(
    r'style="fill: none; stroke: (#[0-9a-f]{6})'
    r"(?:; stroke-width: ([\d.]+))?"
    r'; stroke-linecap: square"'
)
DASHED_LINE_RE = re.compile(
    r'style="fill: none; stroke-dasharray: ([\d.,]+); stroke-dashoffset: 0; '
    r'stroke: (#[0-9a-f]{6})(?:; stroke-width: ([\d.]+))?"'
)


def square_marker_glyph(half: float) -> str:
    """The flattened ``d="..."`` path matplotlib draws for a `square`
    marker of half-size ``half`` (``marker_size / 2``) -- four straight
    corners, unlike the default circle's cubic-Bezier path."""
    h = f"{half:g}"
    return f"M -{h} {h} L {h} {h} L {h} -{h} L -{h} -{h} z"
