"""Tick-label prefix / suffix (gap audit 5 lane J, L3): the export half of the
shared fixture ``tests/fixtures/wire/tick_affix.json`` -- the screen half is
``frontend/src/lib/axisAffix.test.ts``. Both must draw the fixture's labels."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import pytest  # noqa: E402
from matplotlib.ticker import FixedLocator  # noqa: E402

from quantized.calc.figure_ticks import apply_tick_formats  # noqa: E402
from quantized.routes.export_figures_schema import TickFormatSpec, _tick_fmt  # noqa: E402

CASES: list[dict[str, Any]] = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "tick_affix.json").read_text(encoding="utf-8")
)["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_export_draws_the_fixture_labels(case: dict[str, Any]) -> None:
    fig, ax = plt.subplots()
    splits = case["splits"]
    ax.plot(splits, [0] * len(splits))
    ax.set_xlim(min(splits) - 1, max(splits) + 1)
    ax.xaxis.set_major_locator(FixedLocator(splits))
    # The wire path: the request's TickFormatSpec, then its plain mapping.
    apply_tick_formats(ax, _tick_fmt(TickFormatSpec(**case["fmt"])), None)
    ax.figure.canvas.draw()
    # matplotlib needs a "$" escaped (the screen draws it literally).
    labels = [t.get_text().replace("\\$", "$") for t in ax.get_xticklabels()]
    plt.close(fig)
    assert labels == case["labels"]


def test_dollars_are_escaped_for_mathtext() -> None:
    fig, ax = plt.subplots()
    ax.plot([0, 1], [0, 1])
    apply_tick_formats(ax, {"mode": "fixed", "digits": 1, "prefix": "$", "suffix": "$"}, None)
    ax.figure.canvas.draw()
    texts = [t.get_text() for t in ax.get_xticklabels() if t.get_text()]
    plt.close(fig)
    assert texts and all(t.startswith("\\$") and t.endswith("\\$") for t in texts)


def test_empty_affix_changes_nothing() -> None:
    fig, ax = plt.subplots()
    ax.plot([0, 1], [0, 1])
    apply_tick_formats(ax, {"mode": "fixed", "digits": 1, "prefix": "", "suffix": None}, None)
    ax.figure.canvas.draw()
    texts = [t.get_text() for t in ax.get_xticklabels() if t.get_text()]
    plt.close(fig)
    assert texts and not any("\\$" in t or " " in t for t in texts)
