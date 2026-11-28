"""The lollipop export's whisker legend stays clear of the whiskers (acceptance 14, C2).

matplotlib's ``loc="best"`` ignores LineCollection segments, so the legend used to sit on the top
of the tallest whisker. The check is geometric and independent of the drawing code: the legend's
window box against every whisker segment (taken from the request's own data via numpy).
"""

from __future__ import annotations

import numpy as np
import pytest
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from quantized.calc.figure_dist3 import draw_lollipop

GROUPS = [[1.0, 1.2, 0.8, 1.1], [2.0, 2.4, 1.6, 2.1], [3.0, 3.6, 2.4, 3.1], [9.0, 12.0, 6.0, 9.5]]


def _segments_hit_box(ax: object, box: object) -> list[str]:
    hit = []
    for coll in ax.collections:  # type: ignore[attr-defined]
        if coll.get_gid() != "lolli-whiskers":
            continue
        for seg in coll.get_segments():
            pix = ax.transData.transform(seg)  # type: ignore[attr-defined]
            # sample densely along the segment: a box that straddles the middle must count
            pts = np.linspace(pix[0], pix[1], 200)
            if any(box.contains(*p) for p in pts):
                hit.append(str(seg.tolist()))
    return hit


@pytest.mark.parametrize("horizontal", [False, True])
@pytest.mark.parametrize("sort", ["none", "desc", "asc"])
def test_legend_does_not_cover_a_whisker(horizontal: bool, sort: str) -> None:
    fig = Figure(figsize=(6, 4))
    FigureCanvasAgg(fig)
    ax = fig.add_subplot()
    draw_lollipop(ax, GROUPS, ["a", "b", "c", "d"], stat="mean", sort=sort, horizontal=horizontal,
                  whisker="sd")
    fig.canvas.draw()
    legend = ax.get_legend()
    assert legend is not None
    box = legend.get_window_extent()
    assert _segments_hit_box(ax, box) == []
