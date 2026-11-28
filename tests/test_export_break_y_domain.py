"""Axis-break export range (#1227), the BACKEND half.

``frontend/src/lib/breakYDomainFixture.test.ts`` records, per case, the export request the Stage
builds and the y limits a real uPlot instance gives every segment (one exact shared domain). Each
request is posted to the real route; every exported panel must carry those limits, not
matplotlib's 5 % padded autoscale.
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
from quantized.calc.figure_break_domain import shared_y_domain

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "break_y_domain.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _render(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_every_exported_segment_has_the_screens_y_limits(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig = _render(monkeypatch, case["request"])
    panels = [ax for ax in fig.axes if ax.get_visible() and ax.lines]
    assert len(panels) == len(case["limits"]) == 2
    for ax, want in zip(panels, case["limits"], strict=True):
        np.testing.assert_allclose(ax.get_ylim(), want, rtol=1e-9, atol=1e-9)


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_the_domain_is_the_numpy_min_and_max_of_the_shown_rows(case: dict[str, Any]) -> None:
    """Independent check: numpy over the request's own rows, minus what a log axis cannot draw."""
    ds = case["request"]["dataset"]
    x = np.asarray(ds["time"], dtype=float)
    values = np.asarray(ds["values"], dtype=float)
    cols = values[:, case["request"]["y_keys"]]
    if case["request"]["y_scale"] != "linear":
        cols = np.where(cols > 0, cols, np.nan)
    np.testing.assert_allclose(
        (np.nanmin(cols), np.nanmax(cols)), case["domain"], rtol=1e-9, atol=1e-9
    )
    got = shared_y_domain(
        x, [("a", cols[:, k]) for k in range(cols.shape[1])], [(0, 4), (20, 24)],
        positive_only=case["request"]["y_scale"] != "linear",
    )
    assert got is not None
    np.testing.assert_allclose(got, case["domain"], rtol=1e-9, atol=1e-9)


def test_rows_in_the_elided_gap_do_not_stretch_the_domain() -> None:
    x = np.array([0.0, 1.0, 10.0, 20.0, 21.0])
    y = np.array([1.0, 2.0, 99.0, 3.0, 4.0])  # x = 10 lies between the segments: not drawn
    got = shared_y_domain(x, [("y", y)], [(0, 1), (20, 21)])
    assert got == pytest.approx((1.0, 4.0))


def test_a_flat_or_empty_domain_is_left_to_the_autoscale() -> None:
    x = np.array([0.0, 1.0])
    assert shared_y_domain(x, [("y", np.array([2.0, 2.0]))], [(0, 1)]) is None
    assert shared_y_domain(x, [("y", np.array([np.nan, np.nan]))], [(0, 1)]) is None
    assert shared_y_domain(x, [("y", np.array([-1.0, 0.0]))], [(0, 1)], positive_only=True) is None
