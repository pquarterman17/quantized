"""Panel insets (audit item #15): an inset box showing ANOTHER dataset, an
embedded image, or a small table -- see ``calc.figure_panel_insets`` doc.
These tests FAIL without the feature (no ``calc.figure_panel_insets`` module,
no ``apply_panel_insets`` call site, no validation)."""

from __future__ import annotations

import base64
import io
from typing import Any
from unittest.mock import patch

import numpy as np
import pytest
from matplotlib.image import AxesImage
from matplotlib.lines import Line2D
from matplotlib.table import Table
from PIL import Image

import quantized.calc.figure as fig_mod
from quantized.calc.figure import render_figure
from quantized.calc.figure_panel_insets import validate_panel_insets

X = np.linspace(0.0, 10.0, 51)
Y1 = np.sin(X)
Y2 = np.cos(X)
AT = [0.05, 0.05, 0.3, 0.3]

def _tiny_png_base64() -> str:
    """A real 2x2 RGB PNG, base64-encoded (no fixture file needed -- small
    enough to build on the fly, unlike a hand-typed base64 string, which is
    easy to truncate by hand and then fail to decode)."""
    img = Image.new("RGB", (2, 2), color=(200, 40, 40))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


_TINY_PNG = _tiny_png_base64()


def _render(overrides: dict[str, Any], **kw: Any) -> Any:
    captured: dict[str, Any] = {}
    real = fig_mod.savefig_bytes

    def grab(fig: Any, *a: Any, **k: Any) -> bytes:
        captured["fig"] = fig
        return real(fig, *a, **k)

    with patch.object(fig_mod, "savefig_bytes", grab):
        render_figure(X, [("A", Y1), ("B", Y2)], fmt="svg", overrides=overrides, **kw)
    return captured["fig"]


def _inset_axes(fig: Any) -> list[Any]:
    """Panel insets are ``ax.inset_axes`` CHILD axes (``child_axes``), not
    top-level ``fig.axes`` entries -- same as the magnifier inset
    (``test_calc_figure_inset.py``'s ``_main_and_inset``)."""
    main = fig.axes[0]
    return list(main.child_axes)


def test_dataset_panel_inset_draws_its_own_series() -> None:
    other_x = [0.0, 1.0, 2.0, 3.0]
    other_y = [1.0, 4.0, 9.0, 16.0]
    ov = {
        "panel_insets": [
            {
                "at": AT,
                "content": {
                    "kind": "dataset",
                    "x": other_x,
                    "series": [{"label": "fit", "y": other_y, "color": "#ff0000"}],
                    "legend": True,
                    "title": "Other dataset",
                },
            }
        ]
    }
    fig = _render(ov)
    insets = _inset_axes(fig)
    assert len(insets) == 1
    kids = insets[0].get_children()
    lines = [a for a in kids if isinstance(a, Line2D) and a.get_label() == "fit"]
    assert len(lines) == 1
    np.testing.assert_allclose(lines[0].get_xdata(), other_x)
    np.testing.assert_allclose(lines[0].get_ydata(), other_y)
    assert insets[0].get_title() == "Other dataset"


def test_image_panel_inset_draws_the_decoded_raster() -> None:
    ov = {
        "panel_insets": [
            {"at": AT, "content": {"kind": "image", "data": _TINY_PNG, "format": "png"}},
        ]
    }
    fig = _render(ov)
    insets = _inset_axes(fig)
    assert len(insets) == 1
    images = [a for a in insets[0].get_children() if isinstance(a, AxesImage)]
    assert len(images) == 1
    raw = base64.b64decode(_TINY_PNG)
    with Image.open(io.BytesIO(raw)) as expected:
        expected_arr = np.asarray(expected.convert("RGBA"))
    np.testing.assert_array_equal(images[0].get_array(), expected_arr)


def test_table_panel_inset_draws_cells() -> None:
    ov = {
        "panel_insets": [
            {
                "at": AT,
                "content": {
                    "kind": "table",
                    "headers": ["param", "value"],
                    "rows": [["x0", "1.23"], ["fwhm", "0.45"]],
                    "title": "Fit parameters",
                },
            }
        ]
    }
    fig = _render(ov)
    insets = _inset_axes(fig)
    assert len(insets) == 1
    tables = [a for a in insets[0].get_children() if isinstance(a, Table)]
    assert len(tables) == 1
    assert tables[0].get_celld()[(0, 0)].get_text().get_text() == "param"
    assert tables[0].get_celld()[(1, 1)].get_text().get_text() == "1.23"


def test_multiple_panel_insets_all_draw() -> None:
    ov = {
        "panel_insets": [
            {"at": [0.05, 0.05, 0.3, 0.3], "content": {"kind": "table", "rows": [["a"]]}},
            {
                "at": [0.6, 0.6, 0.3, 0.3],
                "content": {
                    "kind": "dataset",
                    "x": [0, 1],
                    "series": [{"label": "s", "y": [0, 1]}],
                },
            },
        ]
    }
    fig = _render(ov)
    assert len(_inset_axes(fig)) == 2


def test_panel_inset_draws_exactly_once_on_a_dual_y_figure() -> None:
    """A panel inset owns its own content (no twin awareness) but must not
    double-draw on the y2 path the way an un-stripped override would."""
    ov = {
        "panel_insets": [
            {"at": AT, "content": {"kind": "table", "rows": [["a", "b"]]}},
        ]
    }
    fig = _render(ov, y2_mask=[False, True])
    child_axes = [ins for ax in fig.axes for ins in ax.child_axes]
    tables = [a for ins in child_axes for a in ins.get_children() if isinstance(a, Table)]
    assert len(tables) == 1


def test_validate_panel_insets_rejects_bad_at() -> None:
    with pytest.raises(ValueError, match="at"):
        validate_panel_insets([{"at": [0, 0, 0, 1], "content": {"kind": "table", "rows": [["a"]]}}])


def test_validate_panel_insets_rejects_unknown_kind() -> None:
    with pytest.raises(ValueError, match="kind"):
        validate_panel_insets([{"at": AT, "content": {"kind": "bogus"}}])


def test_validate_panel_insets_rejects_mismatched_dataset_lengths() -> None:
    with pytest.raises(ValueError, match="length"):
        validate_panel_insets(
            [{"at": AT, "content": {"kind": "dataset", "x": [0, 1, 2], "series": [{"y": [0, 1]}]}}]
        )


def test_validate_panel_insets_rejects_bad_image_format() -> None:
    bad = {"kind": "image", "data": _TINY_PNG, "format": "bmp"}
    with pytest.raises(ValueError, match="format"):
        validate_panel_insets([{"at": AT, "content": bad}])


def test_validate_panel_insets_rejects_empty_table_rows() -> None:
    with pytest.raises(ValueError, match="row"):
        validate_panel_insets([{"at": AT, "content": {"kind": "table", "rows": []}}])


def test_render_figure_rejects_invalid_panel_insets() -> None:
    with pytest.raises(ValueError):
        render_figure(X, [("A", Y1)], overrides={"panel_insets": [{"at": [0, 0, -1, 1]}]})
