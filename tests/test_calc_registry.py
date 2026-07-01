"""Headless calculator registry (calc/registry.py).

The registry is a thin, curated dispatch over the pure calc functions — so the
tests assert catalog integrity (every op resolves to a callable + summary, names
unique), discovery (describe exposes signature params), call parity (dispatch ==
a direct call), and the error contract (unknown name → KeyError, bad params →
ValueError).
"""

from __future__ import annotations

import pytest

from quantized.calc import crystallography, superconductor, xray
from quantized.calc.registry import (
    CALCULATORS,
    DOMAINS,
    call_calculator,
    describe_calculator,
    list_calculators,
)

_EXPECTED_DOMAINS = {
    "units",
    "constants",
    "xray",
    "crystal",
    "sld",
    "electrical",
    "thermal",
    "diffusion",
    "optics",
    "vacuum",
    "electrochemistry",
    "substrates",
    "semiconductor",
    "superconductor",
    "thinfilm",
    "magnetic",
}


def test_catalog_integrity() -> None:
    ops = list_calculators()
    assert len(ops) == len(CALCULATORS) >= 80
    # names unique + <domain>.<op> shaped; every op resolves + summarizes
    names = [o["name"] for o in ops]
    assert len(names) == len(set(names))
    for name, op in CALCULATORS.items():
        assert "." in name and name.split(".", 1)[0] == op.domain
        assert callable(op.fn)
        assert op.summary, f"{name} has no docstring summary"
    assert set(DOMAINS) == _EXPECTED_DOMAINS


def test_list_calculators_filters_by_domain() -> None:
    xr = list_calculators(domain="xray")
    assert {o["name"] for o in xr} == {
        "xray.bragg_d_spacing",
        "xray.bragg_two_theta",
        "xray.q_from_two_theta",
        "xray.two_theta_from_q",
        "xray.xray_calc",
    }
    assert all(o["domain"] == "xray" for o in xr)
    assert list_calculators(domain="nope") == []


def test_describe_exposes_signature_params() -> None:
    desc = describe_calculator("crystal.d_spacing")
    assert desc["name"] == "crystal.d_spacing"
    assert desc["domain"] == "crystal"
    assert desc["summary"]
    param_names = {p["name"] for p in desc["params"]}
    assert {"system", "a", "b", "c", "h", "k", "l"} <= param_names
    # required vs optional split is surfaced (alpha has a default, system does not)
    by_name = {p["name"]: p for p in desc["params"]}
    assert by_name["system"]["required"] is True
    assert by_name["alpha"]["required"] is False
    assert by_name["alpha"]["default"] == 90.0


def test_describe_unknown_raises_keyerror() -> None:
    with pytest.raises(KeyError, match="unknown calculator"):
        describe_calculator("does.not.exist")


def test_call_matches_direct_function() -> None:
    params = {"system": "cubic", "a": 5.4309, "b": 5.4309, "c": 5.4309, "h": 1, "k": 1, "l": 1}
    assert call_calculator("crystal.d_spacing", params) == crystallography.d_spacing(**params)

    d_direct = xray.bragg_d_spacing(1.5406, 28.44)
    d_reg = call_calculator(
        "xray.bragg_d_spacing", {"wavelength_a": 1.5406, "two_theta_deg": 28.44}
    )
    assert d_reg == d_direct

    sc_direct = superconductor.london_depth(None, 4.0, 9.0, material="Nb")
    sc_reg = call_calculator(
        "superconductor.london_depth", {"lambda0": None, "t": 4.0, "tc": 9.0, "material": "Nb"}
    )
    assert sc_reg == sc_direct


def test_call_default_params_are_optional() -> None:
    # cell_volume defaults the angles to 90 → a cubic cell needs only a/b/c.
    vol = call_calculator("crystal.cell_volume", {"a": 4.0, "b": 4.0, "c": 4.0})
    assert vol == pytest.approx(64.0)


def test_call_unknown_raises_keyerror() -> None:
    with pytest.raises(KeyError, match="unknown calculator"):
        call_calculator("nope.nope", {})


def test_call_bad_params_raises_valueerror_listing_expected() -> None:
    with pytest.raises(ValueError, match="invalid parameters for 'crystal.cell_volume'"):
        call_calculator("crystal.cell_volume", {"bogus": 1})


def test_call_domain_validation_error_propagates() -> None:
    # (0,0,0) is not a valid reflection → the calc function raises ValueError.
    with pytest.raises(ValueError):
        call_calculator(
            "crystal.d_spacing",
            {"system": "cubic", "a": 4.0, "b": 4.0, "c": 4.0, "h": 0, "k": 0, "l": 0},
        )
