"""A8 acceptance journey, supplementary structural parity checks.

``tests/test_export_vector_structure.py`` covers limits, tick labels, rich
text, legend, symmetric error spans, annotations and 2x2 placement. This file
adds what that suite does not compare, each against the REAL export routes
(``TestClient``) and the matplotlib Figure that was actually saved:

  * ASYMMETRIC Y errors: the bar drawn in the SVG spans ``[y - minus, y + plus]``
    (measured by converting the SVG's own pixel segment back to data units with
    the axes rect and the pinned y-limits), not a symmetrised bar.
  * SECONDARY (right) axis: its pinned limits, scale and the format of its tick
    labels land on the second Axes of the saved Figure.
  * LOG scale: the saved Axes is log and the requested limits are kept.
  * SERIES ORDER: a reordered ``y_keys`` list reorders the exported legend.
  * SVG vs PDF: the same request in both formats yields the same physical page
    size (SVG ``width``/``height`` in pt == PDF ``/MediaBox``), so a vector
    export is not silently rescaled between formats.

Not compared (human): glyph outlines, sub-pixel placement, what a PDF viewer
shows. No wall-clock or randomness is involved.
"""

from __future__ import annotations

import math
import re
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

_N = 12


def _dataset() -> dict[str, Any]:
    xs = [float(i) for i in range(_N)]
    return {
        "time": xs,
        "values": [[math.sin(v) + 3.0, 10.0 + v, 100.0 * (v + 1.0)] for v in xs],
        "labels": ["Alpha", "Beta", "Gamma"],
        "units": ["au", "au", "au"],
        "metadata": {},
    }


def _saved_figure(
    monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]
) -> matplotlib.figure.Figure:
    """The Figure the route actually saved (not a re-render)."""
    kept: list[matplotlib.figure.Figure] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: matplotlib.figure.Figure, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "no figure was saved"
    return kept[-1]


def _svg(body: dict[str, Any]) -> str:
    r = client.post("/api/export/figure", json={**body, "fmt": "svg"})
    assert r.status_code == 200, r.text
    return r.text


def test_asymmetric_y_errors_draw_a_bar_from_minus_to_plus(monkeypatch: pytest.MonkeyPatch) -> None:
    plus, minus = 0.5, 0.1
    body = {
        "dataset": _dataset(),
        "y_keys": [0],
        "error_spans": [{"y": {"plus": [plus] * _N, "minus": [minus] * _N}}],
        "overrides": {"y_lim": [0.0, 5.0], "x_lim": [-1.0, 12.0]},
    }
    fig = _saved_figure(monkeypatch, body)
    ax = fig.axes[0]
    assert tuple(ax.get_ylim()) == (0.0, 5.0)
    # Every drawn error segment, in DATA units (matplotlib's own transform).
    from matplotlib.collections import LineCollection

    cols = [c for c in ax.collections if isinstance(c, LineCollection)]
    assert cols, "no error-bar collection was drawn"
    ys = [(s[0][1], s[1][1]) for c in cols for s in c.get_segments() if s[0][0] == s[1][0]]
    assert ys, "no vertical error segments"
    expected = [
        (math.sin(float(i)) + 3.0 - minus, math.sin(float(i)) + 3.0 + plus) for i in range(_N)
    ]
    got = sorted((min(a, b), max(a, b)) for a, b in ys)
    for (glo, ghi), (elo, ehi) in zip(got, sorted(expected), strict=True):
        assert glo == pytest.approx(elo, abs=1e-9)
        assert ghi == pytest.approx(ehi, abs=1e-9)
    # The same bars reach the vector output.
    assert 'id="LineCollection_1"' in _svg(body)


def test_secondary_axis_limits_scale_and_tick_format_reach_the_figure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = {
        "dataset": _dataset(),
        "y_keys": [0, 2],
        "y2_keys": [2],
        "y2_scale": "log",
        "y2_step": None,
        "overrides": {"y2_lim": [50.0, 5000.0], "y_lim": [0.0, 6.0]},
        "y2_fmt": {"mode": "sci", "digits": 1},
    }
    fig = _saved_figure(monkeypatch, body)
    assert len(fig.axes) == 2, "a real secondary axis was drawn"
    left, right = fig.axes
    assert tuple(left.get_ylim()) == (0.0, 6.0)
    assert right.get_yscale() == "log"
    assert tuple(right.get_ylim()) == (50.0, 5000.0)
    # The requested sci(1) format shaped the right axis' tick labels.
    fig.canvas.draw()
    labels = [lb.get_text() for lb in right.get_yticklabels() if lb.get_text()]
    assert labels == ["1.0e+2", "1.0e+3"]


def test_log_scale_and_limits_survive_to_the_saved_axes(monkeypatch: pytest.MonkeyPatch) -> None:
    body = {
        "dataset": _dataset(),
        "y_keys": [2],
        "y_scale": "log",
        "overrides": {"y_lim": [50.0, 5000.0]},
    }
    ax = _saved_figure(monkeypatch, body).axes[0]
    assert ax.get_yscale() == "log"
    assert tuple(ax.get_ylim()) == (50.0, 5000.0)


def _legend(svg: str) -> list[str]:
    m = re.search(r'<g id="legend_1">', svg)
    assert m, "no legend in SVG"
    depth, pos = 1, m.end()
    for tm in re.finditer(r"<g\b|</g>", svg[pos:]):
        depth += -1 if tm.group() == "</g>" else 1
        if depth == 0:
            block = svg[m.start() : pos + tm.end()]
            return re.findall(r"<text[^>]*>([^<]*)</text>", block)
    raise AssertionError("unbalanced legend group")


def test_a_reordered_series_list_reorders_the_exported_legend() -> None:
    base = {"dataset": _dataset(), "overrides": {"legend": {"show": True, "loc": "upper right"}}}
    forward = _legend(_svg({**base, "y_keys": [0, 1, 2]}))
    reverse = _legend(_svg({**base, "y_keys": [2, 1, 0]}))
    assert forward == ["Alpha (au)", "Beta (au)", "Gamma (au)"]
    assert reverse == list(reversed(forward))


def _svg_size_pt(svg: str) -> tuple[float, float]:
    m = re.search(r'<svg[^>]*\bwidth="([\d.]+)pt"[^>]*\bheight="([\d.]+)pt"', svg, re.S)
    assert m, "SVG width/height in pt not found"
    return float(m.group(1)), float(m.group(2))


def _pdf_mediabox(pdf: bytes) -> tuple[float, float]:
    m = re.search(rb"/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]", pdf)
    assert m, "PDF MediaBox not found"
    return float(m.group(1)), float(m.group(2))


def test_svg_and_pdf_share_the_same_physical_page_size() -> None:
    body = {"dataset": _dataset(), "y_keys": [0], "width_in": 5.0, "height_in": 3.0}
    w, h = _svg_size_pt(_svg(body))
    r = client.post("/api/export/figure", json={**body, "fmt": "pdf"})
    assert r.status_code == 200, r.text
    pw, ph = _pdf_mediabox(r.content)
    assert (w, h) == pytest.approx((5.0 * 72, 3.0 * 72), abs=0.5)
    assert (pw, ph) == pytest.approx((w, h), abs=0.5)
