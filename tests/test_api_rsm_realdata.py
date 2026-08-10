"""Realdata end-to-end smoke test for /api/rsm (RSM_CUTS_PLAN item 10).

Drives the real HTTP layer (TestClient, the ``tests/test_api_rsm.py``
pattern) against two real corpus files instead of the small synthetic
fixture that file uses:

- ``panalytical/xrd/epytaxy_rsm.xrdml`` -- a full Qx/Qz-bearing RSM (the
  substrate/film pair ``docs/theory/xrd.md`` and
  ``docs/tutorials/rsm-analysis-workflow.md`` both work through).
- ``panalytical/xrd/xrayutilities_polefig_point.xrdml`` -- a pole figure
  (Phi/Psi axes, no Qx/Qz at all), exercising the native-polar branch (ii)
  of the RSM_CUTS_PLAN polar-space rule and the branch-(iii)-style rejection
  when a true-polar op (``/sector``) is asked of it.

This is the sweep that was run by hand against the real HTTP layer before
committing it; the point of committing it is that a silent regression --
wrong axis routing, a cut quietly reverting to the pre-item-2 whole-row
selection, a dropped provenance field -- now fails a test instead of
waiting to be re-discovered by hand again. Assertions check *meaning*
(peak position, provenance metadata, band honesty), not just status codes;
expected numeric values are derived from the corpus file itself at test
time (raw brightest-pixel |Q|/azimuth, the map's own Q range/grid spacing)
rather than transcribed, so a corpus update cannot silently desync the
assertions from the data.

Skips cleanly (like every other realdata test) when ../test-data is absent
-- see ``tests/conftest.py``'s ``corpus_dir`` fixture.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.datastruct import DataStruct
from quantized.io.registry import import_auto
from quantized.routes._payload import datastruct_payload

pytestmark = pytest.mark.realdata

client = TestClient(app)

RSM_RELPATH = "panalytical/xrd/epytaxy_rsm.xrdml"
POLEFIG_RELPATH = "panalytical/xrd/xrayutilities_polefig_point.xrdml"


def _load(corpus_dir: Path, relpath: str) -> DataStruct:
    path = corpus_dir / relpath
    if not path.exists():
        pytest.skip(f"{relpath} not present in corpus")
    return import_auto(str(path))


@pytest.fixture
def rsm_ds(corpus_dir: Path) -> DataStruct:
    return _load(corpus_dir, RSM_RELPATH)


@pytest.fixture
def rsm_payload(rsm_ds: DataStruct) -> dict[str, Any]:
    return datastruct_payload(rsm_ds)


@pytest.fixture
def polefig_ds(corpus_dir: Path) -> DataStruct:
    return _load(corpus_dir, POLEFIG_RELPATH)


@pytest.fixture
def polefig_payload(polefig_ds: DataStruct) -> dict[str, Any]:
    return datastruct_payload(polefig_ds)


def _raw_peak_q(ds: DataStruct) -> tuple[float, float, float, float]:
    """``(qrad, phi_deg, qx, qz)`` of the single brightest raw pixel.

    The anchor ``docs/theory/xrd.md``'s worked examples use (|Q|=4.827
    Ang^-1, phi=90.0 deg for this same file) -- computed fresh here from
    whatever corpus file is actually on disk rather than transcribed.
    """
    qx = ds.column("Qx")
    qz = ds.column("Qz")
    intensity = ds.column("Intensity")
    idx = int(np.argmax(intensity))
    qrad = float(np.hypot(qx[idx], qz[idx]))
    phi = float(np.degrees(np.arctan2(qz[idx], qx[idx])))
    return qrad, phi, float(qx[idx]), float(qz[idx])


def _q_range(ds: DataStruct) -> tuple[float, float]:
    qrad = np.hypot(ds.column("Qx"), ds.column("Qz"))
    return float(qrad.min()), float(qrad.max())


def _assert_has_provenance(metadata: dict[str, Any], *extra_keys: str) -> None:
    """Every cut must carry a human-readable label plus enough structured
    provenance to re-apply the same ROI/sector later (RSM_CUTS_PLAN item
    10's "deliverable, not mechanism" acceptance: a caption-able number is
    useless without knowing what selection produced it)."""
    assert metadata.get("cut_label")
    for key in extra_keys:
        assert key in metadata, f"missing provenance key: {key}"


# ── /api/rsm/sector ─────────────────────────────────────────────────────────


def test_sector_full_annulus_peak_matches_raw_brightest_pixel(
    rsm_ds: DataStruct, rsm_payload: dict[str, Any]
) -> None:
    q_min, q_max = _q_range(rsm_ds)
    # A hair outside the exact min/max so the extreme points survive the
    # `>=`/`<=` mask even after a JSON float round-trip.
    q_min, q_max = q_min - 1e-6, q_max + 1e-6
    resp = client.post(
        "/api/rsm/sector",
        json={"dataset": rsm_payload, "q_min": q_min, "q_max": q_max, "n_bins": 60},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["labels"] == ["Intensity", "N points"]
    assert len(out["time"]) == 60
    _assert_has_provenance(out["metadata"], "cut_kind", "q_range", "sector", "mode")
    assert out["metadata"]["cut_kind"] == "sector"

    raw_qrad, _raw_phi, _raw_qx, _raw_qz = _raw_peak_q(rsm_ds)
    intensities = np.asarray(out["values"], dtype=float)[:, 0]
    q_bin_centres = np.asarray(out["time"], dtype=float)
    peak_q = float(q_bin_centres[np.argmax(intensities)])
    bin_width = (q_max - q_min) / 60
    # docs/theory/xrd.md's worked example: the binned peak lands within one
    # bin (~0.003 Ang^-1) of the raw brightest pixel's own |Q|=4.827
    # Ang^-1; two bin widths of slack absorbs the coarser 60-bin binning
    # used here (the doc's example uses the 100-bin default).
    assert abs(peak_q - raw_qrad) <= 2 * bin_width, (
        f"sector peak |Q|={peak_q:.4f} is not within 2 bins of the raw "
        f"brightest pixel's |Q|={raw_qrad:.4f}"
    )
    assert 4.5 <= raw_qrad <= 5.1  # sanity: this IS the ~4.83 Ang^-1 reflection


def test_sector_phi_center_halfwidth_matches_bin_count(
    rsm_ds: DataStruct, rsm_payload: dict[str, Any]
) -> None:
    q_min, q_max = _q_range(rsm_ds)
    resp = client.post(
        "/api/rsm/sector",
        json={
            "dataset": rsm_payload,
            "q_min": q_min - 1e-6,
            "q_max": q_max + 1e-6,
            "n_bins": 60,
            "phi_center": 90.0,
            "phi_halfwidth": 5.0,
        },
    )
    assert resp.status_code == 200
    out = resp.json()
    assert len(out["time"]) == 60
    assert out["metadata"]["sector"] == [85.0, 95.0]


def test_sector_zero_halfwidth_is_422(rsm_payload: dict[str, Any]) -> None:
    """A zero half-width is ambiguous with "full circle" under the mod-360
    rebase (RSM_CUTS_PLAN item 21) -- the route rejects it outright rather
    than silently integrating everything."""
    resp = client.post(
        "/api/rsm/sector",
        json={
            "dataset": rsm_payload,
            "q_min": 4.0,
            "q_max": 5.0,
            "phi_center": 90.0,
            "phi_halfwidth": 0.0,
        },
    )
    assert resp.status_code == 422


# ── /api/rsm/chi-profile ─────────────────────────────────────────────────────


def test_chi_profile_peak_azimuth_matches_raw_brightest_pixel(
    rsm_ds: DataStruct, rsm_payload: dict[str, Any]
) -> None:
    q_min, q_max = _q_range(rsm_ds)
    resp = client.post(
        "/api/rsm/chi-profile",
        json={"dataset": rsm_payload, "q_min": q_min - 1e-6, "q_max": q_max + 1e-6, "n_bins": 45},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["labels"] == ["Intensity", "N points"]
    assert len(out["time"]) == 45
    _assert_has_provenance(out["metadata"], "cut_kind", "q_range", "sector", "mode")
    assert out["metadata"]["cut_kind"] == "chi"

    _raw_qrad, raw_phi, _raw_qx, _raw_qz = _raw_peak_q(rsm_ds)
    intensities = np.asarray(out["values"], dtype=float)[:, 0]
    azimuths = np.asarray(out["time"], dtype=float)
    finite = np.isfinite(intensities)
    peak_phi = float(azimuths[finite][np.argmax(intensities[finite])])
    bin_width_deg = 360.0 / 45
    # docs/theory/xrd.md's worked example: peaks at phi=90 deg, matching
    # the raw brightest pixel's own phi=90.0 deg almost exactly (the
    # near-symmetric substrate reflection sits along +Qz/specular). Slack
    # of 2 bins (~16 deg) covers the coarser 45-bin request here.
    assert abs(peak_phi - raw_phi) <= 2 * bin_width_deg, (
        f"chi-profile peak azimuth={peak_phi:.1f} deg is not within 2 bins of the "
        f"raw brightest pixel's azimuth={raw_phi:.1f} deg"
    )
    assert 80.0 <= raw_phi <= 100.0  # sanity: near-specular (~88-90 deg), per the plan


# ── /api/rsm/box + /box-stats (Q-space box around the bright peak) ─────────


@pytest.fixture
def q_box_bounds(rsm_ds: DataStruct) -> dict[str, float]:
    qx = rsm_ds.column("Qx")
    qz = rsm_ds.column("Qz")
    _raw_qrad, _raw_phi, peak_qx, peak_qz = _raw_peak_q(rsm_ds)
    x_span = float(qx.max() - qx.min())
    y_span = float(qz.max() - qz.min())
    # A generous box centred on the raw peak: ~15% of the map's total Qx
    # spread and ~40% of its Qz spread, comfortably wider than the fitted
    # radial/transverse widths in docs/theory/xrd.md's table (0.001-0.02
    # Ang^-1) without depending on that fit having run.
    x_margin = 0.15 * x_span
    y_margin = 0.40 * y_span
    return {
        "x_min": peak_qx - x_margin,
        "x_max": peak_qx + x_margin,
        "y_min": peak_qz - y_margin,
        "y_max": peak_qz + y_margin,
    }


def test_box_q_space_around_bright_peak_collapse_x(
    rsm_ds: DataStruct, rsm_payload: dict[str, Any], q_box_bounds: dict[str, float]
) -> None:
    resp = client.post(
        "/api/rsm/box",
        json={"dataset": rsm_payload, "space": "q", "collapse": "x", **q_box_bounds},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["labels"] == ["Intensity", "N points"]
    assert len(out["time"]) == 200  # calc.boxcut's cloud-path default n_bins
    _assert_has_provenance(out["metadata"], "cut_kind", "roi", "cut_space", "collapse")
    assert out["metadata"]["cut_kind"] == "box"
    assert out["metadata"]["cut_space"] == "q"
    assert out["metadata"]["x_column_name"] == "Qx"

    # collapse="x" -> profile vs Qx; its peak should sit near the raw
    # brightest pixel's own (near-zero) Qx.
    _raw_qrad, _raw_phi, peak_qx, _peak_qz = _raw_peak_q(rsm_ds)
    intensities = np.asarray(out["values"], dtype=float)[:, 0]
    xs = np.asarray(out["time"], dtype=float)
    finite = np.isfinite(intensities)
    peak_x = float(xs[finite][np.argmax(intensities[finite])])
    bin_width = (q_box_bounds["x_max"] - q_box_bounds["x_min"]) / 200
    assert abs(peak_x - peak_qx) <= 5 * bin_width


def test_box_q_space_rotated_still_full_bins(
    rsm_payload: dict[str, Any], q_box_bounds: dict[str, float]
) -> None:
    resp = client.post(
        "/api/rsm/box",
        json={
            "dataset": rsm_payload,
            "space": "q",
            "collapse": "x",
            "angle": 30.0,
            **q_box_bounds,
        },
    )
    assert resp.status_code == 200
    out = resp.json()
    assert len(out["time"]) == 200
    _assert_has_provenance(out["metadata"], "cut_kind", "roi", "angle")
    assert out["metadata"]["angle"] == 30.0
    assert out["metadata"]["cut_space"] == "q"


def test_box_stats_centroid_near_peak(
    rsm_ds: DataStruct, rsm_payload: dict[str, Any], q_box_bounds: dict[str, float]
) -> None:
    resp = client.post(
        "/api/rsm/box-stats",
        json={"dataset": rsm_payload, "space": "q", **q_box_bounds},
    )
    assert resp.status_code == 200
    body = resp.json()
    for key in (
        "n_points",
        "integrated_intensity",
        "mean_intensity",
        "max_intensity",
        "peak_x",
        "peak_y",
        "centroid_x",
        "centroid_y",
    ):
        assert key in body
    assert body["n_points"] > 0

    # The peak the box_stats endpoint itself found should match the raw
    # brightest pixel over the same ROI.
    _raw_qrad, _raw_phi, peak_qx, peak_qz = _raw_peak_q(rsm_ds)
    assert body["peak_x"] == pytest.approx(peak_qx, abs=1e-9)
    assert body["peak_y"] == pytest.approx(peak_qz, abs=1e-9)

    # Centroid lands within a grid spacing of the peak (a bright,
    # reasonably compact reflection has its intensity-weighted mean close
    # to its maximum) -- grid spacing derived from the map's own pixel
    # pitch in Qx/Qz, tripled for slack.
    n, m = rsm_ds.metadata["map_shape"]
    qx, qz = rsm_ds.column("Qx"), rsm_ds.column("Qz")
    grid_spacing = float(
        np.hypot((qx.max() - qx.min()) / m, (qz.max() - qz.min()) / n)
    )
    dist = float(np.hypot(body["centroid_x"] - body["peak_x"], body["centroid_y"] - body["peak_y"]))
    assert dist <= 3 * grid_spacing, (
        f"centroid is {dist:.5f} Ang^-1 from the peak, more than 3 grid "
        f"spacings ({grid_spacing:.5f} Ang^-1) away"
    )


# ── /api/rsm/linecut (Q-space band, RSM_CUTS_PLAN item 2 fix) ──────────────


def test_linecut_q_space_band_is_honest_near_symmetric_peak(
    rsm_ds: DataStruct, rsm_payload: dict[str, Any]
) -> None:
    _raw_qrad, _raw_phi, _peak_qx, peak_qz = _raw_peak_q(rsm_ds)
    resp = client.post(
        "/api/rsm/linecut",
        json={"dataset": rsm_payload, "direction": "h", "value": peak_qz, "space": "q"},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["labels"] == ["Intensity"]
    _assert_has_provenance(out["metadata"], "cut_direction", "cut_value", "cut_width_used")
    assert out["metadata"]["cut_direction"] == "h"
    assert out["metadata"]["cut_space"] == "q"
    assert out["metadata"]["x_column_name"] == "Qx"

    # Item 2's own acceptance check, repeated here on the real corpus: the
    # band actually applied must be a small slice of the map's Qz range,
    # not a whole-row sweep (the pre-fix defect measured 98.1% on this
    # exact file -- see calc/linecut.py's module docstring).
    qz = rsm_ds.column("Qz")
    total_range = float(qz.max() - qz.min())
    band_used = out["metadata"]["cut_width_used"]
    assert band_used / total_range < 0.1, (
        f"band {band_used:g} is {100 * band_used / total_range:.1f}% of the map's "
        "Qz range -- expected a small slice, not a whole-row sweep"
    )


# ── Pole figure: box (native-polar branch ii) + sector (branch iii reject) ──


def test_pole_figure_box_wrap_x_labels_phi(
    polefig_ds: DataStruct, polefig_payload: dict[str, Any]
) -> None:
    psi = polefig_ds.column("Psi")
    resp = client.post(
        "/api/rsm/box",
        json={
            "dataset": polefig_payload,
            "space": "angular",
            "collapse": "x",
            "wrap": "x",
            # -180/180 is the natural "full circle" bound for a mod-360
            # periodic axis (matches tests/test_calc_boxcut.py's pole-figure
            # coverage), not a value read off this file.
            "x_min": -180.0,
            "x_max": 180.0,
            "y_min": float(psi.min()) - 0.01,
            "y_max": float(psi.max()) + 0.01,
        },
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["metadata"]["x_column_name"] == "Phi"
    _assert_has_provenance(out["metadata"], "cut_kind", "roi", "wrap")
    assert out["metadata"]["wrap"] == "x"
    values = np.asarray(out["values"], dtype=float)
    assert np.all(np.isfinite(values[:, 0]))
    assert values[:, 0].sum() > 0


def test_pole_figure_sector_is_422_missing_q_columns(polefig_payload: dict[str, Any]) -> None:
    """Branch (iii) of the polar-space rule: a true-polar op is meaningless
    without a Qx/Qz origin, and this file has none -- the error must say
    so, not leak an internal KeyError/tuple.index message."""
    resp = client.post(
        "/api/rsm/sector",
        json={"dataset": polefig_payload, "q_min": 1.0, "q_max": 2.0, "n_bins": 10},
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "Qx/Qz" in detail or "Qx" in detail
