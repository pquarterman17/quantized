"""Shrink the polygon groups of a matplotlib SVG without changing what they draw.

A 3-D bar plot is one ``Poly3DCollection`` of thousands of four-corner faces, and
matplotlib writes each as its own ``<path>`` with six decimals per coordinate, a
newline after every point and its own copy of the clip reference. This rewrites
only those groups:

* coordinates are rounded to 3 decimals of an SVG user unit (a point, 1/72 in), so
  no corner moves by more than 0.0005 pt (0.00018 mm), far below any pixel;
* the path is written without the padding (``M x y L x y ... z`` on one line);
* a clip reference that every path of the group shares moves onto the ``<g>``
  (the clip of a group of opaque shapes is the clip of each);
* ``fill: #rrggbb`` loses its space; a stroke in the face's own colour (the hairline
  that closes the seams between faces) keeps its colour per path and its one
  ``stroke-width`` moves onto the ``<g>``.

Fail closed: a group whose paths are not all of that exact shape (other
commands, other attributes, a path with a different clip) is returned untouched.
Pure (text in, text out).
"""

from __future__ import annotations

import re

__all__ = ["compact_polygon_groups"]

_GROUP = re.compile(r'(<g id="Poly3DCollection_\d+")>\n(.*?)\n(\s*)</g>', re.S)
_PATH = re.compile(
    r'\s*<path d="(?P<d>[^"]*)"(?: clip-path="url\(#(?P<clip>[^)"]+)\)")? '
    r'style="fill: (?P<fill>#[0-9a-fA-F]{6})'
    r'(?:; stroke: (?P<stroke>#[0-9a-fA-F]{6}); stroke-width: (?P<sw>[0-9.]+))?"/>'
)
_TOKEN = re.compile(r"([MLz])|(-?\d+(?:\.\d+)?)")


def _number(text: str) -> str:
    out = f"{float(text):.3f}".rstrip("0").rstrip(".")
    return "0" if out in ("", "-0") else out


def _compact_path(d: str) -> str | None:
    """``d`` rewritten, or None when it holds anything but M / L / z and numbers."""
    pieces: list[str] = []
    pos = 0
    for m in _TOKEN.finditer(d):
        if d[pos : m.start()].strip():
            return None
        pos = m.end()
        if m.group(1):
            pieces.append(m.group(1))
        else:
            sep = " " if pieces and pieces[-1][-1].isdigit() else ""
            pieces.append(sep + _number(m.group(2)))
    return None if d[pos:].strip() else "".join(pieces)


def _compact_group(match: re.Match[str]) -> str:
    head, body, indent = match.group(1), match.group(2), match.group(3)
    paths = list(_PATH.finditer(body))
    glued = "".join(m.group(0) for m in paths)
    if not paths or glued != body.strip("\n") and len(glued.strip()) != len(body.strip()):
        return match.group(0)
    clips = {m.group("clip") for m in paths}
    widths = {m.group("sw") for m in paths}
    # A stroke must be the face's own colour and one width for the whole group
    # (the seam-closing hairline): the width moves onto the ``<g>``.
    if len(clips) != 1 or len(widths) != 1:
        return match.group(0)
    if any(m.group("stroke") not in (None, m.group("fill")) for m in paths):
        return match.group(0)
    width = widths.pop()
    rows = []
    for m in paths:
        d = _compact_path(m.group("d"))
        if d is None:
            return match.group(0)
        stroke = f";stroke:{m.group('fill')}" if width else ""
        rows.append(f'{indent} <path d="{d}" style="fill:{m.group("fill")}{stroke}"/>')
    clip = clips.pop()
    clip_attr = f' clip-path="url(#{clip})"' if clip else ""
    wide = f' stroke-width="{width}"' if width else ""
    return f"{head}{clip_attr}{wide}>\n" + "\n".join(rows) + f"\n{indent}</g>"


def compact_polygon_groups(svg: bytes) -> bytes:
    """``svg`` with every ``Poly3DCollection`` group compacted (see the module)."""
    text = svg.decode("utf-8")
    return _GROUP.sub(_compact_group, text).encode("utf-8")
