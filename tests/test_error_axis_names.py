"""Axis-from-name table for error columns (mirrors errorAxisNames.test.ts)."""

import pytest

from quantized.io.error_inference import infer_error_bindings_from_labels as infer

NAMES = [
    "x_err", "xerr", "sigma_x", "x_std", "x_sd", "x_unc", "X.Err",
    "x-err", "x err", "XERR", "err_x", "xStd", "x.unc", "Sigma-X",
]


@pytest.mark.parametrize("name", NAMES)
def test_x_error(name: str) -> None:
    b = infer(["y", name])
    assert [(x.channel, x.target, x.axis) for x in b] == [(1, -1, "x")]


@pytest.mark.parametrize("name", NAMES)
def test_y_error(name: str) -> None:
    b = infer(["y", name.replace("x", "y").replace("X", "Y")])
    assert [(x.channel, x.target, x.axis) for x in b] == [(1, 0, "y")]


def test_xy_pair() -> None:
    b = infer(["y", "x_err", "y_err"])
    assert [(x.channel, x.target, x.axis) for x in b] == [(1, -1, "x"), (2, 0, "y")]


def test_named_column_wins() -> None:
    b = infer(["x", "y", "x_err"])
    assert [(x.channel, x.target, x.axis) for x in b] == [(2, 0, "y")]


@pytest.mark.parametrize("name", ["sex", "dxy", "Index", "x", "Co-Fe"])
def test_ordinary_names_not_errors(name: str) -> None:
    assert infer(["y", name]) == []


def test_bare_delta_is_not_an_error_unless_asked() -> None:
    for name in ("dx", "dy", "DX", "d_x"):
        assert infer(["y", name]) == []
    assert [(b.channel, b.axis) for b in infer(["y", "dx"], delta=True)] == [(1, "x")]
    assert infer(["x", "y", "z", "dx", "dy", "dz"]) == []
    got = infer(["x", "y", "z", "dx", "dy", "dz"], delta=True)
    assert [b.channel for b in got] == [3, 4]
