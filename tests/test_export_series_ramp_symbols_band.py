"""Origin gap audit 4 lane A -- screen == export, the BACKEND half.

``frontend/src/lib/seriesRampSymbolsBandFixture.test.ts`` records, per case,
the export request the app sends and what the canvas draws (per plotted
series: the stroke colour, the rows its "symbol every N" filter keeps, the
symbol edge / fill paint, and the Y error band's quads in data units) in
``series_ramp_symbols_band.json``. Here each request is posted to the real
route and the saved matplotlib figure must draw the same thing: the same
colours (G1 colour gradient), the same marker rows and face / edge (G10), and
the same band vertices in row order with no Y bars (G8).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.colors import to_hex, to_rgba
from matplotlib.lines import Line2D
from matplotlib.patches import PathPatch

from quantized.app import app
from quantized.calc.figure_errorbars import apply_error_bars, band_quads
from quantized.calc.figure_symbols import apply_symbol_details

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "series_ramp_symbols_band.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _axes(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "no figure was saved"
    return kept[-1].axes[0]


def _series_lines(ax: Any, n: int) -> list[Line2D]:
    lines = [ln for ln in ax.get_lines() if not str(ln.get_label()).startswith("_")]
    assert len(lines) == n
    return lines


_MIX = re.compile(r"color-mix\(in oklab, (#[0-9a-f]{6}) (\d+)%, transparent\)")


def _canvas_rgba(paint: str) -> tuple[float, float, float, float]:
    """The canvas' fill paint (a hex, or a ``translucent()`` color-mix) as RGBA."""
    m = _MIX.fullmatch(paint)
    return to_rgba(m.group(1), int(m.group(2)) / 100) if m else to_rgba(paint)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_export_draws_what_the_canvas_draws(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _axes(monkeypatch, case["request"])
    want = case["canvas"]
    lines = _series_lines(ax, len(want))
    for line, w in zip(lines, want, strict=True):
        assert to_hex(line.get_color()) == w["color"]
        if w["marker_rows"] is not None:
            assert list(line.get_markevery()) == w["marker_rows"]
        if w["marker_edge"] is not None:
            assert to_hex(line.get_markeredgecolor()) == w["marker_edge"]
            assert to_rgba(line.get_markerfacecolor()) == pytest.approx(
                _canvas_rgba(w["marker_fill"]), abs=1e-9
            )
    bands = [p for p in ax.patches if isinstance(p, PathPatch)]
    want_bands = [w["band"] for w in want if w["band"] is not None]
    assert len(bands) == len(want_bands)
    for patch, quads in zip(bands, want_bands, strict=True):
        verts = patch.get_path().vertices.reshape(-1, 5, 2)[:, :4]  # each quad closes on its start
        got = np.column_stack(
            [
                verts[:, 0, 0],
                verts[:, 0, 1],
                verts[:, 1, 0],
                verts[:, 1, 1],
                verts[:, 2, 1],
                verts[:, 3, 1],
            ]
        )
        assert got == pytest.approx(np.asarray(quads, dtype=float), abs=1e-12)
        assert patch.get_alpha() == pytest.approx(0.25)  # the canvas' FILL_ALPHA_PCT
    if want_bands:
        # No Y bars for a band series: only X bars (horizontal segments) may remain.
        for coll in ax.collections:
            for seg in coll.get_segments():
                assert np.allclose(seg[:, 1], seg[0, 1]), "a vertical (Y) error bar was drawn"


def test_band_quads_follow_row_order_on_a_loop() -> None:
    x = np.array([0.0, 1.0, 2.0, 1.0, 0.0])
    y = np.array([0.0, 1.0, 0.0, -1.0, 0.0])
    e = np.full((2, 5), 0.5)
    quads = band_quads(x, y, e)
    # One quad per segment, each from its lower-X end: the return branch is not sorted away.
    assert [q[0] for q in quads] == [0.0, 1.0, 1.0, 0.0]
    assert quads[2] == (1.0, -0.5, 2.0, 0.5, -0.5, -1.5)
    x[2] = np.nan  # a gap breaks the band as it breaks the line
    assert len(band_quads(x, y, e)) == 2


class _Line:
    """A minimal ``Line2D`` stand-in for the bad-input contract."""

    def __init__(self, marker: str) -> None:
        self.marker = marker
        self.calls: list[str] = []

    def get_marker(self) -> str:
        return self.marker

    def __getattr__(self, name: str) -> Any:
        if name.startswith("set_"):
            return lambda *_a: self.calls.append(name)
        raise AttributeError(name)


def test_symbol_details_ignore_bad_values_and_markerless_lines() -> None:
    line = _Line("None")
    apply_symbol_details(line, {"marker_edge": "#123456", "marker_every": 3})
    assert line.calls == []
    line = _Line("o")
    apply_symbol_details(line, {"marker_alpha": 7, "marker_every": 1, "marker_edge": 5})
    assert line.calls == []


def test_band_without_y_errors_draws_bars_unchanged() -> None:
    calls: list[dict[str, Any]] = []

    class _Ax:
        patches: list[Any] = []

        def errorbar(self, *_a: Any, **kw: Any) -> None:
            calls.append(kw)

        def add_patch(self, p: Any) -> None:
            self.patches.append(p)

    x = np.array([0.0, 1.0])
    spans = [{"x": {"plus": [0.1, 0.1], "minus": [0.1, 0.1]}}]
    apply_error_bars(_Ax(), x, [("s", [1.0, 2.0])], spans, [None], [{"error_band": True}])
    assert len(calls) == 1 and calls[0]["yerr"] is None and calls[0]["xerr"] is not None
    assert _Ax.patches == []


def test_symbol_details_survive_an_unreadable_colour() -> None:
    from matplotlib.figure import Figure

    ax = Figure().subplots()
    (line,) = ax.plot([0, 1, 2], [0, 1, 0], marker="o", color="#336699")
    apply_symbol_details(line, {"marker_edge": "not-a-colour", "marker_alpha": 0.5})
    assert to_hex(line.get_markeredgecolor()) == "#336699"
    assert to_rgba(line.get_markerfacecolor())[3] == pytest.approx(0.5)


def test_greyscale_greys_in_the_gradient_order() -> None:
    """Review L2: curves plotted in shuffled order, ranked by the gradient."""
    from quantized.calc.figure_greyscale import apply_greyscale, greyscale_ramp

    styles = [{"color": "#111111", "ramp_rank": r} for r in (2, 0, 3, 1)]
    out = apply_greyscale(styles, 4)
    ramp = greyscale_ramp(4)
    assert [s["color"] for s in out] == [ramp[2], ramp[0], ramp[3], ramp[1]]
    assert all("ramp_rank" not in s for s in out)
    # Without ranks: display order, as before.
    assert [s["color"] for s in apply_greyscale([{}, {}, {}, {}], 4)] == ramp


def test_an_open_star_keeps_its_face_alone() -> None:
    """Review L3: the canvas star is an open asterisk, so no fill colour is set."""
    from matplotlib.figure import Figure

    ax = Figure().subplots()
    (star,) = ax.plot([0, 1], [0, 1], marker="*", color="#336699")
    face = to_rgba(star.get_markerfacecolor())
    apply_symbol_details(
        star, {"marker_face": "#ff0000", "marker_alpha": 0.3, "marker_edge": "#00ff00"}
    )
    assert to_rgba(star.get_markerfacecolor()) == face
    assert to_hex(star.get_markeredgecolor()) == "#00ff00"


def test_a_colour_mapped_band_uses_the_series_colour() -> None:
    """Review L4: a scatter artist has no single colour; the spec's colour shades the band."""
    from matplotlib.figure import Figure

    ax = Figure().subplots()
    x = np.array([0.0, 1.0, 2.0])
    sc = ax.scatter(x, [1.0, 2.0, 1.0], c=[0.0, 0.5, 1.0])
    spans = [{"y": {"plus": [0.1, 0.1, 0.1], "minus": [0.1, 0.1, 0.1]}}]
    apply_error_bars(
        ax, x, [("s", [1.0, 2.0, 1.0])], spans, [sc], [{"error_band": True, "color": "#aa3377"}]
    )
    (patch,) = [p for p in ax.patches if isinstance(p, PathPatch)]
    assert to_hex(patch.get_facecolor()) == "#aa3377"


def test_symbol_every_rejects_what_the_canvas_rejects() -> None:
    """Review L5: only integers 2..100000, the canvas' `symbolSanitize.validEvery`."""
    from matplotlib.figure import Figure

    for bad in (2.5, "3", 1, 0, 200000, True):
        ax = Figure().subplots()
        (line,) = ax.plot([0, 1, 2, 3], [0, 1, 0, 1], marker="o")
        apply_symbol_details(line, {"marker_every": bad})
        assert line.get_markevery() is None, bad
