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

_EXPECTED_OPERATIONS_BY_DOMAIN = {
    "units": {"convert"},
    "constants": {"list"},
    "xray": {
        "bragg_d_spacing",
        "bragg_two_theta",
        "q_from_two_theta",
        "two_theta_from_q",
        "xray_calc",
        "neutron_calc",
    },
    "crystal": {
        "d_spacing",
        "cell_volume",
        "theoretical_density",
        "plane_spacings",
        "interplanar_angle",
    },
    "sld": {"sld_from_formula"},
    "electrical": {
        "resistivity",
        "sheet_resistance",
        "conductivity",
        "mobility",
        "current_density",
        "hall_single_point",
        "hall_analysis",
        "van_der_pauw",
        "wiedemann_franz",
    },
    "thermal": {"wiedemann_franz", "debye_temperature", "thermal_diffusivity"},
    "diffusion": {"arrhenius", "diffusion_length", "fick_flux", "c_profile"},
    "optics": {
        "fresnel_coefficients",
        "critical_angle",
        "brewster_angle",
        "penetration_depth",
        "skin_depth",
        "dielectric_to_refractive",
        "refractive_to_dielectric",
    },
    "vacuum": {
        "mean_free_path",
        "monolayer_time",
        "knudsen_number",
        "pump_down_time",
        "sputter_yield",
        "gas_flow",
    },
    "electrochemistry": {
        "nernst_potential",
        "butler_volmer",
        "tafel_slope",
        "ohmic_drop",
        "double_layer_capacitance",
    },
    "substrates": {
        "get_substrate",
        "list_substrates",
        "lattice_mismatch",
        "critical_thickness",
        "substrate_table",
    },
    "semiconductor": {
        "intrinsic_carrier_conc",
        "carrier_concentration",
        "fermi_level",
        "built_in_potential",
        "depletion_width",
        "debye_length",
        "hall_coefficient",
        "mobility_model",
        "thermal_velocity",
        "sheet_carrier_density",
        "diffusion_coeff",
        "diffusion_length",
        "dos_effective_mass",
        "material_presets",
    },
    "superconductor": {
        "london_depth",
        "coherence_length",
        "gl_parameter",
        "critical_fields",
        "depairing_current",
        "bcs_gap",
        "material_presets",
    },
    "thinfilm": {
        "deposition_rate",
        "sputter_rate",
        "kiessig_thickness",
        "stoney_stress",
        "projected_range",
        "multilayer_thermal_conductivity",
        "thermal_mismatch_strain",
        "diffusion_length_thermal",
        "dose_from_current",
        "dose_to_concentration",
        "sauerbrey",
        "scherrer_grain_size",
    },
    "magnetic": {
        "moment_convert",
        "bohr_magneton_convert",
        "demag_factor",
        "demag_named",
        "curie_weiss_moment",
        "curie_weiss_fit",
        "langevin",
        "magnetization",
        "domain_wall",
        "moment_per_atom",
    },
}

_EXPECTED_OPERATION_NAMES = {
    f"{domain}.{operation}"
    for domain, operations in _EXPECTED_OPERATIONS_BY_DOMAIN.items()
    for operation in operations
}


def test_catalog_integrity() -> None:
    ops = list_calculators()
    assert len(ops) == len(CALCULATORS)
    # names unique + <domain>.<op> shaped; every op resolves + summarizes
    names = [o["name"] for o in ops]
    assert len(names) == len(set(names))
    for name, op in CALCULATORS.items():
        assert "." in name and name.split(".", 1)[0] == op.domain
        assert callable(op.fn)
        assert op.summary, f"{name} has no docstring summary"
    assert set(names) == _EXPECTED_OPERATION_NAMES
    assert set(DOMAINS) == set(_EXPECTED_OPERATIONS_BY_DOMAIN)


def test_list_calculators_filters_by_domain() -> None:
    xr = list_calculators(domain="xray")
    assert {o["name"] for o in xr} == {
        "xray.bragg_d_spacing",
        "xray.bragg_two_theta",
        "xray.q_from_two_theta",
        "xray.two_theta_from_q",
        "xray.xray_calc",
        "xray.neutron_calc",
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
