"""SIMS comparison table + decade offsets (audit P2.3, box 3):
``calc.sims_compare`` and ``calc.plot_log_offsets``."""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.plot_log_offsets import (
    apply_log_offsets,
    log_offset_decades,
    log_offset_suffix,
    scale_error_spans,
)
from quantized.calc.plotting import PlotSeries
from quantized.calc.sims_compare import compare_profiles
from quantized.calc.sims_depth import is_length_unit
from quantized.datastruct import DataStruct


def _p(
    x: list[float], cols: dict[str, list[float]], x_unit: str = "nm",
    units: list[str] | None = None, **kw: object,
) -> DataStruct:
    return DataStruct.create(
        x, np.array(list(cols.values()), dtype=float).T, labels=list(cols),
        units=units or ["atoms/cm3"] * len(cols),
        metadata={"x_column_name": "Depth", "x_column_unit": x_unit}, **kw,  # type: ignore[arg-type]
    )


A = _p([0.0, 10.0, 20.0], {"B": [1.0, 2.0, 3.0], "Si": [9.0, 9.0, 9.0]})
# Same species, other order, other sample, depth in Angstrom.
S2 = _p([0.0, 50.0, 100.0, 150.0], {"Si": [8.0] * 4, "B": [4.0, 5.0, 6.0, 7.0]}, x_unit="A")


def _col(d: DataStruct, label: str) -> list[float | None]:
    j = d.labels.index(label)
    return [None if math.isnan(v) else float(v) for v in d.values[:, j]]


def test_row_blocks_by_name_with_an_exact_depth_conversion() -> None:
    res = compare_profiles([("a.csv", A), ("s2.csv", S2)], ["B"])
    d = res.data
    # Profile a's 3 rows, then s2's 4 rows; s2's Angstrom converted to nm
    # (x 0.1, an exact power of ten).
    assert d.time.tolist() == [0.0, 10.0, 20.0, 0.0, 5.0, 10.0, 15.0]
    assert list(d.labels) == ["B — a", "B — s2"]
    # Each trace is a contiguous run of its OWN samples, blank elsewhere --
    # nothing interpolated, and s2's B found by NAME despite the column order.
    assert _col(d, "B — a") == [1.0, 2.0, 3.0, None, None, None, None]
    assert _col(d, "B — s2") == [None, None, None, 4.0, 5.0, 6.0, 7.0]
    assert list(d.units) == ["atoms/cm3", "atoms/cm3"]
    assert d.metadata["x_column_unit"] == "nm" and d.metadata["technique"] == "sims"
    prov = d.metadata["sims_comparison"]
    assert prov["x_conversions"] == [{"profile": "s2.csv", "from": "A", "factor": 0.1}]
    assert [t["rows"] for t in prov["traces"]] == [[0, 3], [3, 7]]
    assert [w["code"] for w in res.warnings] == ["x-converted"]


def test_one_profile_several_species_keeps_plain_names() -> None:
    res = compare_profiles([("a.csv", A)], ["Si", "B"])
    assert list(res.data.labels) == ["Si", "B"]
    assert res.data.time.tolist() == [0.0, 10.0, 20.0]
    assert res.warnings == []


def test_missing_species_is_reported_and_mixed_units_warned() -> None:
    s3 = _p([0.0, 1.0], {"B": [1.0, 2.0]}, units=["c/s"])
    res = compare_profiles([("a", A), ("s3", s3)], ["B", "Si"])
    assert list(res.data.labels) == ["B — a", "Si — a", "B — s3"]
    codes = {w["code"]: w for w in res.warnings}
    assert codes["missing-species"]["text"] == "no trace for Si in s3 (no such column)"
    assert codes["mixed-units"]["columns"] == ["B"]


def test_same_file_name_twice_gets_distinct_labels() -> None:
    res = compare_profiles([("x.csv", A), ("dir/x.csv", A)], ["B"])
    assert list(res.data.labels) == ["B — x", "B — x #2"]


@pytest.mark.parametrize(
    ("profiles", "species", "msg"),
    [
        ([], ["B"], "at least one profile"),
        ([("a", A)], ["  "], "at least one species"),
        ([("a", A)], ["P"], "none of the profiles has 'P'"),
        ([("a", A), ("t", _p([0.0, 1.0], {"B": [1.0, 2.0]}, x_unit="s"))], ["B"],
         r"not depth units: t \(s\)"),
        ([("a", _p([0.0, 1.0], {"B": [1.0, 2.0], "B ": [1.0, 1.0]}))], ["B"], None),
    ],
)
def test_refusals(
    profiles: list[tuple[str, DataStruct]], species: list[str], msg: str | None
) -> None:
    if msg is None:  # "B " is a different name: no refusal, one trace
        assert list(compare_profiles(profiles, species).data.labels) == ["B"]
        return
    with pytest.raises(ValueError, match=msg):
        compare_profiles(profiles, species)


def test_categorical_columns_are_refused() -> None:
    # (Two columns of one name cannot reach here: DataStruct de-duplicates
    # labels to "B", "B (2)", so a by-name pick is never ambiguous.)
    cat = _p([0.0, 1.0], {"B": [0.0, 1.0]}, cat_levels={0: ("lo", "hi")})
    with pytest.raises(ValueError, match="categorical"):
        compare_profiles([("c", cat)], ["B"])


def test_same_non_length_unit_is_copied_as_is() -> None:
    t1 = _p([0.0, 1.0], {"B": [1.0, 2.0]}, x_unit="s")
    t2 = _p([0.0, 2.0], {"B": [3.0, 4.0]}, x_unit="s")
    res = compare_profiles([("t1", t1), ("t2", t2)], ["B"])
    assert res.data.time.tolist() == [0.0, 1.0, 0.0, 2.0]
    assert res.data.metadata["x_column_unit"] == "s"


# ── finding 10 dedupe: one `is_length_unit`, shared by sims_compare's x-unit
# compatibility check and sims_region's areal-dose eligibility ────────────


@pytest.mark.parametrize(
    ("unit", "want"),
    [("nm", True), ("A", True), ("Å", True), ("um", True), ("cm", True),
     ("s", False), ("min", False), ("", False), ("   ", False), ("atoms/cm3", False)],
)
def test_is_length_unit(unit: str, want: bool) -> None:
    assert is_length_unit(unit) is want


# ── decade offsets ─────────────────────────────────────────────────────────


def test_log_offsets_scale_by_whole_decades_and_suffix_the_label() -> None:
    s = [PlotSeries("B", "atoms/cm3", np.array([1.0, 10.0])),
         PlotSeries("Si", "atoms/cm3", np.array([2.0, math.nan]))]
    out = apply_log_offsets(s, [0, -3])
    assert out[0] is s[0]
    assert out[1].label == "Si ×10^-3" and out[1].unit == "atoms/cm3"
    assert out[1].values[0] == pytest.approx(2e-3) and math.isnan(out[1].values[1])
    assert apply_log_offsets(s, None) == s


@pytest.mark.parametrize(
    ("v", "k"),
    [(2, 2), (2.0, 2), (-1, -1), (1.5, 0), (True, 0), ("2", 0), (math.inf, 0), (31, 0), (30, 30)],
)
def test_malformed_offsets_degrade_to_none(v: object, k: int) -> None:
    assert log_offset_decades(v) == k


def test_suffix_text() -> None:
    assert (log_offset_suffix(0), log_offset_suffix(2), log_offset_suffix(-1)) == (
        "", " ×10^2", " ×10^-1",
    )


# ── finding 3: error spans scale with the same decade offsets ──────────────


def test_scale_error_spans_scales_only_the_y_half_by_the_same_10_power_k() -> None:
    spans: list[dict[str, object] | None] = [
        {"y": {"plus": [1.0, 2.0], "minus": [0.5, None]}},
        None,
        {"x": {"plus": [5.0], "minus": [5.0]}, "y": {"plus": [4.0], "minus": [4.0]}},
    ]
    out = scale_error_spans(spans, [2, 0, -1])
    assert out is not None
    assert out[0] == {"y": {"plus": [100.0, 200.0], "minus": [50.0, None]}}
    assert out[1] is None  # untouched
    ch2 = out[2]
    assert ch2 is not None
    assert ch2["x"] == {"plus": [5.0], "minus": [5.0]}  # X untouched by a Y-only offset
    assert ch2["y"] == {"plus": [0.4], "minus": [0.4]}


def test_scale_error_spans_is_a_no_op_with_no_offsets_or_no_spans() -> None:
    spans = [{"y": {"plus": [1.0], "minus": [1.0]}}]
    assert scale_error_spans(spans, None) is spans
    assert scale_error_spans(spans, [0]) is spans
    assert scale_error_spans(None, [2]) is None
