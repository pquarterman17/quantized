"""Origin-style multiple Y axes (gap audit 4 G11), screen == export: the
BACKEND half of ``tests/fixtures/wire/multi_y.json``.

``frontend/src/lib/multiYFixture.test.ts`` draws each case on a real uPlot
instance and records what it MEASURED there -- every right-hand axis' outward
offset from the frame, title, colour, range and drawn majors with their
labels, and which axis each series rides -- beside the exact request the app
sends. This half renders that request with the real matplotlib export and
reads the same values back from what matplotlib DREW (window extents, the
final limits, the major ticks and their rendered text), so neither half can
agree with the other merely by sharing a derivation.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.colors
import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure_multi_y import SLOT_PT

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "multi_y.json"
DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = DATA["cases"]
IDS = [c["name"] for c in CASES]


def _figure(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    fig = kept[-1]
    fig.canvas.draw()
    return fig


def _owner(fig: Any) -> dict[str, Any]:
    """Each drawn series' label -> the axes it was drawn on."""
    return {
        ln.get_label(): ax
        for ax in fig.axes
        for ln in ax.get_lines()
        if not ln.get_label().startswith("_")
    }


def _right_axes(fig: Any) -> list[tuple[float, Any]]:
    """Every drawn right-hand axis with its spine's outward offset from the
    frame, in pt, measured from the rendered window extents."""
    renderer = fig.canvas.get_renderer()
    frame = fig.axes[0].get_window_extent(renderer)
    out = []
    for ax in fig.axes[1:]:
        if not ax.axison or not ax.spines["right"].get_visible():
            continue
        spine = ax.spines["right"]
        # Where the spine LINE is drawn (its extent would also span the ticks).
        x = spine.get_transform().transform(spine.get_path().vertices)[0][0]
        out.append(((x - frame.x1) * 72.0 / fig.dpi, ax))
    return sorted(out, key=lambda p: p[0])


def _majors(ax: Any) -> list[tuple[float, str]]:
    lo, hi = sorted(ax.get_ylim())
    span = hi - lo
    return [
        (float(t.get_loc()), t.label2.get_text() or t.label1.get_text())
        for t in ax.yaxis.get_major_ticks()
        if lo - 1e-9 * span <= t.get_loc() <= hi + 1e-9 * span and t.label2.get_visible()
    ]


def _hex(c: Any) -> str:
    return matplotlib.colors.to_hex(c)


def test_the_slot_is_one_constant_on_both_sides() -> None:
    assert DATA["slot_pt"] == SLOT_PT


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_every_series_rides_the_axis_the_canvas_draws_it_on(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    fig = _figure(monkeypatch, case["request"])
    on = _owner(fig)
    canvas = case["canvas"]
    shown = [s for s in canvas["series"] if s["shown"]]
    assert sorted(on) == sorted(s["label"] for s in shown), (
        "the export draws the canvas' shown series"
    )
    offsets = {id(ax): off for off, ax in _right_axes(fig)}
    y2_off = float((case["request"].get("y2_fmt") or {}).get("offset") or 0)  # drawn, not laid out
    want = {a["axis"]: a["offset_pt"] + (y2_off if a["axis"] == 2 else 0) for a in canvas["axes"]}
    for s in shown:
        ax = on[s["label"]]
        if s["axis"] == 1:
            assert ax is fig.axes[0], s
        else:
            assert offsets[id(ax)] == pytest.approx(want[s["axis"]], abs=0.6), s
        line = next(ln for ln in ax.get_lines() if ln.get_label() == s["label"])
        assert _hex(line.get_color()) == _hex(s["color"])
    legend = fig.axes[0].get_legend()
    assert [t.get_text() for t in legend.get_texts()] == [s["label"] for s in shown]


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_every_right_axis_draws_what_the_canvas_draws(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    req = case["request"]
    fig = _figure(monkeypatch, req)
    drawn = _right_axes(fig)
    canvas = case["canvas"]["axes"]
    # Y2's own gap-#5 offset moves its line on screen by drawing, not by
    # layout (uPlot's `_pos` stays at the frame); every Y3+ slot is layout.
    y2_off = float((req.get("y2_fmt") or {}).get("offset") or 0)
    want = [a["offset_pt"] + (y2_off if a["axis"] == 2 else 0) for a in canvas]
    assert [off for off, _ in drawn] == pytest.approx(want, abs=0.6), (
        "same right axes, same offsets"
    )
    extras = iter(req.get("y_axes") or [])
    for (_, ax), spec in zip(drawn, canvas, strict=True):
        own = next(extras) if spec["axis"] >= 3 else None
        assert ax.get_ylabel() == spec["label"]
        if spec["color"] is not None:
            want = _hex(spec["color"])
            assert _hex(ax.spines["right"].get_edgecolor()) == want
            assert _hex(ax.yaxis.label.get_color()) == want
            assert all(_hex(t.get_color()) == want for t in ax.get_yticklabels())
        # The majors either side draws, compared over the range both show --
        # for a Y3+ axis whose majors a RULE fixes (a fixed range and step, a
        # log, Log2 or probability scale, custom ticks). An autoscaled linear
        # axis' majors come from two different locators; its range compares
        # (`test_a_fixed_or_error_bar_range_is_the_canvas_range`).
        fmt = (own or {}).get("fmt") or {}
        if own is None or not (
            own.get("lim") or own.get("scale") == "log" or fmt.get("prob") or fmt.get("custom")
        ):
            continue
        lo = max(min(ax.get_ylim()), spec["range"][0])
        hi = min(max(ax.get_ylim()), spec["range"][1])
        span = max(hi - lo, 1e-300)
        inside = [
            (v, t)
            for v, t in zip(spec["ticks"], spec["tick_labels"], strict=True)
            if lo - 1e-9 * span <= v <= hi + 1e-9 * span
        ]
        mine = [(v, t) for v, t in _majors(ax) if lo - 1e-9 * span <= v <= hi + 1e-9 * span]
        assert [v for v, _ in mine] == pytest.approx([v for v, _ in inside], rel=1e-9), spec
        assert [_plain(t) for _, t in mine] == [_plain(t) for _, t in inside], spec


def test_a_fixed_or_error_bar_range_is_the_canvas_range(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "Y2 then Y3 log then Y4 fixed, own colours",
        "error bars on a Y3 series widen Y3's range",
    ):
        case = next(c for c in CASES if c["name"] == name)
        fig = _figure(monkeypatch, case["request"])
        _, ax = _right_axes(fig)[-1]
        assert list(ax.get_ylim()) == pytest.approx(case["canvas"]["axes"][-1]["range"], rel=1e-9)


_SUP = str.maketrans("⁻⁰¹²³⁴⁵⁶⁷⁸⁹", "-0123456789")


def _plain(text: str) -> str:
    """A tick label as plain text: matplotlib's mathtext ``$\\mathdefault{10^{-6}}$``
    and the canvas' ``10⁻⁶`` both read ``10^-6``; its unicode minus reads ``-``."""
    t = text.replace("$", "").replace("\\mathdefault", "").replace("{", "").replace("}", "")
    t = t.replace("−", "-")
    if any(c in text for c in "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"):
        base, _, rest = next(
            ((text[:i], "", text[i:]) for i, c in enumerate(text) if c in "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"),
            (text, "", ""),
        )
        t = f"{base}^{rest.translate(_SUP)}"
    return t


def test_an_orphan_case_sends_no_extra_axis_and_draws_one_axes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = next(c for c in CASES if c["name"] == "an orphan assignment draws on Y1")
    assert "y_axes" not in case["request"]
    fig = _figure(monkeypatch, case["request"])
    assert len(fig.axes) == 1
