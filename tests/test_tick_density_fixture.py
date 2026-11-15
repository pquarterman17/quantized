"""The automatic tick density of the linear, numeric main axes (audit 6
lane L, P3 / B3) -- the BACKEND half.

The canvas used uPlot's 30 px tick spacing (about 20 Y majors) and the Stage
exports carried that increment into a 6x4 in PDF as ``y_step``, while
Publication preview let matplotlib choose: two tick sets for one graph. The
canvas now applies matplotlib's AutoLocator rule
(``frontend/src/lib/uplotRightPad.ts``'s ``autoTickStep``); every route sends
the drawn increment only as a hint the export takes when it fits
(``tests/test_tick_hint_fixture.py``), so matplotlib's own locator spaces an
export whose axes cannot hold the screen's step.

``tests/fixtures/wire/tick_density.json`` was generated from matplotlib; this
file pins that matplotlib still lands there, ``tickDensity.test.ts`` that the
canvas port does.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.figure import Figure

from quantized.app import app
from quantized.io.qd import import_mpms

client = TestClient(app)
ROOT = Path(__file__).parent
CASES = json.loads((ROOT / "fixtures" / "wire" / "tick_density.json").read_text("utf-8"))["cases"]


def _ticks(axis: str, lo: float, hi: float, length: float, font: float) -> list[float]:
    """matplotlib's own AutoLocator on an axis ``length`` pt long."""
    fig = Figure(figsize=(length / 72, 1) if axis == "x" else (1, length / 72))
    ax = fig.add_axes((0, 0, 1, 1))
    (ax.set_xlim if axis == "x" else ax.set_ylim)(lo, hi)
    ax.tick_params(labelsize=font)
    locs = (ax.xaxis if axis == "x" else ax.yaxis).get_majorticklocs()
    tol = 1e-12 * abs(hi - lo)
    return [float(v) for v in locs if lo - tol <= v <= hi + tol]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_matplotlib_places_the_fixture_ticks(case: dict[str, Any]) -> None:
    got = _ticks(case["axis"], *case["lim"], case["length"], case["font"])
    np.testing.assert_allclose(got, case["ticks"], rtol=0, atol=1e-9 * abs(np.ptp(case["lim"])))
    assert min(np.diff(got)) == pytest.approx(case["step"], rel=1e-9)


def test_a_6x4in_mpms_export_has_at_most_ten_y_tick_labels() -> None:
    """Acceptance 4: the request Export figure now sends (no automatic
    ``y_step``, no hint) keeps a 6x4 in SVG of ``mpms_mvst.dat`` publication-sparse."""
    ds = import_mpms(ROOT / "fixtures" / "mpms_mvst.dat")
    body = {
        "dataset": {
            "time": ds.time.tolist(), "values": ds.values.tolist(),
            "labels": list(ds.labels), "units": list(ds.units), "metadata": {},
        },
        "y_keys": [0], "fmt": "svg", "width_in": 6, "height_in": 4,
    }
    r = client.post("/api/export/figure", json=body)
    assert r.status_code == 200, r.text
    svg = r.content.decode("utf-8")
    labels = re.findall(r'<g id="ytick_\d+">', svg)
    assert 3 <= len(labels) <= 10, len(labels)  # matplotlib: 0.000 ... 0.009 here
    # The crowding the screen step used to carry in: 0.0005 apart, ~20 labels.
    crowded = client.post("/api/export/figure", json={**body, "y_step": 0.0005})
    assert len(re.findall(r'<g id="ytick_\d+">', crowded.content.decode("utf-8"))) > 10
