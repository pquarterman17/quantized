"""Maxwell entropy change, Arrott analysis and approach-to-saturation: calc + API.

Expected values are analytic (no MATLAB reference): synthetic data with closed
forms for the quantities being recovered.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.calc.magnetic_critical import arrott_analysis
from quantized.calc.magnetic_entropy import magnetic_entropy_change
from quantized.calc.magnetic_isotherms import MU0
from quantized.calc.magnetic_saturation import approach_to_saturation


def _linear_family(temps: list[float], slope: float = -2.0) -> list[dict[str, Any]]:
    """M = c(T) * H with c(T) = 1e-3*(T-?)...: M(A/m) = (A + slope*T)*H[T]*1e-3."""
    h_t = np.linspace(0.0, 2.0, 21)  # tesla
    out = []
    for t in temps:
        out.append(
            {
                "temperature": t,
                "field": h_t.tolist(),
                "magnetization": ((100 + slope * t) * h_t).tolist(),
            }
        )
    return out


def test_entropy_matches_analytic_maxwell_integral() -> None:
    # M(T,B) = (100 - 2T) B  [A/m, B in T]  ->  dM/dT = -2 B
    # dS = int_0^Hmax (dM/dT) mu0 dH' = int_0^Bmax -2 B dB = -Bmax^2
    res = magnetic_entropy_change(
        _linear_family([10, 20, 30, 40]),
        field_unit="T",
        magnetization_unit="A/m",
        max_fields=[1.0, 2.0],
    )
    assert res["unit"] == "J/(m^3 K)"
    assert res["temperature"] == [15.0, 25.0, 35.0]
    for curve in res["curves"]:
        # M above uses H axis in tesla numerically, so H[A/m]=B/mu0: dS = -mu0*... check scale
        bmax = curve["max_field"]
        # field values were given in tesla units => H = B/mu0 A/m; M = (100-2T)*B
        # dM/dT = -2 B ; mu0 * int dM/dT dH = int -2 B dB = -Bmax^2
        assert curve["delta_s"] == pytest.approx([-(bmax**2)] * 3, rel=1e-9)
    assert res["curves"][1]["peak_delta_s"] == pytest.approx(-4.0)


def test_entropy_rcp_from_gaussian_peak() -> None:
    temps = [float(t) for t in range(50, 151, 5)]
    h = np.linspace(0, 1e5, 11)  # A/m
    sigma, t0 = 10.0, 100.0
    iso = []
    for t in temps:
        # dM/dT = -exp(-(T-t0)^2/2s^2) * H/1e5  ->  M = -cumulative Gaussian
        from scipy.special import erf

        mval = -math.sqrt(math.pi / 2) * sigma * erf((t - t0) / (math.sqrt(2) * sigma)) * h / 1e5
        iso.append({"temperature": t, "field": h.tolist(), "magnetization": mval.tolist()})
    res = magnetic_entropy_change(iso, field_unit="A/m", magnetization_unit="A/m", max_fields=[1e5])
    c = res["curves"][0]
    assert c["peak_temperature"] == pytest.approx(100.0, abs=2.6)
    # FWHM of a Gaussian = 2.355 sigma
    assert c["fwhm"] == pytest.approx(2.3548 * sigma, rel=0.05)
    assert c["rcp"] == pytest.approx(abs(c["peak_delta_s"]) * c["fwhm"])
    # midpoint of the 5 K bracket nearest t0 sits 2.5 K off the peak; the discrete
    # form averages dM/dT over the bracket, ~ -exp(-(2.5)^2/(2 sigma^2)) * 0.5e5 * mu0
    expected = -MU0 * 0.5e5 * math.exp(-(2.5**2) / (2 * sigma**2))
    assert c["peak_delta_s"] == pytest.approx(expected, rel=0.01)


def test_entropy_mass_units_and_failures() -> None:
    res = magnetic_entropy_change(
        _linear_family([10, 20]), field_unit="T", magnetization_unit="emu/g", max_fields=[1.0]
    )
    assert res["unit"] == "J/(kg K)"
    with pytest.raises(ValueError, match="at least 2 isotherms"):
        magnetic_entropy_change(
            _linear_family([10]), field_unit="T", magnetization_unit="A/m", max_fields=[1.0]
        )
    with pytest.raises(ValueError, match="does not span"):
        magnetic_entropy_change(
            _linear_family([10, 20]), field_unit="T", magnetization_unit="A/m", max_fields=[5.0]
        )
    with pytest.raises(ValueError, match="normalized unit"):
        magnetic_entropy_change(
            _linear_family([10, 20]), field_unit="T", magnetization_unit="emu", max_fields=[1.0]
        )


def _arrott_family(tc: float) -> list[dict[str, Any]]:
    # Mean field: M^2 = a (Tc - T) + b H/M  ->  solve M for each H
    a, b = 4.0, 2.0
    out = []
    h = np.linspace(2000.0, 10000.0, 17)
    for t in (tc - 20, tc - 10, tc + 10, tc + 20):
        c0 = a * (tc - t)
        # M^2 - (b H)/M = c0 -> M^3 - c0 M - b H = 0
        m = [max(np.roots([1, 0, -c0, -b * x]).real) for x in h]
        out.append({"temperature": t, "field": h.tolist(), "magnetization": m})
    return out


def test_arrott_recovers_tc_and_exponent_labels() -> None:
    res = arrott_analysis(
        _arrott_family(100.0),
        field_unit="Oe",
        magnetization_unit="emu/cm3",
        window=(2000, 10000),
    )
    # field in Oe is converted to A/m and M in emu/cm3 -> A/m, so the intercept
    # is rescaled; Tc must still be bracketed by the sign change
    assert res["tc"] is not None
    assert 85 < res["tc"] < 115
    assert res["x_label"] == "(H/M)^(1/1)"
    assert res["isotherms"][0]["spontaneous_magnetization"] > 0
    assert res["isotherms"][-1]["spontaneous_magnetization"] == 0.0
    assert all(i["r2"] > 0.99 for i in res["isotherms"])


def test_arrott_exact_line_in_si_units() -> None:
    h = np.linspace(1e3, 1e4, 10)
    # M^2 = 5e6 + 2e3*(H/M)? build M from M^3 - c0 M - bH = 0 in A/m, field A/m
    iso = []
    for t, c0 in ((90.0, 4e6), (110.0, -4e6)):
        m = [max(np.roots([1, 0, -c0, -2e3 * x]).real) for x in h]
        iso.append({"temperature": t, "field": h.tolist(), "magnetization": m})
    res = arrott_analysis(iso, field_unit="A/m", magnetization_unit="A/m", window=(1e3, 1e4))
    assert res["isotherms"][0]["intercept"] == pytest.approx(4e6, rel=1e-6)
    assert res["isotherms"][0]["slope"] == pytest.approx(2e3, rel=1e-6)
    assert res["tc"] == pytest.approx(100.0, abs=1e-6)


def test_arrott_fails_closed_on_bad_input() -> None:
    iso = _arrott_family(100.0)
    with pytest.raises(ValueError, match="beta and gamma"):
        arrott_analysis(iso, beta=0.0, window=(2000, 10000))
    with pytest.raises(ValueError, match="fewer than 3"):
        arrott_analysis(iso, window=(20000, 30000))
    iso[0]["field"][1] = iso[0]["field"][0]
    with pytest.raises(ValueError, match="repeated field"):
        arrott_analysis(iso, window=(2000, 10000))


def test_approach_to_saturation_recovers_parameters() -> None:
    h = np.linspace(2e4, 3e5, 120)  # A/m
    ms, a, b, chi = 1.0e6, 2.0e3, 5.0e8, 0.01
    m = ms * (1 - a / h - b / h**2) + chi * h
    res = approach_to_saturation(
        h.tolist(), m.tolist(), field_unit="A/m", magnetization_unit="A/m", h_min=2e4
    )
    assert res["Ms"] == pytest.approx(ms, rel=1e-8)
    assert res["a"] == pytest.approx(a, rel=1e-6)
    assert res["b"] == pytest.approx(b, rel=1e-6)
    assert res["chi_hf"] == pytest.approx(chi, rel=1e-6)
    k_expected = MU0 * ms * math.sqrt(b / (4 / 15))
    assert res["k1"] == pytest.approx(k_expected, rel=1e-6)
    # switching terms off pins them at zero
    res2 = approach_to_saturation(
        h.tolist(),
        m.tolist(),
        field_unit="A/m",
        magnetization_unit="A/m",
        h_min=2e4,
        include_chi=False,
        include_b=False,
    )
    assert res2["b"] == 0.0 and res2["chi_hf"] == 0.0 and "k1" not in res2


def test_approach_to_saturation_failures() -> None:
    with pytest.raises(ValueError, match="at least"):
        approach_to_saturation(
            [1e4, 2e4, 3e4], [1.0, 1.0, 1.0], field_unit="A/m", magnetization_unit="A/m", h_min=1e4
        )
    with pytest.raises(ValueError, match="h_min"):
        approach_to_saturation([1.0], [1.0], h_min=0.0)


def test_routes_roundtrip_and_422(client: TestClient) -> None:
    body = {
        "isotherms": _linear_family([10, 20, 30]),
        "field_unit": "T",
        "magnetization_unit": "A/m",
        "max_fields": [1.5],
    }
    r = client.post("/api/magnetic/entropy-change", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["curves"][0]["delta_s"][0] == pytest.approx(-2.25)

    bad = client.post("/api/magnetic/entropy-change", json={**body, "max_fields": [9.0]})
    assert bad.status_code == 422

    r = client.post(
        "/api/magnetic/arrott",
        json={"isotherms": _arrott_family(100.0), "window": [2000, 10000]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["tc"] is not None

    h = np.linspace(2e4, 3e5, 40)
    r = client.post(
        "/api/magnetic/approach-to-saturation",
        json={
            "field": h.tolist(),
            "magnetization": (1e6 * (1 - 2e3 / h)).tolist(),
            "field_unit": "A/m",
            "magnetization_unit": "A/m",
            "h_min": 2e4,
            "include_b": False,
            "include_chi": False,
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["Ms"] == pytest.approx(1e6, rel=1e-8)
