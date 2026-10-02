"""XRDML 1-D abscissa follows the SWEPT axis (plot-correctness audit 2026-10-02).

A rocking curve (``scanAxis="Omega"``) holds 2Theta at one commonPosition and
sweeps Omega. Reconstructing x from the 2Theta range gave every point the same
abscissa, so the curve plotted as a vertical line at the fixed 2Theta. The
1-D path must also carry the file's kAlpha1 wavelength (``wavelength_a``), as
the 2-D paths already do, so XRD reductions can pre-fill it.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.xrdml import import_xrdml


def _one_scan(scan_axis: str, positions: str, counts: str = "1 4 9 4 1") -> str:
    return f"""<?xml version="1.0"?>
<xrdMeasurements xmlns="http://www.xrdml.com/XRDMeasurement/2.1" status="Completed">
 <xrdMeasurement measurementType="Scan" status="Completed">
  <usedWavelength intended="K-Alpha 1"><kAlpha1 unit="Angstrom">1.5405980</kAlpha1></usedWavelength>
  <scan appendNumber="0" status="Completed" scanAxis="{scan_axis}">
   <dataPoints>
    {positions}
    <commonCountingTime unit="seconds">2.0</commonCountingTime>
    <counts unit="counts">{counts}</counts>
   </dataPoints>
  </scan>
 </xrdMeasurement>
</xrdMeasurements>"""


def _pos(axis: str, start: float, end: float | None = None) -> str:
    if end is None:
        return (
            f'<positions axis="{axis}" unit="deg">'
            f"<commonPosition>{start}</commonPosition></positions>"
        )
    return (
        f'<positions axis="{axis}" unit="deg"><startPosition>{start}</startPosition>'
        f"<endPosition>{end}</endPosition></positions>"
    )


def test_rocking_curve_x_is_omega(tmp_path: Path) -> None:
    p = tmp_path / "rc.xrdml"
    p.write_text(_one_scan("Omega", _pos("2Theta", 33.9) + _pos("Omega", 16.7, 17.1)
                           + _pos("Phi", 0.0)))
    ds = import_xrdml(p)
    assert_allclose(ds.time, np.linspace(16.7, 17.1, 5))
    assert ds.metadata["x_column_name"] == "Omega"
    assert ds.metadata["x_column_unit"] == "deg"
    assert ds.metadata["two_theta_deg"] == pytest.approx(33.9)
    assert ds.metadata["is2D"] is False
    assert_allclose(ds.values[:, 0], [0.5, 2.0, 4.5, 2.0, 0.5])  # cps unchanged


def test_phi_scan_x_is_phi(tmp_path: Path) -> None:
    p = tmp_path / "phi.xrdml"
    p.write_text(_one_scan("Phi", _pos("2Theta", 40.0) + _pos("Omega", 20.0)
                           + _pos("Phi", 0.0, 360.0)))
    ds = import_xrdml(p)
    assert_allclose(ds.time, np.linspace(0.0, 360.0, 5))
    assert ds.metadata["x_column_name"] == "Phi"


@pytest.mark.parametrize("axis", ["2Theta", "Gonio", "2Theta-Omega"])
def test_two_theta_scans_keep_two_theta_x(tmp_path: Path, axis: str) -> None:
    omega = _pos("Omega", 20.0, 21.0) if axis != "2Theta" else _pos("Omega", 4.0)
    p = tmp_path / "tt.xrdml"
    p.write_text(_one_scan(axis, _pos("2Theta", 40.0, 42.0) + omega))
    ds = import_xrdml(p)
    assert_allclose(ds.time, np.linspace(40.0, 42.0, 5))
    assert ds.metadata["x_column_name"] == "2-Theta"
    assert "two_theta_deg" not in ds.metadata


def test_1d_carries_wavelength(tmp_path: Path) -> None:
    p = tmp_path / "tt.xrdml"
    p.write_text(_one_scan("2Theta", _pos("2Theta", 40.0, 42.0)))
    assert import_xrdml(p).metadata["wavelength_a"] == pytest.approx(1.540598)


@pytest.mark.realdata
def test_corpus_rocking_curve_spans_omega(corpus_dir: Path) -> None:
    path = corpus_dir / "panalytical" / "xrd" / "mcda_omega.xrdml"
    if not path.exists():
        pytest.skip("rocking-curve corpus file missing")
    ds = import_auto(path)
    assert ds.metadata["x_column_name"] == "Omega"
    assert float(np.ptp(ds.time)) > 0.1  # a real sweep, not one repeated 2Theta
