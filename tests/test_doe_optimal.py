"""D-optimal designs (calc/doe_optimal.py). Oracles: Hadamard's inequality
(det(X'X) <= N**p for entries in [-1, 1], equality for an orthogonal +-1 design)
so the main-effects design of k two-level factors in N = 2**k runs must reach
D-efficiency 100 % (it IS the full factorial); and BRUTE-FORCE enumeration of
every N-run multiset of a tiny candidate set, whose optimum the exchange result
must match. No outside software numbers are used."""

from __future__ import annotations

from itertools import combinations_with_replacement

import numpy as np
import pytest

from quantized.calc.doe_optimal import (
    OptFactor,
    candidate_grid,
    candidates_from_rows,
    d_optimal,
    model_matrix,
    model_terms,
)
from quantized.calc.doe_sheet import FactorSetting, build_worksheet


def _facs(k: int) -> list[OptFactor]:
    return [OptFactor(chr(65 + i)) for i in range(k)]


@pytest.mark.parametrize("method", ["coordinate", "fedorov"])
@pytest.mark.parametrize("k", [2, 3, 4, 5])
def test_main_effects_in_2k_runs_reaches_full_factorial_efficiency(k: int, method: str) -> None:
    r = d_optimal(_facs(k), "main", 2**k, method)
    assert r.d_efficiency == pytest.approx(100.0, abs=1e-8)
    assert r.n_params == k + 1
    x = model_matrix(r.design.coded, _facs(k), r.design.terms)
    assert np.allclose(x.T @ x, 2**k * np.eye(k + 1))  # orthogonal: det = N**p exactly
    # optimal, not unique: any orthogonal +-1 design (e.g. a Hadamard one) attains it, so
    # the corners need not each appear once.
    assert set(np.unique(r.design.coded)) == {-1.0, 1.0}


def test_hadamard_bound_holds_for_any_main_effects_design() -> None:
    rng = np.random.default_rng(1)
    f = _facs(3)
    t = model_terms(3, f, "main")
    for _ in range(50):
        d = rng.choice([-1.0, 0.0, 1.0], size=(8, 3))
        x = model_matrix(d, f, t)
        assert np.linalg.det(x.T @ x) <= 8**4 + 1e-6


def _brute_force(
    cand: np.ndarray, f: list[OptFactor], model: str, n: int
) -> tuple[float, np.ndarray]:
    t = model_terms(len(f), f, model)
    xc = model_matrix(cand, f, t)
    best = -np.inf
    arg = None
    for combo in combinations_with_replacement(range(len(cand)), n):
        x = xc[list(combo)]
        s, ld = np.linalg.slogdet(x.T @ x)
        if s > 0 and ld > best + 1e-12:
            best, arg = float(ld), np.array(combo)
    assert arg is not None
    return best, arg


@pytest.mark.parametrize(
    ("model", "n", "levels"),
    [
        ("main", 5, 3),
        ("interaction", 4, 3),
        ("interaction", 6, 3),
        ("quadratic", 6, 3),
        ("quadratic", 8, 3),
    ],
)
def test_exchange_matches_exhaustive_search_on_a_tiny_candidate_set(
    model: str, n: int, levels: int
) -> None:
    f = _facs(2)
    cand = candidate_grid(f, levels)  # 3 x 3 = 9 candidate points
    best_ld, _ = _brute_force(cand, f, model, n)
    for method, kw in (("fedorov", {"candidates": cand}), ("coordinate", {})):
        r = d_optimal(f, model, n, method, grid_levels=levels, starts=25, seed=3, **kw)  # type: ignore[arg-type]
        assert r.log_det == pytest.approx(best_ld, abs=1e-9), method


def test_exhaustive_match_with_a_categorical_factor_and_user_candidates() -> None:
    f = [OptFactor("T", 10.0, 30.0), OptFactor("Cat", levels=("a", "b", "c"))]
    rows: list[list[float | str]] = [[t, c] for t in (10.0, 20.0, 30.0) for c in ("a", "b", "c")]
    cand = candidates_from_rows(f, rows)
    assert cand.shape == (9, 2) and set(cand[:, 0]) == {-1.0, 0.0, 1.0}
    best_ld, _ = _brute_force(cand, f, "interaction", 7)
    r = d_optimal(f, "interaction", 7, "fedorov", cand, starts=25, seed=2)
    assert r.log_det == pytest.approx(best_ld, abs=1e-9)
    coord = d_optimal(f, "interaction", 7, "coordinate", grid_levels=3, starts=25, seed=2)
    assert coord.log_det == pytest.approx(best_ld, abs=1e-9)


def test_efficiency_definition_and_fixed_seed() -> None:
    f = _facs(3)
    a = d_optimal(f, "quadratic", 12, seed=11)
    b = d_optimal(f, "quadratic", 12, seed=11)
    assert np.array_equal(a.design.coded, b.design.coded) and a.log_det == b.log_det
    x = model_matrix(a.design.coded, f, a.design.terms)
    sign, ld = np.linalg.slogdet(x.T @ x)
    assert sign > 0 and a.log_det == pytest.approx(ld)
    assert a.d_efficiency == pytest.approx(100 * np.exp(ld / a.n_params) / 12)
    assert a.n_params == 10 and a.design.n_params == 10 and a.design.d_efficiency == a.d_efficiency
    assert a.design.kind == "d_optimal" and a.design.n_runs == 12
    assert np.all(np.abs(a.design.coded) <= 1.0)


def test_quadratic_design_uses_interior_levels() -> None:
    r = d_optimal(_facs(2), "quadratic", 9, seed=0)  # 9 runs, p = 6: needs the centre level
    assert (r.design.coded == 0).any()


def test_categorical_effect_coding_and_param_count() -> None:
    f = [OptFactor("A"), OptFactor("C", levels=("x", "y", "z", "w"))]
    t = model_terms(2, f, "interaction")
    x = model_matrix(np.array([[1.0, 0], [1.0, 3]]), f, t)
    assert x.shape[1] == 1 + 1 + 3 + 3  # intercept, A, C(3), A*C(3)
    assert list(x[1, 2:5]) == [-1, -1, -1]  # last level coded -1 everywhere
    assert list(x[0, 2:5]) == [1, 0, 0]


@pytest.mark.parametrize(
    ("kw", "msg"),
    [
        ({"n_runs": 3}, "parameters"),  # p = 4 for main effects of 3
        ({"n_runs": 8, "model": "cubic"}, "unknown model"),
        ({"n_runs": 8, "method": "annealing"}, "unknown method"),
        ({"n_runs": 8, "starts": 0}, "starts"),
        ({"n_runs": 8, "seed": -1}, "seed"),
        ({"n_runs": 8, "grid_levels": 1}, "levels"),
        ({"n_runs": 12, "model": "quadratic", "grid_levels": 2}, "at least 3 levels"),
        ({"n_runs": 600}, "parameters"),
    ],
)
def test_refusals(kw: dict[str, object], msg: str) -> None:
    args: dict[str, object] = {"model": "main", **kw}
    with pytest.raises(ValueError, match=msg):
        d_optimal(_facs(3), args.pop("model"), args.pop("n_runs"), **args)  # type: ignore[arg-type]


def test_candidate_set_refusals() -> None:
    f = [OptFactor("T", 0.0, 10.0), OptFactor("C", levels=("a", "b"))]
    with pytest.raises(ValueError, match="outside"):
        candidates_from_rows(f, [[11.0, "a"]])
    with pytest.raises(ValueError, match="not a level"):
        candidates_from_rows(f, [[1.0, "q"]])
    with pytest.raises(ValueError, match="values for 2"):
        candidates_from_rows(f, [[1.0]])
    with pytest.raises(ValueError, match="empty"):
        candidates_from_rows(f, [])
    with pytest.raises(ValueError, match="rank-deficient"):
        d_optimal(f, "interaction", 6, "fedorov", candidates_from_rows(f, [[0.0, "a"], [5.0, "b"]]))
    with pytest.raises(ValueError, match="does not use a candidate set"):
        d_optimal(f, "main", 4, "coordinate", candidates_from_rows(f, [[0.0, "a"]]))
    with pytest.raises(ValueError, match="grid has"):
        candidate_grid(_facs(8), 9)


def test_design_goes_through_the_worksheet_path() -> None:
    f = [OptFactor("Temp", 100, 200), OptFactor("Mode", levels=("slow", "fast"))]
    r = d_optimal(f, "interaction", 6, seed=5)
    settings = [
        FactorSetting("Temp", 100, 200, "C"),
        FactorSetting("Mode", levels=("slow", "fast")),
    ]
    ds = build_worksheet(r.design, settings, "Y", randomize=True, seed=1)
    labels = list(ds.labels)
    assert labels == ["StdOrder", "PointType", "Temp (coded)", "Mode (coded)", "Temp", "Mode", "Y"]
    assert ds.cat_levels[5] == ("slow", "fast")
    temp = ds.values[:, labels.index("Temp")]
    assert set(np.unique(temp)) <= {100.0, 200.0}  # actual units from the coded +-1
    meta = ds.metadata["doe"]
    assert meta["kind"] == "d_optimal" and meta["d_efficiency"] == pytest.approx(r.d_efficiency)
    assert meta["factors"][1]["levels"] == ["slow", "fast"]
    assert meta["terms_coded"][1] == [
        "Mode"
    ]  # categorical factors are analysed by their own column
    assert meta["error_df"] == 6 - 4  # p = 1 + 1 + 1 + 1
