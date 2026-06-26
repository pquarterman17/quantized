"""Parameter-constraint expansion: golden parity vs MATLAB fitting.applyConstraints."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.fit_constraints import apply_constraints


def _as_list(v: Any) -> list[float]:
    # jsonencode collapses a single-element vector to a scalar.
    return [float(v)] if np.isscalar(v) else [float(x) for x in v]


@pytest.mark.golden
def test_apply_constraints_matches_matlab(load_golden: Callable[[str], dict[str, Any]]) -> None:
    g = load_golden("calc_constraints.json")
    for case in g["cases"]:
        p_full, free_idx = apply_constraints(
            _as_list(case["pFree"]), list(case["constraints"]), list(case["names"])
        )
        assert_allclose(
            p_full, np.asarray(_as_list(case["pFull"]), dtype=float),
            rtol=1e-12, atol=1e-12, err_msg=str(case["names"]),
        )
        # MATLAB freeIdx is 1-based; Python is 0-based.
        matlab_free = [int(v) - 1 for v in _as_list(case["freeIdx"])]
        assert free_idx == matlab_free, case["names"]


def test_linear_link_b_equals_2a() -> None:
    p_full, free_idx = apply_constraints([3.5], ["", "2*p1"], ["a", "b"])
    assert_allclose(p_full, [3.5, 7.0])
    assert free_idx == [0]


def test_named_reference_constraint() -> None:
    # C = a + 2*tau, with a and tau free
    p_full, _ = apply_constraints([2.0, 5.0], ["", "", "a + 2*tau"], ["a", "tau", "C"])
    assert_allclose(p_full, [2.0, 5.0, 12.0])


def test_constant_and_math_function_constraint() -> None:
    p_full, _ = apply_constraints([9.0, 1.0], ["", "", "sqrt(p1) + 1"], ["a", "b", "c"])
    assert_allclose(p_full, [9.0, 1.0, 4.0])


def test_reindexed_double_replacement_quirk_is_faithful() -> None:
    # 'b + c' (b,c free) rewrites to 'p1 + p2', then the positional pass mistakes
    # the named-produced p2 for global-position 2 → 'p1 + p1' → a = 2*b. This
    # matches MATLAB applyConstraints exactly (faithful port of the quirk).
    p_full, free_idx = apply_constraints([2.0, 3.0], ["b + c", "", ""], ["a", "b", "c"])
    assert_allclose(p_full, [4.0, 2.0, 3.0])  # NOT [5, 2, 3]
    assert free_idx == [1, 2]


def test_constraint_referencing_constrained_param_raises() -> None:
    with pytest.raises(ValueError, match="itself constrained"):
        apply_constraints([1.0], ["", "2*p1", "b + 1"], ["a", "b", "c"])


def test_free_count_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="free parameters found"):
        apply_constraints([1.0, 2.0], ["", "2*p1"], ["a", "b"])  # 1 free, 2 given


def test_all_constrained_requires_empty_free() -> None:
    with pytest.raises(ValueError, match="all .* parameters are constrained"):
        apply_constraints([1.0], ["5", "10"], ["a", "b"])


def test_size_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="same length"):
        apply_constraints([1.0], [""], ["a", "b"])
