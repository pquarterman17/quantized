"""POST /api/export/figure with ``overrides.exchange_xy``: the turned figure
renders, and what the turn cannot draw honestly is refused with a 422 (the
screen blocks the same set in both directions: frontend/src/lib/exchangeXY.ts)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app

client = TestClient(create_app())

DATASET = {
    "time": [0.0, 1.0, 2.0, 3.0, 4.0],
    "values": [[10.0], [40.0], [90.0], [160.0], [250.0]],
    "labels": ["Signal"],
    "units": ["V"],
    "metadata": {},
}
EX = {"exchange_xy": True}
INSET = {"x": [1.0, 3.0], "y": [40.0, 160.0], "at": [0.5, 0.1, 0.3, 0.3]}


def _post(**body: Any) -> Any:
    return client.post("/api/export/figure", json={"dataset": DATASET, "fmt": "svg", **body})


def test_an_exchanged_figure_renders() -> None:
    resp = _post(overrides={"exchange_xy": True})
    assert resp.status_code == 200
    assert resp.content != _post().content  # turned, not the upright figure


@pytest.mark.parametrize(
    ("what", "body"),
    [
        ("inset", {"overrides": {"exchange_xy": True, "inset": INSET}}),
        ("Y axis breaks", {"overrides": EX, "y_fmt": {"breaks": [[50.0, 150.0]]}}),
        ("a top X axis", {"overrides": EX, "x_fmt": {"top": {"kind": "reciprocal", "factor": 1}}}),
        ("x_breaks", {"overrides": {"exchange_xy": True, "x_breaks": [[1.5, 2.5]]}}),
    ],
)
def test_what_the_turn_cannot_draw_is_refused_with_a_422(what: str, body: dict[str, Any]) -> None:
    resp = _post(**body)
    assert resp.status_code == 422, resp.text
    assert "exchange_xy" in resp.text


def test_the_same_settings_render_when_not_exchanged() -> None:
    assert _post(overrides={"inset": INSET}).status_code == 200
    assert _post(y_fmt={"breaks": [[50.0, 150.0]]}).status_code == 200


def _page(**panel_figure: Any) -> dict[str, Any]:
    return {
        "rows": 1, "cols": 1,
        "panels": [{"figure": {"dataset": DATASET, **panel_figure}, "row": 0, "col": 0}],
        "fmt": "svg",
    }


@pytest.mark.parametrize(
    ("what", "figure"),
    [
        ("inset", {"overrides": {**EX, "inset": INSET}}),
        ("Y axis breaks", {"overrides": EX, "y_fmt": {"breaks": [[50.0, 150.0]]}}),
        ("Y2 axis breaks", {"overrides": EX, "y2_fmt": {"breaks": [[50.0, 150.0]]}}),
        ("a top X axis", {"overrides": EX, "x_fmt": {"top": {"kind": "reciprocal", "factor": 1}}}),
    ],
)
def test_a_figure_page_panel_refuses_the_same_combinations_with_a_clean_422(
    what: str, figure: dict[str, Any]
) -> None:
    resp = client.post("/api/export/figure-page", json=_page(**figure))
    assert resp.status_code == 422, resp.text
    assert f"panel 0: exchange_xy is not supported together with {what}" in resp.text


def test_a_figure_page_panel_may_be_exchanged() -> None:
    assert client.post("/api/export/figure-page", json=_page(overrides=EX)).status_code == 200
