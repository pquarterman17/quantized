"""Plan item 20 -- rug marks on a facet grid, an x-break and the magnifier inset, the BACKEND half.

``frontend/src/lib/rugPanelsFixture.test.ts`` records, per case, the export request the
Stage builds and, per panel, the X of every rug tick the canvas draws. Each request is
posted to the real route; every saved panel must hold rug segments at the same X (a numpy
selection of the finite points), with no warning that the rug was dropped.
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

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "rug_panels.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _render(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> tuple[Any, str]:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1], r.headers.get("x-figure-warnings", "")


def _rug_x(ax: Any) -> list[float]:
    out: list[float] = []
    for col in ax.collections:
        if col.get_gid() == "series-rug-x":
            out.extend(float(seg[0][0]) for seg in col.get_segments())
    return out


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_every_panel_holds_the_canvas_ticks(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig, warnings = _render(monkeypatch, case["request"])
    assert "ug" not in warnings, warnings  # no "Rug marks are not drawn in ..."
    want = case["canvas"]
    if "inset" in case["request"]["overrides"]:
        main, inset = fig.axes[0], fig.axes[0].child_axes[0]
        assert _rug_x(main) == pytest.approx(want[0])
        assert _rug_x(inset) == pytest.approx(want[0])
        return
    panels = [ax for ax in fig.axes if ax.get_visible() and ax.lines]
    assert len(panels) == len(want)
    for ax, ticks in zip(panels, want, strict=True):
        assert _rug_x(ax) == pytest.approx(ticks)
        # numpy: the panel line's finite points are exactly the ticks
        xs = np.asarray(ax.lines[0].get_xdata(), dtype=float)
        ys = np.asarray(ax.lines[0].get_ydata(), dtype=float)
        np.testing.assert_allclose(xs[np.isfinite(xs) & np.isfinite(ys)], ticks)
