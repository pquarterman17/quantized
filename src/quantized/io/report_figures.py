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

import base64 as _base64
import binascii as _binascii
import re
import struct
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from quantized.io.report_blocks import EMBEDDABLE_IMAGE_MIMES, decode_raster

__all__ = [
    "FIGURE_WIDTH_IN_RANGE",
    "HTML_EMBEDDABLE_IMAGE_MIMES",
    "OFFICE_DPI",
    "FigurePlan",
    "RenderedFigure",
    "figure_alt_text",
    "figure_file_stem",
    "figure_file_stems",
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

#: Sane inch range for an embedded figure's requested size (finding P3.6-R5):
#: a report author -- or a malformed/hostile spec -- can ask for anything, so
#: every consumer (the LaTeX ``\includegraphics`` width, the pixel-budget
#: check below) clamps to this range rather than trusting the request.
FIGURE_WIDTH_IN_RANGE = (0.5, 20.0)

#: Raster MIME types HTML can inline as a data URI (Office cannot place an
#: SVG directly -- see ``EMBEDDABLE_IMAGE_MIMES`` -- but a browser renders one
#: fine, so HTML's allowlist is one wider).
HTML_EMBEDDABLE_IMAGE_MIMES = (*EMBEDDABLE_IMAGE_MIMES, "image/svg+xml")

#: Strict base64 alphabet (letters, digits, ``+/=``, and whitespace some
#: encoders insert) -- rejects anything that could break out of an HTML
#: attribute (P3.6-R1: an attacker-controlled ``mime``/``data`` pasted
#: unescaped into ``<img src="data:...">`` is an HTML-injection vector).
_BASE64_RE = re.compile(r"^[A-Za-z0-9+/=\s]*$")

#: ``(section index, block index)`` -> that figure block's render.
FigureKey = tuple[int, int]


@dataclass(frozen=True, slots=True)
class RenderedFigure:
    """One figure block's server-side render (built by ``routes.report_figures``).

    ``png`` is the raster (``dpi`` dots per inch), ``svg`` the vector when the
    spec requested one. ``error`` set = nothing could be rendered (the block
    becomes a named placeholder); ``svg_error``/``png_error`` set = that ONE
    half rendered while the other one, requested, failed -- the specific
    reason for whichever half is missing, so a downstream placeholder or
    caption never has to fall back to a generic "wasn't rendered" message
    when the real one is known (P3.6-R9).
    """

    png: bytes | None = None
    svg: bytes | None = None
    dpi: int = OFFICE_DPI
    vector_requested: bool = False
    error: str | None = None
    svg_error: str | None = None
    png_error: str | None = None


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
    note: str | None = None  # a caveat printed with the caption / reported as a warning
    # kind == "placeholder" AND the block never carried an image or spec at all
    # (a pure FigureDoc reference, what ReportPanel builds today) -- rendered
    # as the pre-P3.6 "[figure: <caption>]" text, not a "not embedded: <reason>"
    # message (P3.6-R4: that reason is for a REAL failure, and showing it here
    # would be new noise on every reference-only figure every report already had).
    reference_only: bool = False


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


def _validate_html_image(image: Mapping[str, Any]) -> tuple[Mapping[str, str] | None, str | None]:
    """(a validated ``{mime, data}``, None) for an image HTML can inline as a
    data URI, else (None, reason). Both fields are checked against a strict
    allowlist/format BEFORE they ever reach an HTML attribute (P3.6-R1): an
    arbitrary ``mime`` (e.g. ``'image/png" onerror="alert(1)'``) or non-base64
    ``data`` is exactly the injection this closes, whether or not the caller
    also HTML-escapes the result belt-and-suspenders style."""
    mime = str(image.get("mime", ""))
    if mime not in HTML_EMBEDDABLE_IMAGE_MIMES:
        return None, f"image type {mime or '(none)'!r} is not embeddable in HTML"
    data = str(image.get("data", ""))
    if not _BASE64_RE.match(data):
        return None, "the attached image data is not valid base64"
    try:
        _base64.b64decode(data, validate=True)
    except (_binascii.Error, ValueError):
        return None, "the attached image data is not valid base64"
    return {"mime": mime, "data": data}, None


def _image_fallback(
    block: Mapping[str, Any], target: Literal["office", "html"], note: str
) -> FigurePlan | None:
    """``None`` unless ``block`` carries an embeddable ``image`` -- in which
    case the ``FigurePlan`` that shows it, captioned with ``note`` (P3.6-R3:
    a failed/un-rendered ``spec`` falls back to an attached image rather than
    a placeholder, when one is there and usable)."""
    image = block.get("image")
    if not isinstance(image, Mapping):
        return None
    if target == "html":
        safe_image, _reason = _validate_html_image(image)
        return None if safe_image is None else FigurePlan("image", image=safe_image, note=note)
    raster, _reason = _decode_image(image)
    return None if raster is None else FigurePlan("image", raster=raster, note=note)


def plan_figure(
    block: Mapping[str, Any],
    rendered: RenderedFigure | None,
    target: Literal["office", "html"],
) -> FigurePlan:
    """Decide what ``target`` embeds for ``block``.

    Order: a server render (``rendered``, from the block's ``spec``) wins over
    an attached ``image``; a spec that failed to render, or reached here
    un-rendered at all, falls back to a usable attached ``image`` (with a
    note naming the spec failure) before becoming a placeholder (P3.6-R3); a
    block with neither an image nor a spec is a placeholder marked
    ``reference_only`` (P3.6-R4) so the renderer keeps showing its caption
    instead of a "not embedded" message that was never true of it.
    """
    if rendered is not None:
        if rendered.error is not None or (rendered.png is None and rendered.svg is None):
            reason = rendered.error or "the render produced nothing"
            fallback = _image_fallback(
                block, target, f"the figure spec failed to render ({reason}); showing the "
                "attached image instead"
            )
            return fallback if fallback is not None else FigurePlan("placeholder", reason=reason)
        note = None
        if rendered.vector_requested and rendered.svg is None:
            note = (f"vector (SVG) unavailable ({rendered.svg_error or 'not rendered'}); "
                    f"embedded as a {rendered.dpi}-DPI PNG")
        return FigurePlan("render", png=rendered.png, svg=rendered.svg,
                          dpi=rendered.dpi, note=note)
    if "spec" in block and not isinstance(block["spec"], Mapping):
        return FigurePlan("placeholder", reason="its figure spec is not a JSON object")
    if isinstance(block.get("spec"), Mapping):
        reason = (
            "its figure spec was not rendered -- the spec is rendered by the server's "
            "figure exporter (POST /api/report/export), not by a bare render_report call"
        )
        fallback = _image_fallback(
            block, target, f"the figure spec was not rendered ({reason}); showing the "
            "attached image instead"
        )
        return fallback if fallback is not None else FigurePlan("placeholder", reason=reason)
    image = block.get("image")
    if isinstance(image, Mapping):
        if target == "html":
            safe_image, html_reason = _validate_html_image(image)
            if safe_image is None:
                return FigurePlan("placeholder", reason=html_reason)
            return FigurePlan("image", image=safe_image)
        raster, office_reason = _decode_image(image)
        if raster is None:
            return FigurePlan("placeholder", reason=office_reason)
        return FigurePlan("image", raster=raster)
    return FigurePlan("placeholder", reference_only=True,
                      reason="the block carries no image or figure spec")


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


def figure_file_stem(block: Mapping[str, Any], *, index: int | None = None) -> str:
    """A filesystem/LaTeX-safe stem for a figure's companion file: ``fig-<name>``,
    sanitized to ``[A-Za-z0-9-]`` -- a SUBSET of ``routes._export_common.
    _safe_name``'s own allowed charset (``[A-Za-z0-9._-]``), so a stem this
    returns is already stable under that function too (P3.6-R7: a companion
    file downloaded separately via ``/api/export/figure`` with this stem as
    its filename comes back unchanged, not re-mangled).

    A name with no survivable ASCII letters/digits (all-non-ASCII, blank, …)
    falls back to ``figure-<index>`` when ``index`` is given (the block's
    1-based position among the report's figures -- see
    :func:`figure_file_stems`, which is what a caller wanting UNIQUE stems
    across a whole report should use instead of calling this directly).
    """
    stem = re.sub(r"[^A-Za-z0-9-]+", "-", str(block.get("name", ""))).strip("-")
    if stem:
        return f"fig-{stem}"
    return f"figure-{index}" if index is not None else "fig-figure"


def figure_file_stems(report: Mapping[str, Any]) -> dict[FigureKey, str]:
    """A unique, deterministic file stem per figure block in ``report``, in
    document order (P3.6-R7). Two figures whose names sanitize to the same
    stem -- including two non-ASCII names that both fall back to
    ``figure-<n>`` -- would otherwise collide on the same companion file;
    repeats here get ``-2``, ``-3``, ... suffixes instead."""
    seen: dict[str, int] = {}
    stems: dict[FigureKey, str] = {}
    index = 0
    for si, sec in enumerate(report.get("sections", [])):
        for bi, block in enumerate(sec.get("blocks", [])):
            if block.get("type") != "figure":
                continue
            index += 1
            base = figure_file_stem(block, index=index)
            seen[base] = seen.get(base, 0) + 1
            n = seen[base]
            stems[(si, bi)] = base if n == 1 else f"{base}-{n}"
    return stems


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
