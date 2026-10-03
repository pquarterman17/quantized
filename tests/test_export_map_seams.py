"""A heatmap's vector export draws its cells without seams (plot audit).

``pcolormesh`` writes every cell as its own filled polygon in SVG and PDF.
A viewer antialiases each polygon's edges on its own, so two touching cells
each cover a shared edge pixel only partly and the background shows through
as a faint grid of lines (XRDML and .brml RSM exports, 200 x 200 = 40,000
paths, 7.5 MB). The mesh is rasterized at the export dpi instead -- one
embedded image, the way matplotlib already draws the colour bar -- while
the axes, ticks, labels, colour bar ticks and map marks stay vector.

The seam is a viewer artifact, so CI checks its cause: no per-cell polygons
(the path / fill count does not grow with the cell count), plus what must not
change -- cells centred on their axis values and the frame at the axis span.
"""

from __future__ import annotations

import re
import zlib
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def _body(n: int, fmt: str, **extra: Any) -> dict[str, Any]:
    z = np.random.default_rng(0).random((n, n))
    z[0, 0] = np.nan  # a hull gap stays a gap
    return {
        "x_axis": np.linspace(64.0, 72.0, n).tolist(),
        "y_axis": np.linspace(32.0, 36.0, n).tolist(),
        "z_grid": [[None if np.isnan(v) else float(v) for v in row] for row in z],
        "kind": "heatmap",
        "fmt": fmt,
        "x_label": "2Theta (deg)",
        "y_label": "Omega (deg)",
        "z_label": "Intensity (counts)",
        **extra,
    }


def _export(body: dict[str, Any]) -> bytes:
    r = client.post("/api/export/map-figure", json=body)
    assert r.status_code == 200, r.text
    return r.content


def _pdf_fill_ops(pdf: bytes) -> int:
    """Path-fill operators across the PDF's (Flate-decoded) content streams."""
    count = 0
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", pdf, re.S):
        try:
            data = zlib.decompress(m.group(1))
        except zlib.error:
            continue  # an image's own pixel data, not drawing operators
        count += len(re.findall(rb"(?m)(?:^|\s)(?:f\*?|B\*?|b\*?)$", data))
    return count


def test_svg_heatmap_cells_are_one_image_not_per_cell_paths() -> None:
    small, large = _export(_body(10, "svg")), _export(_body(60, "svg"))
    # 3,500 more cells, not one more path: no per-cell polygon to seam.
    assert large.count(b"<path") == small.count(b"<path")
    assert large.count(b"<image") == 2  # the mesh + matplotlib's colour bar
    # Axes stay vector: live <text> (svg.fonttype none) and vector ticks.
    text = large.decode()
    for label in ("2Theta (deg)", "Omega (deg)", "Intensity (counts)"):
        assert re.search(rf"<text[^>]*>{re.escape(label)}</text>", text), label
    assert len(large) < 200_000  # was ~700 kB at 60 x 60, 7.5 MB at 200 x 200


def test_pdf_heatmap_cells_are_one_image_not_per_cell_fills() -> None:
    small, large = _export(_body(10, "pdf")), _export(_body(60, "pdf"))
    assert _pdf_fill_ops(large) == _pdf_fill_ops(small)
    # The mesh (plus its soft mask: a gap is transparent) and the colour bar.
    assert large.count(b"/Subtype /Image") == small.count(b"/Subtype /Image") >= 2


def test_rasterized_mesh_keeps_cell_centres_and_frame(monkeypatch: pytest.MonkeyPatch) -> None:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    _export(_body(5, "svg", equal_aspect=True))
    monkeypatch.undo()
    ax = kept[-1].axes[0]
    (mesh,) = ax.collections
    assert mesh.get_rasterized() is True
    # Only the mesh: the frame, ticks and labels are not rasterized.
    assert not any(a.get_rasterized() for a in (*ax.spines.values(), ax.xaxis, ax.yaxis))
    x = np.linspace(64.0, 72.0, 5)
    y = np.linspace(32.0, 36.0, 5)
    coords = mesh.get_coordinates()  # (ny + 1, nx + 1, 2) cell corners
    np.testing.assert_allclose(0.5 * (coords[0, 1:, 0] + coords[0, :-1, 0]), x)
    np.testing.assert_allclose(0.5 * (coords[1:, 0, 1] + coords[:-1, 0, 1]), y)
    assert ax.get_xlim() == pytest.approx((64.0, 72.0))
    assert ax.get_ylim() == pytest.approx((32.0, 36.0))
    assert ax.get_aspect() == 1.0
