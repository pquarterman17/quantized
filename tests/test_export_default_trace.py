"""The Preferences default trace (Scatter / Line + markers / Step) -- screen ==
export, the BACKEND half.

``frontend/src/lib/defaultTraceFixture.test.ts`` pins, per case, what every
drawn series looks like on the canvas (connecting line, markers, step-after)
beside the exact request the live Stage export sends. matplotlib must draw
each exported series the same way.
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

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "default_trace.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _lines(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> list[Any]:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "no figure was saved"
    return [ln for ln in kept[-1].axes[0].get_lines() if not str(ln.get_label()).startswith("_")]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_each_exported_series_is_drawn_in_the_canvas_trace(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    lines = _lines(monkeypatch, case["request"])
    drawn = [
        {
            "line": ln.get_linestyle() not in ("None", "none", "") and ln.get_linewidth() > 0,
            "marker": ln.get_marker() not in (None, "None", "none", ""),
            "step": "post" if ln.get_drawstyle() == "steps-post" else None,
        }
        for ln in lines
    ]
    assert drawn == case["drawn"]
