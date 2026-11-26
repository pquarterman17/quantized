"""Each frozen Origin oracle fixture still has the property it exists for.

The fixtures are Origin's own answers (``tools/origin_oracle``); these tests
do not re-derive them. They assert that the planted truth is still inside the
sampled data and that Origin's recorded answer agrees with it, so a fixture
that silently stopped exercising its case fails here. Skips without the
local ``../test-data`` corpus.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

from _origin_oracle_fixture import OracleFixture, load_fixture

TOOLS = Path(__file__).resolve().parents[1] / "tools" / "origin_oracle"
sys.path.insert(0, str(TOOLS))

import oracle_cases  # noqa: E402
from oracle_model import find_case, input_csv, make_input  # noqa: E402

pytestmark = pytest.mark.realdata


def _vals(col: list[float | None]) -> np.ndarray:
    return np.array([v for v in col if v is not None], dtype=float)


@pytest.fixture(params=[c.id for c in oracle_cases.CASES if not c.not_exercised])
def any_fixture(request: pytest.FixtureRequest) -> OracleFixture:
    fx: OracleFixture = load_fixture(request.param)
    return fx


def test_every_fixture_ran_and_matches_its_generator(any_fixture: OracleFixture) -> None:
    fx = any_fixture
    assert fx.oracle["status"] == "ok", fx.oracle.get("error")
    assert fx.oracle["labtalk"] and all(fx.oracle["step_results"])
    assert fx.oracle["leftover_books"] == []
    case = find_case(oracle_cases.CASES, fx.case_id)
    # The frozen input is still what the generator produces today.
    assert fx.input_bytes == input_csv(make_input(case)).encode("utf-8")
    assert fx.truth["seed"] == case.seed


def test_intersect_finds_every_planted_crossing() -> None:
    fx = load_fixture("intersect")
    planted = np.array(fx.planted["crossings_x"])
    lo, hi = fx.planted["x_range"]
    assert len(planted) == 4 and np.all((planted > lo) & (planted < hi))
    found = _vals(fx.column("Intersection X1"))
    assert len(found) == len(planted)
    np.testing.assert_allclose(np.sort(found), planted, atol=1e-2)


def test_levelcrossing_counts_every_planted_crossing() -> None:
    fx = load_fixture("levelcrossing")
    planted = np.array(fx.planted["crossings_x"])
    assert len(planted) == fx.planted["n_crossings"] >= 4
    assert fx.oracle["values"]["ncr"] == len(planted)
    found = _vals(fx.column("CrossingX1"))
    assert len(found) == len(planted)
    np.testing.assert_allclose(np.sort(found), planted, atol=0.05)


def test_nlfit_gauss_recovers_planted_peak() -> None:
    fx = load_fixture("nlfit_gauss")
    xc, xc_err = fx.column("xc", 0)[0], fx.column("xc", 1)[0]  # value, standard error
    fwhm = fx.column("FWHM")[0]
    height = fx.column("Height")[0]
    assert xc is not None and xc_err is not None and fwhm is not None and height is not None
    assert abs(xc - fx.planted["x0"]) < 5 * xc_err
    assert abs(fwhm - fx.planted["fwhm"]) < 0.05
    assert abs(height - fx.planted["height"]) < 0.1


def test_integ1_area_is_the_exact_trapezoid_area() -> None:
    fx = load_fixture("integ1_area")
    assert fx.planted["area"] == 25.0
    assert fx.oracle["values"]["ar"] == pytest.approx(25.0, abs=1e-9)


def test_pkfind_locates_the_planted_peaks() -> None:
    fx = load_fixture("pkfind")
    planted = np.array(fx.planted["centers"])
    found = _vals(fx.column("Xs of Peak Centers"))
    assert len(found) == len(planted)
    np.testing.assert_allclose(np.sort(found), planted, atol=0.05)


def test_fitlrxerr_york_slope_is_consistent_with_the_planted_line() -> None:
    fx = load_fixture("fitlrxerr")
    v = fx.oracle["values"]
    assert v["qz_ret"] == 0 and v["qz_n"] == fx.planted["n"]
    assert abs(v["qz_slope"] - fx.planted["slope"]) < 4 * v["qz_slope_err"]
    assert abs(v["qz_intercept"] - fx.planted["intercept"]) < 4 * v["qz_intercept_err"]
    assert 0.2 < v["qz_redchisq"] < 3.0  # the planted errors are the real scatter
