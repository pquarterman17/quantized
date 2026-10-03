"""The Plot-tab view of a 2-D map (XRDML / Bruker .brml RSMs, pole figures).

A map DataStruct is a scattered point cloud: one row per detector pixel per
scan, ``[2Theta, <axis1>, Intensity, ...]``. Its ``.time`` is the default
plot x, and ``x_column_name`` titles that axis. Both must describe the same
thing: before this fix ``.time`` was the ROW INDEX while the title read
"2-Theta (deg)", so the Plot tab (and its SVG/PDF export, which read the same
``build_series`` default) drew every channel against 0..N-1 under a 2theta
title.

The map also carries the parser plot hints the frontend already honours:
``default_value_channels`` (plot Intensity, not every column) and
``default_trace = "Scatter"`` (markers, no joining lines: consecutive rows
jump from one scan's last pixel back to the next scan's first, so a line
would draw a fly-back stroke across the whole x range per scan).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.testing import assert_allclose

from quantized.calc.plotting import build_series
from quantized.datastruct import DataStruct
from quantized.io import import_auto
from quantized.io.xrdml import import_xrdml

_POLE_SCAN = """<scan appendNumber="{n}" status="Completed" scanAxis="Phi"><dataPoints>
 <positions axis="2Theta" unit="deg"><commonPosition>53.686</commonPosition></positions>
 <positions axis="Phi" unit="deg"><startPosition>0</startPosition>
 <endPosition>360</endPosition></positions>
 <positions axis="Psi" unit="deg"><commonPosition>{psi}</commonPosition></positions>
 <commonCountingTime unit="seconds">1.0</commonCountingTime>
 <counts unit="counts">1 2 3 4 5</counts>
</dataPoints></scan>"""


def _pole(tmp_path: Path) -> Path:
    scans = "".join(_POLE_SCAN.format(n=i + 1, psi=15.0 * i) for i in range(4))
    p = tmp_path / "pole.xrdml"
    p.write_text(
        '<?xml version="1.0"?><xrdMeasurements '
        'xmlns="http://www.xrdml.com/XRDMeasurement/2.0" status="Completed">'
        '<xrdMeasurement measurementType="Area measurement" status="Completed">'
        '<usedWavelength intended="K-Alpha 1"><kAlpha1 unit="Angstrom">1.5406'
        f"</kAlpha1></usedWavelength>{scans}</xrdMeasurement></xrdMeasurements>"
    )
    return p


def _assert_honest_map_plot(ds: DataStruct, x_channel: str, title: str) -> None:
    assert ds.metadata["is2D"] is True
    assert ds.metadata["x_column_name"] == title
    # The default x (.time) IS the channel its title names, row for row --
    # never the row index (the bug: 0, 1, 2, ... under "2-Theta (deg)").
    assert_allclose(ds.time, ds.column(x_channel))
    assert not np.array_equal(ds.time, np.arange(ds.n_points, dtype=float))
    plot = build_series(ds)  # the Plot tab + export default (x_key None)
    assert_allclose(plot.x, ds.column(x_channel))
    assert (plot.x_label, plot.x_unit) == (title, "deg")
    # Plot hints: Intensity alone, drawn as markers.
    assert ds.metadata["default_value_channels"] == [ds.labels.index("Intensity")]
    assert ds.metadata["default_trace"] == "Scatter"


@pytest.mark.parametrize(
    "fixture",
    [f"xrdml_{k}_synthetic.xrdml" for k in ("rsm", "snapshot", "coupled")],
)
def test_xrdml_rsm_default_x_is_two_theta(fixtures_dir: Path, fixture: str) -> None:
    _assert_honest_map_plot(import_xrdml(fixtures_dir / fixture), "2Theta", "2-Theta")


def test_xrdml_pole_figure_default_x_is_phi(tmp_path: Path) -> None:
    ds = import_xrdml(_pole(tmp_path))
    assert ds.metadata["mesh_kind"] == "pole"
    _assert_honest_map_plot(ds, "Phi", "Phi")


def test_one_d_xrdml_scan_takes_no_map_hints(fixtures_dir: Path) -> None:
    """A plain 2theta scan keeps its joined line: the hints are map-only."""
    ds = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml")
    assert "default_trace" not in ds.metadata
    assert "default_value_channels" not in ds.metadata


def test_plot_series_route_serves_two_theta_for_a_map(
    client: TestClient, fixtures_dir: Path
) -> None:
    """``/api/plot/series`` (the on-screen plot) with no x_key: x is 2theta."""
    ds = import_xrdml(fixtures_dir / "xrdml_rsm_synthetic.xrdml")
    r = client.post("/api/plot/series", json={"dataset": ds.to_dict()})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["x"]["label"] == "2-Theta"
    assert_allclose(np.asarray(body["data"][0], dtype=float), ds.column("2Theta"))


@pytest.mark.realdata
@pytest.mark.parametrize(
    "rel",
    ["panalytical/xrd/epytaxy_rsm.xrdml", "bruker/xrd/FAIRmat_RSM.brml"],
)
def test_corpus_map_default_x_is_two_theta(corpus_dir: Path, rel: str) -> None:
    path = corpus_dir / rel
    if not path.exists():
        pytest.skip("corpus file missing")
    _assert_honest_map_plot(import_auto(path), "2Theta", "2-Theta")
