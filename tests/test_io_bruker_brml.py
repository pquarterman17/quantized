"""Bruker .brml (ZIP-of-XML) parser: synthetic guard-rail tests (CI) + a real
FAIRmat 1-D line scan decode (realdata).

The synthetic builder writes a minimal but structurally faithful RawData XML
(ScanInformation / ScanAxisInfo / Datum rows) into a ZIP, so CI exercises the
abscissa-column matching, last-column-is-intensity rule, and multi-scan (RSM)
rejection without shipping a binary.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.bruker_brml import import_bruker_brml, is_bruker_brml


def _rawdata_xml(two_theta: list[float], counts: list[float]) -> str:
    start, stop = two_theta[0], two_theta[-1]
    inc = (stop - start) / (len(two_theta) - 1) if len(two_theta) > 1 else 1.0
    # Datum columns: plannedTime, measuredTime, TwoTheta, Theta, RecSpace, Counts
    data = "\n".join(
        f"<Datum>1,1,{tt},{tt / 2},{-0.1},{c}</Datum>"
        for tt, c in zip(two_theta, counts, strict=True)
    )
    return f"""<?xml version="1.0"?>
<RawData>
  <DataRoutes><DataRoute RouteFlag="Measured">
    <ScanInformation>
      <MeasurementPoints>{len(two_theta)}</MeasurementPoints>
      <ScanAxes>
        <ScanAxisInfo AxisId="TwoTheta" VisibleName="2Theta" Unit="°">
          <Start>{start}</Start><Stop>{stop}</Stop><Increment>{inc}</Increment>
        </ScanAxisInfo>
        <ScanAxisInfo AxisId="Theta" VisibleName="Omega" Unit="°">
          <Start>{start / 2}</Start><Stop>{stop / 2}</Stop><Increment>{inc / 2}</Increment>
        </ScanAxisInfo>
      </ScanAxes>
    </ScanInformation>
    {data}
  </DataRoute></DataRoutes>
</RawData>"""


def _make_brml(tmp_path: Path, scans: int = 1, name: str = "s.brml") -> Path:
    p = tmp_path / name
    tt = [10.0, 10.5, 11.0, 11.5, 12.0]
    counts = [100.0, 250.0, 900.0, 240.0, 110.0]
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("experimentCollection.xml", "<x/>")
        for j in range(scans):
            zf.writestr(f"Experiment0/RawData{j}.xml", _rawdata_xml(tt, counts))
    return p


def test_synthetic_1d_scan(tmp_path: Path) -> None:
    ds = import_bruker_brml(_make_brml(tmp_path))
    assert_allclose(ds.time, [10.0, 10.5, 11.0, 11.5, 12.0])
    assert_allclose(ds.values[:, 0], [100.0, 250.0, 900.0, 240.0, 110.0])  # last col
    assert ds.labels == ("Intensity",) and ds.units == ("counts",)
    assert ds.metadata["x_column_name"] == "2Theta"
    assert ds.metadata["x_column_unit"] == "deg"  # ° normalized


def test_multiscan_rsm_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="multi-scan"):
        import_bruker_brml(_make_brml(tmp_path, scans=3))


def test_not_a_zip_rejected(tmp_path: Path) -> None:
    p = tmp_path / "bad.brml"
    p.write_text("not a zip")
    assert not is_bruker_brml(p)
    with pytest.raises(ValueError, match="not a ZIP"):
        import_bruker_brml(p)


def test_sniffer_accepts_synthetic(tmp_path: Path) -> None:
    assert is_bruker_brml(_make_brml(tmp_path))


@pytest.mark.realdata
def test_fairmat_2thomega(corpus_dir: Path) -> None:
    path = corpus_dir / "bruker" / "xrd" / "FAIRmat_2thomega.brml"
    if not path.exists():
        pytest.skip("corpus file missing")
    ds = import_auto(str(path))
    assert len(ds.time) == 2001
    assert ds.time[0] == pytest.approx(44.0) and ds.time[-1] == pytest.approx(48.0)
    assert ds.metadata["x_column_name"] == "2Theta"
    assert np.all(np.diff(ds.time) > 0)  # monotonic 2theta
    assert np.all(ds.values[:, 0] >= 0)


@pytest.mark.realdata
def test_fairmat_rsm_rejected(corpus_dir: Path) -> None:
    path = corpus_dir / "bruker" / "xrd" / "FAIRmat_RSM.brml"
    if not path.exists():
        pytest.skip("corpus file missing")
    with pytest.raises(ValueError, match="multi-scan"):
        import_bruker_brml(str(path))
