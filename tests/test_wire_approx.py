"""The wire-fixture tree comparison: floats within a tolerance, everything else exact."""

from __future__ import annotations

import pytest

from _wire_approx import assert_tree_close


def test_a_last_bit_float_difference_passes() -> None:
    x = 18.54231616329601
    pinned = {"probes": [{"xy": [0.45, 0.3], "z": x}]}
    derived = {"probes": [{"xy": [0.45, 0.3], "z": x * (1 + 4e-16)}]}
    assert_tree_close(pinned, derived)


@pytest.mark.parametrize(
    ("expected", "actual"),
    [
        ({"z": 1.0}, {"z": 1.0 + 1e-6}),  # a real change in a pinned number
        ({"z": 1.0}, {"z": None}),  # a value turned into a gap
        ({"z": None}, {"z": 0.0}),
        ({"a": 1}, {"a": 1, "b": 2}),  # a new key
        ([1.0, 2.0], [1.0]),  # a dropped element
        ({"rgb": [12, 34, 56]}, {"rgb": [12, 34, 57]}),  # ints stay exact
        ({"kind": "contour"}, {"kind": "heatmap"}),
        ({"on": True}, {"on": False}),
    ],
)
def test_a_real_difference_fails_and_names_the_path(expected: object, actual: object) -> None:
    with pytest.raises(AssertionError, match=r"\$"):
        assert_tree_close(expected, actual)
