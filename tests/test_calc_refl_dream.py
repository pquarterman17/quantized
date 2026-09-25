"""sample_reflectivity: a DREAM posterior for a reflectivity fit (calc/refl_dream.py).

New capability with no MATLAB counterpart, so no golden parity: verified
against the committed XRR fixture's known truth and its least-squares fit,
against a deliberately degenerate model, and by invariants (determinism under
a seed, the deadline, cancellation, ties, bands, validation).

Measured 2026-09-24, and the source of every tolerance below:

* The CI run (seed 1, 18 chains, 100 burn-in + 100 kept generations, ~13 s)
  is short and not converged (R-hat 1.3-1.5); over seeds 1-8 its 95% widths
  were 0.80-1.27x the least-squares 2 x 1.96 sigma, and the truth sat
  0.01-0.89 half-widths from the median for L1.thickness / L1.sld and
  0.81-1.36 for L2.thickness / L2.sld.
* A converged run (27 chains, 300 + 1000 generations, R-hat <= 1.04, 118 s)
  gave widths 0.93-1.04x least squares, and truth inside the 95% interval for
  L1.thickness, L1.sld and L2.thickness; L2.sld's truth sits 1.013 upper
  half-widths out. That is this noise realization, not the sampler: the
  least-squares fit puts it 1.96 sigma out too.
* Coverage over 20 fresh realizations of the fixture's generator (18 chains,
  150 + 200 generations each): the truth fell inside the 95% interval in
  77/80 thickness/SLD cases (least squares: 77/80) and inside the 68%
  interval in 51/80; widths 0.80-1.26x least squares.
"""

from __future__ import annotations

import sys
from typing import Any

import numpy as np
import pytest

from quantized.calc import dream_seed, refl_dream
from quantized.calc.refl_dream import RHAT_FLAG, plan_sampling, sample_reflectivity
from quantized.calc.refl_fit import fit_reflectivity
from quantized.calc.reflectivity import parratt_refl

# The fixture, its starting model and its truth, exactly as slice 1 fits them
# (pytest puts tests/ on the path; tests/ has no __init__).
from test_calc_refl_fit import TRUTH, bilayer, xrr_channel


def by_name(out: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in out["parameters"]}


def test_the_xrr_fixture_posterior_against_least_squares_and_the_truth() -> None:
    """ONE seeded run (~13 s) checked several ways: a module fixture would be
    re-run by every xdist worker that picks up one of its tests."""
    fit = fit_reflectivity(bilayer(), [xrr_channel()])
    centre = {p["name"]: p["value"] for p in fit["parameters"] if p["vary"]}
    post = sample_reflectivity(
        bilayer(), [xrr_channel()], centre=centre, samples=1800, burn=100, pop=2, seed=1,
    )
    check_intervals_against_least_squares(fit, post)
    check_truth(post)
    check_run_report(fit, post)
    check_bands(fit, post)


def check_intervals_against_least_squares(fit: dict[str, Any], post: dict[str, Any]) -> None:
    ls, p = by_name(fit), by_name(post)
    assert sorted(p) == sorted(fit["free"])
    for name in fit["free"]:
        lo, hi = p[name]["interval95"]
        ratio = (hi - lo) / (2 * 1.96 * ls[name]["stderr"])
        assert 0.5 < ratio < 2.0, (name, ratio)  # measured 0.80-1.27 over 8 seeds
        lo68, hi68 = p[name]["interval68"]
        assert lo <= lo68 <= p[name]["median"] <= hi68 <= hi


def check_truth(post: dict[str, Any]) -> None:
    p = by_name(post)
    for name in ("L1.thickness", "L1.sld"):
        lo, hi = p[name]["interval95"]
        assert lo <= TRUTH[name] <= hi, name
    # L2's truths sit at this realization's 95% edge (least squares: 1.7 and
    # 1.96 sigma); a short run puts them 0.81-1.36 half-widths out, so assert
    # that measured band, not a containment the data do not support.
    for name in ("L2.thickness", "L2.sld"):
        med = p[name]["median"]
        lo, hi = p[name]["interval95"]
        half = hi - med if TRUTH[name] > med else med - lo
        assert abs(TRUTH[name] - med) <= 1.5 * half, name


def check_run_report(fit: dict[str, Any], post: dict[str, Any]) -> None:
    c = post["convergence"]
    assert c["n_chains"] == 18 and c["n_generations"] == 200 and c["n_draws"] == 1800
    assert c["burn"] == 100 and c["thin"] == 1 and c["stopped"] == "completed"
    assert c["reproducible"] is True and c["seed"] == 1
    assert c["n_evaluations"] >= c["n_generations"] * c["n_chains"]
    rhat = [x["rhat"] for x in post["parameters"]]
    assert c["rhat_max"] == max(rhat)
    assert c["flagged"] == [x["name"] for x in post["parameters"] if x["rhat"] > RHAT_FLAG]
    assert c["converged"] is (not c["flagged"])
    # the best draw is near, and never better than, the least-squares optimum
    assert fit["chi2"] * (1 - 1e-6) <= post["map_chi2"] < fit["chi2"] + 5.0
    corr = np.array(post["correlation"], dtype=float)
    assert corr.shape == (len(fit["free"]),) * 2
    np.testing.assert_allclose(corr, corr.T, atol=1e-12)
    np.testing.assert_allclose(np.diag(corr), 1.0, atol=1e-9)
    # a well-determined background far from its wide [0, 1e-5] bound is not
    # "limited by the bound"
    assert not by_name(post)["background"]["at_bound"]


def check_bands(fit: dict[str, Any], post: dict[str, Any]) -> None:
    (band,) = post["r_bands"]
    n = len(fit["curves"][0]["q"])
    keys = ("lo95", "lo68", "median", "hi68", "hi95")
    rows = np.array([band[k] for k in keys])
    assert rows.shape == (5, n) and band["q"] == fit["curves"][0]["q"]
    assert np.all(np.diff(rows, axis=0) >= 0)
    # the band brackets the least-squares model almost everywhere
    model = np.array(fit["curves"][0]["model"])
    assert np.mean((rows[0] <= model) & (model <= rows[4])) > 0.9
    (sld,) = post["sld_bands"]
    assert sld["spin"] is None
    s = np.array([sld[k] for k in keys])
    assert np.all(np.diff(s, axis=0) >= 0) and s.shape[1] == len(sld["z"])
    # ambient to substrate: the band runs 0 (air) to Si's 2.07e-6
    assert abs(s[2][0]) < 1e-8 and s[2][-1] == pytest.approx(2.07e-6, rel=1e-3)


# ── a model the data cannot determine ────────────────────────────────────────


def degenerate() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Two adjacent layers of the SAME material: only their summed thickness
    reaches the data, so each thickness alone is undetermined."""
    q = np.linspace(0.01, 0.2, 200)
    engine = [[0, 0, 0, 0], [200.0, 4e-6, 0, 3.0], [100.0, 4e-6, 0, 3.0], [0, 2.07e-6, 0, 3.0]]
    r0 = parratt_refl(q, engine)
    dr = 0.02 * r0
    r = r0 + dr * np.random.default_rng(5).standard_normal(q.size)
    params = [
        {"name": "L0.sld", "value": 0.0},
        {"name": "L1.thickness", "value": 190.0, "vary": True, "min": 150.0, "max": 250.0},
        {"name": "L1.sld", "value": 4e-6},
        {"name": "L1.roughness", "value": 3.0},
        {"name": "L2.thickness", "value": 110.0, "vary": True, "min": 50.0, "max": 150.0},
        {"name": "L2.sld", "value": 4e-6},
        {"name": "L2.roughness", "value": 3.0},
        {"name": "L3.sld", "value": 2.07e-6},
        {"name": "L3.roughness", "value": 3.0},
    ]
    return params, [{"q": q, "r": r, "dr": dr}]


def test_a_degenerate_pair_gets_wide_bound_limited_intervals() -> None:
    params, chans = degenerate()
    fit = fit_reflectivity(params, chans)
    assert all(p["stderr"] is None for p in fit["parameters"] if p["vary"])  # LS gives up
    out = sample_reflectivity(params, chans, samples=600, burn=50, pop=5, seed=1)
    p = by_name(out)
    for name in ("L1.thickness", "L2.thickness"):
        lo, hi = p[name]["interval95"]
        assert hi - lo > 80.0, name  # measured 85-97 of the 100 A span over seeds 1-10
        assert p[name]["at_bound"], name
    assert out["correlation"][0][1] < -0.99  # measured -0.9999998: only the sum is seen
    assert any("bound" in w and "L1.thickness" in w for w in out["warnings"])


def test_a_seed_reproduces_a_run_exactly_and_restores_bumps() -> None:
    import bumps.dream.core as core
    import bumps.dream.diffev as diffev

    before = (core.rng, diffev.rng, diffev.pchoice)
    params, chans = degenerate()
    a = sample_reflectivity(params, chans, samples=300, burn=20, pop=5, seed=7, band_draws=20)
    b = sample_reflectivity(params, chans, samples=300, burn=20, pop=5, seed=7, band_draws=20)
    c = sample_reflectivity(params, chans, samples=300, burn=20, pop=5, seed=8, band_draws=20)
    assert a == b
    assert a["parameters"] != c["parameters"]
    assert (core.rng, diffev.rng, diffev.pchoice) == before


def test_the_seeded_stream_is_restored_when_the_body_raises() -> None:
    import bumps.dream.util as util

    before = util.rng
    with pytest.raises(RuntimeError), dream_seed.seeded_dream(3):
        assert util.rng is not before
        raise RuntimeError("boom")
    assert util.rng is before


# ── bounded work ─────────────────────────────────────────────────────────────


class FakeClock:
    """``time.monotonic`` that ticks one second per call, so a deadline lands
    at an exact model evaluation (the sampler checks it before each one)."""

    def __init__(self) -> None:
        self.calls = 0

    def monotonic(self) -> float:
        self.calls += 1
        return float(self.calls)


def test_the_deadline_returns_a_flagged_partial_posterior(monkeypatch: pytest.MonkeyPatch) -> None:
    # Clock read 1 sets the deadline at 26.5; reads 2-4 are the start ball's
    # Jacobian, 5-14 the start population, 15-24 generation 1, 25 DREAM's own
    # end-of-generation check, 26-27 generation 2's first evaluations: the run
    # stops inside generation 2 with generations 0 and 1 recorded.
    clock = FakeClock()
    monkeypatch.setattr(refl_dream, "time", clock)
    params, chans = degenerate()
    out = sample_reflectivity(params, chans, samples=100_000, burn=50, pop=5, seed=1,
                              deadline_s=25.5, band_draws=10)
    c = out["convergence"]
    assert c["n_generations"] == 1
    assert c["stopped"] == "deadline" and c["converged"] is False
    assert c["n_generations"] < c["n_generations_requested"]
    assert any("time limit" in w for w in out["warnings"])
    assert any("burn-in" in w for w in out["warnings"])
    # too few generations for R-hat: said as such, not as "above 1.2"
    assert c["flagged"] == [] and c["unmeasured"] == ["L1.thickness", "L2.thickness"]
    assert any("could not be computed" in w for w in out["warnings"])
    assert all(p["rhat"] is None and p["rhat_flag"] for p in out["parameters"])
    assert len(out["parameters"]) == 2 and out["r_bands"]


def test_the_deadline_is_checked_before_every_evaluation_not_per_generation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The deadline passes during the start population (clock read 7): the run
    # stops there, before a single generation, and has nothing to report — it
    # must not present the start ball as a posterior.
    clock = FakeClock()
    monkeypatch.setattr(refl_dream, "time", clock)
    params, chans = degenerate()
    with pytest.raises(ValueError, match="time limit ran out before DREAM completed one"):
        sample_reflectivity(params, chans, samples=1000, burn=50, pop=5, seed=1, deadline_s=5.5)
    assert clock.calls == 7  # no evaluation ran after the deadline


def test_a_cancel_before_the_first_generation_raises_cancelled() -> None:
    params, chans = degenerate()
    calls = {"n": 0}

    def abort() -> bool:
        calls["n"] += 1
        return calls["n"] >= 3  # inside the start ball's Jacobian

    with pytest.raises(dream_seed.DreamCancelled, match="cancelled after 0 generations"):
        sample_reflectivity(params, chans, samples=1000, seed=1, abort_check=abort)
    assert calls["n"] == 3


def test_the_run_keeps_every_requested_generation_after_burn_in() -> None:
    # bumps counts the start population as n_chains draws; sized without it,
    # burn 21 + 10 kept generations ended at generation 30, keeping 9.
    params, chans = degenerate()
    out = sample_reflectivity(params, chans, samples=100, burn=21, pop=5, seed=1, band_draws=10)
    c = out["convergence"]
    assert c["n_kept_generations"] >= 10 and c["n_draws"] >= 100
    assert c["burn"] >= 21 and c["stopped"] == "completed"  # rounded up to whole blocks
    assert not any("burn-in" in w or "ended after" in w for w in out["warnings"])


def test_samples_too_few_for_the_minimum_kept_generations_are_refused() -> None:
    params, chans = degenerate()  # 2 free x pop 5 = 10 chains: at least 100 samples
    with pytest.raises(ValueError, match="samples \\(90\\) must be at least 100"):
        sample_reflectivity(params, chans, samples=90, burn=20, pop=5)
    with pytest.raises(ValueError, match="at least 10 generations are kept"):
        plan_sampling(params, chans, samples=10, burn=20, pop=5)


def test_a_cancel_mid_run_raises_cancelled_rather_than_returning() -> None:
    params, chans = degenerate()
    calls = {"n": 0}

    def abort() -> bool:
        calls["n"] += 1
        return calls["n"] > 60  # a few generations in

    with pytest.raises(dream_seed.DreamCancelled, match="cancelled after [1-9]"):
        sample_reflectivity(params, chans, samples=100_000, burn=10, pop=5, seed=1,
                            abort_check=abort, band_draws=10)


def test_progress_is_reported_and_may_cancel() -> None:
    params, chans = degenerate()
    seen: list[float] = []
    sample_reflectivity(params, chans, samples=200, burn=10, pop=5, seed=1, band_draws=20,
                        progress_callback=seen.append)
    assert seen and all(0 <= f < 1 for f in seen) and seen == sorted(seen)

    class Stop(Exception):
        pass

    def cancel(_f: float) -> None:
        raise Stop

    with pytest.raises(Stop):
        sample_reflectivity(params, chans, samples=200, burn=10, pop=5, seed=1,
                            progress_callback=cancel)


def test_plan_sizes_the_run_it_validates() -> None:
    params, chans = degenerate()
    plan = plan_sampling(params, chans, samples=600, burn=50, pop=5, band_draws=100)
    assert plan == {"n_free": 2, "n_chains": 10, "n_generations": 110,
                    "n_evaluations": 3 + (50 + 60 + 10) * 10 + 100}
    out = sample_reflectivity(params, chans, samples=600, burn=50, pop=5, seed=1, band_draws=100)
    assert out["convergence"]["n_evaluations"] <= plan["n_evaluations"]


def test_a_run_queued_behind_another_waits_cancellably_and_its_budget_starts_late() -> None:
    import threading

    params, chans = degenerate()
    held, release = threading.Event(), threading.Event()

    def other_run() -> None:
        with dream_seed.seeded_dream(None):
            held.set()
            release.wait(5)

    t = threading.Thread(target=other_run)
    t.start()
    held.wait(5)
    waits = {"n": 0}

    def progress(_f: float) -> None:
        waits["n"] += 1
        if waits["n"] == 4:  # ~1 s queued: longer than this run's whole budget
            release.set()

    out = sample_reflectivity(params, chans, samples=200, burn=10, pop=5, seed=1,
                              deadline_s=0.5, band_draws=10, progress_callback=progress)
    t.join()
    assert out["convergence"]["stopped"] == "completed"  # the wait did not spend the budget

    held.clear()
    release.clear()
    t = threading.Thread(target=other_run)
    t.start()
    held.wait(5)
    try:
        with pytest.raises(dream_seed.DreamCancelled):
            sample_reflectivity(params, chans, samples=200, seed=1, abort_check=lambda: True)
    finally:
        release.set()
        t.join()
    with dream_seed.seeded_dream(2):  # and nothing was left holding the sampler
        pass


# ── the model and the request ────────────────────────────────────────────────


def test_a_tied_parameter_reports_its_targets_posterior() -> None:
    params, chans = degenerate()
    params[4] = {"name": "L2.thickness", "value": 100.0, "tie": "L1.thickness"}
    params[1] = {**params[1], "value": 150.0, "min": 120.0, "max": 180.0}
    out = sample_reflectivity(params, chans, samples=400, burn=30, pop=5, seed=2, band_draws=20)
    p = by_name(out)
    assert out["free"] == ["L1.thickness"]
    assert p["L2.thickness"]["tie"] == "L1.thickness"
    assert p["L2.thickness"]["interval95"] == p["L1.thickness"]["interval95"]
    assert 148 < p["L1.thickness"]["median"] < 152  # 2 x 150 = the 300 A total


def test_the_centre_starts_the_population_and_is_checked() -> None:
    params, chans = degenerate()
    with pytest.raises(ValueError, match="outside"):
        sample_reflectivity(params, chans, centre={"L1.thickness": 400.0}, seed=1)
    out = sample_reflectivity(params, chans, centre={"L1.thickness": 200.0, "L2.sld": 1.0},
                              samples=200, burn=0, pop=5, seed=1, band_draws=10)
    assert out["convergence"]["burn"] == 0


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"weighting": "log"}, "DREAM needs dR weighting"),
        ({"samples": 0}, "samples must be"),
        ({"burn": -1}, "burn must be"),
        ({"pop": 1.5}, "pop must be"),
        ({"thin": 0}, "thin must be"),
    ],
)
def test_bad_requests_are_refused(kwargs: dict[str, Any], match: str) -> None:
    params, chans = degenerate()
    with pytest.raises(ValueError, match=match):
        sample_reflectivity(params, chans, **kwargs)
    with pytest.raises(ValueError, match=match):
        plan_sampling(params, chans, **kwargs)


def test_nothing_free_and_no_dr_are_refused() -> None:
    params, chans = degenerate()
    fixed = [{**p, "vary": False} for p in params]
    with pytest.raises(ValueError, match="no free parameters"):
        sample_reflectivity(fixed, chans)
    no_dr = [{"q": chans[0]["q"], "r": chans[0]["r"]}]
    with pytest.raises(ValueError, match="dR column"):
        sample_reflectivity(params, no_dr)


def test_missing_bumps_is_a_value_error_with_the_install_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for mod in ("bumps.dream.core", "bumps.dream.gelman"):
        monkeypatch.setitem(sys.modules, mod, None)
    params, chans = degenerate()
    with pytest.raises(ValueError, match=r"quantized\[bumps\]"):
        sample_reflectivity(params, chans)


def test_a_polarised_pair_gets_a_band_per_spin() -> None:
    q = np.linspace(0.01, 0.15, 120)
    up = [[0, 0, 0, 0], [150.0, 4.5e-6, 0, 3.0], [0, 2.07e-6, 0, 3.0]]
    dn = [[0, 0, 0, 0], [150.0, 3.5e-6, 0, 3.0], [0, 2.07e-6, 0, 3.0]]
    chans = []
    for spin, layers in (("+", up), ("-", dn)):
        r = parratt_refl(q, layers)
        chans.append({"q": q, "r": r, "dr": 0.02 * r, "spin": spin, "label": spin})
    params = [
        {"name": "L0.sld", "value": 0.0},
        {"name": "L1.thickness", "value": 150.0, "vary": True, "min": 120.0, "max": 180.0},
        {"name": "L1.sld", "value": 4e-6, "vary": True, "min": 3e-6, "max": 5e-6},
        {"name": "L1.msld", "value": 0.5e-6, "vary": True, "min": 0.0, "max": 1e-6},
        {"name": "L1.roughness", "value": 3.0},
        {"name": "L2.sld", "value": 2.07e-6},
        {"name": "L2.roughness", "value": 3.0},
    ]
    out = sample_reflectivity(params, chans, samples=300, burn=20, pop=4, seed=3, band_draws=30)
    assert [b["spin"] for b in out["r_bands"]] == ["+", "-"]
    assert sorted(str(b["spin"]) for b in out["sld_bands"]) == ["+", "-"]
    p = by_name(out)
    assert p["L1.msld"]["interval95"][0] < 0.5e-6 < p["L1.msld"]["interval95"][1]
