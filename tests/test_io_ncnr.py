"""NCNR reductus .refl parser: golden parity vs MATLAB + behaviour."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.ncnr import import_ncnr_dat, import_ncnr_pnr, import_ncnr_refl, is_ncnr_refl


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


# ── .refl dual-format disambiguation (reductus vs refl1d-exported) ────────────
# The reductus "template_data" header line alone runs to ~30 KB, with the
# "columns" key only on a later line — the sniffer must scan line-by-line.
_REFL1D_STYLE_REFL = (
    "# intensity: 1.04776102038159\n"
    "# background: 0.0\n"
    "# Q (1/A) dQ R dR theory fresnel\n"
    "0.01 0.001 0.50 0.01 0.50 0.60\n"
    "0.02 0.001 0.30 0.01 0.31 0.40\n"
    "0.03 0.001 0.10 0.01 0.11 0.20\n"
)


def test_is_ncnr_refl_true_for_reductus(fixtures_dir: Path) -> None:
    assert is_ncnr_refl(fixtures_dir / "ncnr_j395.refl") is True


def test_is_ncnr_refl_false_for_refl1d_style(tmp_path: Path) -> None:
    f = tmp_path / "model.refl"
    f.write_text(_REFL1D_STYLE_REFL, encoding="latin-1")
    assert is_ncnr_refl(f) is False


def test_registry_routes_refl1d_style_refl(tmp_path: Path) -> None:
    """A refl1d-exported .refl (Q/R column header, no JSON "columns") must route to
    the refl1d parser, not crash in import_ncnr_refl ("no columns header")."""
    f = tmp_path / "model.refl"
    f.write_text(_REFL1D_STYLE_REFL, encoding="latin-1")
    ds = import_auto(f)
    assert ds.metadata["parser_name"] == "import_refl1d_dat"
    assert ds.metadata["x_column_name"] == "Q"
    assert ds.labels == ("dQ", "R", "dR", "theory", "fresnel")


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


def test_ncnr_dat_default_plot_hints(tmp_path: Path) -> None:
    """A full cross section emits plot hints: default to R + fit (theory) with
    dR as R's error bars; dQ and fresnel stay off the plot by default."""
    f = tmp_path / "hints.datA"
    f.write_text(
        "# Q (1/A) dQ R dR theory fresnel\n"
        "0.01 0.001 0.5 0.01 0.51 1.0\n"
        "0.02 0.001 0.6 0.01 0.61 1.0\n"
        "0.03 0.001 0.7 0.01 0.71 1.0\n",
        encoding="latin-1",
    )
    ds = import_ncnr_dat(f)
    assert list(ds.labels) == ["dQ", "R", "dR", "theory", "fresnel"]
    # R (value-col 1) + theory (3) plotted by default; dQ (0), dR (2), fresnel (4) off.
    assert ds.metadata["default_value_channels"] == [1, 3]
    # dR (2) is R's (1) error bars.
    assert ds.metadata["error_channels"] == {1: 2}


def test_ncnr_dat_hints_absent_when_columns_missing(tmp_path: Path) -> None:
    """A minimal 3-column file (Q dQ R) has no theory/fresnel — the default set
    is just R, and there's no dR so no error pairing is emitted."""
    f = tmp_path / "min.datA"
    f.write_text(
        "# Q (1/A) dQ R\n0.01 0.001 0.5\n0.02 0.001 0.6\n0.03 0.001 0.7\n",
        encoding="latin-1",
    )
    ds = import_ncnr_dat(f)
    assert list(ds.labels) == ["dQ", "R"]
    assert ds.metadata["default_value_channels"] == [1]  # R only
    assert "error_channels" not in ds.metadata  # no dR column
