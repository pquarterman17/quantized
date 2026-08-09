"""Shared grid/scatter internals (calc._rsm_grid) — RSM_CUTS_PLAN item 19.

``resolve_angular_axes`` is the ONE place ``space="angular"``'s (primary,
secondary) column pair is decided; ``full_grids`` and ``scatter_columns`` both
call it. These tests cover the helper directly (both branches + the domain
error) and confirm ``full_grids``/``scatter_columns`` actually use its answer
instead of a hardcoded ``"2Theta"`` — the defect this item fixes: a pole
figure (no '2Theta' column, e.g. labels ``["Phi", "Psi", "Intensity"]``) used
to crash with a leaked ``tuple.index(x): x not in tuple`` instead of
resolving to its own ``(Phi, Psi)`` pair. See ``tests/test_calc_boxcut.py``
for the end-to-end box_cut/box_stats behaviour on a pole-figure-shaped
dataset and the real-corpus round trip.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc._rsm_grid import full_grids, resolve_angular_axes, scatter_columns
from quantized.datastruct import DataStruct


def _tt_omega_grid(n: int = 3, m: int = 4, *, tt_unit: str = "deg") -> DataStruct:
    """A normal 2Theta/Omega mesh — the pair every existing RSM path uses."""
    tt_vec = np.linspace(10.0, 13.0, m)
    om_vec = np.linspace(0.0, 2.0, n)
    tt_grid, om_grid = np.meshgrid(tt_vec, om_vec)
    intensity = np.arange(n * m, dtype=float).reshape(n, m)
    values = np.column_stack([tt_grid.ravel(), om_grid.ravel(), intensity.ravel()])
    return DataStruct.create(
        np.arange(n * m, dtype=float),
        values,
        labels=["2Theta", "Omega", "Intensity"],
        units=[tt_unit, tt_unit, "counts"],
        metadata={"is2D": True, "map_shape": [n, m], "axis1_name": "Omega", "source": "test"},
    )


def _pole_figure_grid(n: int = 5, m: int = 7) -> DataStruct:
    """Pole-figure-shaped: no '2Theta' column, labels ``(Phi, Psi, Intensity)``,
    ``axis1_name='Psi'`` — matches the real corpus anchor's schema
    (``xrayutilities_polefig_point.xrdml``: labels ``['Phi', 'Psi',
    'Intensity']``, ``axis1_name='Psi'``)."""
    phi_vec = np.linspace(-179.7, 179.7, m)
    psi_vec = np.linspace(0.0, 90.0, n)
    phi_grid, psi_grid = np.meshgrid(phi_vec, psi_vec)
    intensity = np.arange(n * m, dtype=float).reshape(n, m)
    values = np.column_stack([phi_grid.ravel(), psi_grid.ravel(), intensity.ravel()])
    return DataStruct.create(
        np.arange(n * m, dtype=float),
        values,
        labels=["Phi", "Psi", "Intensity"],
        units=["deg", "deg", "cps"],
        metadata={"is2D": True, "map_shape": [n, m], "axis1_name": "Psi", "source": "test"},
    )


# ── resolve_angular_axes ─────────────────────────────────────────────────────


def test_resolve_angular_axes_prefers_2theta_when_present() -> None:
    ds = _tt_omega_grid()
    assert resolve_angular_axes(ds) == ("2Theta", "Omega")


def test_resolve_angular_axes_falls_back_to_dataset_columns_for_pole_figure() -> None:
    ds = _pole_figure_grid()
    assert resolve_angular_axes(ds) == ("Phi", "Psi")


def test_resolve_angular_axes_raises_domain_error_not_tuple_index() -> None:
    """The exact regression this item fixes: before, a bare
    ``ds.column("2Theta")`` leaked ``ValueError: tuple.index(x): x not in
    tuple``. Now the message names what's missing and the dataset's actual
    labels."""
    ds = DataStruct.create(
        np.arange(6, dtype=float),
        np.column_stack([np.arange(6.0), np.arange(6.0) * 2, np.arange(6.0) * 3]),
        labels=["Foo", "Bar", "Intensity"],
        units=["deg", "deg", "cps"],
        metadata={"is2D": True, "map_shape": [2, 3], "source": "test"},
    )
    with pytest.raises(ValueError) as excinfo:
        resolve_angular_axes(ds)
    msg = str(excinfo.value)
    assert "tuple.index" not in msg
    assert "2Theta" in msg
    assert "Foo" in msg and "Bar" in msg and "Intensity" in msg


def test_resolve_angular_axes_raises_when_more_than_two_angular_columns() -> None:
    """No '2Theta', axis1_name matches one column, but two more remain --
    ambiguous, must raise rather than silently pick one."""
    ds = DataStruct.create(
        np.arange(4, dtype=float),
        np.column_stack([np.arange(4.0)] * 3 + [np.arange(4.0) * 5]),
        labels=["Chi", "Phi", "Psi", "Intensity"],
        units=["deg", "deg", "deg", "cps"],
        metadata={"is2D": True, "map_shape": [2, 2], "axis1_name": "Psi", "source": "test"},
    )
    with pytest.raises(ValueError, match="Chi.*Phi.*Psi.*Intensity"):
        resolve_angular_axes(ds)


# ── full_grids uses the resolved pair ───────────────────────────────────────


def test_full_grids_tt_name_is_2theta_on_a_normal_mesh() -> None:
    g = full_grids(_tt_omega_grid())
    assert g["tt_name"] == "2Theta"
    assert g["sec_name"] == "Omega"


def test_full_grids_tt_name_is_phi_on_a_pole_figure() -> None:
    """Before this item: ``full_grids`` unconditionally called
    ``ds.column("2Theta")`` and crashed on this exact dataset shape."""
    g = full_grids(_pole_figure_grid())
    assert g["tt_name"] == "Phi"
    assert g["sec_name"] == "Psi"
    n, m = 5, 7
    assert g["tt"].shape == (n, m)
    assert g["sec"].shape == (n, m)
    np.testing.assert_allclose(g["tt"][0, :], np.linspace(-179.7, 179.7, m))
    np.testing.assert_allclose(g["sec"][:, 0], np.linspace(0.0, 90.0, n))


# ── scatter_columns uses the resolved pair + reads axis_unit honestly ──────


def test_scatter_columns_angular_returns_resolved_names() -> None:
    xs, ys, _i, _unit, _iu, x_name, y_name = scatter_columns(_tt_omega_grid(), "angular")
    assert (x_name, y_name) == ("2Theta", "Omega")
    assert xs.shape == ys.shape


def test_scatter_columns_angular_pole_figure_returns_phi_psi() -> None:
    xs, ys, _i, axis_unit, _iu, x_name, y_name = scatter_columns(_pole_figure_grid(), "angular")
    assert (x_name, y_name) == ("Phi", "Psi")
    assert axis_unit == "deg"
    assert xs.min() == pytest.approx(-179.7)
    assert xs.max() == pytest.approx(179.7)


def test_scatter_columns_q_space_names_are_always_qx_qz() -> None:
    ds = _tt_omega_grid()
    n_pts = ds.time.size
    ds_q = DataStruct.create(
        ds.time,
        np.column_stack(
            [
                ds.column("2Theta"),
                ds.column("Omega"),
                np.linspace(0.0, 1.0, n_pts),  # Qx
                np.linspace(1.0, 2.0, n_pts),  # Qz
                ds.column("Intensity"),
            ]
        ),
        labels=["2Theta", "Omega", "Qx", "Qz", "Intensity"],
        units=["deg", "deg", "Ang^-1", "Ang^-1", "counts"],
        metadata=dict(ds.metadata),
    )
    _xs, _ys, _i, axis_unit, _iu, x_name, y_name = scatter_columns(ds_q, "q")
    assert (x_name, y_name) == ("Qx", "Qz")
    assert axis_unit == "Ang^-1"


def test_scatter_columns_axis_unit_reads_ds_units_not_hardcoded() -> None:
    """Regression guard for the 'deg' literal this item replaced: a dataset
    whose primary angular column is genuinely in a DIFFERENT unit must have
    that unit reported back, not a silently-assumed ``"deg"``."""
    ds = _tt_omega_grid(tt_unit="rad")
    _xs, _ys, _i, axis_unit, _iu, _xn, _yn = scatter_columns(ds, "angular")
    assert axis_unit == "rad"
