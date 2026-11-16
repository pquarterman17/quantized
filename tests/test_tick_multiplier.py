"""UX audit 8 #8: the export half of the shared fixture
``tests/fixtures/wire/tick_multiplier.json`` -- the screen half is
``frontend/src/lib/autoTickMultiplier.test.ts``. Both draw the fixture's auto
labels and x10^n factor for the same ticks."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from matplotlib.ticker import FixedLocator, ScalarFormatter  # noqa: E402

from quantized.calc.figure import render_figure  # noqa: E402
from quantized.calc.figure_ticks import apply_tick_formats  # noqa: E402
from quantized.calc.tick_multiplier import (  # noqa: E402
    AutoTickFormatter,
    auto_tick_exponent,
    disable_auto_multiplier,
)

CASES: list[dict[str, Any]] = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "tick_multiplier.json").read_text(
        encoding="utf-8"
    )
)["cases"]


def _drawn(
    ticks: list[float], fmt: dict[str, Any] | None, *, axis: str = "y"
) -> tuple[list[str], str]:
    fig, ax = plt.subplots()
    ax.plot(ticks, ticks)
    lim = (min(ticks), max(ticks))
    target = ax.yaxis if axis == "y" else ax.xaxis
    (ax.set_ylim if axis == "y" else ax.set_xlim)(*lim)
    target.set_major_locator(FixedLocator(ticks))
    apply_tick_formats(ax, fmt if axis == "x" else None, fmt if axis == "y" else None)
    fig.canvas.draw()
    labels = [t.get_text() for t in (ax.get_yticklabels() if axis == "y" else ax.get_xticklabels())]
    offset = target.get_offset_text().get_text()
    plt.close(fig)
    return labels, offset


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
@pytest.mark.parametrize("axis", ["x", "y"])
def test_export_draws_the_fixture_labels_and_factor(case: dict[str, Any], axis: str) -> None:
    labels, offset = _drawn(case["ticks"], None, axis=axis)
    assert labels == case["labels"]
    assert offset == (case["factor"] or "")


def test_ticks_past_the_view_do_not_set_the_factor() -> None:
    # matplotlib's locator returns ticks beyond the limits; only drawn ones count.
    assert auto_tick_exponent([0.0, 0.005, 0.01]) is None
    fig, ax = plt.subplots()
    ax.set_ylim(0, 0.0095)
    ax.yaxis.set_major_locator(FixedLocator([0, 0.005, 0.01]))
    apply_tick_formats(ax, None, None)
    fig.canvas.draw()
    assert ax.yaxis.get_offset_text().get_text() == "×10⁻³"
    plt.close(fig)


@pytest.mark.parametrize(
    "fmt",
    [
        {"mode": "fixed", "digits": 2},
        {"mode": "auto", "digits": 2, "prefix": "$"},
        {"mode": "auto", "digits": 2, "suffix": " K"},
        {"mode": "auto", "digits": 2, "divide": 1000},
        {"mode": "auto", "digits": 2, "custom": {"at": [0, 0.001]}},
        {"mode": "auto", "digits": 2, "cross": 0},
    ],
)
def test_an_explicit_format_or_affix_never_takes_the_factor(fmt: dict[str, Any]) -> None:
    _, offset = _drawn([0, 0.0005, 0.001, 0.0015], fmt)
    assert offset != "×10⁻³"  # (divide-by draws its own "×10³")


def test_a_twin_axis_keeps_its_owner_x_formatter() -> None:
    fig, ax = plt.subplots()
    ax.plot([0, 1], [0, 1])
    apply_tick_formats(ax, {"mode": "fixed", "digits": 2}, None)
    twin = ax.twinx()
    apply_tick_formats(twin, None, None)
    assert not isinstance(ax.xaxis.get_major_formatter(), AutoTickFormatter)
    assert isinstance(twin.yaxis.get_major_formatter(), AutoTickFormatter)
    plt.close(fig)


def test_disabled_multiplier_is_matplotlib_default() -> None:
    fig, ax = plt.subplots()
    ax.set_ylim(0, 0.00175)
    ax.yaxis.set_major_locator(FixedLocator([0, 0.001]))
    apply_tick_formats(ax, None, None)
    disable_auto_multiplier(ax.yaxis)
    fig.canvas.draw()
    plain = ScalarFormatter()
    plain.set_axis(ax.yaxis)
    assert ax.yaxis.get_offset_text().get_text() == ""
    assert [t.get_text() for t in ax.get_yticklabels()] == plain.format_ticks([0, 0.001])
    plt.close(fig)



@pytest.mark.parametrize("y_breaks", [None, [[0.0004, 0.0008]]])
def test_an_x_break_panel_takes_the_factor_unless_y_is_broken(y_breaks: Any) -> None:
    # The x-break renderer applies the Y break once, after formatting each panel
    # without it; the screen draws no factor on a broken axis, so neither does this.
    x = np.linspace(0, 10, 50)
    y = np.linspace(0, 0.0015, 50)
    fmt: dict[str, Any] = {"mode": "auto", "digits": 2}
    if y_breaks:
        fmt["breaks"] = y_breaks
    svg = render_figure(
        x, [("m", y)], fmt="svg", overrides={"x_breaks": [[3.0, 4.0]]}, y_fmt=fmt
    ).decode()
    assert ("10⁻³" in svg) is (y_breaks is None)
