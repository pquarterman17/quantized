"""Screen == export tick positions (figures integration).

The canvas drew x ticks 2, 4, ... where the export's matplotlib AutoLocator
chose 2.5, 5, .... The client now sends the increment the canvas drew as
``x_step`` (``frontend/src/lib/liveTickSteps.ts``) and the export marks the
same ticks. Shared fixture: ``tests/fixtures/wire/live_tick_steps.json``,
also read by ``liveTickSteps.test.ts``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)
FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "live_tick_steps.json").read_text("utf-8")
)


def _axes(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1].axes[0]


def _body(**extra: Any) -> dict[str, Any]:
    return {
        "dataset": {
            "time": FIXTURE["x"], "values": [[v] for v in FIXTURE["y"]],
            "labels": ["y"], "units": [""], "metadata": {},
        },
        "y_keys": [0], "fmt": "svg",
        "overrides": {"x_lim": FIXTURE["x_lim"]},
        **extra,
    }


def _visible(ax: Any) -> list[float]:
    lo, hi = ax.get_xlim()
    return [float(t) for t in ax.get_xticks() if lo - 1e-9 <= t <= hi + 1e-9]


def test_the_export_marks_the_ticks_the_canvas_drew(monkeypatch: pytest.MonkeyPatch) -> None:
    ax = _axes(monkeypatch, _body(x_step=FIXTURE["x_step"]))
    assert _visible(ax) == FIXTURE["ticks"]


def test_without_the_canvas_increment_matplotlib_picks_its_own(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The disagreement the fixture pins: matplotlib alone does not land on
    the screen's ticks for this range at the export's size."""
    ax = _axes(monkeypatch, _body())
    assert _visible(ax) != FIXTURE["ticks"]
