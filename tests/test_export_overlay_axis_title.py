"""Gap audit 6 lane K (B2): a fitted graph's auto Y title, screen == export --
the BACKEND half.

``frontend/src/lib/overlayAxisTitleFixture.test.ts`` pins, per case, the Y
title the canvas draws (from the plotted channels alone) beside the exact
request the Stage export sends, whose fit / band / baseline / peak series are
marked by ``analysis_overlays``. matplotlib must title the axis the same --
it read "signal, fit, 95% CI low, ... (V)" -- in the figure and in the SVG
text, and a Figure Page panel embedding the same request too.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.plotting import PlotSeries
from quantized.routes.export_figures_labels import solo_axis_label

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "overlay_axis_title.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
IDS = [c["name"] for c in CASES]


def _ylabels(
    monkeypatch: pytest.MonkeyPatch, url: str, body: dict[str, Any]
) -> tuple[list[str], str]:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post(url, json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "no figure was saved"
    return [ax.get_ylabel() for ax in kept[-1].axes if ax.get_ylabel()], r.text


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_export_y_title_is_the_screens(
    case: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    labels, svg = _ylabels(monkeypatch, "/api/export/figure", case["request"])
    assert labels == [case["title"]]
    # The SVG's text: the title once, and no overlay name in any Y title.
    assert case["title"] in svg
    for overlay in ("fit", "CI low", "baseline"):
        assert f"{case['title'].split(' (')[0]}, {overlay}" not in svg


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_page_panel_y_title_is_the_screens(
    case: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    panel = {"figure": case["request"], "row": 0, "col": 0}
    page = {"rows": 1, "cols": 1, "fmt": "svg", "panels": [panel]}
    labels, _svg = _ylabels(monkeypatch, "/api/export/figure-page", page)
    assert labels == [case["title"]]


def _series(label: str, unit: str = "V") -> PlotSeries:
    return PlotSeries(label=label, unit=unit, values=np.zeros(3))


def test_solo_axis_label_skips_marked_overlays() -> None:
    """One data series plus a fit and two band edges: the data series' name."""
    series = [
        _series("signal"), _series("fit", ""), _series("95% CI low", ""), _series("95% CI high", "")
    ]
    names = ["signal (V)", "fit", "95% CI low", "95% CI high"]
    assert solo_axis_label(None, names, series, 0, [False, True, True, True]) == "signal (V)"
    # Unmarked (a request from before the flag): the old joint title.
    assert "fit" in solo_axis_label(None, names, series, 0)
    # A short flag list marks only what it covers; an explicit title still wins.
    assert solo_axis_label(None, names[:2], series[:2], 0, [False, True]) == "signal (V)"
    assert solo_axis_label("Custom", names, series, 0, [False, True, True, True]) == "Custom"
