"""Golden parity vs MATLAB ``calc.crystal.phaseDatabase()``.

The freeze case is in ``tools/matlab/freeze_diraculator_values.m``; until it is
run against ``../quantized_matlab`` the fixture is absent and ``load_golden``
skips this test. ``compare_calc`` cannot compare a basis row (a symbol followed
by numbers), so this test compares field by field: strings exactly, numbers
to the campaign tolerance.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc.phase_database import phase_database

_STRINGS = ("name", "formula", "centering", "system", "category")
_NUMBERS = ("a", "b", "c", "alpha", "beta", "gamma", "icsd")


def _rows(basis: Any) -> list[list[Any]]:
    # jsonencode writes an empty MATLAB cell {} as [] and an N x 4 cell as N rows.
    return [list(r) for r in basis] if basis else []


@pytest.mark.golden
def test_phase_database_matches_matlab(load_golden: Callable[[str], dict[str, Any]]) -> None:
    frozen = load_golden("calc_dira_crystal_phase_database.json")["output"]
    ours = phase_database()
    assert [p["name"] for p in ours] == [p["name"] for p in frozen]
    for mine, theirs in zip(ours, frozen, strict=True):
        for key in _STRINGS:
            assert mine[key] == theirs[key], (mine["name"], key)
        for key in _NUMBERS:
            expected = pytest.approx(theirs[key], rel=1e-12, abs=1e-12)
            assert mine[key] == expected, (mine["name"], key)
        theirs_basis = _rows(theirs["basis"])
        assert len(mine["basis"]) == len(theirs_basis), mine["name"]
        for row, frow in zip(mine["basis"], theirs_basis, strict=True):
            assert row[0] == frow[0], mine["name"]
            assert row[1:] == pytest.approx(frow[1:], rel=1e-12, abs=1e-12), mine["name"]
