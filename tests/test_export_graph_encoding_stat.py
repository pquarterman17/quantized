"""P1.4 residual 3 -- Color-by on box / violin / bar, export parity.

The BACKEND half of the screen <-> export check. ``frontend/src/components/
Stage/statColorParity.test.ts`` takes a Graph Builder spec with a Color pick,
drives the real Stat Stage hook with the seed a plot action sends, paints the
draw on a recording canvas (``screen.fills``: each glyph body's fill, in paint
order) and captures the export request, and pins the pair byte for byte as
``tests/fixtures/wire/graph_encoding_stat.json`` (one ``{"request",
"screen"}`` per case: nested box, violin, bar, faceted box). This file posts
each request to the real route and reads the matplotlib artists back: every
box / violin body / bar is filled with the colour the canvas drew, in the same
order, at the canvas' translucency, and edged in it. Plus the negative control
(no ``color_levels``: the figure is the one it always was) and the 422s.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient
from matplotlib.collections import PathCollection, PolyCollection
from matplotlib.colors import to_hex, to_rgba
from matplotlib.patches import PathPatch, Rectangle

from quantized.app import app
from quantized.calc.figure_stat_colors import BAR_ALPHA, BOX_ALPHA, VIOLIN_ALPHA, level_colors

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "graph_encoding_stat.json"
CASES = ("box", "violin", "bar", "facets")


def _fixture() -> dict[str, Any]:
    return dict(json.loads(FIXTURE.read_text(encoding="utf-8")))


def _url(request: dict[str, Any]) -> str:
    kind = "categorical" if "groups" in request else "statplot"
    return f"/api/export/{kind}-figure"


def _post_capturing(monkeypatch: pytest.MonkeyPatch, request: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post(_url(request), json=request)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "the route saved no figure"
    return kept[-1]


def _panels(fig: Any) -> list[Any]:
    """The data axes, in order (twin / tier axes carry no title-less glyphs)."""
    return [ax for ax in fig.axes if ax.get_visible() and (ax.patches or ax.collections)]


def _bodies(ax: Any, kind: str) -> list[tuple[str, float, str]]:
    """(fill hex, fill alpha, edge hex) per glyph body, in draw order."""
    if kind == "violin":
        arts = [c for c in ax.collections if isinstance(c, PolyCollection)]
        fe = [(c.get_facecolor()[0], c.get_edgecolor()[0]) for c in arts]
    elif kind == "bar":
        arts = [p for p in ax.patches if isinstance(p, Rectangle)]
        fe = [(p.get_facecolor(), p.get_edgecolor()) for p in arts]
    else:
        arts = [p for p in ax.patches if isinstance(p, PathPatch)]
        fe = [(p.get_facecolor(), p.get_edgecolor()) for p in arts]
    return [(to_hex(f, keep_alpha=False), float(f[3]), to_hex(e, keep_alpha=False)) for f, e in fe]


@pytest.mark.parametrize("case", CASES)
def test_every_glyph_is_filled_with_the_colour_the_screen_drew(
    case: str, monkeypatch: pytest.MonkeyPatch,
) -> None:
    fx = _fixture()[case]
    request, fills = fx["request"], fx["screen"]["fills"]
    fig = _post_capturing(monkeypatch, request)
    kind = "bar" if "groups" in request else request["kind"]
    alpha = {"bar": BAR_ALPHA, "violin": VIOLIN_ALPHA}.get(kind, BOX_ALPHA)
    axes = _panels(fig)
    assert len(axes) == len(fills)
    for ax, want in zip(axes, fills, strict=True):
        got = _bodies(ax, kind)
        assert [f for f, _, _ in got] == want
        assert [e for _, _, e in got] == want
        assert all(a == pytest.approx(alpha) for _, a, _ in got)


def test_the_fixture_levels_resolve_to_the_screen_fills() -> None:
    fx = _fixture()["box"]
    req = fx["request"]
    colors = level_colors(req["color_levels"], req["palette"])
    filled = [c for c, g in zip(colors or [], req["data"], strict=True) if g]
    assert filled == fx["screen"]["fills"][0]


def test_level_colors_rule() -> None:
    pal = ["#111111", "#222222", "#333333"]
    assert level_colors(None, pal) is None
    assert level_colors([0, 4, None], pal) == ["#111111", "#222222", None]
    assert level_colors([1], None) == ["C1"]  # no palette: matplotlib's own cycle, by level


def test_strip_points_take_their_groups_colour(monkeypatch: pytest.MonkeyPatch) -> None:
    body = {"kind": "strip", "data": [[1.0, 2.0], [3.0, 4.0]], "labels": ["A", "B"], "fmt": "svg",
            "points": "all", "color_levels": [1, 0], "palette": ["#0b6e4f", "#c3423f"]}
    fig = _post_capturing(monkeypatch, body)
    scat = [c for c in fig.axes[0].collections if isinstance(c, PathCollection)]
    assert [to_hex(c.get_facecolor()[0], keep_alpha=False) for c in scat] == ["#c3423f", "#0b6e4f"]


def test_without_color_levels_the_figure_is_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    drop = ("color_levels", "palette")
    req = {k: v for k, v in _fixture()["box"]["request"].items() if k not in drop}
    fig = _post_capturing(monkeypatch, req)
    # boxplot's own plain line boxes, no filled patch
    assert not [p for p in fig.axes[0].patches if isinstance(p, PathPatch)]
    bar = {k: v for k, v in _fixture()["bar"]["request"].items() if k not in drop}
    fig = _post_capturing(monkeypatch, bar)
    rect = [p for p in fig.axes[0].patches if isinstance(p, Rectangle)]
    assert rect and to_rgba(rect[0].get_facecolor())[3] == 1.0  # matplotlib's own opaque cycle


@pytest.mark.parametrize("case", ["box", "bar"])
def test_a_misaligned_level_list_is_refused(case: str) -> None:
    req = dict(_fixture()[case]["request"])
    req["color_levels"] = req["color_levels"][:-1]
    r = client.post(_url(req), json=req)
    assert r.status_code == 422, r.text
