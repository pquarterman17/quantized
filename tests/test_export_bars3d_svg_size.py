"""3-D bar exports: a vector file stays small without changing what is drawn.

A 10,000-bar SVG used to be ~10 MB (60,000 faces, six decimals each). The export
now leaves out the faces turned away from the camera (``figure_map3d_bar_cull``)
and writes the rest compactly (``svg_compact``). The size is pinned as a RATIO of
the old output (both switches off), the picture by rasterising before and after.
"""

from __future__ import annotations

import io
import re
from typing import Any
from xml.etree import ElementTree

import matplotlib
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from scipy.ndimage import uniform_filter

import quantized.calc.figure_map3d_ext_render as render_mod
from quantized.app import app
from quantized.calc.figure_map3d_bar_cull import BarFaces, cull_hidden_faces
from quantized.calc.svg_compact import compact_polygon_groups

matplotlib.use("Agg")
client = TestClient(app)


def _body(
    n: int, *, elev: float = 30, azim: float = -60, fmt: str = "png", low: float = 1, **kw: Any
) -> dict[str, Any]:
    rng = np.random.default_rng(3)
    z = (rng.random((n, n)) * 9 + low).round(3).tolist()
    body: dict[str, Any] = {
        "x_axis": list(range(n)),
        "y_axis": list(range(n)),
        "z_grid": z,
        "kind": "bars3d",
        "bar_width": 0.8,
        "bar_depth": 0.8,
        "view_elev": elev,
        "view_azim": azim,
        "view_zoom": 1,
        "fmt": fmt,
        "style": "default",
        "cmap": "viridis",
        "title": "",
        "x_label": "x",
        "y_label": "y",
        "z_label": "z",
        "filename": "bars",
        "dpi": 100,
    }
    body.update(kw)
    return body


def _render(body: dict[str, Any]) -> bytes:
    r = client.post("/api/export/map-figure", json=body)
    assert r.status_code == 200, r.text
    return r.content


def _old(monkeypatch: pytest.MonkeyPatch, *, cull: bool = True, compact: bool = True) -> None:
    """The output as it was: every face drawn, matplotlib's own text."""
    if cull:
        monkeypatch.setattr(render_mod, "cull_hidden_faces", lambda ax, faces: 0)
    if compact:
        monkeypatch.setattr(render_mod, "compact_polygon_groups", lambda svg: svg)


def _pixels(png: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(png)).convert("RGB"), dtype=float)


def _blurred_gap(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    # A one-pixel seam between two faces of one box used to be covered by the
    # hidden face under it; a 3x3 mean keeps every face's colour and position
    # and forgives only that seam.
    box = (3, 3, 1)
    return np.abs(uniform_filter(a, size=box) - uniform_filter(b, size=box))


VIEWS = [
    pytest.param({"elev": 30, "azim": -60}, id="default"),
    pytest.param({"elev": -30, "azim": -60}, id="from below"),
    pytest.param({"elev": 70, "azim": 20}, id="steep"),
    pytest.param({"elev": 5, "azim": 200}, id="grazing, behind"),
    pytest.param({"elev": 30, "azim": -60, "low": -8}, id="bars below the base"),
    pytest.param({"elev": 30, "azim": -60, "bar_width": 1.0, "bar_depth": 1.0}, id="touching"),
]


@pytest.mark.parametrize("view", VIEWS)
def test_dropping_hidden_faces_leaves_the_picture_alone(
    monkeypatch: pytest.MonkeyPatch, view: dict[str, Any]
) -> None:
    body = _body(14, **view)
    after = _pixels(_render(body))
    _old(monkeypatch, compact=False)
    before = _pixels(_render(body))
    diff = _blurred_gap(after, before)
    assert diff.mean() < 2.0
    assert float((diff.max(axis=2) > 20).mean()) < 0.02
    assert diff.max() < 70


def test_the_check_can_tell_a_culled_visible_face(monkeypatch: pytest.MonkeyPatch) -> None:
    """Dropping the faces on the wrong side is far outside the tolerance above."""
    body = _body(14)
    good = _pixels(_render(body))
    real = render_mod.cull_hidden_faces

    def inverted(ax: Any, faces: BarFaces) -> int:
        flipped = BarFaces(faces.collection, faces.polys, faces.colours, -faces.height_sign)
        return real(ax, flipped)

    monkeypatch.setattr(render_mod, "cull_hidden_faces", inverted)
    bad = _pixels(_render(body))
    assert float((_blurred_gap(good, bad).max(axis=2) > 20).mean()) > 0.05


def _paths(svg: bytes) -> int:
    """Faces drawn: the paths of the bar collection only (axes and ticks excluded)."""
    start = svg.index(b'<g id="Poly3DCollection')
    return svg.count(b"<path", start, svg.index(b"</g>", start))


def test_half_the_faces_go_and_the_svg_is_well_formed(monkeypatch: pytest.MonkeyPatch) -> None:
    body = _body(12, fmt="svg")
    new = _render(body)
    ElementTree.fromstring(new)
    _old(monkeypatch)
    old = _render(body)
    assert _paths(old) - _paths(new) == 12 * 12 * 3  # three faces per box face away
    assert len(new) < 0.5 * len(old)


def test_a_10000_bar_svg_is_a_third_of_the_old_size(monkeypatch: pytest.MonkeyPatch) -> None:
    body = _body(100, fmt="svg")
    new = _render(body)
    _old(monkeypatch)
    old = _render(body)
    assert _paths(old) >= 60_000
    assert len(new) < 0.35 * len(old)  # measured 0.30: ~3.1 MB from ~10.2 MB


def test_bars_below_the_base_cull_too() -> None:
    svg = _render(_body(6, fmt="svg", low=-8))
    assert _paths(svg) == 6 * 6 * 3


def test_a_bar_with_no_height_keeps_every_face() -> None:
    body = _body(4, fmt="svg", bar_base=5.0)
    body["z_grid"][1][1] = 5.0  # exactly the base: top and bottom coincide
    assert _paths(_render(body)) == 4 * 4 * 6


def test_translucent_faces_are_never_dropped() -> None:
    class Ax:  # nothing may be asked of the axes when a face is translucent
        collections: list[Any] = []

    colours = np.full((2, 6, 4), 0.5)
    faces = BarFaces(object(), np.zeros((2, 6, 4, 3)), colours, np.ones(2))
    assert cull_hidden_faces(Ax(), faces) == 0


# -- svg_compact ------------------------------------------------------------

_GROUP = (
    '  <g id="Poly3DCollection_1">\n'
    '   <path d="M 1.2345678 2.5 \nL 3.0000004 -0.0000001 \nL 4 5 \nL 6 7 \nz\n" '
    'clip-path="url(#pab)" style="fill: #183b4c"/>\n'
    '   <path d="M 10 20 \nL 30.25 40 \nL 50 60 \nL 70 80 \nz\n" '
    'clip-path="url(#pab)" style="fill: #212749"/>\n'
    "  </g>\n"
)


def test_compaction_rounds_to_three_decimals_and_hoists_the_clip() -> None:
    out = compact_polygon_groups(_GROUP.encode()).decode()
    assert out == (
        '  <g id="Poly3DCollection_1" clip-path="url(#pab)">\n'
        '   <path d="M1.235 2.5L3 0L4 5L6 7z" style="fill:#183b4c"/>\n'
        '   <path d="M10 20L30.25 40L50 60L70 80z" style="fill:#212749"/>\n'
        "  </g>\n"
    )


def _corners(svg: str) -> list[np.ndarray]:
    return [
        np.array(re.findall(r"-?\d+(?:\.\d+)?", d), dtype=float)
        for d in re.findall(r'<path d="(M[^"]*)"', svg)
    ]


def test_compaction_never_moves_a_corner_by_more_than_half_a_thousandth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = _body(8, fmt="svg")
    compact = _corners(_render(body).decode())
    _old(monkeypatch, cull=False)
    raw = _corners(_render(body).decode())
    assert len(raw) == len(compact) > 0
    worst = max(float(np.max(np.abs(p - q))) for p, q in zip(raw, compact, strict=True))
    assert worst <= 5e-4 + 1e-9


@pytest.mark.parametrize(
    "group",
    [
        _GROUP.replace("L 6 7", "C 6 7 8 9 10 11"),
        _GROUP.replace('style="fill: #212749"', 'style="fill: #212749; stroke: #000"'),
        _GROUP.replace('#pab)" style="fill: #212749', '#o)" style="fill: #212749'),
    ],
    ids=["other command", "other style", "two clips"],
)
def test_compaction_leaves_a_group_it_does_not_understand_alone(group: str) -> None:
    assert compact_polygon_groups(group.encode()).decode() == group


def test_other_svg_text_is_left_alone() -> None:
    other = '<g id="axes_1">\n <path d="M 1.123456 2 \nL 3 4 \nz\n" style="fill: #000"/>\n</g>\n'
    assert compact_polygon_groups(other.encode()).decode() == other
