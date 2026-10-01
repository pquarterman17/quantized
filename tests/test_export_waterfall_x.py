"""Waterfall X offset -- screen == export, the BACKEND half.

``frontend/src/lib/waterfallXWireFixture.test.ts`` builds, from one view (Y and
X steps both set, a hidden middle series, an excluded row), the export request
the window sends AND the points each drawn series puts on the canvas, and
pins both as ``tests/fixtures/wire/waterfall_x_offset.json``. This posts the
request to the real route and reads every matplotlib line back: each series
must draw exactly the screen's points -- shifted along x by its own
``waterfall_x_offsets`` entry and up by its ``waterfall_offsets`` entry.
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

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "waterfall_x_offset.json"


def _fixture() -> dict[str, Any]:
    return dict(json.loads(FIXTURE.read_text(encoding="utf-8")))


def _rendered(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
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
    return kept[-1]


def _points(line: Any) -> tuple[list[float], list[float]]:
    x = np.asarray(line.get_xdata(), dtype=float)
    y = np.asarray(line.get_ydata(), dtype=float)
    keep = np.isfinite(x) & np.isfinite(y)
    return x[keep].tolist(), y[keep].tolist()


def test_each_series_draws_the_screens_shifted_points(monkeypatch: pytest.MonkeyPatch) -> None:
    fx = _fixture()
    req, screen = fx["request"], fx["screen"]
    assert req["waterfall_x_offsets"] == [0, 2]  # the X half really is on the wire
    fig = _rendered(monkeypatch, req)
    lines = fig.axes[0].get_lines()
    assert len(lines) == len(screen)
    for line, want in zip(lines, screen, strict=True):
        x, y = _points(line)
        assert x == pytest.approx(want["x"], abs=1e-9)
        assert y == pytest.approx(want["y"], abs=1e-9)


def test_without_the_x_half_every_series_shares_the_unshifted_x(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = {**_fixture()["request"]}
    req.pop("waterfall_x_offsets")
    lines = _rendered(monkeypatch, req).axes[0].get_lines()
    xs = [_points(line)[0] for line in lines]
    assert xs[0] == xs[1] == [10.0, 12.0, 14.0, 18.0]


# ── The X autoscale: the export covers the same domain the canvas does ──────
# ``frontend/src/lib/waterfallXDomainFixture.test.ts`` hand-states, per case,
# the x data domain an auto-scaled X axis must cover (every drawn series at its
# own shifted x; positive points only on a log X) and pins it beside the
# request in ``waterfall_x_domain.json``; the canvas half asserts uPlot's range
# is that domain padded by the canvas' rule. Here matplotlib's autoscaled xlim
# must be that SAME domain padded by matplotlib's margin rule, and an explicit
# ``x_lim`` must win outright.

DOMAIN_FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "waterfall_x_domain.json"
DOMAIN_CASES = json.loads(DOMAIN_FIXTURE.read_text(encoding="utf-8"))["cases"]


def _padded(domain: list[float], margin: float, log: bool) -> tuple[float, float]:
    lo, hi = (np.log10(domain[0]), np.log10(domain[1])) if log else (domain[0], domain[1])
    pad = (hi - lo) * margin
    a, b = lo - pad, hi + pad
    return (float(10**a), float(10**b)) if log else (a, b)


@pytest.mark.parametrize("case", DOMAIN_CASES, ids=[c["name"] for c in DOMAIN_CASES])
def test_the_x_autoscale_covers_every_shifted_series(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    req = case["request"]
    assert req.get("waterfall_x_offsets"), "the X step must be on the wire"
    ax = _rendered(monkeypatch, req).axes[0]
    got = ax.get_xlim()
    if case["x_lim"] is not None:
        assert got == pytest.approx(tuple(case["x_lim"]), abs=1e-12)
        return
    want = _padded(case["x_domain"], ax.margins()[0], req.get("x_scale") == "log")
    assert got == pytest.approx(want, rel=1e-12)
