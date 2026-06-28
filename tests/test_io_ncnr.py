"""NCNR reductus .refl parser: golden parity vs MATLAB + behaviour."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.ncnr import import_ncnr_dat, import_ncnr_pnr, import_ncnr_refl


@pytest.mark.golden
def test_ncnr_refl_matches_matlab(
    fixtures_dir: Path,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    ref = load_golden("ncnr_j395_default.json")
    ds = import_ncnr_refl(fixtures_dir / "ncnr_j395.refl")
    assert list(ds.labels) == list(ref["labels"])
    assert list(ds.units) == list(ref["units"])
    assert_allclose(ds.time, np.asarray(ref["time"], dtype=float), rtol=1e-9, atol=1e-12)
    ref_values = np.asarray(ref["values"], dtype=float).reshape(ds.values.shape)
    assert_allclose(ds.values, ref_values, rtol=1e-9, atol=1e-12)


def test_ncnr_refl_structure(fixtures_dir: Path) -> None:
    ds = import_ncnr_refl(fixtures_dir / "ncnr_j395.refl")
    # time = Qz; values = Intensity / uncertainty / resolution
    assert ds.labels == ("Intensity", "uncertainty", "resolution")
    assert ds.metadata["x_column_name"] == "Qz"
    assert ds.n_channels == 3
    assert ds.n_points == 325


def test_registry_routes_refl(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "ncnr_j395.refl")
    assert ds.metadata["parser_name"] == "import_ncnr_refl"


# ── Polarized .pnr ────────────────────────────────────────────────────────
@pytest.mark.golden
def test_ncnr_pnr_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_ncnr_pnr(fixtures_dir / "ncnr_s11_nsf.pnr")
    assert_golden(ds, "ncnr_s11_nsf_default.json")


def test_ncnr_pnr_cleans_polarization_labels(fixtures_dir: Path) -> None:
    ds = import_ncnr_pnr(fixtures_dir / "ncnr_s11_nsf.pnr")
    assert ds.metadata["variant"] == "NSF"
    assert "Rpp" in ds.labels  # R++ -> Rpp
    assert "Rmm" in ds.labels  # R-- -> Rmm
    assert not any("+" in label for label in ds.labels)


def test_registry_routes_pnr(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "ncnr_s11_nsf.pnr")
    assert ds.metadata["parser_name"] == "import_ncnr_pnr"


# ── Cross-section .datA ───────────────────────────────────────────────────
@pytest.mark.golden
def test_ncnr_dat_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_ncnr_dat(fixtures_dir / "ncnr_s3.datA")
    assert_golden(ds, "ncnr_s3_datA_default.json")


def test_ncnr_dat_polarization_from_extension(fixtures_dir: Path) -> None:
    ds = import_ncnr_dat(fixtures_dir / "ncnr_s3.datA")
    assert ds.metadata["polarization"] == "++"
    assert ds.metadata["x_column_name"] == "Q"


def test_registry_routes_datA(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "ncnr_s3.datA")
    assert ds.metadata["parser_name"] == "import_ncnr_dat"


def test_ncnr_metadata_beyond_first_five_lines(tmp_path: Path) -> None:
    """intensity/background sitting past line 5 must still be captured (the scan
    was capped at lines[:5])."""
    f = tmp_path / "late_meta.datA"
    f.write_text(
        "# c1\n# c2\n# c3\n# c4\n# c5\n"
        "# intensity: 1.2345\n"  # index 5 — beyond the old lines[:5] window
        "# background: 0.001\n"
        "# Q (1/A) R dR\n"
        "0.01 0.5 0.01\n0.02 0.6 0.01\n0.03 0.7 0.01\n",
        encoding="latin-1",
    )
    ds = import_ncnr_dat(f)
    assert ds.metadata["intensity"] == pytest.approx(1.2345)
    assert ds.metadata["background"] == pytest.approx(0.001)
    assert ds.n_points == 3
