"""Map-correlation options (no mean subtraction, local normalisation) and the
solver extras (systems of equations, constrained minimisation).

Every number is checked against an independent computation: a brute-force numpy
loop for the correlation, known roots / optima and scipy for the solver.
"""

from __future__ import annotations

import numpy as np
import pytest
from scipy.optimize import minimize

from quantized.calc.map_correlate import correlate_maps
from quantized.calc.map_ops import MapGrid
from quantized.calc.math_constrained import minimize_constrained
from quantized.calc.math_relations import split_relation
from quantized.calc.math_system import solve_system


def grid(z: np.ndarray) -> MapGrid:
    x = np.arange(z.shape[1], dtype=float)
    y = np.arange(z.shape[0], dtype=float)
    return MapGrid(
        x=x, y=y, z=z, x_label="x", x_unit="", y_label="y", y_unit="", z_unit="", metadata={}
    )


def brute(a: np.ndarray, b: np.ndarray, *, centre: bool, min_cells: int) -> np.ndarray:
    """Per-offset correlation over the cells valid in both maps, written as loops."""
    ny, nx = a.shape[0] + b.shape[0] - 1, a.shape[1] + b.shape[1] - 1
    out = np.full((ny, nx), np.nan)
    for j in range(ny):
        for i in range(nx):
            ly, lx = j - (b.shape[0] - 1), i - (b.shape[1] - 1)
            u, v = [], []
            for r in range(a.shape[0]):
                for c in range(a.shape[1]):
                    rb, cb = r - ly, c - lx
                    if 0 <= rb < b.shape[0] and 0 <= cb < b.shape[1]:
                        if np.isfinite(a[r, c]) and np.isfinite(b[rb, cb]):
                            u.append(a[r, c])
                            v.append(b[rb, cb])
            if len(u) < min_cells:
                continue
            u, v = np.array(u), np.array(v)
            if centre:
                u, v = u - u.mean(), v - v.mean()
            den = np.sqrt((u * u).sum() * (v * v).sum())
            if den > 1e-12:
                out[j, i] = (u * v).sum() / den
    return out


def maps() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(3)
    a = rng.normal(size=(7, 9)) + 2.0
    b = rng.normal(size=(5, 6)) + 1.0
    a[2, 3] = np.nan
    a[5, 7] = np.nan
    b[1, 1] = np.nan
    return a, b


def test_default_is_unchanged_mean_subtracted_global() -> None:
    a, b = maps()
    a[np.isnan(a)] = 1.0
    b[np.isnan(b)] = 1.0
    out, _ = correlate_maps(grid(a), grid(b))
    ac, bc = a - a.mean(), b - b.mean()
    from scipy.signal import correlate

    expect = correlate(ac, bc, mode="full", method="direct") / np.sqrt(
        (ac**2).sum() * (bc**2).sum()
    )
    np.testing.assert_allclose(out.z, expect, atol=1e-12)


def test_no_mean_subtraction_is_the_plain_correlation_over_the_norms() -> None:
    a, b = maps()
    a[np.isnan(a)] = 1.0
    b[np.isnan(b)] = 1.0
    out, _ = correlate_maps(grid(a), grid(b), subtract_means=False)
    from scipy.signal import correlate

    expect = correlate(a, b, mode="full", method="direct") / np.sqrt((a**2).sum() * (b**2).sum())
    np.testing.assert_allclose(out.z, expect, atol=1e-12)
    centred, _ = correlate_maps(grid(a), grid(b))
    assert out.z.max() > 2 * centred.z.max()  # the shared offset dominates when not removed


@pytest.mark.parametrize("centre", [True, False])
def test_local_normalisation_matches_brute_force_with_blank_cells(centre: bool) -> None:
    a, b = maps()
    n_valid = min(np.isfinite(a).sum(), np.isfinite(b).sum())
    min_cells = int(np.ceil(0.3 * n_valid))
    out, peak = correlate_maps(
        grid(a), grid(b), normalize="local", subtract_means=centre, min_overlap=0.3
    )
    expect = brute(a, b, centre=centre, min_cells=max(2, min_cells))
    np.testing.assert_array_equal(np.isnan(out.z), np.isnan(expect))
    np.testing.assert_allclose(out.z, expect, atol=1e-9)
    j, i = np.unravel_index(np.nanargmax(expect), expect.shape)
    assert (peak.lag_x, peak.lag_y) == (i - (b.shape[1] - 1), j - (b.shape[0] - 1))
    assert peak.value == pytest.approx(float(np.nanmax(expect)), abs=1e-9)
    assert peak.blank_cells == 3


def test_local_normalisation_removes_the_edge_bias_of_the_global_form() -> None:
    """A pattern cut by a shift: the global form lowers the peak, the local one
    recovers a perfect match over the overlap."""
    rng = np.random.default_rng(5)
    big = rng.normal(size=(20, 30))
    a, b = big[:, 4:24], big[:, 0:20]  # b's content sits 4 columns to the right of a's
    _, g = correlate_maps(grid(a), grid(b))
    _, loc = correlate_maps(grid(a), grid(b), normalize="local", min_overlap=0.5)
    assert loc.value == pytest.approx(1.0, abs=1e-9)
    assert g.value < 0.9
    assert (loc.lag_x, loc.lag_y) == (-4, 0)


def test_correlation_option_refusals() -> None:
    a, b = maps()
    with pytest.raises(ValueError, match="blank"):
        correlate_maps(grid(a), grid(b))  # global still refuses blanks
    with pytest.raises(ValueError, match="min_overlap"):
        correlate_maps(grid(a), grid(b), normalize="local", min_overlap=0.0)
    with pytest.raises(ValueError, match="normalize"):
        correlate_maps(grid(a), grid(b), normalize="window")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="no offset"):
        correlate_maps(grid(np.ones((5, 5))), grid(b[:, :5]), normalize="local")


# ---- relations -------------------------------------------------------------


def test_relation_split_respects_parentheses_and_operators() -> None:
    r = split_relation("if(x < 1, 2, 3) + y <= 4")
    assert (r.op, r.lhs, r.rhs) == ("<=", "if(x < 1, 2, 3) + y", "4")
    assert split_relation("x^2 == 4").op == "="
    assert split_relation("x + 1").rhs == "0"
    for bad in ("x < 1", "x != 1", "x = y = 1", "= 3", "x ="):
        with pytest.raises(ValueError):
            split_relation(bad)
    with pytest.raises(ValueError, match="not allowed"):
        split_relation("x <= 1", allow=("=",))


# ---- systems of equations --------------------------------------------------


def test_nonlinear_2x2_system_known_root() -> None:
    # x^2 + y^2 = 4, y = x: x = y = sqrt(2) from a start in the first quadrant.
    r = solve_system(["x^2 + y^2 = 4", "y = x"], {"x": 1.0, "y": 0.5})
    assert r.converged
    assert r.point == pytest.approx([np.sqrt(2), np.sqrt(2)], abs=1e-9)
    assert r.residual_norm < 1e-10
    assert r.variables == ["x", "y"]


def test_system_3x3_with_constants_and_function() -> None:
    # u + v + w = 6, u*v = k*w - 4, k = 2 (u=1,v=2,w=3), exp(u-1) = w - 2 (u = 1)
    r = solve_system(
        ["u + v + w = 6", "u*v = k*w - 4", "exp(u - 1) = w - 2"],
        {"u": 1.2, "v": 1.8, "w": 3.1},
        {"k": 2},
    )
    assert r.converged
    assert r.point == pytest.approx([1.0, 2.0, 3.0], abs=1e-8)


def test_system_matches_scipy_and_reports_each_residual() -> None:
    from scipy.optimize import root

    sol = root(lambda v: [v[0] ** 2 + v[1] - 3, v[0] - v[1] ** 2 + 1], [1.0, 1.0])
    r = solve_system(["x^2 + y - 3", "x - y^2 + 1"], {"x": 1.0, "y": 1.0}, method="lm")
    assert r.point == pytest.approx(list(sol.x), abs=1e-8)
    assert len(r.residuals) == 2 and r.method == "lm"


def test_system_without_a_root_says_it_did_not_converge() -> None:
    r = solve_system(["x^2 + y^2 = -1", "x = y"], {"x": 1.0, "y": 1.0})
    assert not r.converged
    assert r.residual_norm > 0.5
    assert r.message


def test_rank_deficient_system_warns_that_the_solution_is_not_unique() -> None:
    # x + y = 3 and 2x + 2y = 6 are one equation: the solver lands on a point of the line
    # and the Jacobian [[1, 1], [2, 2]] has rank 1.
    r = solve_system(["x + y = 3", "2*x + 2*y = 6"], {"x": 1.0, "y": 1.0})
    assert r.converged
    assert r.point[0] + r.point[1] == pytest.approx(3.0, abs=1e-9)
    assert len(r.warnings) == 1 and "not unique" in r.warnings[0] and "rank 1 of 2" in r.warnings[0]
    # an independent system carries no warning
    ok = solve_system(["x + y = 3", "x - y = 1"], {"x": 0.0, "y": 0.0})
    assert ok.point == pytest.approx([2.0, 1.0], abs=1e-9) and ok.warnings == []


def test_system_refusals() -> None:
    with pytest.raises(ValueError, match="2 equation.*3 unknown"):
        solve_system(["x + y = 1", "x*z = 2"], {"x": 1, "y": 1, "z": 1})
    with pytest.raises(ValueError, match="starting value for: y"):
        solve_system(["x + y = 1", "x - y = 0"], {"x": 1})
    with pytest.raises(ValueError, match="not an unknown"):
        solve_system(["x = 1"], {"x": 0, "q": 1})
    with pytest.raises(ValueError, match="at least one"):
        solve_system([" "], {})
    with pytest.raises(ValueError, match="not allowed"):
        solve_system(["x <= 1"], {"x": 0})
    with pytest.raises(ValueError, match="x \\+"):
        solve_system(["x +"], {"x": 0})


# ---- constrained minimisation ----------------------------------------------


@pytest.mark.parametrize("method", ["SLSQP", "trust-constr"])
def test_a_bound_the_solver_stops_just_short_of_is_still_reported(method: str) -> None:
    # min x^2 + y^2 s.t. x + y >= 1, 0 <= x <= 0.4: the unconstrained line optimum (0.5, 0.5) is out
    # of the box, so the answer is (0.4, 0.6) with value 0.52. trust-constr stops ~1e-4 short.
    r = minimize_constrained(
        "x^2 + y^2", ["x + y >= 1"], bounds={"x": (0, 0.4), "y": (-5, 5)},
        guess={"x": 0.2, "y": 0.8}, method=method,  # type: ignore[arg-type]
    )
    assert r.point == pytest.approx([0.4, 0.6], abs=1e-3)
    assert r.value == pytest.approx(0.52, abs=1e-3)
    assert r.at_bound == ["x"]
    assert r.constraints[0].active


def test_a_point_well_inside_a_bound_is_not_reported_on_it() -> None:
    r = minimize_constrained("(x-1)^2", [], bounds={"x": (0, 4)}, guess={"x": 3.0})
    assert r.point == pytest.approx([1.0], abs=1e-6) and r.at_bound == []


@pytest.mark.parametrize("method", ["SLSQP", "trust-constr"])
def test_inequality_constraint_active_at_known_optimum(method: str) -> None:
    # min (x-2)^2 + (y-2)^2 s.t. x + y <= 2 -> (1, 1), value 2, constraint binding.
    r = minimize_constrained(
        "(x-2)^2 + (y-2)^2",
        ["x + y <= 2", "x >= 0.5"],
        guess={"x": 0, "y": 0},
        method=method,  # type: ignore[arg-type]
    )
    assert r.converged and r.feasible
    assert r.point == pytest.approx([1.0, 1.0], abs=1e-3)
    assert r.value == pytest.approx(2.0, abs=1e-3)
    sum_c, x_c = r.constraints
    assert sum_c.active and not x_c.active
    assert sum_c.slack == pytest.approx(0.0, abs=1e-3)
    assert x_c.slack == pytest.approx(0.5, abs=1e-2)


@pytest.mark.parametrize("method", ["SLSQP", "trust-constr"])
def test_equality_constraint_maximum_matches_scipy(method: str) -> None:
    # max x*y on the circle x^2 + y^2 = 2: value 1 at (1, 1) or (-1, -1).
    r = minimize_constrained(
        "x*y",
        ["x^2 + y^2 = 2"],
        guess={"x": 0.5, "y": 1.2},
        sense="max",
        method=method,  # type: ignore[arg-type]
    )
    ref = minimize(
        lambda v: -v[0] * v[1],
        [0.5, 1.2],
        method="SLSQP",
        constraints=[{"type": "eq", "fun": lambda v: v[0] ** 2 + v[1] ** 2 - 2}],
    )
    assert r.value == pytest.approx(-ref.fun, abs=1e-6)
    assert r.value == pytest.approx(1.0, abs=1e-5)
    assert r.constraints[0].kind == "eq" and r.constraints[0].active


def test_bounds_and_constraints_together_report_both() -> None:
    # min x + y s.t. x*y >= 4, 0.5 <= x <= 10, 0.5 <= y <= 10 -> (2, 2).
    r = minimize_constrained(
        "x + y", ["x*y >= 4"], bounds={"x": (0.5, 10), "y": (0.5, 10)}, starts=4
    )
    assert r.point == pytest.approx([2.0, 2.0], abs=1e-4)
    assert r.constraints[0].active and r.at_bound == []
    lo = minimize_constrained("x", [], bounds={"x": (1, 3)})
    assert lo.at_bound == ["x"] and lo.point[0] == pytest.approx(1.0)


def test_infeasible_is_not_reported_as_converged() -> None:
    r = minimize_constrained("x", ["x >= 5", "x <= 1"], guess={"x": 2.0})
    assert not r.feasible and not r.converged
    assert r.max_violation > 1.0
    assert not all(c.satisfied for c in r.constraints)


def test_constrained_refusals() -> None:
    with pytest.raises(ValueError, match="starting value for x"):
        minimize_constrained("x^2", ["x >= 1"])
    with pytest.raises(ValueError, match="finite bounds"):
        minimize_constrained("x^2", [], guess={"x": 1}, starts=3)
    with pytest.raises(ValueError, match="no unknown named"):
        minimize_constrained("x^2", [], guess={"x": 1, "q": 2})
    with pytest.raises(ValueError, match="a value, not a relation"):
        minimize_constrained("x <= 2", [], guess={"x": 1})
    with pytest.raises(ValueError, match="method"):
        minimize_constrained("x", [], guess={"x": 1}, method="cobyla")  # type: ignore[arg-type]
