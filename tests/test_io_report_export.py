"""Report exporters (io.report_export): LaTeX/HTML always, docx/pptx if present.

The exporters walk the #36 report schema; these tests prove one schema renders
through every format with no per-block special cases, and that value ± error
formatting follows the stated uncertainty.
"""

from __future__ import annotations

import io as _io

import pytest

from quantized.calc.report import (
    ReportSheet,
    figure_block,
    params_block,
    section,
    table_block,
    text_block,
)
from quantized.calc.report_emit import from_anova, from_curve_fit
from quantized.calc.stats_anova2 import anova2
from quantized.io.report_export import (
    ReportExportError,
    format_value_error,
    render_report,
    to_html,
    to_latex,
)

_BATTERY = [
    [[130, 155, 74, 180], [34, 40, 80, 75]],
    [[150, 188, 159, 126], [136, 122, 106, 115]],
]


def _sample_report() -> dict:
    return from_curve_fit(
        {"params": [2.0, 5.0], "errors": [0.1, 0.3], "R2": 0.995, "chiSqRed": 1.02,
         "RMSE": 0.05, "AIC": -120.0, "nFree": 2, "nPoints": 50},
        param_names=["amplitude", "center"], param_units=["V", "nm"],
        model_name="Gaussian",
    ).to_dict()


# --------------------------------------------------------------------------
# value ± error formatting
# --------------------------------------------------------------------------
@pytest.mark.parametrize(("value", "error", "expected"), [
    (1.23456, 0.0123, "1.235 ± 0.012"),   # 2 sig figs on error -> value to 3 dp
    (1234.5, 120.0, "1230 ± 120"),        # large error -> round value to tens
    (0.00012345, 0.0000021, "0.0001234 ± 0.0000021"),
    (5.0, None, "5"),                     # no error -> plain number
    (5.0, 0.0, "5"),                      # zero error -> plain number
    (2.0, float("nan"), "2"),             # non-finite error -> plain number
])
def test_format_value_error(value: float, error: float | None, expected: str) -> None:
    assert format_value_error(value, error) == expected


# --------------------------------------------------------------------------
# LaTeX
# --------------------------------------------------------------------------
def test_latex_booktabs_and_value_error() -> None:
    tex = to_latex(_sample_report())
    assert r"\toprule" in tex and r"\midrule" in tex and r"\bottomrule" in tex
    assert r"\begin{tabular}{lrr}" in tex  # 3-col params table, left + 2 right
    assert r"2.00 $\pm$ 0.10" in tex       # unicode ± mapped to a math macro
    assert r"$\chi$" in tex                # 'Reduced χ²' glyph translated
    assert "±" not in tex and "χ" not in tex  # no raw unicode left


def test_latex_escapes_specials() -> None:
    rep = ReportSheet(title="A & B", sections=(
        section("100% done", [text_block("cost is $5 with _under_ & #hash")]),
    )).to_dict()
    tex = to_latex(rep)
    assert r"\&" in tex and r"\%" in tex and r"\$" in tex and r"\_" in tex and r"\#" in tex


# --------------------------------------------------------------------------
# HTML
# --------------------------------------------------------------------------
def test_html_self_contained_and_escaped() -> None:
    rep = ReportSheet(title="Rep <x>", sections=(
        section("Sec", [table_block(["a", "b"], [[1, 2]]),
                        params_block([{"name": "p<1>", "value": 1.0}])]),
    )).to_dict()
    doc = to_html(rep)
    assert doc.startswith("<!doctype html>")
    assert "<style>" in doc and "<table>" in doc
    assert "&lt;x&gt;" in doc and "p&lt;1&gt;" in doc  # HTML-escaped


# --------------------------------------------------------------------------
# dispatch + errors
# --------------------------------------------------------------------------
def test_render_report_text_flags_and_unknown() -> None:
    rep = _sample_report()
    data, mime, is_text = render_report(rep, "html")
    assert is_text and mime == "text/html" and data[:9] == b"<!doctype"
    data, mime, is_text = render_report(rep, "latex")
    assert is_text and mime == "text/x-tex"
    with pytest.raises(ReportExportError, match="unknown report format"):
        render_report(rep, "rtf")


# --------------------------------------------------------------------------
# Word / PowerPoint (optional deps)
# --------------------------------------------------------------------------
def test_docx_roundtrip() -> None:
    docx = pytest.importorskip("docx")
    data, mime, is_text = render_report(from_anova(anova2(_BATTERY)).to_dict(), "docx")
    assert not is_text and data[:2] == b"PK"  # zip container
    doc = docx.Document(_io.BytesIO(data))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "ANOVA" in text
    # the ANOVA table (5 sources + header) is embedded as a real table
    assert doc.tables and len(doc.tables[0].rows) == 6


def test_pptx_roundtrip() -> None:
    pptx = pytest.importorskip("pptx")
    data, mime, is_text = render_report(_sample_report(), "pptx")
    assert not is_text and data[:2] == b"PK"
    prs = pptx.Presentation(_io.BytesIO(data))
    assert len(prs.slides) >= 2  # title slide + one section slide


def _png_b64() -> str:
    import base64

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig = plt.figure(figsize=(2, 1.5))
    fig.gca().plot([0, 1, 2], [0, 1, 0])
    buf = _io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def _figure_report(image: dict | None) -> dict:
    return ReportSheet(title="Fig", sections=(
        section("Figures", [figure_block("plot1", image=image, caption="A plot")]),
    )).to_dict()


def test_docx_embeds_raster_figure() -> None:
    docx = pytest.importorskip("docx")
    rep = _figure_report({"mime": "image/png", "data": _png_b64()})
    data, _mime, _is_text = render_report(rep, "docx")
    doc = docx.Document(_io.BytesIO(data))
    assert len(doc.inline_shapes) == 1  # the PNG embedded, not a text placeholder


def test_pptx_embeds_raster_figure() -> None:
    pptx = pytest.importorskip("pptx")
    rep = _figure_report({"mime": "image/png", "data": _png_b64()})
    data, _mime, _is_text = render_report(rep, "pptx")
    prs = pptx.Presentation(_io.BytesIO(data))
    pics = [s for sl in prs.slides for s in sl.shapes if s.shape_type == 13]  # PICTURE
    assert len(pics) == 1


def test_docx_non_raster_figure_falls_back_to_text() -> None:
    docx = pytest.importorskip("docx")
    rep = _figure_report({"mime": "image/svg+xml", "data": "PHN2Zz48L3N2Zz4="})
    data, _mime, _is_text = render_report(rep, "docx")
    doc = docx.Document(_io.BytesIO(data))
    assert len(doc.inline_shapes) == 0  # SVG can't embed in Office
    assert any("[figure:" in p.text for p in doc.paragraphs)


def test_html_embeds_figure_image() -> None:
    rep = _figure_report({"mime": "image/png", "data": "QUJD"})
    doc = to_html(rep)
    assert "data:image/png;base64,QUJD" in doc and "<figure>" in doc
