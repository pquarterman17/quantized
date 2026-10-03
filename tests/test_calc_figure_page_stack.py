"""A figure page laid out as the Stage's per-channel STACK (plot audit round 4):
one column of panels sharing x, the x tick labels and title on the bottom
panel only (as the canvas blanks them on every panel above), and the page
kept near one figure's height instead of one figure per row."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import numpy as np
import pytest

import quantized.calc.figure_page as fp
from quantized.calc.figure_page import PagePanel, render_figure_page
from quantized.calc.figure_styles import figure_style


def _panel(row: int) -> PagePanel:
    x = np.linspace(0.0, 5.0, 30)
    series = [(f"s{row}", np.sin(x + row))]
    return PagePanel(x=x, series=series, row=row, col=0, x_label="Depth (nm)")


def _figure(n: int, **kw: Any) -> Any:
    captured: dict[str, Any] = {}
    real = fp.savefig_bytes

    def grab(fig: Any, *a: Any, **k: Any) -> bytes:
        captured["fig"] = fig
        return real(fig, *a, **k)

    with patch.object(fp, "savefig_bytes", grab):
        render_figure_page([_panel(r) for r in range(n)], rows=n, cols=1, fmt="svg", **kw)
    return captured["fig"]


def _shows_x(ax: Any) -> bool:
    return any(t.label1.get_visible() for t in ax.xaxis.get_major_ticks()) or bool(ax.get_xlabel())


def test_stack_labels_x_on_the_bottom_panel_only() -> None:
    axes = _figure(3, stack=True, link_x=True, label_format="none").axes
    assert [_shows_x(ax) for ax in axes] == [False, False, True]
    assert axes[-1].get_xlabel() == "Depth (nm)"


def test_plain_page_keeps_every_panels_x_labels() -> None:
    axes = _figure(3, link_x=True, label_format="none").axes
    assert all(_shows_x(ax) for ax in axes)


def test_stack_page_height_grows_by_a_third_of_a_figure_per_panel() -> None:
    st = figure_style("default")
    assert _figure(2, stack=True).get_figheight() == pytest.approx(st.fig_height_in)
    assert _figure(6, stack=True).get_figheight() == pytest.approx(2 * st.fig_height_in)
    assert _figure(6, stack=True, height_in=3.0).get_figheight() == pytest.approx(3.0)


def test_stack_needs_one_column() -> None:
    x = np.linspace(0.0, 1.0, 5)
    panels = [PagePanel(x=x, series=[("y", x)], row=0, col=c) for c in range(2)]
    with pytest.raises(ValueError, match="one column"):
        render_figure_page(panels, rows=1, cols=2, stack=True)


def test_route_passes_stack_through() -> None:
    from fastapi.testclient import TestClient

    from quantized.app import app

    ds = {"time": [0.0, 1.0, 2.0], "values": [[1.0], [2.0], [3.0]], "labels": ["A"], "units": [""]}
    panels = [{"figure": {"dataset": ds}, "row": 0, "col": c} for c in (0, 1)]
    body = {"rows": 1, "cols": 2, "panels": panels, "stack": True}
    resp = TestClient(app).post("/api/export/figure-page", json=body)
    assert resp.status_code == 422 and "one column" in resp.text
