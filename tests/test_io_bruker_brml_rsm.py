"""Bruker multi-scan ``.brml`` reciprocal-space maps (io/bruker_brml_map.py).

Synthetic archives (CI) mirror the two DIFFRAC layouts: "PSD fixed" frames,
one RawData document per omega step whose single Datum carries a 1-D detector
(Mythen-style) counter, and coupled 2theta-omega point scans at stepped omega
offsets. A realdata test checks the FAIRmat RSM against an independent read
of its raw XML (regex, not the parser) -- no corpus values are committed.
"""

from __future__ import annotations

import re
import zipfile
from pathlib import Path

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.qspace import compute_qspace
from quantized.io import bruker_brml
from quantized.io.bruker_brml import import_bruker_brml
from quantized.io.registry import import_auto

REF, INC, NPIX = 20.0, 0.1, 5  # detector: 2theta = REF + i*INC
WAVELENGTH = 1.5406
ALIGN_OFFSET = 2.5  # VirtualPosition - Position: must never leak into omega


def _psd_frame(omega: float, counts: list[float], *, absorption: float = 1.0) -> str:
    """One "PSD fixed" RawData document (structure of a DIFFRAC.MEASUREMENT RSM)."""
    n = len(counts)
    # Datum: MeasuredTime, AbsorptionFactor, 2theta (aligned/virtual), RecSpX/Y/Z, counter
    datum = ",".join(
        ["9", f"{absorption}", f"{REF + 5.0}", "-0.2", "0", "4.4"] + [f"{c:g}" for c in counts]
    )
    return f"""<?xml version="1.0"?>
<RawData xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <DataRoutes><DataRoute RouteFlag="Measured">
    <ScanInformation ScanName="PsdFixed">
      <MeasurementPoints>1</MeasurementPoints>
      <ScanMode>StillScan</ScanMode>
      <ScanAxes>
        <ScanAxisInfo AxisId="TwoTheta" AxisName="TwoTheta" VisibleName="2Theta" Unit="°">
          <Reference>{REF}</Reference><Start>-0</Start>
          <Stop>{n * INC}</Stop><Increment>{INC}</Increment>
        </ScanAxisInfo>
      </ScanAxes>
    </ScanInformation>
    <Datum>{datum}</Datum>
    <DataViews>
      <RawDataView xsi:type="FixedRawDataView" Start="0" Length="1" LogicName="MeasuredTime" />
      <RawDataView xsi:type="FixedRawDataView" Start="1" Length="1" LogicName="AbsorptionFactor" />
      <RawDataView xsi:type="RecordedRawDataView" Start="6" Length="{n}" MeasuredDataIndex="0">
        <Recording LogicName="Counter1D"><Size><X>{n}</X><Y>1</Y></Size></Recording>
      </RawDataView>
    </DataViews>
  </DataRoute></DataRoutes>
  <FixedInformation>
    <Drives>
      <InfoData LogicName="Theta" VisibleName="Omega" AxisId="Theta">
        <Position Unit="°" Value="{omega}" />
        <VirtualPosition Unit="°" Value="{omega + ALIGN_OFFSET}" />
      </InfoData>
    </Drives>
    <Instrument><Tube><WaveLengthAlpha1 Unit="Å" Value="{WAVELENGTH}" /></Tube></Instrument>
  </FixedInformation>
</RawData>"""


def _coupled_frame(offset: float, two_theta: list[float], counts: list[float]) -> str:
    """One coupled 2theta-omega point scan at omega = 2theta/2 + offset."""
    om = [t / 2 + offset for t in two_theta]
    rows = "\n".join(
        f"<Datum>1,1,{t},{o},{c}</Datum>" for t, o, c in zip(two_theta, om, counts, strict=True)
    )
    inc = two_theta[1] - two_theta[0]
    return f"""<?xml version="1.0"?>
<RawData>
  <DataRoutes><DataRoute RouteFlag="Measured">
    <ScanInformation>
      <MeasurementPoints>{len(two_theta)}</MeasurementPoints>
      <ScanAxes>
        <ScanAxisInfo AxisId="TwoTheta" VisibleName="2Theta" Unit="°">
          <Reference>0</Reference><Start>{two_theta[0]}</Start>
          <Stop>{two_theta[-1]}</Stop><Increment>{inc}</Increment>
        </ScanAxisInfo>
        <ScanAxisInfo AxisId="Theta" VisibleName="Omega" Unit="°">
          <Reference>0</Reference><Start>{om[0]}</Start>
          <Stop>{om[-1]}</Stop><Increment>{inc / 2}</Increment>
        </ScanAxisInfo>
      </ScanAxes>
    </ScanInformation>
    {rows}
  </DataRoute></DataRoutes>
  <FixedInformation><Instrument><Tube>
    <WaveLengthAlpha1 Unit="Å" Value="{WAVELENGTH}" />
  </Tube></Instrument></FixedInformation>
</RawData>"""


def _write(tmp_path: Path, docs: list[str], name: str = "rsm.brml") -> Path:
    p = tmp_path / name
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("experimentCollection.xml", "<x/>")
        for j, doc in enumerate(docs):
            zf.writestr(f"Experiment0/RawData{j}.xml", doc)
    return p


# Frames written OUT of omega order: the map must come back sorted by omega.
OMEGAS = [10.2, 10.0, 10.3, 10.1]


def _frame_counts(omega: float) -> list[float]:
    base = round(omega * 10) - 99  # 10.0 -> 1, 10.1 -> 2, ...
    return [float(base * 100 + i) for i in range(NPIX)]


def _psd_map(tmp_path: Path) -> Path:
    return _write(tmp_path, [_psd_frame(om, _frame_counts(om)) for om in OMEGAS])


def test_psd_frames_become_an_omega_by_2theta_mesh(tmp_path: Path) -> None:
    ds = import_bruker_brml(_psd_map(tmp_path))
    assert ds.labels == ("2Theta", "Omega", "Intensity", "Qx", "Qz")
    assert ds.units == ("deg", "deg", "counts", "Ang^-1", "Ang^-1")
    md = ds.metadata
    assert md["is2D"] is True and md["mesh_kind"] == "mesh"
    assert md["map_shape"] == [4, NPIX]
    assert md["axis1_name"] == "Omega" and md["axis2_name"] == "2Theta"
    assert md["wavelength_a"] == pytest.approx(WAVELENGTH)

    grid = ds.values.reshape(4, NPIX, 5)  # (frame, pixel, channel), row-major
    omegas = sorted(OMEGAS)
    # 2theta = Reference + Start + i*Increment (motor frame), never the Datum's
    # aligned 2theta; omega = the drive Position, never VirtualPosition.
    for row, om in enumerate(omegas):
        assert_allclose(grid[row, :, 0], REF + INC * np.arange(NPIX))
        assert_allclose(grid[row, :, 1], om)
        assert_allclose(grid[row, :, 2], _frame_counts(om))
    qx, qz = compute_qspace(grid[:, :, 0], grid[:, :, 1], WAVELENGTH)
    assert_allclose(grid[:, :, 3], qx)
    assert_allclose(grid[:, :, 4], qz)
    # The default plot x is the 2theta its title names, never the row index
    # (tests/test_io_map_plot_axis.py has the XRDML side of this contract).
    assert md["x_column_name"] == "2-Theta"
    assert_allclose(ds.time, grid[:, :, 0].ravel())
    assert md["default_value_channels"] == [2] and md["default_trace"] == "Scatter"


def test_psd_map_is_tagged_as_an_rsm(tmp_path: Path) -> None:
    ds = import_auto(_psd_map(tmp_path))
    assert ds.metadata["technique"] == "xrd.rsm"
    assert ds.metadata["parser_name"] == "import_bruker_brml"


def test_absorption_factor_restores_attenuated_counts(tmp_path: Path) -> None:
    docs = [_psd_frame(10.0, [1.0] * NPIX), _psd_frame(10.1, [2.0] * NPIX, absorption=50.0)]
    ds = import_bruker_brml(_write(tmp_path, docs))
    grid = ds.values.reshape(2, NPIX, 5)
    assert_allclose(grid[0, :, 2], 1.0)
    assert_allclose(grid[1, :, 2], 100.0)
    assert ds.metadata["n_scans_att_corrected"] == 1


def test_coupled_point_scans_become_a_sheared_map(tmp_path: Path) -> None:
    tt = [60.0, 60.5, 61.0, 61.5]
    docs = [_coupled_frame(off, tt, [off * 10 + k for k in range(4)]) for off in (0.2, -0.2, 0.0)]
    ds = import_bruker_brml(_write(tmp_path, docs))
    md = ds.metadata
    assert md["is2D"] is True and md["mesh_kind"] == "coupled"
    assert md["map_shape"] == [3, 4]
    grid = ds.values.reshape(3, 4, 5)
    for row, off in enumerate((-0.2, 0.0, 0.2)):
        assert_allclose(grid[row, :, 0], tt)
        assert_allclose(grid[row, :, 1], np.asarray(tt) / 2 + off)
        assert_allclose(grid[row, :, 2], [off * 10 + k for k in range(4)])
    assert_allclose(ds.time, grid[:, :, 0].ravel())


def test_point_scans_without_an_omega_step_are_refused(tmp_path: Path) -> None:
    """Repeated (or multi-range) line scans are not a map: refused as before."""
    tt = [60.0, 60.5, 61.0, 61.5]
    docs = [_coupled_frame(0.0, tt, [1.0, 2.0, 3.0, 4.0]) for _ in range(3)]
    with pytest.raises(ValueError, match="multi-scan"):
        import_bruker_brml(_write(tmp_path, docs))


def test_psd_frames_with_different_detector_windows_are_refused(tmp_path: Path) -> None:
    docs = [_psd_frame(10.0, [1.0] * NPIX), _psd_frame(10.1, [1.0] * (NPIX + 1))]
    with pytest.raises(ValueError, match="detector"):
        import_bruker_brml(_write(tmp_path, docs))


def test_total_uncompressed_size_is_bounded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every member is small, but together they exceed the archive budget."""
    path = _psd_map(tmp_path)
    member = len(_psd_frame(10.0, _frame_counts(10.0)).encode())
    monkeypatch.setattr(bruker_brml, "MAX_XML_BYTES", 2 * member)
    with pytest.raises(ValueError, match="uncompressed"):
        import_bruker_brml(path)


# ── realdata: FAIRmat RSM vs an independent regex read of its raw XML ─────────

_NUM = r"(-?[0-9.Ee+-]+)"


def _independent_read(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(omega per frame, 2theta per pixel, counts[frame, pixel]) via regex."""
    omegas, frames = [], []
    two_theta: np.ndarray | None = None
    with zipfile.ZipFile(path) as zf:
        for name in zf.namelist():
            if not re.search(r"RawData\d+\.xml$", name):
                continue
            text = zf.read(name).decode()
            drive = re.search(
                r'LogicName="Theta"[^>]*>\s*<Position Unit="[^"]*" Value="' + _NUM, text
            )
            assert drive is not None
            omegas.append(float(drive.group(1)))
            fields = re.search(r"<Datum>(.*?)</Datum>", text).group(1).split(",")  # type: ignore[union-attr]
            rec = re.search(r'RecordedRawDataView" Start="(\d+)" Length="(\d+)"', text)
            assert rec is not None
            start, length = int(rec.group(1)), int(rec.group(2))
            frames.append([float(v) * float(fields[1]) for v in fields[start : start + length]])
            if two_theta is None:
                axis = re.search(
                    r"<Reference>" + _NUM + r"</Reference>\s*<Start>" + _NUM
                    + r"</Start>.*?<Increment>" + _NUM + "</Increment>",
                    text, re.S,
                )
                assert axis is not None
                ref, st, inc = (float(g) for g in axis.groups())
                two_theta = ref + st + inc * np.arange(length)
    order = np.argsort(omegas, kind="stable")
    assert two_theta is not None
    return np.asarray(omegas)[order], two_theta, np.asarray(frames)[order]


@pytest.mark.realdata
def test_fairmat_rsm_matches_an_independent_read(corpus_dir: Path) -> None:
    path = corpus_dir / "bruker" / "xrd" / "FAIRmat_RSM.brml"
    if not path.exists():
        pytest.skip("corpus file missing")
    omegas, two_theta, counts = _independent_read(path)
    ds = import_auto(path)
    md = ds.metadata
    assert md["technique"] == "xrd.rsm" and md["mesh_kind"] == "mesh"
    n_frames, n_pix = counts.shape
    assert md["map_shape"] == [n_frames, n_pix]
    grid = ds.values.reshape(n_frames, n_pix, 5)
    # Extents and pixel alignment: every row shares the detector's 2theta
    # vector, every column the frame's omega, and pixel (i, j) is the raw count.
    assert_allclose(grid[:, :, 0], np.broadcast_to(two_theta, (n_frames, n_pix)))
    assert_allclose(grid[:, :, 1], np.broadcast_to(omegas[:, None], (n_frames, n_pix)))
    assert_allclose(grid[:, :, 2], counts)
    # Geometry sanity, derived from the file at test time: the brightest pixel
    # is the substrate reflection, so it must sit on the specular rod (Qx ~ 0)
    # at the Bragg |Q| of the method's substrate lattice and reflection.
    text = zipfile.ZipFile(path).read("Experiment0/RawData0.xml").decode()
    lattice = re.search(r'<Lattice [^>]*\bC="' + _NUM + r'"[^>]*Unit="nm"', text)
    refl = re.search(r'<Reflection H="(\d+)" K="(\d+)" L="(\d+)"', text)
    assert lattice is not None and refl is not None
    c_ang = float(lattice.group(1)) * 10.0
    q_bragg = 2 * np.pi * int(refl.group(3)) / c_ang
    i, j = np.unravel_index(int(np.argmax(counts)), counts.shape)
    assert abs(grid[i, j, 3]) < 0.01 * q_bragg
    assert grid[i, j, 4] == pytest.approx(q_bragg, rel=2e-3)
