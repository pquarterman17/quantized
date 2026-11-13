"""Page setup margins are OUTER padding around a tight layout (publication-
figures audit B3, ``calc.figure_layout``).

The blocker: an 8.5 x 6 cm page exported with its tick labels, axis titles
and title clipped, because the page margins rode the wire as matplotlib
SUBPLOT fractions (``overrides.margins``): the axes box sat at the margin and
``tight_layout`` was skipped. ``overrides.page_pad`` now carries them; every
text artist must lie inside the canvas AND inside the page minus its margins,
and the exported page must still be exactly the requested size.
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

import quantized.calc.figure as figure_mod
from quantized.app import app
from quantized.calc.figure import render_figure

client = TestClient(app)

CM = 1 / 2.54
W_IN, H_IN = 8.5 * CM, 6.0 * CM
MARGIN_IN = 0.5 * CM
PAGE_PAD = {
    "left": MARGIN_IN / W_IN,
    "right": MARGIN_IN / W_IN,
    "top": MARGIN_IN / H_IN,
    "bottom": MARGIN_IN / H_IN,
}


def _capture_figure(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """Capture the Figure ``calc.figure`` hands to savefig (still drawable)."""
    seen: list[Any] = []
    real = figure_mod.savefig_bytes

    def spy(fig: Any, fmt: str, **kw: Any) -> bytes:
        out = real(fig, fmt, **kw)
        fig.canvas.draw()
        seen.append(fig)
        return out

    monkeypatch.setattr(figure_mod, "savefig_bytes", spy)
    return seen


def _drawn_text_extents(fig: Any) -> list[tuple[str, Any]]:
    """Every text artist the renderer actually draws, with its pixel box --
    tick labels only for ticks inside the view (matplotlib keeps, but never
    draws, label objects for locator ticks beyond the limits)."""
    renderer = fig.canvas.get_renderer()
    out = []
    for ax in fig.axes:
        for axis in (ax.xaxis, ax.yaxis):
            for tick in axis._update_ticks():  # the ticks a draw renders
                for label in (tick.label1, tick.label2):
                    if label.get_visible() and label.get_text().strip():
                        out.append((label.get_text(), label.get_window_extent(renderer)))
        for t in (ax.title, ax.xaxis.label, ax.yaxis.label):
            if t.get_text().strip():
                out.append((t.get_text(), t.get_window_extent(renderer)))
        legend = ax.get_legend()
        if legend is not None:
            out.append(("<legend>", legend.get_window_extent(renderer)))
    # The figure's own tight box: the union of everything that draws.
    out.append(
        ("<figure tight bbox>", fig.get_tightbbox(renderer).transformed(fig.dpi_scale_trans))
    )
    return out


def _render(**overrides: Any) -> bytes:
    x = np.linspace(0.0, 300.0, 40)
    return render_figure(
        x,
        [("Moment (emu)", 1e-3 * np.cos(x / 90.0)), ("Second", 2e-3 * np.sin(x / 70.0))],
        title="Sample A: magnetisation",
        x_label="Temperature (K)",
        y_label="Moment (10$^{-3}$ emu)",
        fmt="pdf",
        width_in=W_IN,
        height_in=H_IN,
        overrides=overrides,
    )


def test_page_margins_keep_every_label_inside_the_padded_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = _capture_figure(monkeypatch)
    _render(page_pad=PAGE_PAD, font_size=9)
    fig = seen[-1]
    w_px, h_px = fig.canvas.get_width_height()
    pad_x = PAGE_PAD["left"] * w_px
    pad_y = PAGE_PAD["bottom"] * h_px
    texts = _drawn_text_extents(fig)
    assert {"Sample A: magnetisation", "Temperature (K)"} <= {t for t, _ in texts}
    tol = 1.0  # one pixel of tight_layout rounding
    for text, box in texts:
        assert box.x0 >= -tol and box.y0 >= -tol, text
        assert box.x1 <= w_px + tol and box.y1 <= h_px + tol, text
        # Inside the page MINUS its margins: the margin is blank border.
        assert box.x0 >= pad_x - tol and box.x1 <= w_px - pad_x + tol, text
        assert box.y0 >= pad_y - tol and box.y1 <= h_px - pad_y + tol, text


def test_page_margins_keep_the_exact_page_size() -> None:
    pdf = _render(page_pad=PAGE_PAD)
    m = re.search(rb"/MediaBox \[\s*0 0 ([\d.]+) ([\d.]+)\s*\]", pdf)
    assert m is not None
    assert float(m.group(1)) == pytest.approx(W_IN * 72, abs=0.01)
    assert float(m.group(2)) == pytest.approx(H_IN * 72, abs=0.01)


def test_page_pad_is_validated() -> None:
    with pytest.raises(ValueError, match="page_pad"):
        _render(page_pad={"left": 0.9})
    with pytest.raises(ValueError, match="page_pad"):
        _render(page_pad={"left": float("nan")})


def test_explicit_subplot_margins_still_place_the_axes_box(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``margins`` (the Figure Builder's hand placement) keeps its meaning and
    wins over ``page_pad``."""
    seen = _capture_figure(monkeypatch)
    _render(margins={"left": 0.3, "bottom": 0.3}, page_pad=PAGE_PAD)
    ax = seen[-1].axes[0]
    assert ax.get_position().x0 == pytest.approx(0.3)
    assert ax.get_position().y0 == pytest.approx(0.3)


def test_route_exports_page_size_with_margins_and_reports_no_clip_warning() -> None:
    resp = client.post(
        "/api/export/figure",
        json={
            "dataset": {
                "time": [0.0, 1.0, 2.0, 3.0],
                "values": [[1.0], [3.0], [2.0], [4.0]],
                "labels": ["Signal"],
                "units": ["V"],
                "metadata": {},
            },
            "fmt": "pdf",
            "title": "Title",
            "width_in": W_IN,
            "height_in": H_IN,
            "overrides": {"page_pad": PAGE_PAD},
        },
    )
    assert resp.status_code == 200
    m = re.search(rb"/MediaBox \[\s*0 0 ([\d.]+) ([\d.]+)\s*\]", resp.content)
    assert m is not None and float(m.group(1)) == pytest.approx(W_IN * 72, abs=0.01)
    assert "page is too small" not in resp.headers.get("x-figure-warnings", "")


def test_an_impossible_page_warns_instead_of_clipping_silently() -> None:
    """A page too small for its own labels cannot be laid out; the export
    says so (calc.figure_warnings) rather than shipping clipped text quietly."""
    from quantized.calc.figure_warnings import collect_figure_warnings

    x = np.linspace(0.0, 1.0, 5)
    with collect_figure_warnings() as notes:
        render_figure(
            x,
            [("a", x)],
            title="A long title that cannot fit",
            x_label="x",
            y_label="y",
            fmt="png",
            dpi=50,
            width_in=0.6,
            height_in=0.5,
            overrides={"page_pad": {"left": 0.4, "right": 0.4, "top": 0.4, "bottom": 0.4}},
        )
    assert any("too small" in n for n in notes)
