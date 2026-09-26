"""calc.fit_holds.check_held_starts -- the shared held-start guard (P2.7 review)."""

from __future__ import annotations

import pytest

from quantized.calc.fit_holds import check_held_starts


def test_nothing_held_is_always_fine() -> None:
    check_held_starts(["a"], [99.0], None, [0.0], [1.0])
    check_held_starts(["a"], [99.0], [False], [0.0], [1.0])


def test_held_inside_or_on_its_bounds_is_fine() -> None:
    check_held_starts(["a", "b"], [0.0, 1.0], [True, True], [0.0, None], [None, 1.0])
    check_held_starts(["a"], [7.0], [True], None, None)


@pytest.mark.parametrize(
    ("p0", "lower", "upper"),
    [([-1.0], [0.0], None), ([2.0], None, [1.0]), ([2.0], [None], [1.0])],
)
def test_held_outside_its_bounds_is_refused(
    p0: list[float], lower: list[float | None] | None, upper: list[float | None] | None
) -> None:
    with pytest.raises(ValueError, match='"a" is held at .*, outside its bounds'):
        check_held_starts(["a"], p0, [True], lower, upper)


def test_unnamed_parameter_is_labelled_by_index() -> None:
    with pytest.raises(ValueError, match='"p1" is held at 5'):
        check_held_starts(None, [0.0, 5.0], [False, True], None, [1.0, 1.0])
