"""Average multiple curves (origin gap audit 2, #9): ``calc.curve_average``.

No golden: Origin's tool is GUI-only and quantized_matlab has no N-curve
average, so every statistic here is hand-computed.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.curve_average import average_curves
from quantized.datastruct import DataStruct


def _ds(
    x: list[float], y: list[float], *, label: str = "M", unit: str = "emu", xu: str = "K"
) -> DataStruct:
    return DataStruct.create(
        np.asarray(x, dtype=float),
        np.asarray(y, dtype=float).reshape(-1, 1),
        labels=[label],
        units=[unit],
        metadata={"xUnit": xu},
    )


def _col(r: DataStruct, c: int) -> list[float]:
    return [float(v) for v in np.asarray(r.values, dtype=float)[:, c]]


def test_same_grid_mean_sd_sem_n() -> None:
    a = _ds([0, 1, 2], [1, 2, 3])
    b = _ds([0, 1, 2], [3, 4, 5])
    c = _ds([0, 1, 2], [2, 3, 7])
    r = average_curves([a, b, c], names=["a", "b", "c"]).data
    assert list(r.time) == [0, 1, 2]
    assert list(r.labels) == ["M mean", "M SD", "M SEM", "N"]
    assert list(r.units) == ["emu", "emu", "emu", ""]
    assert _col(r, 0) == pytest.approx([2, 3, 5])
    sd = [1.0, 1.0, 2.0]  # sample SD (ddof 1) of (1,3,2), (2,4,3), (3,5,7)
    assert _col(r, 1) == pytest.approx(sd)
    assert _col(r, 2) == pytest.approx([s / math.sqrt(3) for s in sd])
    assert _col(r, 3) == [3, 3, 3]


def test_union_grid_linear_interp_and_partial_coverage() -> None:
    a = _ds([0, 2, 4], [0, 20, 40])
    b = _ds([1, 3], [100, 300])
    res = average_curves([a, b], names=["a", "b"], grid="union")
    r = res.data
    assert list(r.time) == [0, 1, 2, 3, 4]
    # a at 1 and 3 is linear: 10, 30. b covers only [1, 3]: 200 at 2.
    mean = _col(r, 0)
    assert mean[0] == pytest.approx(0)  # only a
    assert mean[1] == pytest.approx((10 + 100) / 2)
    assert mean[2] == pytest.approx((20 + 200) / 2)
    assert mean[4] == pytest.approx(40)
    assert _col(r, 3) == [1, 2, 2, 2, 1]
    assert math.isnan(_col(r, 1)[0])  # SD needs >= 2 curves
    codes = [w["code"] for w in res.warnings]
    assert codes.count("out-of-range") == 1  # the partial coverage, reported once
    assert res.overlap == (1.0, 3.0)


def test_step_grid_over_overlap_only() -> None:
    a = _ds([0, 10], [0, 10])
    b = _ds([2, 12], [2, 12])
    r = average_curves([a, b], grid="step", step=2).data
    assert list(r.time) == [2, 4, 6, 8, 10]
    assert _col(r, 0) == pytest.approx([2, 4, 6, 8, 10])
    assert _col(r, 3) == [2] * 5
    assert r.metadata["averageGrid"] == "step"


def test_refusals() -> None:
    a = _ds([0, 1], [0, 1])
    with pytest.raises(ValueError, match="at least two"):
        average_curves([a])
    with pytest.raises(ValueError, match="do not overlap"):
        average_curves([a, _ds([5, 6], [0, 1])], grid="step", step=0.5)
    with pytest.raises(ValueError, match="positive"):
        average_curves([a, a], grid="step", step=0)
    with pytest.raises(ValueError, match='no column named "R"'):
        average_curves([a, a], channel="R")


def test_direction_reversal_refused_unless_sorted() -> None:
    loop = _ds([0, 1, 2, 1, 0], [0, 1, 2, 3, 4])
    line = _ds([0, 1, 2], [0, 1, 2])
    with pytest.raises(ValueError, match="not monotonic"):
        average_curves([loop, line], names=["loop", "line"])
    res = average_curves([loop, line], names=["loop", "line"], unsorted="sort")
    assert any(w["code"] == "reordered" and w["text"].startswith('"loop"') for w in res.warnings)


def test_unit_mismatch_refused_then_confirmed() -> None:
    a = _ds([0, 1], [0, 1], unit="emu")
    b = _ds([0, 1], [0, 1], unit="A/m")
    with pytest.raises(ValueError, match="y units differ"):
        average_curves([a, b])
    res = average_curves([a, b], allow_unit_mismatch=True)
    assert any(w.get("confirm") for w in res.warnings)
    with pytest.raises(ValueError, match="x units differ"):
        average_curves([a, _ds([0, 1], [0, 1], xu="Oe")])


def test_channel_by_name_and_first_numeric_default() -> None:
    two = DataStruct.create(
        np.array([0.0, 1.0]),
        np.array([[1.0, 5.0], [2.0, 6.0]]),
        labels=["T", "R"],
        units=["K", "ohm"],
    )
    r = average_curves([two, two], channel="R").data
    assert r.labels[0] == "R mean"
    assert _col(r, 0) == pytest.approx([5, 6])
    assert average_curves([two, two]).data.labels[0] == "T mean"
