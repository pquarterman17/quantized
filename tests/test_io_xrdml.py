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
