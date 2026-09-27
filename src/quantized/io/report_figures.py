"""Figure blocks in report exports: what each renderer embeds, and why not.

PRIMARY_SOFTWARE_AUDIT_PLAN P3.6 ("Office report export embeds the actual
rendered figure when SVG is requested, not placeholder text"). A report
figure block (``calc.report.figure_block``) can carry

* ``spec`` -- the exact body of ``POST /api/export/figure`` (a
  ``FigureRequest``: dataset + channel picks + style + optional
  ``width_in``/``height_in``). The report route (``routes.report_figures``)
  renders it through the SAME function that route uses, so the embedded
  figure is the app's own export, byte-for-byte, and hands the result in
  here as a :class:`RenderedFigure`. A spec whose ``fmt`` is vector
  (``svg``/``pdf``) *requests* a vector figure.
* ``image`` -- a pre-rendered ``{mime, data}`` (legacy/hand-authored).

:func:`plan_figure` decides, per block and per target, what gets embedded;
every "not embedded" outcome carries a SPECIFIC reason that the renderer
prints in the document (``[figure: <name> -- not embedded: <reason>]``) and
that :func:`figure_warning` turns into a response warning. A figure never
fails the whole export.

Pure ``io`` layer: bytes and dicts in, plans out -- no matplotlib, no Office
library, no web stack.
"""

from __future__ import annotations

import re
import struct
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from quantized.io.report_blocks import EMBEDDABLE_IMAGE_MIMES, decode_raster

__all__ = [
    "OFFICE_DPI",
    "FigurePlan",
    "RenderedFigure",
    "figure_alt_text",
    "figure_file_stem",
    "figure_warning",
    "fit_size",
    "html_inline_svg",
    "placeholder_text",
    "plan_figure",
    "png_size_in",
]

#: Raster resolution of the PNG an Office document embeds (the 300-DPI
#: publication raster; the vector rides alongside it -- see report_office).
OFFICE_DPI = 300

#: ``(section index, block index)`` -> that figure block's render.
FigureKey = tuple[int, int]


@dataclass(frozen=True, slots=True)
class RenderedFigure:
    """One figure block's server-side render (built by ``routes.report_figures``).

    ``png`` is the raster (``dpi`` dots per inch), ``svg`` the vector when the
    spec requested one. ``error`` set = nothing could be rendered (the block
    becomes a named placeholder); ``svg_error`` set = the raster rendered but
    the requested vector did not (embedded raster-only, and the document says
    so -- never a silent downgrade).
    """

    png: bytes | None = None
    svg: bytes | None = None
    dpi: int = OFFICE_DPI
    vector_requested: bool = False
    error: str | None = None
    svg_error: str | None = None


@dataclass(frozen=True, slots=True)
class FigurePlan:
    """What one renderer does with one figure block."""

    kind: Literal["render", "image", "placeholder"]
    png: bytes | None = None
    svg: bytes | None = None
    dpi: int = OFFICE_DPI
    raster: bytes | None = None  # kind == "image": a decoded, embeddable raster
    image: Mapping[str, str] | None = None  # kind == "image" (HTML): the {mime, data}
    reason: str | None = None  # kind == "placeholder": why nothing is embedded
    note: str | None = None  # kind == "render": a caveat printed with the caption


def _decode_image(image: Mapping[str, Any]) -> tuple[bytes | None, str | None]:
    """(raster bytes, None) for an Office-embeddable image, else (None, reason)."""
    mime = str(image.get("mime", ""))
    if mime == "image/svg+xml":
        return None, (
            "an SVG image cannot be placed in an Office document without a raster "
            "fallback, and this block has no figure spec to re-render one from -- "
            "attach the figure's export spec (block 'spec') or a PNG"
        )
    if mime not in EMBEDDABLE_IMAGE_MIMES:
        return None, f"image type {mime or '(none)'!r} is not embeddable in Office"
    raster = decode_raster(image)
    if raster is None:
        return None, "the attached image data is not valid base64"
    return raster, None


def plan_figure(
    block: Mapping[str, Any],
    rendered: RenderedFigure | None,
    target: Literal["office", "html"],
) -> FigurePlan:
    """Decide what ``target`` embeds for ``block``.

    Order: a server render (``rendered``, from the block's ``spec``) wins over
    an attached ``image``; a spec that reached here un-rendered, an image the
    target can't place, and a reference-only block all become placeholders
    with the specific reason.
    """
    if rendered is not None:
        if rendered.error is not None or (rendered.png is None and rendered.svg is None):
            return FigurePlan("placeholder", reason=rendered.error or "the render produced nothing")
        note = None
        if rendered.vector_requested and rendered.svg is None:
            note = (f"vector (SVG) unavailable ({rendered.svg_error or 'not rendered'}); "
                    f"embedded as a {rendered.dpi}-DPI PNG")
        return FigurePlan("render", png=rendered.png, svg=rendered.svg,
                          dpi=rendered.dpi, note=note)
    if "spec" in block and not isinstance(block["spec"], Mapping):
        return FigurePlan("placeholder", reason="its figure spec is not a JSON object")
    if isinstance(block.get("spec"), Mapping):
        return FigurePlan("placeholder", reason=(
            "its figure spec was not rendered -- the spec is rendered by the server's "
            "figure exporter (POST /api/report/export), not by a bare render_report call"
        ))
    image = block.get("image")
    if isinstance(image, Mapping):
        if target == "html":
            return FigurePlan("image", image=image)
        raster, reason = _decode_image(image)
        if raster is None:
            return FigurePlan("placeholder", reason=reason)
        return FigurePlan("image", raster=raster)
    return FigurePlan("placeholder", reason="the block carries no image or figure spec")


def figure_alt_text(block: Mapping[str, Any]) -> str:
    """Accessible description: the caption when there is one, else the name."""
    return str(block.get("caption") or block.get("name") or "figure")


def placeholder_text(block: Mapping[str, Any], reason: str) -> str:
    """The in-document text standing in for a figure that is not embedded."""
    return f"[figure: {block.get('name', '')} — not embedded: {reason}]"


def figure_warning(block: Mapping[str, Any], section_index: int, message: str) -> str:
    """A response warning naming the figure and where it sits in the report."""
    return f"figure {str(block.get('name', ''))!r} (section {section_index + 1}): {message}"


def png_size_in(png: bytes, dpi: int) -> tuple[float, float] | None:
    """Natural (width, height) in inches of a PNG rendered at ``dpi``.

    Reads the IHDR chunk directly (the first chunk of every valid PNG), so no
    image library is needed; ``None`` for anything that isn't a PNG.
    """
    if len(png) < 24 or png[:8] != b"\x89PNG\r\n\x1a\n" or png[12:16] != b"IHDR":
        return None
    w_px, h_px = struct.unpack(">II", png[16:24])
    if w_px == 0 or h_px == 0 or dpi <= 0:
        return None
    return w_px / dpi, h_px / dpi


def fit_size(
    width: float, height: float, max_width: float, max_height: float
) -> tuple[float, float]:
    """Scale (width, height) DOWN, aspect kept, to fit the box -- never up.

    The natural size is the figure's own requested size (``width_in`` /
    ``height_in`` or its preset's), so a figure that already fits the page or
    slide keeps it exactly.
    """
    scale = min(1.0, max_width / width, max_height / height)
    return width * scale, height * scale


def figure_file_stem(block: Mapping[str, Any]) -> str:
    """A filesystem/LaTeX-safe stem for a figure's companion file."""
    stem = re.sub(r"[^A-Za-z0-9-]+", "-", str(block.get("name", ""))).strip("-")
    return f"fig-{stem or 'figure'}"


_SVG_OPEN = re.compile(r"<svg\b", re.IGNORECASE)


def html_inline_svg(svg: bytes, label: str) -> str | None:
    """An exported SVG as inline ``<svg>`` markup for an HTML report.

    Drops the XML declaration / DOCTYPE (invalid inside an HTML body) and adds
    ``role="img"`` + ``aria-label`` (accessibility) and a ``max-width`` so the
    figure keeps its exported size but never overflows the page. ``label``
    must already be HTML-attribute-escaped. ``None`` if ``svg`` holds no
    ``<svg`` element.
    """
    text = svg.decode("utf-8", errors="replace")
    m = _SVG_OPEN.search(text)
    if m is None:
        return None
    # font-style reset: the report CSS italicises <figure>, and matplotlib's
    # <text> styles don't set font-style, so it would inherit.
    style = "max-width:100%;height:auto;font-style:normal"
    attrs = f' role="img" aria-label="{label}" style="{style}"'
    return ("<svg" + attrs + text[m.end():]).strip()
