"""PRIMARY_SOFTWARE_AUDIT_PLAN P3.6 (~line 8687-8688): "Windows/macOS vector
copy and 300-DPI raster fallback" / "Expected bounding box, transparency,
fonts, and scale" -- the VECTOR half.

"Copy figure (vector)" (MAIN_PLAN #35, ``frontend/src/lib/
copyFigureCommand.ts``'s ``runCopyFigureSvgCommand``) has no dedicated
backend route either: it POSTs the same ``FigureSpec`` shape to
``POST /api/export/figure`` with ``fmt="svg"`` (offered only where
``clipboardSvgSupported()`` says the browser's clipboard actually accepts an
SVG MIME type) and hands the bytes to the Clipboard API; PDF is not itself a
clipboard format but is the same renderer's other vector output and shares
every server-side guarantee this file checks. The OS-clipboard paste itself
(pasting into Word/Illustrator/Keynote on a real Windows/macOS box) needs a
real desktop and is NOT covered here -- see this module's report to the
caller for what still needs a platform check.

``tests/test_export_vector_structure.py`` already covers axis
limits/ticks/legend/annotation placement and states the project's stance on
PDF: no ``pypdf``/``pdfminer`` dependency, so PDF assertions there stay to
magic bytes + page count. This file goes one step further using only the
stdlib (``re`` + ``zlib``, no new dependency): matplotlib's own PDF backend
Flate-compresses each object stream, and the font Subtype / MediaBox / a
background-paint operator are all still recoverable by decompressing the
handful of small streams the fixture figures produce and reading the PDF
grammar directly -- see ``_pdf_content_streams`` for exactly what that gives
and doesn't. This is deliberately narrow, structural, and OS-independent:
CI runs ubuntu/windows/mac, and nothing here depends on font hinting,
subpixel AA, or a platform's installed fonts.
"""

from __future__ import annotations

import re
import zlib
from typing import Any

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

_N = 20
_PT_PER_IN = 72.0


def _dataset() -> dict[str, Any]:
    xs = [float(i) for i in range(_N)]
    ys = [float(i) ** 0.5 for i in xs]
    return {
        "time": xs,
        "values": [[y] for y in ys],
        "labels": ["Signal"],
        "units": ["V"],
        "metadata": {},
    }


def _payload(fmt: str, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "dataset": _dataset(),
        "fmt": fmt,
        "style": "default",
        "title": "Copy figure vector test",
        "x_label": "Time",
        "y_label": "Signal (V)",
    }
    payload.update(overrides)
    return payload


def _render(fmt: str, **overrides: Any) -> bytes:
    resp = client.post("/api/export/figure", json=_payload(fmt, **overrides))
    assert resp.status_code == 200, resp.text
    return resp.content


def _svg_root(svg: str) -> re.Match[str]:
    m = re.search(r"<svg\b[^>]*>", svg)
    assert m, "no <svg> root tag"
    return m


def _svg_size_pt(svg: str) -> tuple[float, float, tuple[float, float, float, float]]:
    """(width_pt, height_pt, viewBox) off the root ``<svg>`` tag."""
    root = _svg_root(svg).group(0)
    w = re.search(r'width="([\d.]+)pt"', root)
    h = re.search(r'height="([\d.]+)pt"', root)
    vb = re.search(r'viewBox="([\d.\s-]+)"', root)
    assert w and h and vb, f"missing size attrs on <svg>: {root[:200]}"
    vb_nums = tuple(float(v) for v in vb.group(1).split())
    assert len(vb_nums) == 4
    return float(w.group(1)), float(h.group(1)), vb_nums  # type: ignore[return-value]


def _pdf_mediabox_pt(pdf: bytes) -> tuple[float, float]:
    m = re.search(rb"/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]", pdf)
    assert m, "no /MediaBox in the PDF"
    x0, y0, x1, y1 = (float(g) for g in m.groups())
    assert (x0, y0) == (0.0, 0.0)
    return x1, y1


def _pdf_font_subtypes(pdf: bytes) -> set[bytes]:
    return set(re.findall(rb"/Subtype\s*/(\w+)", pdf))


def _pdf_content_streams(pdf: bytes) -> list[bytes]:
    """Every Flate-decompressible ``stream``...``endstream`` payload that
    looks like a real content stream (has a path-construction or text-show
    operator) -- filters out font-program streams (``FontFile2`` etc.), which
    are also Flate-compressed but are raw font binary, not PDF operators."""
    out = []
    for m in re.finditer(rb"stream\r?\n(.*?)endstream", pdf, re.S):
        raw = m.group(1)
        try:
            dec = zlib.decompress(raw)
        except zlib.error:
            continue
        if b" re" in dec or b" Tj" in dec or b" TJ" in dec:
            out.append(dec)
    return out


def _pdf_background_paint_op(pdf: bytes) -> bytes:
    """The paint operator ('f' fill, or 'n' no-op) matplotlib emits right
    after the whole-page background rectangle's closepath ('h') -- 'f' means
    the background was actually painted (opaque); 'n' means the path was
    built but never painted (transparent). Read from the FIRST content
    stream that has one, matching this file's ``h\\n\\n(f|n)`` shape (see
    this module's own exploratory measurement in the commit that added it)."""
    for dec in _pdf_content_streams(pdf):
        m = re.search(rb"h\r?\n\r?\n(f|n)\b", dec)
        if m:
            return m.group(1)
    raise AssertionError("no background closepath+paint-op found in any content stream")


# ---------------------------------------------------------------------------
# Fonts: embedded/converted as intended -- svg.fonttype "none", pdf.fonttype 42
# ---------------------------------------------------------------------------


def test_svg_text_renders_as_real_text_elements_not_outlined_paths() -> None:
    # svg.fonttype "none" (figure_render.BASE_RC): matplotlib writes an
    # editable <text> per label instead of per-glyph vector outlines.
    svg = _render("svg", y_label="Signal (V)").decode("utf-8", "replace")
    assert "<text" in svg
    body = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    assert re.search(r"<text[^>]*>[^<]*Signal \(V\)[^<]*</text>", body)


def test_pdf_fonts_are_embedded_truetype_not_bespoke_type3_procedures() -> None:
    # THE regression this suite exists to pin (PRIMARY_SOFTWARE_AUDIT_PLAN
    # P3.6): matplotlib's own default (pdf.fonttype=3) draws each glyph as a
    # bespoke per-document "draw procedure", not a real embedded font -- many
    # print/journal PDF pipelines reject or rasterize it. figure_render.
    # BASE_RC now sets pdf.fonttype=42, which embeds the actual TrueType
    # outlines as a real composite font (Type0 wrapping CIDFontType2):
    # editable/selectable text with a real font program behind it, the PDF
    # analogue of svg.fonttype="none" above.
    pdf = _render("pdf", y_label="Signal (V)")
    subtypes = _pdf_font_subtypes(pdf)
    assert "CIDFontType2" in {s.decode() for s in subtypes}, (
        f"no embedded TrueType (CIDFontType2) font in the PDF; subtypes found: {subtypes}"
    )
    assert b"Type3" not in subtypes, "PDF fell back to bespoke Type3 glyph procedures"


def test_pdf_text_is_shown_with_real_text_operators() -> None:
    # Not just "a real font is embedded" (above) but "it's actually USED to
    # show text" -- Tj/TJ operators against a Tf-selected font, not text
    # pre-rendered to filled Bezier paths (which would make it unselectable
    # regardless of which font object sits unused in the file).
    pdf = _render("pdf", y_label="Signal (V)")
    streams = _pdf_content_streams(pdf)
    assert streams, "no content stream decompressed"
    assert any(re.search(rb"\bTj\b|\bTJ\b", s) for s in streams)


# ---------------------------------------------------------------------------
# Page size: viewBox/MediaBox matches the figure size in points
# ---------------------------------------------------------------------------


def test_svg_viewbox_and_dimensions_match_the_default_style_size_in_points() -> None:
    # "default" is 6in x 4in -> 432pt x 288pt exactly.
    svg = _render("svg").decode("utf-8", "replace")
    w_pt, h_pt, viewbox = _svg_size_pt(svg)
    assert (w_pt, h_pt) == (432.0, 288.0)
    assert viewbox == (0.0, 0.0, 432.0, 288.0)


def test_svg_viewbox_matches_a_custom_figure_size_in_points() -> None:
    svg = _render("svg", width_in=5.0, height_in=3.0).decode("utf-8", "replace")
    w_pt, h_pt, viewbox = _svg_size_pt(svg)
    assert (w_pt, h_pt) == (5.0 * _PT_PER_IN, 3.0 * _PT_PER_IN)
    assert viewbox[2:] == (w_pt, h_pt)


def test_pdf_mediabox_matches_the_default_style_size_in_points() -> None:
    pdf = _render("pdf")
    assert _pdf_mediabox_pt(pdf) == (432.0, 288.0)


def test_pdf_mediabox_matches_a_custom_figure_size_in_points() -> None:
    pdf = _render("pdf", width_in=5.0, height_in=3.0)
    assert _pdf_mediabox_pt(pdf) == (5.0 * _PT_PER_IN, 3.0 * _PT_PER_IN)


# ---------------------------------------------------------------------------
# Transparency preserved in vector output
# ---------------------------------------------------------------------------


def test_svg_background_patch_fill_toggles_with_the_transparent_flag() -> None:
    opaque = _render("svg", transparent=False).decode("utf-8", "replace")
    clear = _render("svg", transparent=True).decode("utf-8", "replace")
    # The figure-patch group is always the first drawn element (id="patch_1");
    # its own <path> "style" attribute carries the fill.
    opaque_patch = re.search(r'<g id="patch_1">\s*<path[^>]*style="([^"]*)"', opaque)
    clear_patch = re.search(r'<g id="patch_1">\s*<path[^>]*style="([^"]*)"', clear)
    assert opaque_patch and clear_patch
    assert "fill: #ffffff" in opaque_patch.group(1)
    assert "fill: none" in clear_patch.group(1)


def test_pdf_background_paint_operator_toggles_with_the_transparent_flag() -> None:
    assert _pdf_background_paint_op(_render("pdf", transparent=False)) == b"f"
    assert _pdf_background_paint_op(_render("pdf", transparent=True)) == b"n"


# ---------------------------------------------------------------------------
# Scale: the same figure at 1x and 2x gives proportional vector page sizes
# ---------------------------------------------------------------------------


def test_svg_scale_2x_figure_geometry_doubles_the_page_size_exactly() -> None:
    svg1 = _render("svg", width_in=4.0, height_in=3.0).decode("utf-8", "replace")
    svg2 = _render("svg", width_in=8.0, height_in=6.0).decode("utf-8", "replace")
    w1, h1, vb1 = _svg_size_pt(svg1)
    w2, h2, vb2 = _svg_size_pt(svg2)
    assert (w2, h2) == (w1 * 2, h1 * 2)
    assert vb2[2:] == (vb1[2] * 2, vb1[3] * 2)


def test_pdf_scale_2x_figure_geometry_doubles_the_mediabox_exactly() -> None:
    w1, h1 = _pdf_mediabox_pt(_render("pdf", width_in=4.0, height_in=3.0))
    w2, h2 = _pdf_mediabox_pt(_render("pdf", width_in=8.0, height_in=6.0))
    assert (w2, h2) == (w1 * 2, h1 * 2)
