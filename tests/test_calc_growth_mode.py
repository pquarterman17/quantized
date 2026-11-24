"""Bauer growth-mode scan: the inequality, its boundaries, and fail-closed input."""

from __future__ import annotations

import math

import pytest

from quantized.calc.growth_mode import bauer_scan

GS, GF = 2.0, 1.2  # arbitrary consistent energy units, not material data


def _verdicts(**kw: float) -> dict[float, str]:
    r = bauer_scan(GS, GF, 0.0, 2.0, 41, **kw)
    return {p["gamma_int"]: p["verdict"] for p in r["points"]}


def test_inequality_without_sk() -> None:
    v = _verdicts()
    boundary = GS - GF
    for g, verdict in v.items():
        if g < boundary - 1e-12:
            assert verdict == "FvdM"
        elif g > boundary + 1e-12:
            assert verdict == "VW"
    assert bauer_scan(GS, GF, 0.0, 2.0)["boundaries"][0]["gamma_int"] == pytest.approx(GS - GF)
    assert "SK" not in v.values()


def test_delta_is_gf_plus_gint_minus_gs() -> None:
    for p in bauer_scan(GS, GF, 0.0, 2.0, 5)["points"]:
        assert p["delta"] == pytest.approx(GF + p["gamma_int"] - GS)


def test_exact_boundary_is_indeterminate_not_guessed() -> None:
    r = bauer_scan(GS, GF, GS - GF, GS - GF + 1.0, 2)
    assert r["points"][0]["verdict"] == "indeterminate"


def test_sk_window_sits_between_the_two_boundaries() -> None:
    p = 0.3
    r = bauer_scan(GS, GF, 0.0, 2.0, 81, strain_penalty=p)
    vw, sk = (b["gamma_int"] for b in r["boundaries"])
    assert vw - sk == pytest.approx(p)
    for pt in r["points"]:
        g = pt["gamma_int"]
        if g > vw + 1e-9:
            assert pt["verdict"] == "VW"
        elif sk + 1e-9 < g < vw - 1e-9:
            assert pt["verdict"] == "SK"
        elif g < sk - 1e-9:
            assert pt["verdict"] == "FvdM"


def test_uncertainty_band_is_symmetric_and_nonempty() -> None:
    u = 0.1
    r = bauer_scan(GS, GF, 0.0, 2.0, 201, uncertainty=u)
    ind = [p["gamma_int"] for p in r["points"] if p["verdict"] == "indeterminate"]
    assert ind and all(abs(p["delta"]) <= u for p in r["points"] if p["verdict"] == "indeterminate")
    assert all(abs(p["delta"]) > u for p in r["points"] if p["verdict"] != "indeterminate")
    assert (min(ind) + max(ind)) / 2 == pytest.approx(GS - GF, abs=0.02)


@pytest.mark.parametrize(
    "args",
    [
        (0.0, GF, 0.0, 1.0),
        (GS, -1.0, 0.0, 1.0),
        (GS, GF, -0.1, 1.0),
        (GS, GF, 1.0, 1.0),
        (GS, GF, 0.0, math.inf),
        (math.nan, GF, 0.0, 1.0),
    ],
)
def test_invalid_inputs_raise(args: tuple[float, float, float, float]) -> None:
    with pytest.raises(ValueError):
        bauer_scan(*args)


def test_invalid_n_uncertainty_penalty() -> None:
    for kw in ({"n": 1}, {"n": 5000}, {"uncertainty": -1.0}, {"strain_penalty": -1.0}):
        with pytest.raises(ValueError):
            bauer_scan(GS, GF, 0.0, 1.0, **kw)  # type: ignore[arg-type]
