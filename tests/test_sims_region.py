"""SIMS region measures (audit P2.3, box 4): ``calc.sims_region``.

No MATLAB reference exists, so every expected number below is computed by
hand in the comment beside it (trapezoid areas, interpolated crossings).
"""

from __future__ import annotations

import csv
import io
import math
from typing import Any

import numpy as np
import pytest

from quantized.calc.sims_region import (
    areal_dose_unit,
    region_measures,
    region_summary_csv,
    threshold_crossings,
)
from quantized.datastruct import DataStruct

# depth 0..40 nm every 10 nm; B is a symmetric implant peaking at 20 nm.
X = [0.0, 10.0, 20.0, 30.0, 40.0]
B = [1e18, 3e18, 5e18, 3e18, 1e18]
SI = [5e22, 5e22, 5e22, 5e22, 5e22]


def _ds(
    x: list[float] = X,
    cols: dict[str, list[float]] | None = None,
    units: list[str] | None = None,
    x_unit: str = "nm",
    **kw: Any,
) -> DataStruct:
    cols = cols if cols is not None else {"B": B, "Si": SI}
    values = np.array(list(cols.values()), dtype=float).T
    return DataStruct.create(
        x, values, labels=list(cols), units=units or ["atoms/cm3"] * len(cols),
        metadata={"x_column_name": "Depth", "x_column_unit": x_unit}, **kw,
    )


def _sp(res: dict[str, Any], name: str) -> dict[str, Any]:
    return next(s for s in res["species"] if s["name"] == name)


def test_full_region_dose_peak_mean_and_junctions_by_hand() -> None:
    res = region_measures(_ds(), lo=0, hi=40)
    b = _sp(res, "B")
    # trapezoid: (1+3)/2*10 + (3+5)/2*10 + (5+3)/2*10 + (3+1)/2*10 = 120 (e18 * nm)
    # 120e18 atoms/cm3 * nm = 120e18 * 1e-7 cm -> 1.2e13 atoms/cm2
    assert b["integral"] == pytest.approx(1.2e13, rel=1e-12)
    assert b["integral_unit"] == "atoms/cm^2"
    assert b["integral_kind"] == "areal-dose"
    assert (b["integrated_from"], b["integrated_to"]) == (0.0, 40.0)
    assert b["peak"] == 5e18 and b["peak_depth"] == 20.0
    assert b["mean"] == pytest.approx(13e18 / 5)  # (1+3+5+3+1)/5
    # 50% of peak = 2.5e18. Rising: 0 + (2.5-1)/(3-1)*10 = 7.5 nm;
    # falling: 30 + (2.5-3)/(1-3)*10 = 32.5 nm. Both crossings are listed, but
    # the junction (metallurgical-junction convention) is the first FALLING
    # one at or beyond the peak (20 nm): 32.5 nm, not the leading (rising)
    # edge at 7.5 nm.
    assert b["threshold"] == pytest.approx(2.5e18)
    assert [(c["depth"], c["direction"]) for c in b["crossings"]] == [
        pytest.approx((7.5, "rising")), pytest.approx((32.5, "falling")),
    ]
    assert b["junction_depth"] == pytest.approx(32.5)
    assert b["junction_direction"] == "falling"
    # A flat matrix signal never crosses half its own peak.
    si = _sp(res, "Si")
    assert si["crossings"] == [] and si["junction_depth"] is None
    assert si["integral"] == pytest.approx(5e22 * 40 * 1e-7)  # 2e17 atoms/cm2
    assert [w["code"] for w in res["warnings"]] == ["no-crossing"]
    assert res["rows_in_region"] == 5


def test_junction_is_the_deepest_leading_edge_falling_crossing_not_the_first() -> None:
    # Sabotage-verify 1: a buried implant, Gaussian in depth, peaking at 60 nm
    # with a 1e15 background floor -- B = 1e19*exp(-((x-60)/25)^2) + 1e15 over
    # 0..300 nm. At 50% of its own peak the profile crosses TWICE: a rising
    # (leading, surface-side) edge at x = 60 - 25*sqrt(-ln(0.5)) ~= 39.18 nm,
    # and a falling (trailing) edge at x = 60 + 25*sqrt(-ln(0.5)) ~= 80.82 nm
    # -- solving exp(-((x-60)/25)^2) = 0.5 (the 1e15 floor is negligible next
    # to the 1e19 peak, so the closed form is accurate to ~1e-4 relative).
    # The junction (metallurgical-junction convention) is the falling one,
    # beyond the peak -- NOT the shallower, first-seen rising crossing.
    x = np.linspace(0.0, 300.0, 301)
    b = 1e19 * np.exp(-(((x - 60.0) / 25.0) ** 2)) + 1e15
    res = region_measures(_ds(x=list(x), cols={"B": list(b)}, units=["atoms/cm3"]), lo=0, hi=300)
    sp = _sp(res, "B")
    assert sp["peak_depth"] == pytest.approx(60.0, abs=1.0)
    assert [c["direction"] for c in sp["crossings"]] == ["rising", "falling"]
    rising, falling = sp["crossings"]
    assert rising["depth"] == pytest.approx(39.18, abs=0.1)
    assert falling["depth"] == pytest.approx(80.82, abs=0.1)
    assert sp["junction_depth"] == pytest.approx(80.82, abs=0.1)
    assert sp["junction_direction"] == "falling"


def test_junction_on_a_surface_peaked_profile_is_its_only_falling_crossing() -> None:
    # A profile peaking AT the region's shallow edge (no leading/rising edge
    # to exclude): decaying monotonically from 1e19 at the surface to a 1e15
    # floor. Its one crossing is a falling one at/after the peak (depth 0),
    # so the junction rule changes nothing here -- documented by the module
    # doc's "surface-peaked" case.
    x = np.linspace(0.0, 200.0, 201)
    b = 1e19 * np.exp(-x / 30.0) + 1e15
    res = region_measures(_ds(x=list(x), cols={"B": list(b)}, units=["atoms/cm3"]), lo=0, hi=200)
    sp = _sp(res, "B")
    assert sp["peak_depth"] == pytest.approx(0.0)
    assert [c["direction"] for c in sp["crossings"]] == ["falling"]
    assert sp["junction_depth"] == pytest.approx(sp["crossings"][0]["depth"])
    assert sp["junction_direction"] == "falling"


def test_sub_region_is_inclusive_with_the_shared_tolerance() -> None:
    # 10..30 inclusive: (3+5)/2*10 + (5+3)/2*10 = 80 e18 nm -> 8e12 atoms/cm2
    res = region_measures(_ds(), lo=10, hi=30)
    assert _sp(res, "B")["integral"] == pytest.approx(8e12)
    assert _sp(res, "B")["points"] == 3
    # A limit typed just short of a sample (a computed 29.999999999997) still
    # catches it; a real gap does not.
    assert region_measures(_ds(), lo=10, hi=30 * (1 - 1e-10))["rows_in_region"] == 3
    assert region_measures(_ds(), lo=10, hi=29.9)["rows_in_region"] == 2
    # Limits in either order.
    assert region_measures(_ds(), lo=30, hi=10)["region"] == [10.0, 30.0]


def test_integral_is_not_extrapolated_to_the_region_edges() -> None:
    # Region 5..35 holds samples 10, 20, 30 only: integrated 10..30, not 5..35.
    b = _sp(region_measures(_ds(), lo=5, hi=35), "B")
    assert (b["integrated_from"], b["integrated_to"]) == (10.0, 30.0)
    assert b["integral"] == pytest.approx(8e12)


def test_blank_samples_are_skipped_and_bridged_and_reported() -> None:
    b_nan = [1e18, 3e18, math.nan, 3e18, 1e18]
    res = region_measures(_ds(cols={"B": b_nan}), lo=0, hi=40)
    b = _sp(res, "B")
    # (1+3)/2*10 + (3+3)/2*20 + (3+1)/2*10 = 100 e18 nm -> 1e13
    assert b["integral"] == pytest.approx(1e13)
    assert (b["points"], b["blank"]) == (4, 1)
    blank = next(w for w in res["warnings"] if w["code"] == "blank-in-region")
    assert blank["count"] == 1 and blank["columns"] == ["B"]


def test_a_comparison_tables_row_blocks_are_not_gaps() -> None:
    # calc.sims_compare layout: trace 1 fills rows 0-2, trace 2 rows 3-4, each
    # blank elsewhere. Neither has a GAP; each integrates over its own block.
    nan = math.nan
    ds = _ds(
        x=[0.0, 10.0, 20.0, 0.0, 10.0],
        cols={"B — a": [1e18, 3e18, 1e18, nan, nan], "B — b": [nan, nan, nan, 2e18, 2e18]},
    )
    res = region_measures(ds, lo=0, hi=20)
    a, b = _sp(res, "B — a"), _sp(res, "B — b")
    assert (a["blank"], b["blank"]) == (0, 0)
    assert "blank-in-region" not in [w["code"] for w in res["warnings"]]
    # a: (1+3)/2*10 + (3+1)/2*10 = 40 e18 nm -> 4e12; b: (2+2)/2*10 = 20 -> 2e12
    assert a["integral"] == pytest.approx(4e12) and b["integral"] == pytest.approx(2e12)


def test_unsorted_depth_gives_the_same_answer() -> None:
    fwd = region_measures(_ds(), lo=0, hi=40)
    rev = region_measures(_ds(x=X[::-1], cols={"B": B[::-1], "Si": SI}), lo=0, hi=40)
    assert _sp(rev, "B")["integral"] == pytest.approx(_sp(fwd, "B")["integral"])
    assert _sp(rev, "B")["junction_depth"] == pytest.approx(32.5)


def test_raw_integral_when_units_do_not_make_a_dose() -> None:
    res = region_measures(_ds(units=["c/s", "c/s"]), lo=0, hi=40)
    b = _sp(res, "B")
    assert b["integral"] == pytest.approx(120e18)  # no cm conversion
    assert (b["integral_unit"], b["integral_kind"]) == ("c/s·nm", "raw")
    raw = next(w for w in res["warnings"] if w["code"] == "raw-integral")
    assert "not a volume concentration" in raw["text"] and raw["info"] is True
    # A concentration over a TIME axis is no dose either.
    t = _sp(region_measures(_ds(x_unit="s"), lo=0, hi=40), "B")
    assert (t["integral_unit"], t["integral_kind"]) == ("atoms/cm3·s", "raw")
    # Angstrom depth: 120e18 * A = 120e18 * 1e-8 cm
    a = _sp(region_measures(_ds(x_unit="A"), lo=0, hi=40), "B")
    assert a["integral"] == pytest.approx(1.2e12) and a["integral_kind"] == "areal-dose"


def test_absolute_threshold_and_exact_hits() -> None:
    res = region_measures(_ds(), lo=0, hi=40, threshold_mode="absolute", threshold=3e18)
    b = _sp(res, "B")
    # Samples at 10 and 30 sit exactly on 3e18: the crossings are those samples.
    assert [(c["depth"], c["direction"]) for c in b["crossings"]] == [
        (10.0, "rising"), (30.0, "falling"),
    ]


def test_threshold_crossings_rules() -> None:
    x = np.array([0.0, 1.0, 2.0])
    assert threshold_crossings(x, np.array([4.0, 2.0, 1.0]), 2.0) == [
        {"depth": 1.0, "direction": "falling"}
    ]
    # Touching the threshold without crossing it is no crossing.
    assert threshold_crossings(x, np.array([3.0, 2.0, 3.0]), 2.0) == []
    # Ending on it is no crossing either.
    assert threshold_crossings(x, np.array([3.0, 2.5, 2.0]), 2.0) == []
    # Interpolated: 0 + (2-4)/(0-4) * 1 = 0.5
    assert threshold_crossings(x[:2], np.array([4.0, 0.0]), 2.0)[0]["depth"] == 0.5


def test_non_positive_peak_has_no_fraction_threshold() -> None:
    res = region_measures(_ds(cols={"B": [-1.0, -2, -3, -2, -1]}, units=["c/s"]), lo=0, hi=40)
    assert _sp(res, "B")["threshold"] is None
    assert "no-threshold" in [w["code"] for w in res["warnings"]]


def test_one_sample_has_no_integral_and_empty_species_are_reported() -> None:
    res = region_measures(_ds(cols={"B": B, "P": [math.nan] * 5}), lo=20, hi=20)
    b, p = _sp(res, "B"), _sp(res, "P")
    assert b["integral"] is None and b["peak"] == 5e18 and b["mean"] == 5e18
    assert p["points"] == 0 and p["peak"] is None
    codes = [w["code"] for w in res["warnings"]]
    assert "single-point" in codes and "no-data" in codes


def test_columns_pick_and_categorical_rules() -> None:
    ds = _ds(cols={"B": B, "grp": [0.0, 0, 1, 1, 1]}, units=["atoms/cm3", ""],
             cat_levels={1: ("a", "b")})
    # Default skips the categorical column.
    assert [s["name"] for s in region_measures(ds, lo=0, hi=40)["species"]] == ["B"]
    with pytest.raises(ValueError, match="categorical"):
        region_measures(ds, lo=0, hi=40, columns=[1])
    with pytest.raises(ValueError, match="out of range"):
        region_measures(ds, lo=0, hi=40, columns=[5])


@pytest.mark.parametrize(
    ("kw", "msg"),
    [
        ({"lo": 100, "hi": 200}, "no rows lie in the region"),
        ({"lo": math.nan, "hi": 1}, "finite limits"),
        ({"lo": 0, "hi": 40, "threshold": 1.0}, "strictly between 0 and 1"),
        ({"lo": 0, "hi": 40, "threshold_mode": "median"}, "threshold mode"),
        ({"lo": 0, "hi": 40, "threshold": math.inf, "threshold_mode": "absolute"}, "finite"),
    ],
)
def test_refusals(kw: dict[str, Any], msg: str) -> None:
    with pytest.raises(ValueError, match=msg):
        region_measures(_ds(), **kw)


@pytest.mark.parametrize(
    ("unit", "dose"),
    [
        ("atoms/cm3", "atoms/cm^2"),
        ("atoms/cm^3", "atoms/cm^2"),
        ("atoms/cm³", "atoms/cm^2"),
        ("at./cm3", "at/cm^2"),
        ("atoms cm-3", "atoms/cm^2"),
        ("cm-3", "cm^-2"),
        ("cm^-3", "cm^-2"),
        ("cm⁻³", "cm^-2"),
        ("/cm3", "cm^-2"),
        ("c/s", None),
        ("atoms/cm2", None),
        ("ratio to Si", None),
        ("", None),
    ],
)
def test_areal_dose_unit(unit: str, dose: str | None) -> None:
    assert areal_dose_unit(unit) == dose


def test_summary_csv_carries_provenance_and_one_row_per_species() -> None:
    res = region_measures(_ds(), lo=0, hi=40)
    text = region_summary_csv(res, dataset="implant.csv")
    comments = [ln for ln in text.splitlines() if ln.startswith("#")]
    assert comments[0] == "# SIMS region measures"
    assert "# dataset: implant.csv" in comments
    assert any(c.startswith("# region: Depth 0 to 40 nm (inclusive") for c in comments)
    assert any("50% of each species' peak" in c for c in comments)
    assert any(c.startswith("# warning: Si never crosses") for c in comments)
    rows = list(csv.DictReader(io.StringIO("\n".join(
        ln for ln in text.splitlines() if not ln.startswith("#")
    ))))
    assert [r["species"] for r in rows] == ["B", "Si"]
    assert float(rows[0]["integral"]) == pytest.approx(1.2e13)
    assert rows[0]["integral unit"] == "atoms/cm^2"
    assert float(rows[0]["junction depth (nm)"]) == pytest.approx(32.5)
    assert rows[0]["junction direction"] == "falling"
    assert rows[0]["all crossings (nm)"] == "7.5 rising; 32.5 falling"
    assert rows[1]["junction depth (nm)"] == ""
