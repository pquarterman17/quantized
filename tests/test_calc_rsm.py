"""rsm_strain: strain + relaxation from RSM substrate/film peaks (calc/rsm.py).

Formula-verified (no MATLAB golden): every expected value is derived directly
from the documented relations eps_par = Qx_sub/Qx_film - 1, eps_perp = Qz ratio,
a ~ 2*pi/|Q|, R = (Qx_film - Qx_sub)/(Qx_bulk - Qx_sub).
"""

from __future__ import annotations

import math
from pathlib import Path

import pytest

from quantized.calc.rsm import rsm_strain


def test_strain_ratios() -> None:
    sub = (0.50, 4.00)
    film = (0.40, 3.80)
    r = rsm_strain(sub, film)
    assert r["eps_parallel"] == pytest.approx(0.50 / 0.40 - 1)  # +0.25
    assert r["eps_perp"] == pytest.approx(4.00 / 3.80 - 1)


def test_pseudomorphic_film_has_zero_in_plane_strain() -> None:
    # Qx_film == Qx_sub -> the film is coherently strained in-plane (eps_par = 0).
    r = rsm_strain((0.50, 4.00), (0.50, 3.70))
    assert r["eps_parallel"] == pytest.approx(0.0)
    assert r["eps_perp"] != 0.0


def test_nominal_lattices_scale_as_inverse_q() -> None:
    r = rsm_strain((0.50, 4.00), (0.40, 3.80))
    assert r["a_sub_parallel"] == pytest.approx(2 * math.pi / 0.50)
    assert r["a_sub_perp"] == pytest.approx(2 * math.pi / 4.00)
    assert r["a_film_parallel"] == pytest.approx(2 * math.pi / 0.40)
    assert r["a_film_perp"] == pytest.approx(2 * math.pi / 3.80)


def test_symmetric_reflection_has_nan_in_plane_strain() -> None:
    # Qx == 0 (symmetric (00l) reflection) carries no in-plane information.
    r = rsm_strain((0.0, 4.00), (0.0, 3.80))
    assert math.isnan(r["eps_parallel"])
    assert math.isfinite(r["a_sub_parallel"])  # finite via the eps floor
    assert any("eps_parallel" in w for w in r["warnings"])


def test_near_symmetric_reflection_is_degenerate_not_just_exact_zero() -> None:
    """RSM_CUTS_PLAN #23: the bare ``Qx == 0`` guard missed the common case --
    a fitted peak whose Qx is nonzero only from fit-centroid noise. Values
    below mirror the confirmed defect on epytaxy_rsm.xrdml (real fitted
    substrate/film centres, |Qx|/|Qz| ~ 1e-4): eps_parallel must be NaN with
    a reason, not a fabricated ~81% "strain"."""
    sub = (0.0007999842951093815, 4.826976930890028)
    film = (0.00044230905046043975, 4.64007088121243)
    r = rsm_strain(sub, film)
    assert math.isnan(r["eps_parallel"])
    assert any("eps_parallel" in w and "symmetric" in w for w in r["warnings"])
    # eps_perp is well-conditioned (both Qz are O(1)) and must NOT be swallowed.
    assert math.isfinite(r["eps_perp"])
    assert r["eps_perp"] == pytest.approx(sub[1] / film[1] - 1)


def test_genuinely_asymmetric_reflection_still_computes_normally() -> None:
    """Guard against over-triggering: a real asymmetric reflection (~0.5 deg
    off-normal, an order of magnitude above the degeneracy threshold) must
    return a finite eps_parallel with no warning."""
    sub = (-0.050, 4.500)
    film = (-0.048, 4.520)
    r = rsm_strain(sub, film)
    assert math.isfinite(r["eps_parallel"])
    assert r["eps_parallel"] == pytest.approx(sub[0] / film[0] - 1)
    assert r["warnings"] == []


@pytest.mark.realdata
def test_symmetric_corpus_reflection_is_nan_with_reason(corpus_dir: Path) -> None:
    """Regression for the confirmed defect (RSM_CUTS_PLAN #23): fit the real
    substrate/film peaks from epytaxy_rsm.xrdml -- a symmetric (00L) scan --
    and assert eps_parallel is NaN with a reason, not the fabricated ~81%
    "strain" the unguarded ratio used to produce."""
    from quantized.calc.rsm_analyze import rsm_analyze, rsm_grids_from_datastruct
    from quantized.io.registry import import_auto

    path = corpus_dir / "panalytical" / "xrd" / "epytaxy_rsm.xrdml"
    if not path.exists():
        pytest.skip("epytaxy_rsm.xrdml not present in corpus")

    ds = import_auto(str(path))
    grids = rsm_grids_from_datastruct(ds)
    result = rsm_analyze(
        grids["intensity"], grids["axis1"], grids["axis2"],
        qx=grids["qx"], qz=grids["qz"], n_peaks=2,
    )
    peaks = {p["classification"]: p["centre_Q"] for p in result["peaks"]}
    r = rsm_strain(tuple(peaks["substrate"]), tuple(peaks["film"]))

    assert math.isnan(r["eps_parallel"])
    assert any("eps_parallel" in w for w in r["warnings"])
    assert math.isfinite(r["eps_perp"])  # out-of-plane strain remains honest


def test_zero_qz_raises() -> None:
    with pytest.raises(ValueError, match="Qz must be non-zero"):
        rsm_strain((0.5, 0.0), (0.4, 3.8))
    with pytest.raises(ValueError, match="Qz must be non-zero"):
        rsm_strain((0.5, 4.0), (0.4, 0.0))


def test_relaxation_requires_bulk() -> None:
    assert math.isnan(rsm_strain((0.5, 4.0), (0.4, 3.8))["relaxation"])


def test_relaxation_endpoints() -> None:
    sub = (0.50, 4.00)
    bulk = (0.40, 3.70)
    # Fully strained: film Qx == substrate Qx -> R = 0.
    strained = rsm_strain(sub, (0.50, 3.80), bulk=bulk)
    assert strained["relaxation"] == pytest.approx(0.0)
    # Fully relaxed: film Qx == bulk Qx -> R = 1.
    relaxed = rsm_strain(sub, (0.40, 3.80), bulk=bulk)
    assert relaxed["relaxation"] == pytest.approx(1.0)
    # Partway.
    partial = rsm_strain(sub, (0.45, 3.80), bulk=bulk)
    assert partial["relaxation"] == pytest.approx((0.45 - 0.50) / (0.40 - 0.50))


def test_relaxation_undefined_when_bulk_coincides_with_substrate() -> None:
    r = rsm_strain((0.50, 4.0), (0.50, 3.8), bulk=(0.50, 3.7))
    assert math.isnan(r["relaxation"])
