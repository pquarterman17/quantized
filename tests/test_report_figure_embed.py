"""Report exports embed the ACTUAL rendered figure (PRIMARY_SOFTWARE_AUDIT_PLAN P3.6).

A report figure block carrying ``spec`` (a ``/api/export/figure`` body) is
rendered by ``/api/report/export`` through the figure exporter itself. These
tests pin, per format:

* Word/PowerPoint: the embedded PNG part is BYTE-IDENTICAL to what
  ``/api/export/figure`` returns for the same spec at 300 DPI (so the pixels
  and dimensions match by construction), placed at the requested size (or
  scaled down, aspect kept, to fit), with alt text; a vector request also
  embeds the SVG part through the Office ``svgBlip`` extension.
* A figure that cannot be rendered becomes a placeholder NAMING the figure
  and the reason, the export still succeeds, and the response's
  ``X-Report-Warnings`` header lists it.
* HTML inlines the SVG (vector request) or the PNG; LaTeX emits an
  ``\\includegraphics`` guarded by ``\\IfFileExists`` plus a warning.
* A report WITHOUT figures is untouched: no media parts, no warnings header.

Word/PowerPoint tests skip cleanly when python-docx / python-pptx (the
``office`` extra) are not installed.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import struct
import zipfile
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.calc.report import ReportSheet, figure_block, section, text_block
from quantized.calc.report_emit import from_anova
from quantized.calc.stats_anova2 import anova2
from quantized.datastruct import DataStruct
from quantized.io.report_export import render_report, to_html, to_latex
from quantized.io.report_figures import (
    RenderedFigure,
    figure_file_stems,
    fit_size,
    html_inline_svg,
    plan_figure,
    png_size_in,
)

_EMU = 914400
# A real, minimal (2x2) PNG -- "QUJD" (base64 of "ABC") decodes fine but is
# not a real image, so it exercises fix 2's placeholder path instead of
# actually embedding; tests that need a genuinely embeddable raster use this.
_TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8"
    "z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=="
)


def _dataset() -> dict[str, Any]:
    t = np.linspace(0.0, 10.0, 60)
    ds = DataStruct(time=t, values=np.column_stack([np.sin(t), np.cos(t)]),
                    labels=("sin", "cos"), units=("V", "V"))
    return ds.to_dict()


def _spec(**kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {"dataset": _dataset(), "y_keys": [0, 1], "fmt": "svg",
                            "width_in": 4.0, "height_in": 3.0, "title": "Waves"}
    base.update(kw)
    return base


def _report(*blocks: dict[str, Any]) -> dict[str, Any]:
    return ReportSheet(title="Figures", sections=(
        section("Results", [text_block("Measured waves."), *blocks]),
    )).to_dict()


def _export(client: TestClient, report: dict[str, Any], fmt: str) -> Any:
    resp = client.post("/api/report/export", json={"report": report, "format": fmt})
    assert resp.status_code == 200, resp.text
    return resp


def _warnings(resp: Any) -> list[str]:
    return json.loads(resp.headers.get("x-report-warnings", "[]"))


def _reference_png(client: TestClient, spec: dict[str, Any]) -> bytes:
    resp = client.post("/api/export/figure", json={**spec, "fmt": "png", "dpi": 300})
    assert resp.status_code == 200
    return resp.content


def _media(data: bytes, prefix: str) -> dict[str, bytes]:
    z = zipfile.ZipFile(io.BytesIO(data))
    return {n: z.read(n) for n in z.namelist() if n.startswith(prefix)}


def _png_px(png: bytes) -> tuple[int, int]:
    w, h = struct.unpack(">II", png[16:24])
    return int(w), int(h)


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


# ── Word ──────────────────────────────────────────────────────────────────
def test_docx_embeds_the_same_render_as_the_figure_export(client: TestClient) -> None:
    docx = pytest.importorskip("docx")
    spec = _spec()
    resp = _export(client, _report(figure_block("waves", spec=spec, caption="Sin & cos")),
                   "docx")
    assert "x-report-warnings" not in resp.headers
    media = _media(resp.content, "word/media/")
    pngs = [b for n, b in media.items() if n.endswith(".png")]
    svgs = [b for n, b in media.items() if n.endswith(".svg")]
    ref = _reference_png(client, spec)
    assert len(pngs) == 1 and _sha(pngs[0]) == _sha(ref)  # same bytes -> same pixels
    assert _png_px(pngs[0]) == _png_px(ref) == (1200, 900)  # 4 x 3 in at 300 DPI
    assert len(svgs) == 1 and b"<svg" in svgs[0]  # the vector rides alongside

    doc = docx.Document(io.BytesIO(resp.content))
    (shape,) = doc.inline_shapes
    assert (shape.width, shape.height) == (4 * _EMU, 3 * _EMU)  # requested size kept
    doc_pr = shape._inline.docPr
    assert doc_pr.get("descr") == "Sin & cos" and doc_pr.get("title") == "waves"
    xml = shape._inline.xml
    assert "svgBlip" in xml and "{96DAC541-7B7A-43D3-8B79-37D633B846F1}" in xml
    # the svgBlip's relationship really targets the SVG part
    rid = re.search(r'svgBlip[^>]*r:embed="(rId\d+)"', xml)
    assert rid and doc.part.rels[rid.group(1)].target_ref.endswith(".svg")
    assert any(p.text == "Sin & cos" for p in doc.paragraphs)  # caption
    ctypes = zipfile.ZipFile(io.BytesIO(resp.content)).read("[Content_Types].xml")
    assert b'ContentType="image/svg+xml"' in ctypes


def test_docx_raster_request_embeds_png_only(client: TestClient) -> None:
    pytest.importorskip("docx")
    spec = _spec(fmt="png")
    resp = _export(client, _report(figure_block("waves", spec=spec)), "docx")
    media = _media(resp.content, "word/media/")
    assert [n for n in media if n.endswith(".svg")] == []
    (png,) = media.values()
    assert _sha(png) == _sha(_reference_png(client, spec))


def test_docx_oversize_figure_is_fitted_to_the_text_width(client: TestClient) -> None:
    docx = pytest.importorskip("docx")
    resp = _export(client, _report(figure_block("wide", spec=_spec(width_in=12.0,
                                                                     height_in=6.0))),
                   "docx")
    doc = docx.Document(io.BytesIO(resp.content))
    (shape,) = doc.inline_shapes
    sec = doc.sections[-1]
    text_w = sec.page_width - sec.left_margin - sec.right_margin
    assert shape.width == pytest.approx(text_w, abs=2)
    assert shape.width / shape.height == pytest.approx(2.0, rel=1e-3)  # aspect kept


def test_docx_failing_figures_become_named_placeholders(client: TestClient) -> None:
    docx = pytest.importorskip("docx")
    bad_channel = _spec(y_keys=[7])
    no_dataset = {"fmt": "svg"}
    report = _report(figure_block("good", spec=_spec()),
                     figure_block("bad-channel", spec=bad_channel),
                     figure_block("no-dataset", spec=no_dataset))
    resp = _export(client, report, "docx")  # the export itself never fails
    doc = docx.Document(io.BytesIO(resp.content))
    assert len(doc.inline_shapes) == 1  # the good figure still embeds
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "[figure: bad-channel — not embedded: render failed (" in text
    assert "[figure: no-dataset — not embedded: invalid figure spec -- dataset:" in text
    warns = _warnings(resp)
    assert resp.headers["x-report-warning-count"] == "2" and len(warns) == 2
    assert warns[0].startswith("figure 'bad-channel' (section 1): not embedded: render failed")
    assert "figure 'no-dataset'" in warns[1] and "dataset: Field required" in warns[1]


def test_docx_svg_only_image_names_why_it_is_not_embedded() -> None:
    docx = pytest.importorskip("docx")
    report = _report(figure_block("vec", image={"mime": "image/svg+xml",
                                                "data": "PHN2Zz48L3N2Zz4="}))
    warnings: list[str] = []
    data, _mime, _txt = render_report(report, "docx", warnings=warnings)
    doc = docx.Document(io.BytesIO(data))
    assert len(doc.inline_shapes) == 0
    assert any("[figure: vec — not embedded: an SVG image cannot be placed" in p.text
               for p in doc.paragraphs)
    assert len(warnings) == 1 and "figure spec" in warnings[0]


def test_bare_render_report_says_a_spec_was_not_rendered() -> None:
    docx = pytest.importorskip("docx")
    warnings: list[str] = []
    data, _mime, _txt = render_report(_report(figure_block("w", spec=_spec())), "docx",
                                      warnings=warnings)
    doc = docx.Document(io.BytesIO(data))
    assert any("its figure spec was not rendered" in p.text for p in doc.paragraphs)
    assert len(warnings) == 1


# ── PowerPoint ────────────────────────────────────────────────────────────
def test_pptx_embeds_the_same_render_as_the_figure_export(client: TestClient) -> None:
    pptx = pytest.importorskip("pptx")
    spec = _spec()
    resp = _export(client, _report(figure_block("waves", spec=spec, caption="Sin & cos")),
                   "pptx")
    media = _media(resp.content, "ppt/media/")
    pngs = [b for n, b in media.items() if n.endswith(".png")]
    svgs = [b for n, b in media.items() if n.endswith(".svg")]
    assert len(pngs) == 1 and _sha(pngs[0]) == _sha(_reference_png(client, spec))
    assert len(svgs) == 1 and b"<svg" in svgs[0]

    prs = pptx.Presentation(io.BytesIO(resp.content))
    pics = [s for sl in prs.slides for s in sl.shapes if s.shape_type == 13]
    assert len(pics) == 1
    pic = pics[0]
    assert (pic.width, pic.height) == (4 * _EMU, 3 * _EMU)
    c_nv_pr = pic._element.nvPicPr.cNvPr
    assert c_nv_pr.get("descr") == "Sin & cos" and c_nv_pr.get("title") == "waves"
    assert "svgBlip" in pic._element.xml
    texts = [s.text_frame.text for sl in prs.slides for s in sl.shapes if s.has_text_frame]
    assert "Sin & cos" in texts


def test_pptx_figures_that_do_not_fit_continue_on_a_new_slide(client: TestClient) -> None:
    pptx = pytest.importorskip("pptx")
    spec = _spec(width_in=6.0, height_in=4.5, fmt="png")
    resp = _export(client, _report(figure_block("a", spec=spec), figure_block("b", spec=spec)),
                   "pptx")
    prs = pptx.Presentation(io.BytesIO(resp.content))
    slide_h = prs.slide_height
    per_slide = [[s for s in sl.shapes if s.shape_type == 13] for sl in prs.slides]
    assert [len(p) for p in per_slide] == [0, 1, 1]  # title, section, "(cont.)"
    for pics in per_slide[1:]:
        assert pics[0].top + pics[0].height <= slide_h  # nothing hangs off a slide
    titles = [sl.shapes[0].text_frame.text for sl in list(prs.slides)[1:]]
    assert titles == ["Results", "Results (cont.)"]


def test_pptx_failing_figure_placeholder_and_warning(client: TestClient) -> None:
    pptx = pytest.importorskip("pptx")
    resp = _export(client, _report(figure_block("bad", spec=_spec(y_keys=[9]))), "pptx")
    prs = pptx.Presentation(io.BytesIO(resp.content))
    texts = [s.text_frame.text for sl in prs.slides for s in sl.shapes if s.has_text_frame]
    assert any(t.startswith("[figure: bad — not embedded: render failed (") for t in texts)
    assert _warnings(resp)[0].startswith("figure 'bad' (section 1): not embedded:")


# ── HTML / LaTeX ──────────────────────────────────────────────────────────
def test_html_inlines_svg_for_a_vector_request(client: TestClient) -> None:
    resp = _export(client, _report(figure_block("waves", spec=_spec(), caption="W <1>")),
                   "html")
    html = resp.text
    assert '<svg role="img" aria-label="W &lt;1&gt;"' in html
    assert "<?xml" not in html and "<!DOCTYPE svg" not in html
    assert "<figcaption>W &lt;1&gt;</figcaption>" in html


def test_html_embeds_png_for_a_raster_request_and_names_failures(client: TestClient) -> None:
    spec = _spec(fmt="png")
    resp = _export(client, _report(figure_block("r", spec=spec),
                                   figure_block("x", spec=_spec(y_keys=[5]))), "html")
    m = re.search(r'<img src="data:image/png;base64,([^"]+)" alt="r"', resp.text)
    assert m is not None
    import base64

    assert _sha(base64.b64decode(m.group(1))) == _sha(_reference_png(client, spec))
    assert "[figure: x — not embedded: render failed (" in resp.text
    assert len(_warnings(resp)) == 1


def test_latex_includes_the_exported_file_and_warns(client: TestClient) -> None:
    resp = _export(client, _report(figure_block("Fig 1", spec=_spec(), caption="A & B")),
                   "latex")
    tex = resp.text
    assert r"% Requires \usepackage{graphicx} (figures)" in tex
    assert (r"\IfFileExists{fig-Fig-1.pdf}{\includegraphics[width=4.00in]{fig-Fig-1.pdf}}"
            in tex)
    assert r"\caption{A \& B}" in tex
    assert "fig-Fig-1.pdf" in _warnings(resp)[0]


# ── no figures: nothing changes ───────────────────────────────────────────
_ANOVA = from_anova(anova2([[[130, 155, 74, 180], [34, 40, 80, 75]],
                            [[150, 188, 159, 126], [136, 122, 106, 115]]])).to_dict()


@pytest.mark.parametrize("fmt", ["docx", "pptx"])
def test_report_without_figures_has_no_media_and_no_warnings(
    client: TestClient, fmt: str
) -> None:
    pytest.importorskip("docx" if fmt == "docx" else "pptx")
    resp = _export(client, _ANOVA, fmt)
    assert "x-report-warnings" not in resp.headers
    assert _media(resp.content, "word/media/" if fmt == "docx" else "ppt/media/") == {}


def test_latex_and_html_without_figures_are_unchanged() -> None:
    tex = to_latex(_ANOVA)
    assert "graphicx" not in tex and r"\begin{figure}" not in tex
    assert tex.splitlines()[1:3] == [r"% Requires \usepackage{booktabs}", ""]
    assert "<figure>" not in to_html(_ANOVA)


# ── pure planning helpers ─────────────────────────────────────────────────
def test_fit_size_scales_down_only_and_keeps_aspect() -> None:
    assert fit_size(4.0, 3.0, 6.0, 9.0) == (4.0, 3.0)  # never upscaled
    w, h = fit_size(12.0, 6.0, 6.0, 9.0)
    assert (w, h) == (6.0, 3.0)
    w, h = fit_size(4.0, 12.0, 6.0, 6.0)
    assert (w, h) == (2.0, 6.0)


def test_png_size_in_reads_the_header() -> None:
    header = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", 600, 300)
    assert png_size_in(header, 300) == (2.0, 1.0)
    assert png_size_in(b"not a png", 300) is None


def test_plan_prefers_the_render_and_reports_a_lost_vector() -> None:
    block = figure_block("f", image={"mime": "image/png", "data": "QUJD"}, spec={"fmt": "svg"})
    plan = plan_figure(block, RenderedFigure(png=b"png", vector_requested=True,
                                             svg_error="boom"), "office")
    assert plan.kind == "render" and plan.png == b"png" and plan.svg is None
    assert plan.note is not None and "vector (SVG) unavailable (boom)" in plan.note
    bad = {"type": "figure", "name": "g", "spec": "nope"}
    assert plan_figure(bad, None, "office").reason == "its figure spec is not a JSON object"
    ref = plan_figure({"type": "figure", "name": "h"}, None, "html")
    assert ref.kind == "placeholder" and "no image or figure spec" in (ref.reason or "")


def test_html_inline_svg_strips_the_prolog() -> None:
    svg = b'<?xml version="1.0"?>\n<!DOCTYPE svg>\n<svg width="1pt"><g/></svg>\n'
    out = html_inline_svg(svg, "lbl")
    assert out is not None and out.startswith('<svg role="img" aria-label="lbl"')
    assert out.endswith("</svg>")
    assert html_inline_svg(b"<p>no</p>", "x") is None


def test_figure_block_spec_is_a_detached_copy() -> None:
    spec = {"fmt": "svg", "dataset": {"time": [1, 2]}}
    block = figure_block("f", spec=spec)
    spec["dataset"]["time"].append(3)
    assert block["spec"]["dataset"]["time"] == [1, 2]
    with pytest.raises(ValueError, match="mapping"):
        figure_block("f", spec="nope")  # type: ignore[arg-type]


@pytest.mark.parametrize("fmt", ["html", "docx", "pptx"])
def test_malformed_dataset_in_a_spec_is_a_placeholder_not_a_500(
    client: TestClient, fmt: str
) -> None:
    # The /api/export/figure analogue is a 422 (tests/test_routes_malformed_
    # dataset.py); inside a report it must degrade to that figure's placeholder.
    if fmt != "html":
        pytest.importorskip("docx" if fmt == "docx" else "pptx")
    bad = _spec(dataset={"time": {"not": "an array"}, "values": [[1.0, 2.0]],
                         "labels": ["a", "b"], "units": ["", ""], "metadata": {}})
    resp = _export(client, _report(figure_block("mangled", spec=bad)), fmt)
    (warn,) = _warnings(resp)
    assert warn.startswith("figure 'mangled' (section 1): not embedded: render failed (")


# ── P3.6 review round: fix 1 -- HTML injection via an attached image ───────
def test_html_image_mime_injection_is_rejected() -> None:
    """An unvalidated ``mime``/``data`` pasted into ``<img src="...">`` is an
    HTML-injection vector -- the mime here would break out of the attribute
    and inject an ``onerror`` handler if pasted in raw."""
    block = figure_block("evil", image={"mime": 'image/png" onerror="alert(1)', "data": "QUJD"})
    warnings: list[str] = []
    html = to_html(_report(block), warnings=warnings)
    assert "<img" not in html  # no <img> tag was ever built from the mime/data
    assert '" onerror="' not in html  # the raw (unescaped) breakout sequence
    assert "[figure: evil — not embedded: image type" in html
    assert warnings and "not embeddable in HTML" in warnings[0]


def test_html_image_non_base64_data_is_rejected() -> None:
    """``data`` that isn't base64 at all (e.g. a script-tag payload) must
    never reach the data-URI ``src`` attribute either."""
    block = figure_block("evil2", image={"mime": "image/png",
                                         "data": '"><script>alert(1)</script>'})
    html = to_html(_report(block))
    assert "<script>" not in html
    assert "[figure: evil2 — not embedded: the attached image data is not valid base64" in html


def test_html_valid_image_still_embeds(client: TestClient) -> None:
    """The fix must not break the legitimate case: a real PNG mime + real
    base64 data still embeds exactly as before."""
    resp = _export(client, _report(figure_block("ok", image={"mime": "image/png",
                                                             "data": "QUJD"})), "html")
    assert 'src="data:image/png;base64,QUJD"' in resp.text
    assert "x-report-warnings" not in resp.headers


# ── fix 2 -- a bad attached image must not crash Office export ────────────
def test_docx_bad_attached_image_becomes_placeholder_not_a_crash() -> None:
    docx = pytest.importorskip("docx")
    garbage = base64.b64encode(b"not a real image, just long enough garbage bytes").decode()
    report = _report(figure_block("bad-img", image={"mime": "image/png", "data": garbage}))
    warnings: list[str] = []
    data, _mime, _txt = render_report(report, "docx", warnings=warnings)  # must not raise
    doc = docx.Document(io.BytesIO(data))
    assert len(doc.inline_shapes) == 0
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "[figure: bad-img — not embedded: the attached image data is not a valid image" in text
    assert len(warnings) == 1 and "not a valid image" in warnings[0]


def test_pptx_bad_attached_image_becomes_placeholder_not_a_crash() -> None:
    pptx = pytest.importorskip("pptx")
    garbage = base64.b64encode(b"not a real image, just long enough garbage bytes").decode()
    report = _report(figure_block("bad-img", image={"mime": "image/png", "data": garbage}))
    warnings: list[str] = []
    data, _mime, _txt = render_report(report, "pptx", warnings=warnings)  # must not raise
    prs = pptx.Presentation(io.BytesIO(data))
    pics = [s for sl in prs.slides for s in sl.shapes if s.shape_type == 13]
    assert len(pics) == 0
    texts = [s.text_frame.text for sl in prs.slides for s in sl.shapes if s.has_text_frame]
    assert any("not a valid image" in t for t in texts)
    assert len(warnings) == 1 and "not a valid image" in warnings[0]


# ── fix 3 -- a failed/un-rendered spec falls back to an attached image ────
def test_html_falls_back_to_image_when_spec_render_fails(client: TestClient) -> None:
    block = figure_block("f", spec=_spec(y_keys=[9]), image={"mime": "image/png", "data": "QUJD"})
    resp = _export(client, _report(block), "html")
    assert 'src="data:image/png;base64,QUJD"' in resp.text
    (warn,) = _warnings(resp)
    assert "spec failed to render" in warn and "render failed (" in warn


def test_bare_render_report_falls_back_to_image_when_spec_is_present() -> None:
    block = figure_block("f", spec=_spec(), image={"mime": "image/png", "data": "QUJD"})
    warnings: list[str] = []
    html = to_html(_report(block), warnings=warnings)
    assert 'src="data:image/png;base64,QUJD"' in html
    assert warnings and "spec was not rendered" in warnings[0]


def test_docx_falls_back_to_image_when_spec_render_fails() -> None:
    docx = pytest.importorskip("docx")
    block = figure_block("f", spec=_spec(y_keys=[9]),
                         image={"mime": "image/png", "data": _TINY_PNG_B64})
    # _report() prepends a text block, so the figure lands at block index 1.
    figures = {(0, 1): RenderedFigure(error="render failed (boom)")}
    warnings: list[str] = []
    data, _mime, _txt = render_report(_report(block), "docx", figures=figures,
                                       warnings=warnings)
    doc = docx.Document(io.BytesIO(data))
    assert len(doc.inline_shapes) == 1  # the attached image, not a placeholder
    assert warnings and "spec failed to render" in warnings[0]


# ── fix 4 -- a reference-only figure block keeps its caption ──────────────
def test_reference_only_figure_block_keeps_its_caption_in_html() -> None:
    # The EXACT shape frontend/src/lib/report.ts's ReportFigureBlock builds
    # (and what ReportPanel emits today): no spec, no image.
    block = {"type": "figure", "name": "fig1", "caption": "My caption"}
    warnings: list[str] = []
    html = to_html(_report(block), warnings=warnings)
    assert "<figure>[figure: My caption]</figure>" in html
    assert "not embedded" not in html
    assert not warnings  # never new noise on a reference this every report already had


def test_reference_only_figure_block_falls_back_to_name_with_no_caption() -> None:
    block = {"type": "figure", "name": "fig2"}
    html = to_html(_report(block))
    assert "<figure>[figure: fig2]</figure>" in html


def test_plan_figure_marks_a_true_reference_as_reference_only() -> None:
    plan = plan_figure({"type": "figure", "name": "h"}, None, "html")
    assert plan.kind == "placeholder" and plan.reference_only is True
    # a REAL failure (an unusable image) is not reference_only
    bad = plan_figure({"type": "figure", "name": "g",
                       "image": {"mime": "image/svg+xml", "data": "x"}}, None, "office")
    assert bad.kind == "placeholder" and bad.reference_only is False


# ── fix 5 -- per-report resource limits ────────────────────────────────────
def test_report_figure_count_is_capped(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    import quantized.routes.report_figures as rf

    monkeypatch.setattr(rf, "MAX_FIGURES_PER_REPORT", 2)
    blocks = [figure_block(f"f{i}", spec=_spec(fmt="png")) for i in range(4)]
    resp = _export(client, _report(*blocks), "html")
    html = resp.text
    assert html.count('<img src="data:image/png') == 2  # only the cap's worth rendered
    assert html.count("render budget per export") == 2
    warns = _warnings(resp)
    assert sum("render budget per export" in w for w in warns) == 2


def test_render_spec_rejects_an_absurd_size_without_rendering() -> None:
    from quantized.routes.report_figures import MAX_FIGURE_PIXELS, render_spec

    spec = _spec(fmt="png", width_in=1000.0, height_in=1000.0)
    rendered = render_spec(spec, "office")
    assert rendered.png is None and rendered.svg is None
    assert rendered.error is not None
    assert f"{MAX_FIGURE_PIXELS // 1_000_000} Mpx" in rendered.error


def test_render_spec_clamps_width_to_the_sane_range() -> None:
    from quantized.routes.report_figures import render_spec

    # 25x1in is well under the 40 Mpx budget (2.25 Mpx) -- only the
    # width_in > 20in sane-range clamp should act here, not the budget reject.
    spec = _spec(fmt="png", width_in=25.0, height_in=1.0)
    rendered = render_spec(spec, "office")
    assert rendered.error is None and rendered.png is not None
    assert png_size_in(rendered.png, rendered.dpi) == (20.0, 1.0)  # clamped from 25


def test_office_library_is_checked_before_any_figure_renders(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    """A docx/pptx export with the library missing must 501 WITHOUT ever
    calling into figure rendering (P3.6-R5) -- proven by making a render call
    raise if it is ever reached. Patches the names as IMPORTED into the
    calling modules (``routes.report_export``/``io.report_export``), not the
    defining modules' own attributes -- ``from x import y`` binds a separate
    reference, so patching ``x.y`` alone would not be observed by the caller
    and the test would pass regardless of the real call order."""
    import quantized.io.report_export as report_export_io
    import quantized.routes.report_export as report_export_route
    from quantized.io.report_office import OfficeLibraryMissing

    def _boom(*_a: Any, **_kw: Any) -> Any:
        raise AssertionError("a figure was rendered before the library check ran")

    def _missing(fmt: str) -> None:
        raise OfficeLibraryMissing("Word export needs 'python-docx'")

    monkeypatch.setattr(report_export_route, "render_report_figures", _boom)
    monkeypatch.setattr(report_export_io, "check_office_library", _missing)
    resp = client.post("/api/report/export",
                       json={"report": _report(figure_block("f", spec=_spec())), "format": "docx"})
    assert resp.status_code == 501


def test_render_lock_is_not_held_across_figures(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each figure's render takes ``RENDER_LOCK`` on its own -- the report
    loop must never wrap several figures in one hold (P3.6-R5)."""
    import quantized.routes.report_figures as rf
    from quantized.calc.render_lock import acquire_render_lock, render_lock_is_held

    seen_held_at_entry = []

    def _fake_render_figure_request(req: Any, *, fmt: str, dpi: int) -> bytes:
        seen_held_at_entry.append(render_lock_is_held())
        with acquire_render_lock():  # simulate the real render's own lock use
            return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", 10, 10)

    monkeypatch.setattr(rf, "render_figure_request", _fake_render_figure_request)
    report = _report(figure_block("a", spec=_spec(fmt="png")),
                     figure_block("b", spec=_spec(fmt="png")))
    rf.render_report_figures(report, "office")
    # Neither figure's render observed the lock ALREADY held on entry -- if
    # the outer loop wrapped the whole report in one acquire, the second
    # figure's render would see it held before taking it itself.
    assert seen_held_at_entry == [False, False]
    assert not render_lock_is_held()  # released after the whole call too


# ── fix 6 -- no invalid-escape-sequence warning from any src/ module ──────
def test_no_src_module_emits_an_escape_sequence_warning() -> None:
    """``python -W error::SyntaxWarning -m compileall -q src`` is the CI-
    matching check; this is the version-portable equivalent (Python 3.11
    still classifies an invalid escape sequence as a DeprecationWarning, only
    3.12+ promotes it to SyntaxWarning -- see docs/testing.md-style notes in
    CLAUDE.md). ``report_export.py``'s module docstring had a literal
    ``\\includegraphics`` inside a non-raw string."""
    import pathlib
    import py_compile
    import warnings

    src_root = pathlib.Path(__file__).resolve().parents[1] / "src" / "quantized"
    offenders = []
    for path in sorted(src_root.rglob("*.py")):
        with warnings.catch_warnings(record=True) as rec:
            warnings.simplefilter("always")
            py_compile.compile(str(path), doraise=True)
        for w in rec:
            if "escape sequence" in str(w.message):
                offenders.append(f"{path.relative_to(src_root)}: {w.message}")
    assert not offenders, "\n".join(offenders)


# ── fix 7 -- unique LaTeX companion-file stems per report ─────────────────
def test_latex_figure_stems_are_deduped_across_a_report() -> None:
    report = _report(
        figure_block("Wave", spec=_spec()),
        figure_block("Wave", spec=_spec()),  # same sanitized name -> collision
        figure_block("Wave!!", spec=_spec()),  # sanitizes to the same "Wave" too
    )
    stems = figure_file_stems(report)
    # _report() prepends a text block, so the figures land at indices 1..3.
    values = [stems[(0, i)] for i in range(1, 4)]
    assert values == ["fig-Wave", "fig-Wave-2", "fig-Wave-3"]
    assert len(set(values)) == 3  # never collide on the same companion file


def test_latex_figure_stem_falls_back_for_non_ascii_names() -> None:
    report = _report(
        figure_block("図１", spec=_spec()),  # no ASCII letters/digits/dashes survive
        figure_block("図２", spec=_spec()),
    )
    stems = figure_file_stems(report)
    assert stems[(0, 1)] == "figure-1" and stems[(0, 2)] == "figure-2"


def test_latex_export_uses_deduped_stems(client: TestClient) -> None:
    report = _report(figure_block("Wave", spec=_spec()), figure_block("Wave", spec=_spec()))
    resp = _export(client, report, "latex")
    tex = resp.text
    assert "fig-Wave.pdf" in tex and "fig-Wave-2.pdf" in tex
    warns = _warnings(resp)
    assert any("fig-Wave.pdf" in w for w in warns) and any("fig-Wave-2.pdf" in w for w in warns)


# ── fix 8 -- LaTeX width is validated + clamped + fixed-point ─────────────
def test_latex_width_is_finite_and_clamped() -> None:
    huge = _report(figure_block("huge", spec=_spec(width_in=1000.0)))
    tex = to_latex(huge)
    assert r"width=20.00in" in tex  # clamped to FIGURE_WIDTH_IN_RANGE's 20in cap

    non_finite = _report(figure_block("bad", spec={**_spec(), "width_in": float("nan")}))
    tex2 = to_latex(non_finite)
    assert r"width=\linewidth" in tex2  # never a literal "nan" reaching the .tex
    assert "nanin" not in tex2


# ── fix 9 -- a downgrade inside a renderer must still warn ────────────────
def test_html_svg_with_no_svg_element_warns_on_downgrade() -> None:
    """A render that HAS svg bytes but no ``<svg`` element (and no PNG to
    fall back to) downgrades to a placeholder INSIDE ``_html_figure`` --
    that downgrade must still be reported as a warning, not silently lost."""
    report = _report(figure_block("f", spec=_spec()))
    # _report() prepends a text block, so the figure lands at block index 1.
    figures = {(0, 1): RenderedFigure(svg=b"not an svg at all", png=None,
                                      vector_requested=True)}
    warnings: list[str] = []
    html = to_html(report, figures=figures, warnings=warnings)
    assert "[figure: f — not embedded: the rendered SVG holds no &lt;svg&gt; element]" in html
    assert warnings and "no <svg> element" in warnings[0]


def test_office_reports_the_specific_png_failure_reason() -> None:
    """When an SVG half of a spec rendered but the PNG half specifically
    failed, Office's placeholder/warning must name THAT reason, not the
    generic 'no raster was rendered' message."""
    docx = pytest.importorskip("docx")
    report = _report(figure_block("f", spec=_spec()))
    # _report() prepends a text block, so the figure lands at block index 1.
    figures = {(0, 1): RenderedFigure(svg=b"<svg></svg>", png=None, vector_requested=True,
                                      png_error="ValueError: boom-png-reason")}
    warnings: list[str] = []
    data, _mime, _txt = render_report(report, "docx", figures=figures, warnings=warnings)
    doc = docx.Document(io.BytesIO(data))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "boom-png-reason" in text
    assert warnings and "boom-png-reason" in warnings[0]


# ── fix 10 -- narrowed exception handling + a scripting-API bridge ────────
def test_unexpected_exception_in_a_figure_render_propagates() -> None:
    """A programming bug (an exception outside CALC_ERRORS_WITH_LOCK) inside
    the figure exporter must propagate, not vanish into a silent placeholder
    -- only a bad-but-well-typed spec degrades."""
    import quantized.routes.report_figures as rf

    def _boom(req: Any, *, fmt: str, dpi: int) -> bytes:
        raise AttributeError("not a real report-input failure -- a bug")

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(rf, "render_figure_request", _boom)
        with pytest.raises(AttributeError, match="not a real report-input failure"):
            rf.render_spec(_spec(), "office")


def test_api_render_report_can_embed_spec_figures() -> None:
    """``quantized.api.render_report(..., render_figures=True)`` is the
    scripting-API bridge to the SAME figure exporter the server uses (P3.6-R10):
    a script-built report embeds a real figure, not just a placeholder."""
    import quantized.api as qz

    report = _report(figure_block("f", spec=_spec()))
    data, _mime, _is_text = qz.render_report(report, "html", render_figures=True)
    html = data.decode()
    assert "<svg" in html
    # the default (render_figures=False) stays byte-identical to before
    data2, _mime2, _ = qz.render_report(report, "html")
    assert "<svg" not in data2.decode()
    assert "its figure spec was not rendered" in data2.decode()
