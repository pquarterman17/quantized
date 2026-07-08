"""PANalytical XRDML parser: golden parity vs MATLAB + behaviour."""

from __future__ import annotations

import warnings
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.qspace import compute_qspace
from quantized.io import import_auto
from quantized.io.xrdml import import_xrdml


def _two_scan_xrdml(ct1: float, ct2: float) -> str:
    """Minimal 1D two-range XRDML (no secondary axis → not RSM) with the given
    per-scan counting times."""
    ns = "http://www.xrdml.com/XRDMeasurement/2.1"

    def scan(append: int, tt0: int, tt1: int, ct: float, counts: str) -> str:
        return (
            f'<scan appendNumber="{append}" status="Completed"><dataPoints>'
            f'<positions axis="2Theta" unit="deg">'
            f"<startPosition>{tt0}</startPosition><endPosition>{tt1}</endPosition>"
            f"</positions>"
            f'<commonCountingTime unit="seconds">{ct}</commonCountingTime>'
            f'<counts unit="counts">{counts}</counts>'
            f"</dataPoints></scan>"
        )

    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<xrdMeasurements xmlns="{ns}" status="Completed">'
        '<xrdMeasurement measurementType="Scan">'
        '<usedWavelength intended="K-Alpha 1">'
        '<kAlpha1 unit="Angstrom">1.5405980</kAlpha1></usedWavelength>'
        + scan(0, 10, 20, ct1, "10 20 30 40 50")
        + scan(1, 20, 30, ct2, "60 70 80 90 100")
        + "</xrdMeasurement></xrdMeasurements>"
    )


@pytest.mark.golden
def test_xrdml_default_matches_matlab(
    fixtures_dir: Path,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    ref = load_golden("xrdml_la2nio4_default.json")
    ds = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml")  # default: cps
    assert list(ds.labels) == list(ref["labels"])
    assert list(ds.units) == list(ref["units"])
    assert_allclose(ds.time, np.asarray(ref["time"], dtype=float), rtol=1e-9, atol=1e-9)
    ref_values = np.asarray(ref["values"], dtype=float).reshape(ds.values.shape)
    assert_allclose(ds.values, ref_values, rtol=1e-9, atol=1e-9)


def test_xrdml_defaults_cps(fixtures_dir: Path) -> None:
    ds = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml")
    assert ds.labels == ("Intensity",)
    assert ds.units == ("cps",)
    assert ds.metadata["x_column_name"] == "2-Theta"
    assert ds.n_points > 0
    # 2theta is monotonic increasing across the scan
    assert ds.time[0] < ds.time[-1]


def test_xrdml_counts_option(fixtures_dir: Path) -> None:
    cps = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml", intensity="cps")
    counts = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml", intensity="counts")
    assert counts.units == ("counts",)
    ct = counts.metadata["counting_time"]
    # cps == counts / counting_time
    assert_allclose(cps.values, counts.values / ct, rtol=1e-12)


def test_registry_routes_xrdml(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "xrdml_la2nio4.xrdml")
    assert ds.metadata["parser_name"] == "import_xrdml"


def test_xrdml_1d_file_is_not_flagged_2d(fixtures_dir: Path) -> None:
    ds = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml")
    assert ds.metadata["is2D"] is False
    assert ds.labels == ("Intensity",)


# ── 2D area-detector (RSM) ────────────────────────────────────────────────
# synthetic_rsm.xrdml: 5 Omega frames (30.0..31.0) x 10 2theta pixels (60..62),
# a separable Gaussian blob peaking at Omega=30.5, 2theta=61. Cu K-alpha1.
_RSM = "xrdml_rsm_synthetic.xrdml"
_LAMBDA = 1.5405980
_CT = 0.5  # commonCountingTime (s) -> cps = counts / 0.5


def test_rsm_detected_as_2d(fixtures_dir: Path) -> None:
    ds = import_xrdml(fixtures_dir / _RSM)
    assert ds.metadata["is2D"] is True
    assert ds.metadata["map_shape"] == [5, 10]
    assert ds.metadata["axis1_name"] == "Omega"
    assert ds.labels == ("2Theta", "Omega", "Intensity", "Qx", "Qz")
    assert ds.units == ("deg", "deg", "cps", "Ang^-1", "Ang^-1")
    assert ds.n_points == 50  # 5 x 10 scattered points


def test_rsm_axes_span_the_mesh(fixtures_dir: Path) -> None:
    ds = import_xrdml(fixtures_dir / _RSM)
    two_theta = ds.column("2Theta")
    omega = ds.column("Omega")
    assert two_theta.min() == pytest.approx(60.0)
    assert two_theta.max() == pytest.approx(62.0)
    assert sorted(set(np.round(omega, 3))) == [30.0, 30.25, 30.5, 30.75, 31.0]


def test_rsm_intensity_peak_is_cps(fixtures_dir: Path) -> None:
    ds = import_xrdml(fixtures_dir / _RSM)
    n_frames, n_pix = ds.metadata["map_shape"]
    grid = ds.column("Intensity").reshape(n_frames, n_pix)
    # The blob peaks in the middle Omega frame (30.5) at the centre 2theta pixels.
    peak_frame = grid[2]  # Omega = 30.5 after sort
    assert peak_frame.max() == pytest.approx(1036.0 / _CT)  # 1036 counts -> 2072 cps


def test_rsm_qspace_matches_formula(fixtures_dir: Path) -> None:
    ds = import_xrdml(fixtures_dir / _RSM)
    qx_expected, qz_expected = compute_qspace(ds.column("2Theta"), ds.column("Omega"), _LAMBDA)
    assert_allclose(ds.column("Qx"), qx_expected, rtol=1e-12)
    assert_allclose(ds.column("Qz"), qz_expected, rtol=1e-12)


def test_rsm_counts_option_skips_cps(fixtures_dir: Path) -> None:
    ds = import_xrdml(fixtures_dir / _RSM, intensity="counts")
    assert ds.units[2] == "counts"
    grid = ds.column("Intensity").reshape(*ds.metadata["map_shape"])
    assert grid[2].max() == pytest.approx(1036.0)  # raw counts, no /CT


# ── mixed counting times (parity with parser:importXRDML:mixedCountingTimes) ──
def test_mixed_counting_times_warns_for_cps(tmp_path: Path) -> None:
    p = tmp_path / "mixed_ct.xrdml"
    p.write_text(_two_scan_xrdml(1.0, 2.0), encoding="utf-8")
    with pytest.warns(UserWarning, match="inconsistent counting times"):
        ds = import_xrdml(p, intensity="cps")
    # cps still normalises by the FIRST counting time (matches MATLAB)
    assert ds.metadata["counting_time"] == pytest.approx(1.0)


def test_mixed_counting_times_silent_for_counts(tmp_path: Path) -> None:
    p = tmp_path / "mixed_ct.xrdml"
    p.write_text(_two_scan_xrdml(1.0, 2.0), encoding="utf-8")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        import_xrdml(p, intensity="counts")  # no cps normalisation → no warning
    assert not any("counting times" in str(w.message) for w in caught)


def test_uniform_counting_times_do_not_warn(tmp_path: Path) -> None:
    p = tmp_path / "uniform_ct.xrdml"
    p.write_text(_two_scan_xrdml(1.0, 1.0), encoding="utf-8")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        import_xrdml(p, intensity="cps")
    assert not any("counting times" in str(w.message) for w in caught)


# ── beam-attenuation correction (per-pixel beamAttenuationFactors) ───────────


@pytest.mark.golden
def test_xrdml_beam_attenuation_matches_matlab(
    fixtures_dir: Path,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    ref = load_golden("xrdml_attenuation.json")
    ds = import_xrdml(fixtures_dir / "xrdml_attenuation.xrdml")  # default cps
    assert list(ds.labels) == list(ref["labels"])
    assert list(ds.units) == list(ref["units"])
    assert_allclose(ds.time, np.asarray(ref["time"], dtype=float), rtol=1e-9, atol=1e-9)
    ref_values = np.asarray(ref["values"], dtype=float).reshape(ds.values.shape)
    assert_allclose(ds.values, ref_values, rtol=1e-9, atol=1e-9)


def test_xrdml_attenuation_metadata_and_multiply(fixtures_dir: Path) -> None:
    ds = import_xrdml(fixtures_dir / "xrdml_attenuation.xrdml")
    assert ds.metadata["n_scans_att_corrected"] == 1
    assert ds.metadata["attenuator_factor"] == pytest.approx(100.0)
    assert ds.metadata["attenuator_material"] == "Cu"
    assert ds.metadata["attenuator_activate_level"] == pytest.approx(800000.0)
    # counts [100..1000], factors 6x1.0 then 4x100.0, /countingTime=10 → cps
    expected = np.array([10, 20, 30, 40, 50, 60, 7000, 8000, 9000, 10000], dtype=float)
    assert_allclose(ds.values[:, 0], expected, rtol=1e-12)


def test_xrdml_no_attenuator_metadata_is_empty(fixtures_dir: Path) -> None:
    ds = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml")  # no attenuator block
    assert ds.metadata["n_scans_att_corrected"] == 0
    assert ds.metadata["attenuator_factor"] is None
    assert ds.metadata["attenuator_material"] == ""


@pytest.mark.golden
def test_rsm_map_matrix_matches_matlab(
    fixtures_dir: Path,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """The Python scattered mesh, reshaped by map_shape, equals MATLAB's map2D."""
    ref = load_golden("xrdml_rsm_map.json")
    ds = import_xrdml(fixtures_dir / _RSM)
    n_frames, n_pix = ds.metadata["map_shape"]
    two_theta = ds.column("2Theta").reshape(n_frames, n_pix)
    omega = ds.column("Omega").reshape(n_frames, n_pix)
    intensity = ds.column("Intensity").reshape(n_frames, n_pix)
    assert ds.metadata["axis1_name"] == ref["axis1Name"]
    assert_allclose(omega[:, 0], np.asarray(ref["axis1"], dtype=float), rtol=1e-9, atol=1e-9)
    assert_allclose(two_theta[0, :], np.asarray(ref["axis2"], dtype=float), rtol=1e-9, atol=1e-9)
    assert_allclose(intensity, np.asarray(ref["intensity"], dtype=float), rtol=1e-9, atol=1e-9)


def test_xrdml_float_append_number(tmp_path: Path) -> None:
    """Some exporters write appendNumber="1.0"; int() raised, float() must not."""
    xml = _two_scan_xrdml(1.0, 1.0).replace('appendNumber="0"', 'appendNumber="0.0"').replace(
        'appendNumber="1"', 'appendNumber="1.0"'
    )
    p = tmp_path / "float_append.xrdml"
    p.write_text(xml, encoding="utf-8")
    ds = import_xrdml(p)  # must not raise ValueError: invalid literal for int()
    assert ds.n_points == 10  # both scans (5 + 5 points) parsed and ordered


def test_bom_prefixed_file_parses(tmp_path: Path, fixtures_dir: Path) -> None:
    """A UTF-8 BOM (Windows instrument exporters emit one) must not break the
    parser — found by the corpus audit (ORIGIN_GAP_PLAN #46): 2 of 13 public
    samples carried a BOM and failed with 'not well-formed' before the fix."""
    src = fixtures_dir / "xrdml_la2nio4.xrdml"
    bom = tmp_path / "bom.xrdml"
    bom.write_bytes(b"\xef\xbb\xbf" + src.read_bytes())
    ref = import_xrdml(src)
    out = import_xrdml(bom)
    assert_allclose(out.values, ref.values)
    assert list(out.labels) == list(ref.labels)


def _cloud_xrdml(scans: list[str]) -> str:
    body = "\n".join(scans)
    return f"""<?xml version="1.0"?>
<xrdMeasurements xmlns="http://www.xrdml.com/XRDMeasurement/2.0" status="Completed">
 <xrdMeasurement measurementType="Area measurement" status="Completed">
  <usedWavelength intended="K-Alpha 1"><kAlpha1 unit="Angstrom">1.5406</kAlpha1></usedWavelength>
  {body}
 </xrdMeasurement>
</xrdMeasurements>"""


def _snapshot_scan(append: int, tt0: float, tt1: float, omega: float, counts: str) -> str:
    return f"""<scan appendNumber="{append}" status="Completed" scanAxis="2Theta">
   <dataPoints>
    <positions axis="2Theta" unit="deg"><startPosition>{tt0}</startPosition>
    <endPosition>{tt1}</endPosition></positions>
    <positions axis="Omega" unit="deg"><commonPosition>{omega}</commonPosition></positions>
    <commonCountingTime unit="seconds">1.0</commonCountingTime>
    <counts unit="counts">{counts}</counts>
   </dataPoints>
  </scan>"""


def _coupled_scan(append: int, om0: float, om1: float, counts: str) -> str:
    return f"""<scan appendNumber="{append}" status="Completed" scanAxis="Omega-2Theta">
   <dataPoints>
    <positions axis="2Theta" unit="deg"><startPosition>40.0</startPosition>
    <endPosition>42.0</endPosition></positions>
    <positions axis="Omega" unit="deg"><startPosition>{om0}</startPosition>
    <endPosition>{om1}</endPosition></positions>
    <commonCountingTime unit="seconds">1.0</commonCountingTime>
    <intensities unit="counts">{counts}</intensities>
   </dataPoints>
  </scan>"""


def test_snapshot_cloud_detection(tmp_path: Path) -> None:
    """PIXcel3D 'Scanning snapshot': omega fixed per frame, 2theta window ALSO
    steps per frame (no shared 2theta range) -> mesh_kind='snapshot'. The
    MATLAB reference does NOT detect this layout (its ttSame check fails)."""
    scans = [
        _snapshot_scan(i + 1, 40.0 + 0.1 * i, 41.0 + 0.1 * i, 20.0 + 0.05 * i, "1 2 3 4")
        for i in range(4)
    ]
    p = tmp_path / "snapshot.xrdml"
    p.write_text(_cloud_xrdml(scans))
    ds = import_xrdml(p)
    assert ds.metadata["is2D"] is True
    assert ds.metadata["mesh_kind"] == "snapshot"
    assert ds.metadata["map_shape"] == [4, 4]
    assert list(ds.labels) == ["2Theta", "Omega", "Intensity", "Qx", "Qz"]
    # each frame keeps its OWN 2theta window
    tt = ds.column("2Theta").reshape(4, 4)
    assert_allclose(tt[0], np.linspace(40.0, 41.0, 4))
    assert_allclose(tt[3], np.linspace(40.3, 41.3, 4))
    om = ds.column("Omega").reshape(4, 4)
    assert_allclose(om[:, 0], [20.0, 20.05, 20.1, 20.15])


def test_coupled_scan_detection(tmp_path: Path) -> None:
    """Schema-1.0-style RSM: omega sweeps WITHIN each scan (coupled Omega-2Theta)
    at a stepped offset -> mesh_kind='coupled', per-pixel omega ramps."""
    scans = [_coupled_scan(i + 1, 19.0 + 0.1 * i, 21.0 + 0.1 * i, "5 6 7 8 9") for i in range(3)]
    p = tmp_path / "coupled.xrdml"
    p.write_text(_cloud_xrdml(scans))
    ds = import_xrdml(p)
    assert ds.metadata["is2D"] is True
    assert ds.metadata["mesh_kind"] == "coupled"
    assert ds.metadata["map_shape"] == [3, 5]
    om = ds.column("Omega").reshape(3, 5)
    assert_allclose(om[0], np.linspace(19.0, 21.0, 5))  # sweeps within the scan
    assert_allclose(om[:, 0], [19.0, 19.1, 19.2])  # steps between scans


def _pole_scan(
    append: int, tt: float, phi0: float, phi1: float, tilt_axis: str, tilt: float, counts: str
) -> str:
    return f"""<scan appendNumber="{append}" status="Completed" scanAxis="Phi">
   <dataPoints>
    <positions axis="2Theta" unit="deg"><commonPosition>{tt}</commonPosition></positions>
    <positions axis="Phi" unit="deg"><startPosition>{phi0}</startPosition>
    <endPosition>{phi1}</endPosition></positions>
    <positions axis="{tilt_axis}" unit="deg"><commonPosition>{tilt}</commonPosition></positions>
    <commonCountingTime unit="seconds">1.0</commonCountingTime>
    <counts unit="counts">{counts}</counts>
   </dataPoints>
  </scan>"""


def test_pole_figure_psi_naming_detected(tmp_path: Path) -> None:
    """Texture-cradle pole figure: fixed 2Theta, Phi sweeps 0-360 WITHIN each
    scan, Psi steps ACROSS scans -> mesh_kind='pole'. Naming matches the real
    xrayutilities_polefig_point.xrdml corpus anchor (see below)."""
    scans = [_pole_scan(i + 1, 53.686, 0.0, 360.0, "Psi", 15.0 * i, "1 2 3 4 5") for i in range(4)]
    p = tmp_path / "pole_psi.xrdml"
    p.write_text(_cloud_xrdml(scans))
    ds = import_xrdml(p)
    assert ds.metadata["is2D"] is True
    assert ds.metadata["mesh_kind"] == "pole"
    assert ds.metadata["map_shape"] == [4, 5]
    assert ds.metadata["axis1_name"] == "Psi"
    assert ds.metadata["axis2_name"] == "Phi"
    assert ds.metadata["tilt_axis_source"] == "Psi"
    assert ds.metadata["two_theta_deg"] == pytest.approx(53.686)
    assert list(ds.labels) == ["Phi", "Psi", "Intensity"]
    assert list(ds.units) == ["deg", "deg", "cps"]
    phi = ds.column("Phi").reshape(4, 5)
    psi = ds.column("Psi").reshape(4, 5)
    assert_allclose(phi[0], np.linspace(0.0, 360.0, 5))
    assert_allclose(psi[:, 0], [0.0, 15.0, 30.0, 45.0])


def test_pole_figure_chi_naming_detected(tmp_path: Path) -> None:
    """Older Eulerian-cradle pole figures name the tilt axis 'Chi' instead of
    'Psi'; must still classify as a pole figure, not a Chi-axis 'snapshot'
    RSM (Chi alone -- fixed per scan, varying across scans -- would
    otherwise satisfy _classify_cloud's snapshot pattern and silently drop
    the Phi sweep). Output normalizes the label to 'Psi' either way."""
    scans = [_pole_scan(i + 1, 60.0, -180.0, 180.0, "Chi", 10.0 * i, "1 2 3") for i in range(3)]
    p = tmp_path / "pole_chi.xrdml"
    p.write_text(_cloud_xrdml(scans))
    ds = import_xrdml(p)
    assert ds.metadata["mesh_kind"] == "pole"
    assert ds.metadata["tilt_axis_source"] == "Chi"
    assert ds.metadata["axis1_name"] == "Psi"  # normalized regardless of source name
    assert list(ds.labels) == ["Phi", "Psi", "Intensity"]
    psi = ds.column("Psi").reshape(3, 3)
    assert_allclose(psi[:, 0], [0.0, 10.0, 20.0])


def test_pole_figure_needs_phi_sweep_within_every_scan(tmp_path: Path) -> None:
    """A Psi-stepped file where Phi is fixed per scan (not swept) is not a
    pole figure -- ambiguous layouts must never misclassify; this one falls
    through to the flat 1-D path, same as an unrecognized secondary axis."""
    scans = [
        _pole_scan(i + 1, 53.686, 45.0, 45.0, "Psi", 15.0 * i, "1 2 3 4 5") for i in range(4)
    ]
    p = tmp_path / "not_pole.xrdml"
    p.write_text(_cloud_xrdml(scans))
    ds = import_xrdml(p)
    assert ds.metadata.get("mesh_kind") != "pole"
    assert ds.metadata["is2D"] is False


def test_pole_figure_needs_at_least_two_scans(tmp_path: Path) -> None:
    """A single Phi sweep at one Psi is just a normal 1-D azimuthal scan."""
    p = tmp_path / "single_pole_scan.xrdml"
    p.write_text(_cloud_xrdml([_pole_scan(1, 53.686, 0.0, 360.0, "Psi", 0.0, "1 2 3 4 5")]))
    ds = import_xrdml(p)
    assert ds.metadata["is2D"] is False


def test_existing_mesh_kinds_unaffected_by_pole_detection(
    fixtures_dir: Path, tmp_path: Path
) -> None:
    """Regression guard (gap #46): the pole-figure classifier runs BEFORE
    _is_2d/_classify_cloud and adds 'Psi' to the axes captured per scan --
    neither change may alter classification of the three pre-existing mesh
    kinds (none of their fixtures use Phi or Psi)."""
    mesh = import_xrdml(fixtures_dir / _RSM)
    assert mesh.metadata["mesh_kind"] == "mesh"

    snap_scans = [
        _snapshot_scan(i + 1, 40.0 + 0.1 * i, 41.0 + 0.1 * i, 20.0 + 0.05 * i, "1 2 3 4")
        for i in range(4)
    ]
    p1 = tmp_path / "snap_regress.xrdml"
    p1.write_text(_cloud_xrdml(snap_scans))
    assert import_xrdml(p1).metadata["mesh_kind"] == "snapshot"

    coup_scans = [
        _coupled_scan(i + 1, 19.0 + 0.1 * i, 21.0 + 0.1 * i, "5 6 7 8 9") for i in range(3)
    ]
    p2 = tmp_path / "coup_regress.xrdml"
    p2.write_text(_cloud_xrdml(coup_scans))
    assert import_xrdml(p2).metadata["mesh_kind"] == "coupled"


@pytest.mark.realdata
def test_pole_figure_corpus_anchor(corpus_dir: Path) -> None:
    """Real PANalytical pole-figure file (xrayutilities corpus; GPL-2.0,
    flagged copyleft in ../test-data/panalytical/xrd/MANIFEST.md -- kept
    local-only, never redistributed, used purely as a private parsing
    oracle): 91 Psi steps (0-90 deg) x 1199 Phi points (~-179.7..179.7 deg)
    at a fixed 2Theta=53.686 deg reflection -> mesh_kind='pole', flipping
    the known-limitation note in test_realdata_corpus.py to a positive
    assertion."""
    path = corpus_dir / "panalytical" / "xrd" / "xrayutilities_polefig_point.xrdml"
    if not path.exists():
        pytest.skip("pole-figure corpus file missing")
    ds = import_xrdml(path)
    assert ds.metadata["is2D"] is True
    assert ds.metadata["mesh_kind"] == "pole"
    assert ds.metadata["tilt_axis_source"] == "Psi"
    assert ds.metadata["map_shape"] == [91, 1199]
    assert ds.metadata["two_theta_deg"] == pytest.approx(53.686, abs=1e-3)
    assert list(ds.labels) == ["Phi", "Psi", "Intensity"]
    phi = ds.column("Phi")
    psi = ds.column("Psi")
    assert phi.min() == pytest.approx(-179.70, abs=1e-2)
    assert phi.max() == pytest.approx(179.70, abs=1e-2)
    assert psi.min() == pytest.approx(0.0, abs=1e-6)
    assert psi.max() == pytest.approx(90.0, abs=1e-6)


def test_two_range_1d_file_is_not_a_cloud(tmp_path: Path) -> None:
    """A 2-range 1-D file with distinct fixed omegas must stay 1-D (the cloud
    classifier requires >= 3 scans)."""
    scans = [
        _snapshot_scan(1, 40.0, 41.0, 20.0, "1 2 3"),
        _snapshot_scan(2, 41.0, 42.0, 20.5, "4 5 6"),
    ]
    p = tmp_path / "two_range.xrdml"
    p.write_text(_cloud_xrdml(scans))
    ds = import_xrdml(p)
    assert ds.metadata["is2D"] is False


@pytest.mark.golden
@pytest.mark.parametrize("kind,fixture", [
    ("mesh", "xrdml_rsm_synthetic.xrdml"),
    ("snapshot", "xrdml_snapshot_synthetic.xrdml"),
    ("coupled", "xrdml_coupled_synthetic.xrdml"),
])
def test_map2d_golden_vs_matlab(
    kind: str,
    fixture: str,
    fixtures_dir: Path,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """2-D map golden parity vs MATLAB importXRDML+computeQSpace (all three
    mesh kinds; frozen @ quantized_matlab aee70d1 via freeze_xrdml_map2d.m).

    The Python parser emits a scattered cloud; MATLAB emits the map2D grid —
    reshaping the cloud by map_shape must reproduce MATLAB's matrices exactly
    (same assembly math + same cps normalisation on both sides)."""
    ref = load_golden("xrdml_map2d.json")[kind]
    ds = import_xrdml(fixtures_dir / fixture)
    assert ds.metadata["mesh_kind"] == ref["meshKind"] == kind
    n, m = ds.metadata["map_shape"]

    tt = ds.column("2Theta").reshape(n, m)
    om = ds.column(str(ds.metadata["axis1_name"])).reshape(n, m)
    iv = ds.column("Intensity").reshape(n, m)

    assert_allclose(iv, np.asarray(ref["intensity"], dtype=float), rtol=1e-9, atol=1e-12)
    # MATLAB's axis vectors are the per-row secondary value (fixed value or
    # coupled-sweep midpoint) and the representative 2theta axis — both equal
    # the corresponding means of the Python per-point grids for every kind.
    assert_allclose(om.mean(axis=1), np.asarray(ref["axis1"], dtype=float).ravel(), rtol=1e-9)
    assert_allclose(tt.mean(axis=0), np.asarray(ref["axis2"], dtype=float).ravel(), rtol=1e-9)
    # Exact per-point grids for the non-rectilinear kinds.
    if kind == "snapshot":
        assert_allclose(tt, np.asarray(ref["axis2Grid"], dtype=float), rtol=1e-12)
    if kind == "coupled":
        assert_allclose(om, np.asarray(ref["axis1Grid"], dtype=float), rtol=1e-12)
    # Reciprocal space must match bit-for-bit-ish (same closed form both sides).
    assert_allclose(
        ds.column("Qx").reshape(n, m), np.asarray(ref["Qx"], dtype=float), rtol=1e-9, atol=1e-12
    )
    assert_allclose(
        ds.column("Qz").reshape(n, m), np.asarray(ref["Qz"], dtype=float), rtol=1e-9, atol=1e-12
    )
    assert ds.units[list(ds.labels).index("Intensity")] == ref["intensityUnit"]
