"""fit_reflectivity: fit a layer model to measured reflectivity (calc/refl_fit.py).

New capability (MATLAB has no reflectivity fitter), so it is verified by
recovering the known truth of the committed synthetic fixtures — both were
generated from ``tools/baselines/reflectometry.py``'s ``_BILAYER`` with the
golden Parratt engine and counting noise — and by invariants: fixed and tied
parameters, bounds, weighting, Q windows, and error calibration.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest

from quantized.calc.refl_fit import fit_reflectivity, layer_param_name, model_curves
from quantized.calc.reflectivity import parratt_refl

FIXTURES = Path(__file__).parent / "fixtures" / "baselines"

# The fixtures' truth (tools/baselines/reflectometry.py `_BILAYER`).
TRUTH = {
    "L1.thickness": 300.0, "L1.sld": 3.0e-6, "L1.roughness": 6.0,
    "L2.thickness": 150.0, "L2.sld": 5.5e-6, "L2.roughness": 4.0,
    "L3.roughness": 3.0,
}


def P(name: str, value: float, lo: float | None = None, hi: float | None = None,
      *, tie: str | None = None) -> dict[str, Any]:
    p: dict[str, Any] = {"name": name, "value": value, "vary": lo is not None, "tie": tie}
    if lo is not None:
        p["min"], p["max"] = lo, hi
    return p


def bilayer(
    start: dict[str, float] | None = None, *, magnetic: bool = False
) -> list[dict[str, Any]]:
    s = {"L1.thickness": 292.0, "L1.sld": 2.8e-6, "L2.thickness": 158.0, "L2.sld": 5.2e-6}
    s.update(start or {})
    ps = [
        P("L0.thickness", 0), P("L0.sld", 0), P("L0.isld", 0), P("L0.roughness", 0),
        P("L1.thickness", s["L1.thickness"], 250, 350), P("L1.sld", s["L1.sld"], 2e-6, 4e-6),
        P("L1.isld", 0.05e-6), P("L1.roughness", 8, 0, 15),
        P("L2.thickness", s["L2.thickness"], 120, 190), P("L2.sld", s["L2.sld"], 4e-6, 7e-6),
        P("L2.isld", 0.08e-6), P("L2.roughness", 5, 0, 15),
        P("L3.thickness", 0), P("L3.sld", 2.07e-6), P("L3.isld", 0.02e-6),
        P("L3.roughness", 4, 0, 15),
        P("scale", 1.0, 0.8, 1.2), P("background", 1e-7, 0, 1e-5),
    ]
    if magnetic:
        ps.append(P("L2.msld", 0.2e-6, -2e-6, 2e-6))
    return ps


def by_name(out: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in out["parameters"]}


def xrr_channel() -> dict[str, Any]:
    q, r, dr, _dq = np.loadtxt(FIXTURES / "xrr_bilayer_kiessig.refl", comments="#").T
    return {"q": q, "r": r, "dr": dr, "label": "xrr"}


def test_recovers_the_xrr_fixture_truth() -> None:
    out = fit_reflectivity(bilayer(), [xrr_channel()])
    assert out["success"] and not out["warnings"]
    p = by_name(out)
    assert p["L1.thickness"]["value"] == pytest.approx(300.0, abs=0.5)
    assert p["L2.thickness"]["value"] == pytest.approx(150.0, abs=0.5)
    assert p["L1.sld"]["value"] == pytest.approx(3.0e-6, rel=0.01)
    assert p["L2.sld"]["value"] == pytest.approx(5.5e-6, rel=0.01)
    assert p["L1.roughness"]["value"] == pytest.approx(6.0, abs=0.5)
    assert 0.7 < out["reduced_chi2"] < 1.5  # counting noise, dR-weighted
    for name in out["free"]:
        assert p[name]["stderr"] is not None and p[name]["stderr"] > 0


def test_recovers_the_pnr_fixture_truth_including_magnetic_sld() -> None:
    q, dq, rpp, drpp, rmm, drmm = np.loadtxt(FIXTURES / "pnr_bilayer_spin_pair.pnr", skiprows=2).T
    out = fit_reflectivity(
        bilayer(magnetic=True),
        [
            {"q": q, "r": rpp, "dr": drpp, "spin": "+", "label": "++"},
            {"q": q, "r": rmm, "dr": drmm, "spin": "-", "label": "--"},
        ],
    )
    p = by_name(out)
    assert out["success"]
    assert p["L2.msld"]["value"] == pytest.approx(0.45e-6, rel=0.02)
    assert p["L1.thickness"]["value"] == pytest.approx(300.0, abs=0.5)
    assert p["L2.sld"]["value"] == pytest.approx(5.5e-6, rel=0.01)
    assert sorted(c["spin"] for c in out["curves"]) == ["+", "-"]
    assert sorted(prof["spin"] for prof in out["sld_profiles"]) == ["+", "-"]


def test_log_weighting_fits_data_without_an_error_column() -> None:
    ch = xrr_channel()
    del ch["dr"]
    out = fit_reflectivity(bilayer(), [ch], weighting="log")
    p = by_name(out)
    assert p["L1.thickness"]["value"] == pytest.approx(300.0, abs=1.0)
    assert p["L2.thickness"]["value"] == pytest.approx(150.0, abs=1.0)


def test_dr_weighting_requires_a_dr_column() -> None:
    ch = xrr_channel()
    del ch["dr"]
    with pytest.raises(ValueError, match="dR column"):
        fit_reflectivity(bilayer(), [ch], weighting="dr")


def test_fixed_parameters_do_not_move_and_report_no_error() -> None:
    ps = bilayer()
    for p in ps:
        if p["name"] == "L1.thickness":
            p["vary"] = False
            p["value"] = 300.0
    out = fit_reflectivity(ps, [xrr_channel()])
    p = by_name(out)["L1.thickness"]
    assert p["value"] == 300.0 and p["stderr"] is None and not p["vary"]


def test_a_tied_parameter_follows_its_target() -> None:
    ps = bilayer()
    for p in ps:
        if p["name"] == "L2.roughness":
            p.update(vary=False, tie="L1.roughness")
    out = fit_reflectivity(ps, [xrr_channel()])
    p = by_name(out)
    assert p["L2.roughness"]["value"] == p["L1.roughness"]["value"]
    assert p["L2.roughness"]["tie"] == "L1.roughness"
    assert "L2.roughness" not in out["free"]


@pytest.mark.parametrize(
    ("mutate", "match"),
    [
        (lambda ps: ps[4].update(tie="L4.sld"), "unknown parameter"),
        (lambda ps: ps[4].update(tie="L1.thickness"), "tied to itself"),
        (lambda ps: (ps[4].update(tie="L2.thickness"), ps[8].update(tie="L1.thickness")), "cycle"),
        (lambda ps: ps[4].update(min=None, max=None), "finite min < max"),
        (lambda ps: ps[4].update(value=400.0), "starts outside"),
        (lambda ps: ps.append(dict(ps[4])), "unique"),
    ],
)
def test_malformed_parameters_are_refused(mutate: Any, match: str) -> None:
    ps = bilayer()
    mutate(ps)
    with pytest.raises(ValueError, match=match):
        fit_reflectivity(ps, [xrr_channel()])


def test_a_parameter_pinned_on_a_bound_is_flagged() -> None:
    ps = bilayer({"L1.thickness": 260.0})
    for p in ps:
        if p["name"] == "L1.thickness":
            p["max"] = 270.0  # truth (300) lies outside: the fit must press on the bound
    out = fit_reflectivity(ps, [xrr_channel()])
    p = by_name(out)["L1.thickness"]
    assert p["at_bound"] and p["stderr"] is None
    assert any("bound" in w for w in out["warnings"])


def test_q_window_limits_the_fitted_points() -> None:
    full = fit_reflectivity(bilayer(), [xrr_channel()])
    win = fit_reflectivity(bilayer(), [{**xrr_channel(), "q_min": 0.02, "q_max": 0.2}])
    assert win["n_points"] < full["n_points"]
    assert min(win["curves"][0]["q"]) >= 0.02 and max(win["curves"][0]["q"]) <= 0.2


def test_too_few_points_for_the_free_parameters_is_refused() -> None:
    ch = xrr_channel()
    ch = {k: (v[:5] if isinstance(v, np.ndarray) else v) for k, v in ch.items()}
    with pytest.raises(ValueError, match="cannot constrain"):
        fit_reflectivity(bilayer(), [ch])


def test_bad_spin_and_length_mismatch_are_refused() -> None:
    ch = xrr_channel()
    with pytest.raises(ValueError, match="spin"):
        fit_reflectivity(bilayer(), [{**ch, "spin": "x"}])
    with pytest.raises(ValueError, match="same length"):
        fit_reflectivity(bilayer(), [{**ch, "r": ch["r"][:-1]}])


def test_per_point_fwhm_resolution_is_converted_to_sigma() -> None:
    q = np.linspace(0.01, 0.2, 200)
    fwhm = 0.05 * q
    layers = np.array([[0, 0, 0, 0], [200, 4e-6, 0, 3], [0, 2.07e-6, 0, 3]], dtype=float)
    r = parratt_refl(q, layers, resolution=fwhm / 2.3548200450309493)
    ps = [
        P("L0.thickness", 0), P("L0.sld", 0), P("L1.thickness", 190, 150, 250),
        P("L1.sld", 4e-6), P("L1.roughness", 3), P("L2.sld", 2.07e-6), P("L2.roughness", 3),
    ]
    out = fit_reflectivity(ps, [{"q": q, "r": r, "dq": fwhm, "dq_is_fwhm": True}], weighting="log")
    assert by_name(out)["L1.thickness"]["value"] == pytest.approx(200.0, abs=0.05)


def test_reported_errors_match_the_scatter_of_repeated_fits() -> None:
    # Calibration: over many noise realisations the fitted thickness scatters
    # by about its reported standard error (pulls ~ unit width).
    q = np.linspace(0.01, 0.25, 250)
    layers = np.array([[0, 0, 0, 0], [180, 4e-6, 0, 4], [0, 2.07e-6, 0, 3]], dtype=float)
    r_true = parratt_refl(q, layers)
    rng = np.random.default_rng(7)
    pulls = []
    for _ in range(40):
        dr = 0.03 * r_true + 1e-8
        r = r_true + rng.normal(0, dr)
        ps = [
            P("L0.thickness", 0), P("L0.sld", 0), P("L1.thickness", 175, 150, 210),
            P("L1.sld", 4e-6), P("L1.roughness", 4, 0, 10),
            P("L2.sld", 2.07e-6), P("L2.roughness", 3),
        ]
        p = by_name(fit_reflectivity(ps, [{"q": q, "r": r, "dr": dr}]))["L1.thickness"]
        pulls.append((p["value"] - 180.0) / p["stderr"])
    assert 0.6 < float(np.std(pulls)) < 1.6
    assert abs(float(np.mean(pulls))) < 0.5


def test_model_curves_evaluates_each_spin_without_fitting() -> None:
    ps = bilayer(magnetic=True)
    q = [0.02, 0.05, 0.1]
    up, dn = model_curves(ps, q, ["+", "-"])
    assert up.shape == (3,) and not np.allclose(up, dn)
    (plain,) = model_curves(ps, q, [None])
    assert np.all(plain > 0)


def test_layer_param_name() -> None:
    assert layer_param_name(2, "msld") == "L2.msld"
