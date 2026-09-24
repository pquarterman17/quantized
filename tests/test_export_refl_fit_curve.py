"""A reflectivity fit curve exports as a vector figure (P2.2 slice 3).

"Add fit curves" makes one ordinary dataset per channel with the measured R and
the model "R fit" side by side (workshops/reflectivity/useReflFit.ts), and
"Open log-Y plot" shows it on a log y axis. No new export code exists for it:
this proves the EXISTING vector path (``/api/export/figure``, matplotlib) draws
both series on a log axis — including the model's gap where the fit reported
no value (null on the wire), which must break the curve rather than join it or
fail the log scale.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

_Q = [0.01 + 0.005 * i for i in range(30)]
_R = [1.0 / (1.0 + (q / 0.02) ** 4) for q in _Q]
_MODEL: list[float | None] = [0.98 * v for v in _R]
_MODEL[12] = None  # a point the fit did not evaluate


def _payload(fmt: str) -> dict[str, Any]:
    """The request the Stage export builds for a fit-curve dataset on log-Y
    (both columns plotted, as "Open log-Y plot" shows it)."""
    return {
        "dataset": {
            "time": _Q,
            "values": [[r, m] for r, m in zip(_R, _MODEL, strict=True)],
            "labels": ["R", "R fit"],
            "units": ["", ""],
            "metadata": {"source": "reflectivity-fit", "reflFit": {"fitId": "rfit-x-1", "seq": 1}},
        },
        "y_keys": [0, 1],
        "y_scale": "log",
        "fmt": fmt,
        "x_label": "Q (Å⁻¹)",
        "y_label": "R",
        "overrides": {"legend": {"show": True, "loc": "upper right"}},
        "filename": "refl_fit",
    }


def _group(svg: str, gid: str) -> str:
    m = re.search(rf'<g id="{re.escape(gid)}">', svg)
    assert m, gid
    depth, pos = 1, m.end()
    for tm in re.finditer(r"<g\b|</g>", svg[pos:]):
        depth += -1 if tm.group() == "</g>" else 1
        if depth == 0:
            return svg[m.start() : pos + tm.end()]
    raise AssertionError(gid)


def _curve_moves(svg: str) -> list[int]:
    """The number of path segments (M commands) in each DATA curve, in draw
    order. Ticks, grid lines and the legend's sample handles are line2d
    groups too; they are single short strokes (at most two L commands) or sit
    inside the legend, so a data curve is a group outside the legend whose
    path has more line-to commands than that."""
    legend = _group(svg, "legend_1")
    out = []
    for gid in re.findall(r'<g id="(line2d_\d+)"', svg):
        path = re.search(r'<path d="([^"]+)"', _group(svg, gid))
        if not path or f'id="{gid}"' in legend:
            continue
        if len(re.findall(r"\bL\s", path.group(1))) > 2:
            out.append(len(re.findall(r"\bM\s", path.group(1))))
    return out


def test_the_fit_curve_exports_both_series_on_a_log_axis_as_svg() -> None:
    resp = client.post("/api/export/figure", json=_payload("svg"))
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("image/svg")
    svg = resp.content.decode("utf-8", "ignore")
    legend = re.findall(r"<text[^>]*>([^<]*)</text>", _group(svg, "legend_1"))
    assert legend == ["R", "R fit"]
    # Both curves are drawn: the measured R in one piece, the model split at
    # its null point into two.
    assert _curve_moves(svg) == [1, 2]


def test_the_log_axis_is_what_the_renderer_actually_used() -> None:
    resp = client.post("/api/export/figure-hitmap", json=_payload("png"))
    assert resp.status_code == 200, resp.text
    axes = resp.json()["axes"]
    assert axes["yscale"] == "log"
    lo, hi = axes["ylim"]
    assert 0 < lo < min(_R) and hi >= max(_R)  # decades of R, nothing clipped to 0


def test_the_default_vector_pdf_export_succeeds() -> None:
    resp = client.post("/api/export/figure", json=_payload("pdf"))
    assert resp.status_code == 200, resp.text
    assert resp.content.startswith(b"%PDF")
