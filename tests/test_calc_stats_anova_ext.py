"""Extended ANOVA (calc.stats_anova_ext): repeated-measures + unbalanced.

Oracle strategy (no statsmodels dependency):

- Repeated-measures one-way ANOVA is algebraically a subjects x conditions
  two-way ANOVA with n=1 per cell, where the interaction becomes the error.
  The golden-verified closed form ``stats_anova2.anova2`` (validated against
  Montgomery's battery-life table) therefore gives the exact condition F/p.
- A model's residual SS is invariant to how the factors are coded, so the
  Error term, the interaction SS, and the Type II main-effect SS are
  recomputed here independently with plain dummy coding.
- On a balanced design every SS type equals the closed form; the unbalanced
  routine is fed the balanced Montgomery data to anchor on that equivalence.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.stats_anova2 import anova2
from quantized.calc.stats_anova_ext import (
    anova2_unbalanced,
    long_to_cells,
    long_to_groups,
    repeated_measures_anova,
)

# Montgomery battery-life data: materials (A=rows) x temperatures (B=cols), n=4
_BATTERY = [
    [[130, 155, 74, 180], [34, 40, 80, 75], [20, 70, 82, 58]],
    [[150, 188, 159, 126], [136, 122, 106, 115], [25, 70, 58, 45]],
    [[138, 110, 168, 160], [174, 120, 150, 139], [96, 104, 82, 60]],
]

# A small within-subjects matrix: 5 subjects x 3 conditions
_RM = np.array(
    [
        [10.0, 12.0, 15.0],
        [ 8.0, 11.0, 14.0],
        [ 9.0, 10.0, 13.0],
        [11.0, 13.0, 17.0],
        [ 7.0,  9.0, 12.0],
    ]
)


# --------------------------------------------------------------------------
# repeated-measures ANOVA
# --------------------------------------------------------------------------
def test_rm_anova_matches_twoway_n1_crosscheck() -> None:
    out = repeated_measures_anova(_RM)
    rows = {r["source"]: r for r in out["table"]}

    # Independent oracle: subjects x conditions two-way ANOVA with n=1.
    cells = [[[v] for v in row] for row in _RM.tolist()]  # A=subjects, B=conditions
    ref = anova2(cells)
    rref = {r["source"]: r for r in ref["table"]}

    assert math.isclose(rows["Subjects"]["SS"], rref["A"]["SS"], rel_tol=1e-12)
    assert math.isclose(rows["Conditions"]["SS"], rref["B"]["SS"], rel_tol=1e-12)
    assert math.isclose(rows["Error"]["SS"], rref["Error"]["SS"], rel_tol=1e-12)
    assert (rows["Conditions"]["df"], rows["Error"]["df"]) == (rref["B"]["df"], rref["Error"]["df"])
    assert math.isclose(rows["Conditions"]["F"], rref["B"]["F"], rel_tol=1e-10)
    assert math.isclose(rows["Conditions"]["p"], rref["B"]["p"], rel_tol=1e-9)


def test_rm_anova_ss_partition_closes() -> None:
    out = repeated_measures_anova(_RM)
    rows = {r["source"]: r for r in out["table"]}
    total = rows["Total"]["SS"]
    assert math.isclose(
        rows["Subjects"]["SS"] + rows["Conditions"]["SS"] + rows["Error"]["SS"],
        total, rel_tol=1e-12,
    )
    assert 0.0 <= out["partial_eta_sq"] <= 1.0


def test_rm_anova_two_conditions_sphericity_is_one() -> None:
    # With k=2 conditions sphericity is trivially satisfied -> epsilon == 1,
    # so corrected and uncorrected p must coincide.
    out = repeated_measures_anova(_RM[:, :2])
    sph = out["sphericity"]
    assert math.isclose(sph["greenhouse_geisser"], 1.0, abs_tol=1e-9)
    assert math.isclose(sph["huynh_feldt"], 1.0, abs_tol=1e-9)
    cond = next(r for r in out["table"] if r["source"] == "Conditions")
    assert math.isclose(sph["p_greenhouse_geisser"], cond["p"], rel_tol=1e-9)


def test_rm_anova_epsilon_bounds_and_p_ordering() -> None:
    out = repeated_measures_anova(_RM)
    k = out["n_conditions"]
    gg = out["sphericity"]["greenhouse_geisser"]
    assert 1.0 / (k - 1) - 1e-9 <= gg <= 1.0 + 1e-9
    # a smaller (GG) df can only raise (or hold) the p-value
    cond = next(r for r in out["table"] if r["source"] == "Conditions")
    assert out["sphericity"]["p_greenhouse_geisser"] >= cond["p"] - 1e-12


def test_rm_anova_rejects_bad_shape() -> None:
    with pytest.raises(ValueError, match="subjects x conditions"):
        repeated_measures_anova([[1.0, 2.0, 3.0]])  # only one subject
    with pytest.raises(ValueError, match="finite"):
        repeated_measures_anova([[1.0, np.nan], [3.0, 4.0]])


# --------------------------------------------------------------------------
# unbalanced two-way ANOVA
# --------------------------------------------------------------------------
def _battery_long() -> tuple[np.ndarray, list[str], list[str]]:
    vals, fa, fb = [], [], []
    for i, row in enumerate(_BATTERY):
        for j, cell in enumerate(row):
            for v in cell:
                vals.append(float(v))
                fa.append(f"mat{i}")
                fb.append(f"temp{j}")
    return np.array(vals), fa, fb


@pytest.mark.parametrize("ss_type", [2, 3])
def test_unbalanced_reduces_to_closed_form_on_balanced_data(ss_type: int) -> None:
    vals, fa, fb = _battery_long()
    out = anova2_unbalanced(vals, fa, fb, ss_type=ss_type)
    rows = {r["source"]: r for r in out["table"]}
    ref = {r["source"]: r for r in anova2(_BATTERY)["table"]}
    assert out["balanced"] is True
    for src in ("A", "B", "AxB", "Error"):
        assert math.isclose(rows[src]["SS"], ref[src]["SS"], rel_tol=1e-8), src
        assert rows[src]["df"] == ref[src]["df"], src
    for src in ("A", "B", "AxB"):
        assert math.isclose(rows[src]["F"], ref[src]["F"], rel_tol=1e-8), src
        assert math.isclose(rows[src]["p"], ref[src]["p"], rel_tol=1e-7), src


# An unbalanced 2 x 3 design; every cell populated, unequal counts.
_UNBAL_VALS = np.array([
    12.1, 13.4, 11.8,          # lo,x  (3)
    15.0, 14.2,                # lo,y  (2)
    9.6, 10.1, 8.9, 11.2,      # lo,z  (4)
    18.4, 17.1,                # hi,x  (2)
    21.0, 22.3, 20.1, 19.4, 23.0,  # hi,y (5)
    13.3, 12.0, 14.5,          # hi,z  (3)
])
_UNBAL_A = (["lo"] * 9) + (["hi"] * 10)
_UNBAL_B = (["x"] * 3 + ["y"] * 2 + ["z"] * 4) + (["x"] * 2 + ["y"] * 5 + ["z"] * 3)


def _dummy_sse(design: np.ndarray, y: np.ndarray) -> float:
    beta, *_ = np.linalg.lstsq(design, y, rcond=None)
    r = y - design @ beta
    return float(r @ r)


def _dummy_designs() -> dict[str, np.ndarray]:
    y = _UNBAL_VALS
    n = y.size
    a_hi = np.array([1.0 if a == "hi" else 0.0 for a in _UNBAL_A])
    b_y = np.array([1.0 if b == "y" else 0.0 for b in _UNBAL_B])
    b_z = np.array([1.0 if b == "z" else 0.0 for b in _UNBAL_B])
    one = np.ones(n)
    A = a_hi[:, None]
    B = np.column_stack([b_y, b_z])
    AB = np.column_stack([a_hi * b_y, a_hi * b_z])
    return {
        "full": np.column_stack([one, A, B, AB]),
        "main": np.column_stack([one, A, B]),
        "int_b": np.column_stack([one, B]),
        "int_a": np.column_stack([one, A]),
    }


def test_unbalanced_error_and_interaction_via_dummy_coding() -> None:
    # Error SS and interaction SS are coding-invariant -> independent check.
    d = _dummy_designs()
    y = _UNBAL_VALS
    sse_full = _dummy_sse(d["full"], y)
    ss_ab_ref = _dummy_sse(d["main"], y) - sse_full

    for ss_type in (2, 3):
        out = anova2_unbalanced(y, _UNBAL_A, _UNBAL_B, ss_type=ss_type)
        rows = {r["source"]: r for r in out["table"]}
        assert out["balanced"] is False
        assert rows["Error"]["df"] == y.size - 6
        assert math.isclose(rows["Error"]["SS"], sse_full, rel_tol=1e-9)
        assert math.isclose(rows["AxB"]["SS"], ss_ab_ref, rel_tol=1e-9)


def test_unbalanced_type2_main_effects_via_dummy_coding() -> None:
    d = _dummy_designs()
    y = _UNBAL_VALS
    sse_main = _dummy_sse(d["main"], y)
    ss_a_ref = _dummy_sse(d["int_b"], y) - sse_main   # SS(A | B)
    ss_b_ref = _dummy_sse(d["int_a"], y) - sse_main   # SS(B | A)

    out = anova2_unbalanced(y, _UNBAL_A, _UNBAL_B, ss_type=2)
    rows = {r["source"]: r for r in out["table"]}
    assert math.isclose(rows["A"]["SS"], ss_a_ref, rel_tol=1e-9)
    assert math.isclose(rows["B"]["SS"], ss_b_ref, rel_tol=1e-9)


def test_unbalanced_type2_and_type3_agree_on_interaction() -> None:
    y = _UNBAL_VALS
    t2 = {r["source"]: r for r in anova2_unbalanced(y, _UNBAL_A, _UNBAL_B, ss_type=2)["table"]}
    t3 = {r["source"]: r for r in anova2_unbalanced(y, _UNBAL_A, _UNBAL_B, ss_type=3)["table"]}
    assert math.isclose(t2["AxB"]["SS"], t3["AxB"]["SS"], rel_tol=1e-10)
    assert math.isclose(t2["Error"]["SS"], t3["Error"]["SS"], rel_tol=1e-10)
    # Type II and III main effects differ under imbalance + interaction
    assert not math.isclose(t2["A"]["SS"], t3["A"]["SS"], rel_tol=1e-6)


def test_unbalanced_validation_errors() -> None:
    with pytest.raises(ValueError, match="ss_type"):
        anova2_unbalanced(_UNBAL_VALS, _UNBAL_A, _UNBAL_B, ss_type=1)
    with pytest.raises(ValueError, match="same length"):
        anova2_unbalanced(_UNBAL_VALS, _UNBAL_A[:-1], _UNBAL_B)
    # an empty cell (hi,y here) makes Type III undefined
    with pytest.raises(ValueError, match="every A x B cell"):
        anova2_unbalanced(
            np.array([1.0, 2.0, 3.0, 4.0]),
            ["lo", "lo", "hi", "hi"],
            ["x", "y", "x", "x"],  # 2 levels each, but no (hi, y) observation
        )


# --------------------------------------------------------------------------
# long-format reshapers
# --------------------------------------------------------------------------
def test_long_to_groups() -> None:
    out = long_to_groups([1.0, 2.0, 3.0, 4.0, np.nan], ["a", "b", "a", "b", "a"])
    assert out["levels"] == ["a", "b"]
    np.testing.assert_allclose(out["groups"][0], [1.0, 3.0])  # NaN dropped
    np.testing.assert_allclose(out["groups"][1], [2.0, 4.0])


def test_long_to_cells_balanced_flag_and_grid() -> None:
    vals, fa, fb = _battery_long()
    out = long_to_cells(vals, fa, fb)
    assert out["balanced"] is True
    assert out["a_levels"] == ["mat0", "mat1", "mat2"]
    assert out["b_levels"] == ["temp0", "temp1", "temp2"]
    # the reshaped cells reproduce the closed-form ANOVA
    ref = {r["source"]: r for r in anova2(_BATTERY)["table"]}
    got = {r["source"]: r for r in anova2(out["cells"])["table"]}
    assert math.isclose(got["A"]["SS"], ref["A"]["SS"], rel_tol=1e-12)


def test_long_to_cells_flags_unbalanced() -> None:
    out = long_to_cells(_UNBAL_VALS, _UNBAL_A, _UNBAL_B)
    assert out["balanced"] is False
    assert out["cell_counts"] == [[2, 5, 3], [3, 2, 4]]  # levels sort: hi<lo, x<y<z
