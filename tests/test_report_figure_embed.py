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
    fit_size,
    html_inline_svg,
    plan_figure,
    png_size_in,
)

_EMU = 914400


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
    assert (r"\IfFileExists{fig-Fig-1.pdf}{\includegraphics[width=4in]{fig-Fig-1.pdf}}"
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
