from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.magnetic_curie_weiss_data import curie_weiss_data_fit


def synthetic_moment() -> tuple[list[float], list[float], list[float]]:
    temperature = np.linspace(100.0, 400.0, 61)
    field = np.full(temperature.size, 1000.0)
    # C=4 cm3 K/mol, theta=50 K; 0.1 g of a 200 g/mol material.
    chi_molar = 4.0 / (temperature - 50.0)
    moment = chi_molar * field * (0.1 / 200.0)
    return temperature.tolist(), moment.tolist(), field.tolist()


def test_total_moment_is_converted_to_molar_susceptibility_and_fit() -> None:
    temperature, moment, field = synthetic_moment()
    result = curie_weiss_data_fit(
        temperature,
        moment,
        response_basis="total_moment",
        field=field,
        field_unit="Oe",
        sample_mass_g=0.1,
        molar_mass_g_mol=200.0,
        fit_range=(150.0, 400.0),
    )
    assert result["C"] == pytest.approx(4.0, rel=1e-10)
    assert result["theta_cw"] == pytest.approx(50.0, rel=1e-10)
    assert result["n_fit"] == 51
    assert result["susceptibility_molar"][0] == pytest.approx(0.08)
    assert math.isnan(result["fit_inv_chi"][0])
    assert result["fit_inv_chi"][-1] == pytest.approx(87.5)


def test_mass_normalized_moment_needs_no_sample_mass_and_converts_tesla() -> None:
    temperature, moment, field = synthetic_moment()
    moment_per_g = (np.asarray(moment) / 0.1).tolist()
    result = curie_weiss_data_fit(
        temperature,
        moment_per_g,
        response_basis="mass_moment",
        field=(np.asarray(field) / 1e4).tolist(),
        field_unit="T",
        molar_mass_g_mol=200.0,
        fit_range=(150.0, 400.0),
    )
    assert result["C"] == pytest.approx(4.0, rel=1e-10)
    assert result["theta_cw"] == pytest.approx(50.0, rel=1e-10)


def test_response_uncertainty_propagates_through_chi_and_inverse() -> None:
    result = curie_weiss_data_fit(
        [100.0, 200.0, 300.0],
        [0.04, 0.02, 0.01],
        response_basis="molar_susceptibility",
        fit_range=(100.0, 300.0),
        response_errors=[[0.004, 0.002, 0.001]],
    )
    assert result["susceptibility_errors_molar"][0] == [0.004, 0.002, 0.001]
    assert result["inverse_errors"][0] == pytest.approx([2.5, 5.0, 10.0])


def test_zero_field_and_nonpositive_chi_are_excluded_without_changing_rows() -> None:
    result = curie_weiss_data_fit(
        [100.0, 150.0, 200.0, 250.0, 300.0, 350.0],
        [1.0, 0.0, 1.0, -1.0, 1.0, 0.5],
        response_basis="total_moment",
        field=[100.0, 100.0, 0.0, 100.0, 100.0, 100.0],
        field_unit="Oe",
        sample_mass_g=1.0,
        molar_mass_g_mol=1.0,
        fit_range=(100.0, 350.0),
    )
    assert len(result["susceptibility_molar"]) == 6
    assert math.isnan(result["susceptibility_molar"][2])
    assert result["excluded_nonpositive"] == 2
    assert result["fit_mask"] == [True, False, False, False, True, True]


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"sample_mass_g": None, "molar_mass_g_mol": 200.0}, "sample mass"),
        ({"sample_mass_g": 0.1, "molar_mass_g_mol": 0.0}, "molar mass"),
        ({"sample_mass_g": 0.1, "molar_mass_g_mol": 200.0, "field_unit": "G"}, "Unknown source"),
    ],
)
def test_total_moment_requires_explicit_supported_sample_context(
    kwargs: dict[str, float | str | None], message: str
) -> None:
    temperature, moment, field = synthetic_moment()
    with pytest.raises(ValueError, match=message):
        curie_weiss_data_fit(
            temperature,
            moment,
            response_basis="total_moment",
            field=field,
            fit_range=(150.0, 400.0),
            **kwargs,  # type: ignore[arg-type]
        )


def test_explicit_fit_range_never_falls_back_to_other_rows() -> None:
    with pytest.raises(ValueError, match="only 2"):
        curie_weiss_data_fit(
            [100.0, 200.0, 300.0, 400.0],
            [0.1, 0.05, 0.03, 0.02],
            response_basis="molar_susceptibility",
            fit_range=(300.0, 400.0),
        )


def test_nonfinite_susceptibility_cannot_leak_into_legacy_fit() -> None:
    result = curie_weiss_data_fit(
        [100.0, 150.0, 200.0, 250.0],
        [0.04, math.inf, 0.02, 0.016],
        response_basis="molar_susceptibility",
        fit_range=(100.0, 250.0),
    )
    assert result["fit_mask"] == [True, False, True, True]
    assert math.isnan(result["inv_chi"][1])
    assert result["n_fit"] == 3


def test_fit_requires_temperature_variation() -> None:
    with pytest.raises(ValueError, match="distinct temperature"):
        curie_weiss_data_fit(
            [200.0, 200.0, 200.0],
            [0.04, 0.03, 0.02],
            response_basis="molar_susceptibility",
            fit_range=(100.0, 300.0),
        )


def test_applied_field_uncertainty_adds_in_quadrature_and_converts_units() -> None:
    temperature, moment, field = synthetic_moment()
    sigma_m = np.asarray(moment) * 0.01  # 1 % moment error
    sigma_h_t = np.full(len(field), 0.0001)  # 1 Oe expressed in tesla (0.1 % of 1000 Oe)
    kwargs: dict = {
        "response_basis": "total_moment", "sample_mass_g": 0.1, "molar_mass_g_mol": 200.0,
        "fit_range": (150.0, 400.0),
    }
    both = curie_weiss_data_fit(
        temperature, moment, field=(np.asarray(field) / 1e4).tolist(), field_unit="T",
        response_errors=[sigma_m.tolist()], field_errors=[sigma_h_t.tolist()], **kwargs,
    )
    chi = 4.0 / (np.asarray(temperature) - 50.0)
    # relative errors 1 % (moment) and 0.1 % (field) add in quadrature
    rel = math.hypot(0.01, 0.001)
    assert both["susceptibility_errors_molar"][0] == pytest.approx((chi * rel).tolist(), rel=1e-9)
    assert both["inverse_errors"][0] == pytest.approx((rel / chi).tolist(), rel=1e-9)
    # field uncertainty alone -> one series carrying only the field part
    only_h = curie_weiss_data_fit(
        temperature, moment, field=field, field_unit="Oe",
        field_errors=[np.full(len(field), 1.0).tolist()],
        **kwargs,
    )
    assert len(only_h["inverse_errors"]) == 1
    expected = (chi * 0.001).tolist()
    assert only_h["susceptibility_errors_molar"][0] == pytest.approx(expected, rel=1e-9)


def test_applied_field_uncertainty_fails_closed() -> None:
    temperature, moment, field = synthetic_moment()
    with pytest.raises(ValueError, match="applied-field uncertainty series must match"):
        curie_weiss_data_fit(temperature, moment, response_basis="total_moment", field=field,
                             sample_mass_g=0.1, molar_mass_g_mol=200.0, fit_range=(150.0, 400.0),
                             field_errors=[[1.0, 2.0]])
    with pytest.raises(ValueError, match="already-molar"):
        curie_weiss_data_fit(temperature, moment, response_basis="molar_susceptibility",
                             fit_range=(150.0, 400.0), field_errors=[field])
