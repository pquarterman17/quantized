"""Graded (spline) SLD layers as fit parameters (calc/refl_graded.py, S2).

MATLAB has a graded-profile BUILDER (splineSLD / profileToLayers, golden in
test_calc_sld) but no reflectivity FITTER, so fitting knots has no MATLAB
counterpart: it is verified here by a synthetic round trip (simulate a known
graded profile with noise, fit from a perturbed start, recover the knots), by
the stack matching the Model mode's own construction, by parameter packing,
and by the refusals.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.refl_dream import plan_sampling, sample_reflectivity
from quantized.calc.refl_fit import fit_reflectivity, model_curves
from quantized.calc.refl_graded import ReflStack, default_slices, model_stack
from quantized.calc.refl_model import ReflParams, knot_field, knot_param_name
from quantized.calc.reflectivity import parratt_refl
from quantized.calc.sld import profile_to_layers, spline_sld

TRUE_KNOTS = [2.0e-6, 4.5e-6, 6.0e-6, 3.5e-6]
TRUE_T = 120.0
SLICES = 60


def P(name: str, value: float, lo: float | None = None, hi: float | None = None,
      *, tie: str | None = None) -> dict[str, Any]:
    p: dict[str, Any] = {"name": name, "value": value, "vary": lo is not None, "tie": tie}
    if lo is not None:
        p["min"], p["max"] = lo, hi
    return p


def graded_model(knots: list[float], t: float, *, free: bool = False) -> list[dict[str, Any]]:
    """Air / one graded film / Si. ``free`` varies every knot and the thickness."""
    ps = [P("L0.sld", 0.0)]
    for j, k in enumerate(knots):
        name = knot_param_name(1, j)
        ps.append(P(name, k, 0.5e-6, 8e-6) if free else P(name, k))
    ps += [
        P("L1.thickness", t, 90.0, 150.0) if free else P("L1.thickness", t),
        P("L1.roughness", 4.0),
        P("L2.sld", 2.07e-6), P("L2.roughness", 3.0),
        P("scale", 1.0), P("background", 1e-7),
    ]
    return ps


GRADED = [{"layer": 1, "method": "pchip", "slices": SLICES}]


def manual_stack(knots: list[float], t: float, slices: int = SLICES) -> np.ndarray:
    """The Model mode's construction (reflGraded.expandGraded), done by hand:
    /spline-sld over [0, t] with evenly spaced knots, its midpoint slabs, the
    layer roughness on the first slab only."""
    z, sld = spline_sld(np.linspace(0, t, len(knots)), knots, z_range=(0.0, t),
                        n_points=slices + 1, method="pchip")
    slabs = profile_to_layers(z, sld)[1:-1]
    slabs[0, 3] = 4.0
    return np.vstack([[0.0, 0.0, 0.0, 0.0], slabs, [0.0, 2.07e-6, 0.0, 3.0]])


def synthetic_channel(seed: int = 7) -> dict[str, Any]:
    q = np.linspace(0.008, 0.25, 300)
    r = parratt_refl(q, manual_stack(TRUE_KNOTS, TRUE_T), background=1e-7)
    dr = 0.03 * r
    noisy = r + np.random.default_rng(seed).standard_normal(q.size) * dr
    return {"q": q, "r": noisy, "dr": dr, "label": "graded"}


def by_name(out: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in out["parameters"]}


# ── names and packing ───────────────────────────────────────────────────────


def test_knot_names_round_trip_and_are_canonical() -> None:
    assert knot_param_name(2, 3) == "L2.knot3.sld"
    assert knot_param_name(2, 0, "isld") == "L2.knot0.isld"
    assert knot_field("L2.knot3.sld") == (2, 3, "sld")
    assert knot_field("L2.knot0.isld") == (2, 0, "isld")
    for bad in ("L02.knot1.sld", "L2.knot01.sld", "L2.knot1.msld", "L2.knot.sld", "L2.sld"):
        assert knot_field(bad) is None


def test_knots_pack_into_the_same_normalised_vector_as_slab_fields() -> None:
    specs = graded_model(TRUE_KNOTS, TRUE_T, free=True)
    specs.append(P("L1.knot9.sld", 1e-6, tie="L1.knot2.sld"))  # a tie to a knot
    params = ReflParams(specs)
    free = [params.names[i] for i in params.free]
    assert free == [*(knot_param_name(1, j) for j in range(4)), "L1.thickness"]
    x0 = params.x0()
    assert np.all((x0 >= 0) & (x0 <= 1))
    v = params.full(x0)
    for j, k in enumerate(TRUE_KNOTS):
        assert v[params.index[knot_param_name(1, j)]] == pytest.approx(k, rel=1e-12)
    assert v[params.index["L1.knot9.sld"]] == pytest.approx(TRUE_KNOTS[2], rel=1e-12)
    # Unpacking a moved vector moves exactly the knot it names.
    x = x0.copy()
    x[1] = 1.0
    assert params.full(x)[params.index["L1.knot1.sld"]] == pytest.approx(8e-6)
    assert params.full(x)[params.index["L1.knot0.sld"]] == pytest.approx(TRUE_KNOTS[0])


# ── the stack ───────────────────────────────────────────────────────────────


def test_the_stack_matches_the_model_modes_construction() -> None:
    specs = graded_model(TRUE_KNOTS, TRUE_T)
    stack = model_stack(specs, [{"q": [0.1], "r": [1.0]}], GRADED)
    params = ReflParams(specs)
    built = stack.build(params, params.full(np.zeros(0)), 0)
    assert_allclose(built, manual_stack(TRUE_KNOTS, TRUE_T), rtol=1e-12, atol=1e-30)
    assert stack.n_rows == 3 + SLICES - 1


def test_thickness_stretches_the_profile_and_keeps_the_slab_count() -> None:
    specs = graded_model(TRUE_KNOTS, TRUE_T, free=True)
    stack = model_stack(specs, [{"q": [0.1], "r": [1.0]}], GRADED)
    params = ReflParams(specs)
    x = params.x0()
    x[-1] = 1.0  # thickness to its max, 150 Å
    built = stack.build(params, params.full(x), 0)
    assert built.shape[0] == 2 + SLICES
    assert_allclose(built[1:-1, 0].sum(), 150.0, rtol=1e-12)
    assert_allclose(built, manual_stack(TRUE_KNOTS, 150.0), rtol=1e-12, atol=1e-30)


def test_uniform_absorption_isld_knots_msld_and_positions() -> None:
    specs = [
        P("L0.sld", 0.0), P("L1.thickness", 100.0), P("L1.roughness", 2.0),
        P("L1.knot0.sld", 1e-6), P("L1.knot1.sld", 3e-6), P("L1.knot2.sld", 2e-6),
        P("L1.knot0.isld", 0.0), P("L1.knot1.isld", 1e-7), P("L1.knot2.isld", 2e-7),
        P("L1.msld", 0.5e-6), P("L2.sld", 2e-6),
    ]
    graded = [{"layer": 1, "positions": [0.0, 0.25, 1.0], "method": "linear", "slices": 4}]
    chans = [{"q": [0.1], "r": [1.0], "spin": "+"}]
    stack = model_stack(specs, chans, graded)
    params = ReflParams(specs)
    up = stack.build(params, params.full(np.zeros(0)), 1)
    # linear through (0, 1), (25, 3), (100, 2) e-6 at z = 0, 25, 50, 75, 100:
    z_sld = np.array([1.0, 3.0, 3 - 1 / 3, 3 - 2 / 3, 2.0]) * 1e-6
    mid = 0.5 * (z_sld[:-1] + z_sld[1:])
    assert_allclose(up[1:-1, 1], mid + 0.5e-6, rtol=1e-12)
    # Absorption is positive in the API, negative in the engine's rows.
    z_isld = np.array([0.0, 1.0, 1 + 1 / 3, 1 + 2 / 3, 2.0]) * 1e-7
    assert_allclose(up[1:-1, 2], -0.5 * (z_isld[:-1] + z_isld[1:]), rtol=1e-12)
    assert list(up[1:-1, 3]) == [2.0, 0.0, 0.0, 0.0]
    down = stack.build(params, params.full(np.zeros(0)), -1)
    assert_allclose(down[1:-1, 1], mid - 0.5e-6, rtol=1e-12)
    # Without isld knots, L1.isld is a uniform absorption across the slabs.
    uniform = [s for s in specs if ".knot" not in s["name"] or s["name"].endswith(".sld")]
    uniform.append(P("L1.isld", 3e-8))
    st2 = model_stack(uniform, chans, graded)
    p2 = ReflParams(uniform)
    assert_allclose(st2.build(p2, p2.full(np.zeros(0)), 0)[1:-1, 2], -3e-8)


def test_default_slices_follow_the_model_modes_rule() -> None:
    assert default_slices(120.0) == 60
    assert default_slices(3.0) == 4
    assert default_slices(1e4) == 200
    specs = graded_model(TRUE_KNOTS, TRUE_T)
    stack = model_stack(specs, [{"q": [0.1], "r": [1.0]}], [{"layer": 1}])
    assert stack.n_rows == 3 + 60 - 1


def test_a_slab_only_model_builds_the_plain_stack() -> None:
    stack = ReflStack(3)
    params = ReflParams([P("L0.sld", 0.0), P("L1.sld", 1e-6), P("L1.thickness", 50.0),
                         P("L2.sld", 2e-6)])
    built = stack.build(params, params.full(np.zeros(0)), 0)
    assert built.shape == (3, 4)


# ── refusals ────────────────────────────────────────────────────────────────


def _with(specs: list[dict[str, Any]], **edits: dict[str, Any]) -> list[dict[str, Any]]:
    return [{**s, **edits.get(s["name"].replace(".", "_"), {})} for s in specs]


CH = [{"q": [0.1], "r": [1.0]}]
BASE = graded_model(TRUE_KNOTS, TRUE_T, free=True)


@pytest.mark.parametrize(("specs", "graded", "match"), [
    ([s for s in BASE if not s["name"].startswith("L1.knot")] + [P("L1.knot0.sld", 1e-6)],
     GRADED, "at least 2 knots"),
    ([s for s in BASE if s["name"] != "L1.knot1.sld"], GRADED, "without gaps"),
    (BASE, [{"layer": 1, "positions": [0.0, 0.5, 0.4, 1.0]}], "strictly increasing"),
    (BASE, [{"layer": 1, "positions": [0.0, 1.0]}], "one position per knot"),
    (BASE, [{"layer": 1, "positions": [-0.1, 0.3, 0.6, 1.0]}], r"within \[0, 1\]"),
    (_with(BASE, L1_knot2_sld={"min": 9e-6, "max": 1e-6}), GRADED, "finite min < max"),
    (BASE, [{"layer": 1}, {"layer": 2}], "film layer"),
    (BASE, [], "belongs to no graded layer"),
    (BASE, [{"layer": 1}, {"layer": 1}], "more than once"),
    (BASE, [{"layer": 1, "method": "cubic"}], "method"),
    (BASE, [{"layer": 1, "slices": 0}], "slices"),
    (BASE + [P("L1.sld", 3e-6, 1e-6, 5e-6)], GRADED, "no effect"),
    (BASE + [P("L1.knot0.isld", 0.0)], GRADED, "every knot or for none"),
    (BASE + [P(f"L1.knot{j}.isld", 0.0) for j in range(4)] + [P("L1.isld", 1e-8, 0, 1e-7)],
     GRADED, "no effect"),
    (_with(BASE, L1_thickness={"min": 0.0}), GRADED, "thickness above 0"),
])
def test_unsupported_graded_models_are_refused(
    specs: list[dict[str, Any]], graded: list[dict[str, Any]], match: str
) -> None:
    with pytest.raises(ValueError, match=match):
        model_stack(specs, CH, graded)


def test_a_slab_model_still_needs_every_layer_sld() -> None:
    specs = [s for s in BASE if not s["name"].startswith("L1.knot")]
    with pytest.raises(ValueError, match="no L1.sld"):
        model_stack(specs, CH, [])


# ── the round trip ──────────────────────────────────────────────────────────


def test_fit_recovers_the_knots_of_a_synthetic_graded_profile() -> None:
    start = [k * f for k, f in zip(TRUE_KNOTS, (1.2, 0.85, 1.15, 0.8), strict=True)]
    out = fit_reflectivity(graded_model(start, 108.0, free=True), [synthetic_channel()],
                           graded=GRADED)
    assert out["success"], out["message"]
    p = by_name(out)
    # Measured 2026-10-01 over noise seeds 1-10: every knot within 0.73 % of
    # the truth (3.5 sigma at worst), thickness within 0.06 Å; seed 7 here.
    for j, k in enumerate(TRUE_KNOTS):
        knot = p[knot_param_name(1, j)]
        assert knot["value"] == pytest.approx(k, rel=0.01)
        assert knot["stderr"] is not None
        assert abs(knot["value"] - k) < 4 * knot["stderr"]
    assert p["L1.thickness"]["value"] == pytest.approx(TRUE_T, abs=0.5)
    assert out["reduced_chi2"] == pytest.approx(1.0, abs=0.25)
    assert out["free"][:4] == [knot_param_name(1, j) for j in range(4)]
    # The SLD profile is the graded one: it passes through the knots' range.
    prof = np.asarray(out["sld_profiles"][0]["sld"])
    assert prof.max() == pytest.approx(6.0e-6, rel=0.05)


def test_model_curves_take_graded_layers() -> None:
    q = list(np.linspace(0.01, 0.2, 50))
    (r,) = model_curves(graded_model(TRUE_KNOTS, TRUE_T), q, [None], graded=GRADED)
    expected = parratt_refl(np.asarray(q), manual_stack(TRUE_KNOTS, TRUE_T), background=1e-7)
    assert_allclose(r, expected, rtol=1e-12)


# ── the DREAM/bumps path ────────────────────────────────────────────────────


def test_dream_samples_the_knots_about_the_fit() -> None:
    chans = [synthetic_channel()]
    specs = graded_model(TRUE_KNOTS, TRUE_T, free=True)
    fit = fit_reflectivity(specs, chans, graded=GRADED)
    centre = {p["name"]: p["value"] for p in fit["parameters"] if p["vary"]}
    kw: dict[str, Any] = {"centre": centre, "samples": 500, "burn": 20, "pop": 2,
                          "band_draws": 20, "graded": GRADED}
    assert plan_sampling(specs, chans, **kw)["n_free"] == 5
    out = sample_reflectivity(specs, chans, seed=3, **kw)
    post = by_name(out)
    assert out["free"] == fit["free"]
    for j, k in enumerate(TRUE_KNOTS):
        lo, hi = post[knot_param_name(1, j)]["interval95"]
        assert lo < centre[knot_param_name(1, j)] < hi
        assert hi - lo < 0.05 * k
    # The SLD bands are of the graded profile, not a flat slab.
    assert max(out["sld_bands"][0]["median"]) == pytest.approx(6.0e-6, rel=0.05)
    with pytest.raises(ValueError, match="belongs to no graded layer"):
        plan_sampling(specs, chans, **{**kw, "graded": []})
