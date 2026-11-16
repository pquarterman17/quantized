"""The headless error-role seeding equals the app's ``seedErrorRoles``
(``store/errorRoleSeed.parity.test.ts`` writes the fixture from the app's own
function), and a replay keeps a bound error column un-offset as the app does."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

import quantized.api as qz
from quantized.io.error_seed import seed_error_roles
from quantized.recipe_run import parse_recipe, run_recipe

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "frontend"
    / "src"
    / "lib"
    / "__fixtures__"
    / "errorRoleSeed.json"
)


@pytest.mark.parametrize(
    "case", json.loads(FIXTURE.read_text("utf-8"))["cases"], ids=lambda c: c["name"]
)
def test_seed_matches_the_app(case: dict[str, object]) -> None:
    assert seed_error_roles(qz.DataStruct.from_dict(case["data"])) == case["roles"]  # type: ignore[arg-type]


def test_a_correction_leaves_the_bound_error_column_unoffset(tmp_path: Path) -> None:
    """Measured in review: M, M_err with yOff=1 -- the app sends the seeded
    roles, so M_err stays 0.1; without them it became -0.9."""
    path = tmp_path / "m.csv"
    path.write_text("T,M,M_err\n1,5,0.1\n2,6,0.1\n3,7,0.1\n", "utf-8")
    step = {"kind": "correction", "label": "Corrections", "code": "", "enabled": True,
            "params": {"params": {"yOff": 1}, "bg": None}}  # fmt: skip
    recipe = parse_recipe(json.dumps({"version": 1, "name": "r", "steps": [step], "outputs": []}))
    out = run_recipe(recipe, qz.load(path)).data
    np.testing.assert_allclose(out.column(0), [4.0, 5.0, 6.0])
    np.testing.assert_allclose(out.column(1), [0.1, 0.1, 0.1])
