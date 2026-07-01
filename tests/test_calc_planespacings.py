"""plane_spacings: allowed-reflection enumeration (calc/crystallography.py).

Golden-verified against ``calc.crystal.planeSpacings`` (``calc_planespacings.json``,
four cells exercising centering rules F/I/P + cubic/tetragonal/hexagonal system
inference + the canonical-hkl tie-break). Also standalone reference-value tests so
coverage holds without the frozen JSON.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.crystallography import plane_spacings

# golden key (MATLAB camelCase) → python key
_KEY_MAP = {
    "hkl": "hkl",
    "d": "d",
    "twoTheta": "two_theta",
    "multiplicity": "multiplicity",
    "centering": "centering",
    "system": "system",
    "nReflections": "n_reflections",
}

# freeze inputs (mirror psFreeze in tools/matlab/freeze_calc_values.m)
_CASES: dict[str, dict[str, Any]] = {
    "fcc": {"a": 5.4307, "centering": "F", "max_hkl": 4},
    "bcc": {"a": 2.867, "centering": "I", "max_hkl": 3},
    "tetrag": {"a": 3.905, "c": 3.95, "centering": "P", "max_hkl": 2},
    "hex": {"a": 4.758, "c": 12.991, "gamma": 120.0, "centering": "P", "max_hkl": 3},
}


@pytest.mark.golden
def test_planespacings_golden(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    ref = load_golden("calc_planespacings.json")
    for case, kwargs in _CASES.items():
        assert case in ref, f"golden missing case {case}"
        got = plane_spacings(kwargs.pop("a"), **kwargs)  # type: ignore[arg-type]
        exp = ref[case]
        assert got["system"] == exp["system"], f"{case}: system"
        assert got["centering"] == exp["centering"], f"{case}: centering"
        assert got["n_reflections"] == exp["nReflections"], f"{case}: nReflections"
        # canonical hkl must match exactly (int tie-break parity)
        assert got["hkl"] == [list(row) for row in exp["hkl"]], f"{case}: hkl"
        assert got["multiplicity"] == list(exp["multiplicity"]), f"{case}: multiplicity"
        np.testing.assert_allclose(got["d"], exp["d"], rtol=1e-9, atol=1e-12, err_msg=case)
        np.testing.assert_allclose(
            got["two_theta"],
            np.asarray(exp["twoTheta"], dtype=float),
            rtol=1e-9,
            atol=1e-9,
            equal_nan=True,
            err_msg=case,
        )


# ── standalone reference-value tests (no golden needed) ──────────────────────
def test_fcc_first_reflection_is_111() -> None:
    r = plane_spacings(5.4307, centering="F", max_hkl=4)
    assert r["system"] == "cubic"
    assert r["hkl"][0] == [1, 1, 1]
    # Si (111) with Cu Kα: d≈3.1354 Å, 2θ≈28.44°, {111} multiplicity 8
    assert r["d"][0] == pytest.approx(5.4307 / np.sqrt(3), rel=1e-9)
    assert r["two_theta"][0] == pytest.approx(28.444, abs=1e-2)
    assert r["multiplicity"][0] == 8


def test_fcc_forbids_100_and_110() -> None:
    # FCC allows only all-odd / all-even hkl → (100),(110) are absent.
    r = plane_spacings(4.0, centering="F", max_hkl=2)
    assert all(hkl not in r["hkl"] for hkl in ([1, 0, 0], [1, 1, 0], [2, 1, 0]))
    # every listed reflection obeys the parity rule
    for h, k, l in r["hkl"]:
        parity = (h % 2, k % 2, l % 2)
        assert parity in ((0, 0, 0), (1, 1, 1))


def test_bcc_first_reflection_is_110() -> None:
    r = plane_spacings(2.867, centering="I", max_hkl=3)
    # α-Fe BCC: first allowed reflection is {110} at 2θ≈44.67°
    assert sorted(abs(x) for x in r["hkl"][0]) == [0, 1, 1]
    assert r["two_theta"][0] == pytest.approx(44.67, abs=0.05)
    # I-centering: h+k+l even for every reflection
    assert all((h + k + l) % 2 == 0 for h, k, l in r["hkl"])


def test_reflections_sorted_by_descending_d() -> None:
    r = plane_spacings(5.4307, centering="F", max_hkl=4)
    d = r["d"]
    assert all(d[i] >= d[i + 1] for i in range(len(d) - 1))


def test_system_inference() -> None:
    assert plane_spacings(4.0)["system"] == "cubic"
    assert plane_spacings(4.0, c=5.0)["system"] == "tetragonal"
    assert plane_spacings(4.0, c=5.0, gamma=120.0)["system"] == "hexagonal"
    assert plane_spacings(4.0, b=5.0, c=6.0)["system"] == "orthorhombic"
    assert plane_spacings(4.0, b=5.0, c=6.0, beta=100.0)["system"] == "triclinic"


def test_nan_wavelength_gives_nan_two_theta() -> None:
    r = plane_spacings(4.0, lambda_=float("nan"), max_hkl=2)
    assert all(np.isnan(t) for t in r["two_theta"])


def test_invalid_inputs_raise() -> None:
    with pytest.raises(ValueError, match="positive and finite"):
        plane_spacings(-1.0)
    with pytest.raises(ValueError, match="max_hkl"):
        plane_spacings(4.0, max_hkl=0)
