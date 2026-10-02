"""Reflectometry spin states and plotting roles (plot-correctness audit).

A reductus export of a polarized measurement writes one ``#``-header block per
cross section (``++`` then ``--``, or all four) into ONE ``.refl``. These tests
pin that each cross section becomes its own series, and that the `.pnr` and
refl1d reflectivity layouts declare which columns are curves and which are
error bars. Synthetic files reproduce the corpus shapes; the realdata tests
read the local corpus and skip in CI.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io import import_auto
from quantized.io.ncnr import import_ncnr_dat, import_ncnr_pnr, import_ncnr_refl
from quantized.io.refl1d import import_refl1d_dat


def _block(name: str, entry: str, pol: str, rows: list[tuple[float, ...]]) -> str:
    head = (
        f'# "name": "{name}"\n'
        f'# "entry": "{entry}"\n'
        f'# "polarization": "{pol}"\n'
        '# "wavelength": 4.75\n'
        '# "columns": ["Qz", "counts per incident count", "uncertainty", "resolution"]\n'
        '# "units": ["1/Ang", null, null, "1/Ang"]\n'
    )
    return head + "".join(" ".join(f"{v:.6e}" for v in r) + "\n" for r in rows) + "\n\n"


_UP = [(0.01, 0.9, 0.01, 3e-4), (0.02, 0.5, 0.01, 3.1e-4), (0.03, 0.1, 0.005, 3.2e-4)]
_DOWN = [(0.011, 0.8, 0.02, 3.05e-4), (0.021, 0.4, 0.02, 3.15e-4)]


@pytest.fixture
def two_state_refl(tmp_path: Path) -> Path:
    f = tmp_path / "pnr_two_states.refl"
    f.write_text(
        '# "template_data": {"x": 1}\n'
        + _block("S1", "UP_UP", "++", _UP)
        + _block("S1", "DOWN_DOWN", "--", _DOWN),
        encoding="utf-8",
    )
    return f


def test_multi_block_refl_splits_cross_sections(two_state_refl: Path) -> None:
    ds = import_ncnr_refl(two_state_refl)
    assert ds.labels == (
        "counts per incident count ++",
        "uncertainty ++",
        "counts per incident count --",
        "uncertainty --",
        "resolution",
    )
    # JSON null units are blank, never the string "None".
    assert ds.units == ("", "", "", "", "1/Ang")
    # Row order is file order: the ++ block, then the -- block.
    np.testing.assert_allclose(ds.time, [0.01, 0.02, 0.03, 0.011, 0.021])
    v = np.asarray(ds.values)
    np.testing.assert_allclose(v[:3, 0], [0.9, 0.5, 0.1])
    assert np.isnan(v[3:, 0]).all()
    assert np.isnan(v[:3, 2]).all()
    np.testing.assert_allclose(v[3:, 2], [0.8, 0.4])
    np.testing.assert_allclose(v[3:, 3], [0.02, 0.02])
    # The resolution column is shared: every row carries its own block's dQ.
    np.testing.assert_allclose(v[:, 4], [3e-4, 3.1e-4, 3.2e-4, 3.05e-4, 3.15e-4])
    meta = ds.metadata
    assert meta["polarization"] == ["++", "--"]
    assert meta["default_value_channels"] == [0, 2]
    assert meta["error_channels"] == {0: 1, 2: 3}
    assert {"channel": 4, "target": -1, "axis": "x", "side": "both"} in meta["error_roles"]


def test_single_block_refl_null_units_are_blank(tmp_path: Path) -> None:
    f = tmp_path / "one.refl"
    f.write_text(_block("S1", "UP_UP", "++", _UP), encoding="utf-8")
    ds = import_ncnr_refl(f)
    assert ds.labels == ("counts per incident count", "uncertainty", "resolution")
    assert ds.units == ("", "", "1/Ang")
    assert ds.metadata["polarization"] == "++"
    assert ds.n_points == 3


def test_multi_block_unpolarized_blocks_use_entry_names(tmp_path: Path) -> None:
    f = tmp_path / "two_unpolarized.refl"
    f.write_text(
        _block("A", "first", "", _UP) + _block("B", "second", "", _DOWN), encoding="utf-8"
    )
    ds = import_ncnr_refl(f)
    assert ds.labels[0] == "counts per incident count first"
    assert ds.labels[2] == "counts per incident count second"


_PNR_NSF = (
    "Q\tdQ\tR++\tdR++\tR--\tdR--\tT++\tT--\tSA\tdSA\tT SA\n"
    "A-1\tA-1\tarb. units\tarb. units\tarb. units\tarb. units\tarb. units\tarb. units"
    "\tarb. units\tarb. units\tarb. units\n"
    "0.01\t0.0007\t1.2\t0.01\t1.1\t0.01\t1.19\t1.12\t0.03\t0.009\t0.006\n"
    "0.02\t0.0007\t0.5\t0.01\t0.4\t0.01\t0.49\t0.41\t0.04\t0.008\t0.007\n"
)
_PNR_SF = (
    "Q\tdQ\tR+-\tdR+-\tR-+\tdR-+\tT+-\tT-+\n"
    "A-1\tA-1\tarb. units\tarb. units\tarb. units\tarb. units\tarb. units\tarb. units\t\n"
    "0.01\t0.0008\t-0.005\t0.007\t0.002\t0.007\t0.006\t0.006\t\n"
    "0.02\t0.0008\t0.010\t0.002\t0.011\t0.002\t0.015\t0.015\t\n"
)


def test_pnr_nsf_declares_curves_and_error_roles(tmp_path: Path) -> None:
    f = tmp_path / "nsf.pnr"
    f.write_text(_PNR_NSF, encoding="utf-8")
    ds = import_ncnr_pnr(f)
    lab = {name: i for i, name in enumerate(ds.labels)}
    meta = ds.metadata
    # Measured reflectivities and their theory curves; dQ/dR/SA stay off.
    assert meta["default_value_channels"] == [lab["Rpp"], lab["Rmm"], lab["Tpp"], lab["Tmm"]]
    assert meta["error_channels"] == {
        lab["Rpp"]: lab["dRpp"],
        lab["Rmm"]: lab["dRmm"],
        lab["SA"]: lab["dSA"],
    }
    assert {"channel": lab["dQ"], "target": -1, "axis": "x", "side": "both"} in meta[
        "error_roles"
    ]


def test_pnr_sf_declares_curves(tmp_path: Path) -> None:
    f = tmp_path / "sf.pnr"
    f.write_text(_PNR_SF, encoding="utf-8")
    ds = import_ncnr_pnr(f)
    lab = {name: i for i, name in enumerate(ds.labels)}
    assert ds.metadata["default_value_channels"] == [
        lab["Rpm"], lab["Rmp"], lab["Tpm"], lab["Tmp"]
    ]
    assert ds.metadata["error_channels"] == {lab["Rpm"]: lab["dRpm"], lab["Rmp"]: lab["dRmp"]}


_REFL1D_REFL = (
    "# intensity: 1.0\n"
    "# background: 1e-7\n"
    "# Q (1/A) dQ (1/A) R dR theory fresnel\n"
    "0.01 0.0003 0.9 0.01 0.91 1.0\n"
    "0.02 0.0003 0.5 0.01 0.52 0.6\n"
)


def test_refl1d_refl_dat_declares_curves_like_datA(tmp_path: Path) -> None:
    f = tmp_path / "XRR-refl.dat"
    f.write_text(_REFL1D_REFL, encoding="utf-8")
    ds = import_refl1d_dat(f)
    assert ds.labels == ("dQ", "R", "dR", "theory", "fresnel")
    meta = ds.metadata
    assert meta["default_value_channels"] == [1, 3]
    assert meta["error_channels"] == {1: 2}
    assert {"channel": 0, "target": -1, "axis": "x", "side": "both"} in meta["error_roles"]


def test_ncnr_datA_binds_dq_to_x(tmp_path: Path) -> None:
    f = tmp_path / "fit-refl.datA"
    f.write_text(_REFL1D_REFL, encoding="utf-8")
    ds = import_ncnr_dat(f)
    assert ds.metadata["default_value_channels"] == [1, 3]
    assert {"channel": 0, "target": -1, "axis": "x", "side": "both"} in ds.metadata["error_roles"]


def test_refl1d_profile_is_not_tagged_log_reflectometry(tmp_path: Path) -> None:
    """An SLD depth profile is signed and linear; the reflectometry tag would
    open it on a log axis where irho/rhoM (zero or negative) vanish."""
    f = tmp_path / "model-profile.dat"
    f.write_text(
        "# z (A) rho (1e-6/A2) irho (1e-6/A2) rhoM (1e-6/A2)\n"
        "0 2.07 0.0 0.0\n10 -0.5 0.001 1.2\n20 4.0 0.0 0.0\n",
        encoding="utf-8",
    )
    assert import_auto(f).metadata["technique"] == "generic"
    g = tmp_path / "model-refl.dat"
    g.write_text(_REFL1D_REFL, encoding="utf-8")
    assert import_auto(g).metadata["technique"] == "reflectometry"


def test_refl1d_magnetic_profile_plots_slds_not_theta(tmp_path: Path) -> None:
    """theta (degrees, ~270) on the SLD axis flattened rho/irho/rhoM."""
    f = tmp_path / "pnr-0-profile.dat"
    f.write_text(
        "# z (A) rho (1e-6/A2) irho (1e-6/A2) rhoM (1e-6/A2) theta (degrees)\n"
        "0 2.07 0.0 0.0 270\n10 4.5 0.001 1.2 270\n",
        encoding="utf-8",
    )
    ds = import_refl1d_dat(f)
    assert ds.metadata["default_value_channels"] == [0, 1, 2]


@pytest.mark.realdata
def test_corpus_spin_flip_refl_has_four_monotonic_cross_sections(corpus_dir: Path) -> None:
    f = corpus_dir / "ncnr/reflectometry/PNR_SF/S11_20G_SF.refl"
    ds = import_auto(f)
    assert ds.metadata["polarization"] == ["++", "+-", "-+", "--"]
    measured = ds.metadata["default_value_channels"]
    assert len(measured) == 4
    v = np.asarray(ds.values)
    t = np.asarray(ds.time)
    for ch in measured:
        rows = np.isfinite(v[:, ch])
        assert np.all(np.diff(t[rows]) > 0), ds.labels[ch]
    assert all(u != "None" for u in ds.units)
