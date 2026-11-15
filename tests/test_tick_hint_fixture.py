"""Screen == export ticks through the hint -- the BACKEND half (audit 6 lane
L, review H2 / M2).

``frontend/src/lib/tickHintFixture.test.ts`` draws each case on a real uPlot
canvas and records its majors beside the request the shared spec builder
sends (``*_step_hint`` = the drawn increments, no typed steps). Here each
request renders at its own size: an axis marked ``"screen"`` must draw the
canvas' majors (the hint fit the laid-out axes, ``calc.tick_hint.hint_fits``);
one marked ``"auto"`` must fall back to AutoLocator and warn. The aps-size
cases are the negative control.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.ticker import AutoLocator

from quantized.app import app
from quantized.calc.tick_hint import TickHint, hint_fits, step_or_hint

client = TestClient(app)
CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "tick_hint.json").read_text("utf-8")
)["cases"]


def _render(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> tuple[Any, list[str]]:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1], json.loads(r.headers.get("X-Figure-Warnings", "[]"))


def _majors(axis: Any) -> list[float]:
    lo, hi = sorted(axis.get_view_interval())
    tol = 1e-9 * (hi - lo)
    return [float(t) for t in axis.get_majorticklocs() if lo - tol <= t <= hi + tol]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_export_takes_the_screen_ticks_only_where_they_fit(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig, warnings = _render(monkeypatch, case["request"])
    main = fig.axes[0]
    axes = {"x": main.xaxis, "y": main.yaxis}
    if case["request"].get("y2_keys"):
        axes["y2"] = next(a for a in fig.axes[1:] if a.bbox.bounds == main.bbox.bounds).yaxis
    for name, want in case["expect"].items():
        axis = axes[name]
        got = _majors(axis)
        if want == "screen":
            tol = 1e-12 + 1e-9 * abs(got[-1])
            np.testing.assert_allclose(got, case["canvas"][name], rtol=0, atol=tol)
        else:
            auto = AutoLocator()
            auto.set_axis(axis)
            lo, hi = sorted(axis.get_view_interval())
            want_ticks = [t for t in auto.tick_values(lo, hi) if lo <= t <= hi]
            assert got == pytest.approx(want_ticks), name
            assert got != pytest.approx(case["canvas"][name]), name
            prefix = f"{name[0].upper()} ticks re-spaced"
            assert any(w.startswith(prefix) for w in warnings), warnings
    if all(v == "screen" for v in case["expect"].values()):
        assert not any("re-spaced" in w for w in warnings), warnings


def test_a_typed_step_wins_and_a_bad_hint_is_dropped() -> None:
    assert step_or_hint(2.0, 5.0) == 2.0 and not isinstance(step_or_hint(2.0, 5.0), TickHint)
    assert isinstance(step_or_hint(None, 5.0), TickHint)
    assert step_or_hint(None, 0.0) is None and step_or_hint(None, float("nan")) is None


@pytest.mark.parametrize(
    ("span", "hint", "space", "fits"),
    [
        (174, 20, 12, True),  # 9 intervals on a 9-bin axis
        (174, 20, 7, False),  # ... on a 7-bin (aps) axis: 9 > 7 + 1
        (174, 20, 8, True),  # one interval of slack
        (0.0105, 0.0005, 11, False),  # the 0.34.0 crowding: 21 intervals
        (10, 5, 0, True),  # tick space clipped up to one bin: 2 <= 1 + 1
        (10, 2.5, 0, False),  # 4 > 1 + 1
        (0, 1, 9, False),  # no span
    ],
)
def test_hint_fits(span: float, hint: float, space: int, fits: bool) -> None:
    assert hint_fits(span, hint, space) is fits
