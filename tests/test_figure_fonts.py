"""Figure typography (publication-figures audit #6 fonts, #7).

#6: setting a base font size of 12 left the title at the preset's 11 pt --
smaller than the axis labels. The title and legend now scale with the base,
and every element has its own size override.

#7: "Arial" silently rendered in DejaVu Sans although its metric-compatible
twin Liberation Sans was installed. Proprietary families now resolve to an
installed substitute, a real fallback is reported, and the font picker lists
what the export can render.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

import quantized.calc.figure as figure_mod
from quantized.app import app
from quantized.calc.figure import render_figure
from quantized.calc.figure_fonts import effective_style, installed_font_families, resolve_font
from quantized.calc.figure_styles import figure_style
from quantized.calc.figure_warnings import collect_figure_warnings

client = TestClient(app)


def _figure(monkeypatch: pytest.MonkeyPatch, **kwargs: Any) -> Any:
    seen: list[Any] = []
    real = figure_mod.savefig_bytes

    def spy(fig: Any, fmt: str, **kw: Any) -> bytes:
        # The family is generic ("sans-serif") and resolved against the
        # render's rc at draw time -- read the resolved name while it is live.
        fig.qz_title_font = fig.axes[0].title.get_fontname()
        seen.append(fig)
        return real(fig, fmt, **kw)

    monkeypatch.setattr(figure_mod, "savefig_bytes", spy)
    x = np.linspace(0.0, 1.0, 5)
    render_figure(
        x,
        [("a", x), ("b", 2 * x)],
        title="T",
        x_label="x",
        y_label="y",
        fmt="png",
        dpi=50,
        **kwargs,
    )
    return seen[-1]


def test_a_larger_base_size_never_leaves_a_smaller_title(monkeypatch: pytest.MonkeyPatch) -> None:
    ax = _figure(monkeypatch, overrides={"font_size": 12}).axes[0]
    assert ax.xaxis.label.get_fontsize() == 12
    assert ax.title.get_fontsize() > ax.xaxis.label.get_fontsize()
    # The preset's own title/legend ratios are kept (default: 11/10, 9/10).
    assert ax.title.get_fontsize() == pytest.approx(12 * 11 / 10)
    assert ax.get_legend().get_texts()[0].get_fontsize() == pytest.approx(12 * 9 / 10)


def test_every_element_size_is_honoured(monkeypatch: pytest.MonkeyPatch) -> None:
    ov = {"font_size": 9, "title_size": 15, "label_size": 13, "tick_size": 7, "legend_size": 6}
    ax = _figure(monkeypatch, overrides=ov).axes[0]
    assert ax.title.get_fontsize() == 15
    assert ax.xaxis.label.get_fontsize() == 13
    assert ax.yaxis.label.get_fontsize() == 13
    assert ax.xaxis.get_ticklabels()[0].get_fontsize() == 7
    assert ax.get_legend().get_texts()[0].get_fontsize() == 6


@pytest.mark.parametrize(
    "key", ["title_size", "label_size", "tick_size", "legend_size", "font_size"]
)
def test_a_bad_size_is_refused(key: str) -> None:
    x = np.linspace(0.0, 1.0, 3)
    with pytest.raises(ValueError, match=key):
        render_figure(x, [("a", x)], overrides={key: 0})


def test_effective_style_is_idempotent() -> None:
    st = figure_style("aps")
    ov = {"font_size": 12}
    once = effective_style(st, ov)
    assert effective_style(once, ov) == once


def test_proprietary_families_resolve_to_metric_compatible_twins() -> None:
    have = ["Liberation Sans", "Liberation Serif", "DejaVu Sans"]
    assert resolve_font("Arial", "sans-serif", have).family == "Liberation Sans"
    assert resolve_font("Helvetica", "sans-serif", have).family == "Liberation Sans"
    assert resolve_font("Times New Roman", "serif", have).family == "Liberation Serif"
    assert resolve_font("arial", "sans-serif", have).status == "substituted"
    assert resolve_font("Liberation Sans", "sans-serif", have).status == "installed"
    gone = resolve_font("Arial", "sans-serif", ["DejaVu Sans"])
    assert (gone.family, gone.status) == ("DejaVu Sans", "fallback")
    assert resolve_font("Nope Sans", "serif", have).family == "DejaVu Serif"


@pytest.mark.skipif(
    "Liberation Sans" not in installed_font_families(), reason="needs Liberation Sans installed"
)
def test_arial_renders_in_liberation_sans_and_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    with collect_figure_warnings() as notes:
        fig = _figure(monkeypatch, overrides={"font_name": "Arial"})
    assert fig.qz_title_font == "Liberation Sans"
    assert any("Liberation Sans" in n for n in notes)


def test_a_missing_font_falls_back_with_a_warning_on_the_export_route() -> None:
    r = client.post(
        "/api/export/figure",
        json={
            "dataset": {
                "time": [0.0, 1.0],
                "values": [[1.0], [2.0]],
                "labels": ["a"],
                "units": [""],
                "metadata": {},
            },
            "fmt": "png",
            "dpi": 50,
            "overrides": {"font_name": "Definitely Not A Font"},
        },
    )
    assert r.status_code == 200
    warnings = json.loads(r.headers["x-figure-warnings"])
    assert any("Definitely Not A Font" in w and "DejaVu" in w for w in warnings)


def test_the_font_picker_lists_what_the_export_can_render() -> None:
    r = client.get("/api/export/fonts")
    assert r.status_code == 200
    body = r.json()
    assert "DejaVu Sans" in body["families"]
    assert set(body["aliases"]) >= {"Arial", "Helvetica", "Times New Roman"}
    for res in body["aliases"].values():
        assert res["status"] in {"installed", "substituted", "fallback"}
        assert res["family"] in body["families"] or res["status"] == "fallback"


@pytest.mark.skipif(
    "Liberation Sans" not in installed_font_families(), reason="needs Liberation Sans installed"
)
@pytest.mark.parametrize("style", ["aps", "nature", "web"])
def test_every_renderer_resolves_a_preset_font_the_same_way(style: str) -> None:
    """Every figure renderer (map, statplot, corner, facets, ...) builds its
    family rc through ``font_family_rc``; a Helvetica/Arial preset renders in
    Liberation Sans there too, not a silent DejaVu."""
    from quantized.calc.figure_fonts import font_family_rc

    rc = font_family_rc(figure_style(style))
    assert rc["font.family"] == "sans-serif"
    assert rc["font.sans-serif"][0] == "Liberation Sans"
