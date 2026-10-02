"""X-ray source metadata survives import and reaches the XRD CSV export
(plot-correctness audit 2026-10-02).

The XRDML and BRML parsers dropped the tube block (anode, kV, mA) and BRML
also dropped the wavelength, so the Williamson-Hall/Pawley wavelength pre-fill
(`lib/xrdWavelength.ts`: `wavelength_a`, `alpha1`, `alpha_average`) found
nothing for a Bruker line scan. The XRD CSV exporter read only `k_alpha1` /
`kAlpha1`, keys no parser writes, so its Wavelength line never appeared.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io import import_auto
from quantized.io.bruker_brml import import_bruker_brml
from quantized.io.xrd_csv import format_xrd_csv
from quantized.io.xrdml import import_xrdml

_XRDML = """<?xml version="1.0"?>
<xrdMeasurements xmlns="http://www.xrdml.com/XRDMeasurement/2.1" status="Completed">
 <xrdMeasurement measurementType="Scan" status="Completed">
  <usedWavelength intended="K-Alpha 1"><kAlpha1 unit="Angstrom">1.5405980</kAlpha1>
  </usedWavelength>
  <incidentBeamPath><xRayTube id="1" name="tube">
   <tension unit="kV">45.0</tension><current unit="mA">40.0</current>
   <anodeMaterial>Cu</anodeMaterial>
  </xRayTube></incidentBeamPath>
  <scan appendNumber="0" status="Completed" scanAxis="2Theta">
   <dataPoints>
    <positions axis="2Theta" unit="deg"><startPosition>40</startPosition>
    <endPosition>42</endPosition></positions>
    <commonCountingTime unit="seconds">1.0</commonCountingTime>
    <counts unit="counts">1 2 3</counts>
   </dataPoints>
  </scan>
 </xrdMeasurement>
</xrdMeasurements>"""

_TUBE = """<Tube LogicName="T" VisibleName="T">
  <WaveLengthAlpha1 Unit="Å" Value="1.5406" />
  <WaveLengthAlpha2 Unit="Å" Value="1.54439" />
  <WaveLengthAverage Unit="Å" Value="1.5418" />
  <TubeMaterial>Cu</TubeMaterial>
  <Generator LogicName="G" VisibleName="G">
    <Voltage Unit="kV" Value="40" /><Current Unit="mA" Value="40" />
  </Generator>
</Tube>"""


def _brml(tmp_path: Path, tube: str) -> Path:
    data = "\n".join(f"<Datum>1,1,{tt},{tt / 2},{c}</Datum>"
                     for tt, c in [(10.0, 5), (10.5, 9), (11.0, 4)])
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
<RawData>
  <FixedInformation><Instrument>{tube}</Instrument></FixedInformation>
  <DataRoutes><DataRoute RouteFlag="Measured">
    <ScanInformation><ScanAxes>
      <ScanAxisInfo AxisId="TwoTheta" VisibleName="2Theta" Unit="°">
        <Start>10</Start><Stop>11</Stop><Increment>0.5</Increment>
      </ScanAxisInfo>
    </ScanAxes></ScanInformation>
    {data}
  </DataRoute></DataRoutes>
</RawData>"""
    p = tmp_path / "s.brml"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("experimentCollection.xml", "<x/>")
        zf.writestr("Experiment0/RawData0.xml", xml.encode("utf-8"))
    return p


def test_xrdml_records_tube(tmp_path: Path) -> None:
    p = tmp_path / "t.xrdml"
    p.write_text(_XRDML)
    md = import_xrdml(p).metadata
    assert md["anode_material"] == "Cu"
    assert md["tension_kV"] == pytest.approx(45.0)
    assert md["current_mA"] == pytest.approx(40.0)


def test_brml_records_wavelength_and_tube(tmp_path: Path) -> None:
    md = import_bruker_brml(_brml(tmp_path, _TUBE)).metadata
    assert md["alpha1"] == pytest.approx(1.5406)
    assert md["alpha2"] == pytest.approx(1.54439)
    assert md["alpha_average"] == pytest.approx(1.5418)
    assert md["anode_material"] == "Cu"
    assert md["tension_kV"] == pytest.approx(40.0)
    assert md["current_mA"] == pytest.approx(40.0)


def test_brml_without_tube_block_still_imports(tmp_path: Path) -> None:
    md = import_bruker_brml(_brml(tmp_path, "")).metadata
    assert "alpha1" not in md
    assert "anode_material" not in md


@pytest.mark.parametrize("key", ["wavelength_a", "alpha1"])
def test_xrd_csv_writes_wavelength_from_parser_keys(key: str) -> None:
    ds = DataStruct.create(
        np.array([10.0, 11.0]), np.array([1.0, 2.0]), labels=["Intensity"], units=["counts"],
        metadata={"x_column_name": "2-Theta", "x_column_unit": "deg", key: 1.5406},
    )
    assert "# Wavelength: Ka1 = 1.5406 A" in format_xrd_csv(ds).splitlines()


@pytest.mark.realdata
def test_corpus_brml_wavelength(corpus_dir: Path) -> None:
    path = corpus_dir / "bruker" / "xrd" / "FAIRmat_2thomega.brml"
    if not path.exists():
        pytest.skip("BRML corpus file missing")
    md = import_auto(path).metadata
    assert md["alpha1"] == pytest.approx(1.5406)
    assert md["anode_material"] == "Cu"
