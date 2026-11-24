"""People-Bean / Matthews-Blakeslee (general slip) critical thickness.

No frozen literature numbers: every check is an equation residual, a limiting
behaviour, or agreement with an independent closed form (Lambert W) or with the
MATLAB-parity ``critical_thickness`` where the equations coincide.
"""

from __future__ import annotations

import math

import pytest
from scipy.special import lambertw

from quantized.calc.critical_thickness_models import matthews_blakeslee_general, people_bean
from quantized.calc.substrates import critical_thickness

A = 3.9  # arbitrary test lattice constant (Angstrom), not material data
B = A / math.sqrt(2.0)
MISMATCHES = [0.03, 0.02, 0.01, 0.005, 0.002]


def _mb_residual(h: float, f: float, b: float, nu: float, al: float, lam: float) -> float:
    c = math.cos(math.radians(al))
    cl = math.cos(math.radians(lam))
    rhs = b * (1 - nu * c * c) / (2 * math.pi * f * (1 + nu) * cl) * (math.log(h / b) + 1)
    return h / rhs - 1.0


def _pb_residual(h: float, f: float, b: float, a: float, nu: float) -> float:
    rhs = (1 - nu) / (1 + nu) / (16 * math.pi * math.sqrt(2)) * b * b / a / f**2 * math.log(h / b)
    return h / rhs - 1.0


@pytest.mark.parametrize("f", MISMATCHES)
@pytest.mark.parametrize("angles", [(60.0, 60.0), (90.0, 0.0), (0.0, 45.0), (35.0, 55.0)])
def test_mb_self_consistent_and_physical_root(f: float, angles: tuple[float, float]) -> None:
    r = matthews_blakeslee_general(f, B, nu=0.28, alpha_deg=angles[0], lambda_deg=angles[1])
    assert abs(_mb_residual(r["h_c"], f, B, 0.28, *angles)) < 1e-9
    assert r["h_c"] > B  # the larger (physical) root, not the spurious one near b


@pytest.mark.parametrize("f", [0.02, 0.01, 0.005, 0.002])
def test_pb_self_consistent(f: float) -> None:
    r = people_bean(f, B, A, nu=0.28)
    assert abs(_pb_residual(r["h_c"], f, B, A, 0.28)) < 1e-9
    assert r["h_c"] > B


@pytest.mark.parametrize("f", MISMATCHES)
def test_mb_matches_lambert_w_closed_form(f: float) -> None:
    nu = 0.3
    c = (1 - nu * 0.25) / (2 * math.pi * f * (1 + nu) * 0.5)
    y = float((-c * lambertw(-1.0 / (math.e * c), k=-1)).real)
    r = matthews_blakeslee_general(f, B, nu=nu, alpha_deg=60, lambda_deg=60)
    assert r["h_c"] == pytest.approx(y * B, rel=1e-10)


@pytest.mark.parametrize("f", [0.02, 0.01, 0.005])
def test_pb_matches_lambert_w_closed_form(f: float) -> None:
    nu = 0.3
    c = (1 - nu) / (1 + nu) * B / (16 * math.pi * math.sqrt(2) * A * f * f)
    y = float((-c * lambertw(-1.0 / c, k=-1)).real)
    r = people_bean(f, B, A, nu=nu)
    assert r["h_c"] == pytest.approx(y * B, rel=1e-10)


@pytest.mark.parametrize("f", [0.03, 0.01, 0.002])
def test_mb_general_equals_parity_model_at_60_60(f: float) -> None:
    sub = A / (1 + f)
    parity = critical_thickness(A, sub, nu=0.3)
    g = matthews_blakeslee_general(
        parity["mismatch"], parity["b"], nu=0.3, alpha_deg=60, lambda_deg=60
    )
    assert g["h_c"] == pytest.approx(parity["h_c"], rel=1e-9)


@pytest.mark.parametrize("fn", ["mb", "pb"])
def test_decreasing_in_mismatch_and_diverging_to_zero(fn: str) -> None:
    def h(f: float) -> float:
        if fn == "mb":
            return matthews_blakeslee_general(f, B, nu=0.3, alpha_deg=60, lambda_deg=60)["h_c"]
        return people_bean(f, B, A, nu=0.3)["h_c"]

    fs = [0.02, 0.01, 0.005, 0.002, 0.001, 1e-4, 1e-6]
    hs = [h(f) for f in fs]
    assert all(x < y for x, y in zip(hs, hs[1:], strict=False))
    assert hs[-1] > 1e3 * hs[0]
    assert h(-0.01) == pytest.approx(h(0.01))  # sign of the misfit is irrelevant


def test_matched_is_infinite() -> None:
    assert math.isinf(
        matthews_blakeslee_general(0.0, B, nu=0.3, alpha_deg=60, lambda_deg=60)["h_c"]
    )
    assert math.isinf(people_bean(0.0, B, A, nu=0.3)["h_c"])


def test_fail_closed_when_no_root() -> None:
    with pytest.raises(ValueError, match="no critical thickness"):
        matthews_blakeslee_general(0.5, B, nu=0.3, alpha_deg=60, lambda_deg=60)
    with pytest.raises(ValueError, match="no critical thickness"):
        people_bean(0.05, B, A, nu=0.3)


def test_threshold_is_exactly_where_the_root_vanishes() -> None:
    # c == 1 (MB) is the boundary: just inside has a root, just outside none.
    nu, cl = 0.3, 0.5
    f_edge = (1 - nu * 0.25) / (2 * math.pi * (1 + nu) * cl)
    matthews_blakeslee_general(f_edge * 0.999, B, nu=nu, alpha_deg=60, lambda_deg=60)
    with pytest.raises(ValueError):
        matthews_blakeslee_general(f_edge * 1.001, B, nu=nu, alpha_deg=60, lambda_deg=60)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"b": 0.0},
        {"b": float("nan")},
        {"nu": 0.7},
        {"nu": -0.1},
        {"lambda_deg": 90.0},
        {"lambda_deg": -1.0},
        {"alpha_deg": float("inf")},
    ],
)
def test_input_validation(kwargs: dict[str, float]) -> None:
    args = {"b": B, "nu": 0.3, "alpha_deg": 60.0, "lambda_deg": 60.0} | kwargs
    with pytest.raises(ValueError):
        matthews_blakeslee_general(
            0.01,
            args["b"],
            nu=args["nu"],
            alpha_deg=args["alpha_deg"],
            lambda_deg=args["lambda_deg"],
        )


def test_pb_validation() -> None:
    with pytest.raises(ValueError):
        people_bean(0.01, B, 0.0, nu=0.3)
    with pytest.raises(ValueError):
        people_bean(float("nan"), B, A, nu=0.3)


def test_labels_cite_the_papers() -> None:
    assert (
        "118 (1974)"
        in matthews_blakeslee_general(0.01, B, nu=0.3, alpha_deg=60, lambda_deg=60)["label"]
    )
    assert "47, 322 (1985)" in people_bean(0.01, B, A, nu=0.3)["label"]
