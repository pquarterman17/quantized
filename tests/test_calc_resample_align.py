"""Direct calc-layer coverage for ``calc.resample_align`` (audit P2.5 review):
the route tests (``test_transform_resample_route.py``) already pin every
grid mode and warning through the HTTP boundary; these pin two refactors at
the calc layer itself.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.resample import resample_data
from quantized.calc.resample_align import align_resample
from quantized.datastruct import DataStruct


def _ds(x: list[float], y: list[float]) -> DataStruct:
    return DataStruct.create(x, y, labels=["M"], units=["emu"])


def test_n_points_grid_matches_an_explicit_grid_call_bit_for_bit() -> None:
    """Finding #8: the n_points branch was folded into the same
    ``resample_data(..., grid=grid, ...)`` call every other mode already
    used. Its result must still equal `resample_data`'s own linspace path
    exactly -- not just approximately."""
    data = _ds([0.0, 0.7, 1.9, 3.1, 4.0], [1.0, 3.0, 2.0, 5.0, 4.0])
    res = align_resample(data, mode="n_points", n_points=9, method="pchip")
    ref = resample_data(data, n_points=9, method="pchip")
    np.testing.assert_array_equal(res.data.time, ref.time)
    np.testing.assert_array_equal(res.data.values, ref.values)


def test_blank_output_is_never_reported_on_a_coincident_grid() -> None:
    """Finding #8: the blank-output scan is gated by `if not coincident`
    now, rather than repeating `and not coincident` per column -- a
    coincident grid (mode="match" onto the source's own x) must still never
    emit a "blank-output" warning, even with NaNs in y."""
    data = _ds([0.0, 1.0, 2.0, 3.0], [0.0, float("nan"), 2.0, 3.0])
    res = align_resample(data, mode="match", match_x=[0.0, 1.0, 2.0, 3.0], match_x_unit="")
    assert "blank-output" not in [w["code"] for w in res.warnings]


def test_blank_output_is_still_reported_on_a_new_grid() -> None:
    """The same refactor must not silence the warning on a genuinely new
    grid (a channel whose data stops short of the resampled range)."""
    data = _ds([0.0, 1.0, 2.0, 3.0, 4.0], [0.0, 10.0, 20.0, float("nan"), float("nan")])
    res = align_resample(data, mode="n_points", n_points=9)
    codes = [w["code"] for w in res.warnings]
    assert "blank-output" in codes


@pytest.mark.parametrize(
    "grid",
    [{"mode": "step", "step": 0.1}, {"mode": "range", "start": 0.0, "stop": 0.3, "step": 0.1}],
)
def test_step_and_range_grids_land_exactly_on_the_stop_value(grid: dict) -> None:
    """Finding #6: the root ``_colon`` fix, exercised through the calc layer
    directly (the route test pins the same behaviour through the wire)."""
    data = _ds([0.0, 0.1, 0.2, 0.3], [0.0, 1.0, 2.0, 3.0])
    res = align_resample(data, **grid)
    assert res.data.time[-1] == 0.3
    assert res.warnings == []
