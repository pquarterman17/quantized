"""Statistical-plot publication rendering (calc.figure_statplots).

Rendering can't be pixel-asserted, so the tests confirm each kind/format
produces a valid non-trivial file and that malformed input is rejected. The
statistics themselves are golden in test_calc_statplots (matplotlib's boxplot/
violinplot use the same algorithms).
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.figure_statplots import STATPLOT_KINDS, render_statplot_figure

_MAGIC = {"pdf": b"%PDF", "svg": b"<?xml", "png": b"\x89PNG"}
_RNG = np.random.default_rng(7)
_GROUPS = [list(_RNG.normal(m, 1.0, 40)) for m in (0.0, 1.0, 2.0)]
_SAMPLE = list(_RNG.normal(5.0, 2.0, 200))


@pytest.mark.parametrize("kind", STATPLOT_KINDS)
@pytest.mark.parametrize("fmt", ["png", "pdf", "svg"])
def test_every_kind_and_format_renders(kind: str, fmt: str) -> None:
    data = _GROUPS if kind in ("box", "violin") else _SAMPLE
    kw = {"fit": "norm"} if kind == "histogram" else {}
    out = render_statplot_figure(kind, data, fmt=fmt, labels=["A", "B", "C"],
                                 title=kind, y_label="value", **kw)
    assert out[: len(_MAGIC[fmt])] == _MAGIC[fmt]
    assert len(out) > 800


def test_histogram_without_fit() -> None:
    out = render_statplot_figure("histogram", _SAMPLE, bins="sturges", fmt="png")
    assert out[:4] == _MAGIC["png"]


def test_bad_kind_and_format() -> None:
    with pytest.raises(ValueError, match="kind must be"):
        render_statplot_figure("swarm", _SAMPLE)
    with pytest.raises(ValueError, match="fmt must be"):
        render_statplot_figure("histogram", _SAMPLE, fmt="jpg")


def test_grouped_requires_list_of_groups() -> None:
    with pytest.raises(ValueError, match="non-empty list of groups"):
        render_statplot_figure("box", [])


def test_group_with_no_finite_values_rejected() -> None:
    with pytest.raises(ValueError, match="finite value"):
        render_statplot_figure("violin", [[1.0, 2.0], [np.nan, np.inf]])
