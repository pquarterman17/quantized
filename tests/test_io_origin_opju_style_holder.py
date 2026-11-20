"""``.opju`` style-holder objects are not plots (lane M, 2026-11-20).

Origin saves plot-style templates as objects named ``Style``, ``Style1``, ...
whose first field is a curve-token-shaped column reference. Read as plots,
they added phantom bindings and, being first in the file, won the per-layer
dedup against the layer's real plot tokens, which carry the curve's own X and
style (SerialCore Bqqbar Graph2: a D-vs-A segment where Origin draws D
against C as points). ``opju_curves_allcols.in_style_holder``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from origin_corpus import has_project
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_curves_allcols import (
    extract_curves_allcols,
    in_style_holder,
)

_TOKEN = b"\xd7\x01\x01\x01\x80\x01\x02\x84"  # <flag> 01 01 01 80 01 <ordinal 2>


def _object(name: bytes) -> bytes:
    return bytes([len(name)]) + name + b"\xa2\x01\x28\xaa\x00\x80"


@pytest.mark.parametrize("name", [b"Style", b"Style1", b"Style12"])
def test_a_token_opening_a_style_holder_is_detected(name: bytes) -> None:
    b = b"\x00\x91" + _object(name) + _TOKEN
    assert in_style_holder(b, b.index(_TOKEN))


@pytest.mark.parametrize("name", [b"Notes1", b"Styles", b"MyStyle"])
def test_other_objects_are_not_style_holders(name: bytes) -> None:
    b = b"\x00\x91" + _object(name) + _TOKEN
    assert not in_style_holder(b, b.index(_TOKEN))


def test_style_holder_tokens_add_no_curve() -> None:
    style = b"\x00\x91" + _object(b"Style1") + _TOKEN
    plot = b"\x00\x0a\x80" + _TOKEN[:-1] + b"\x83"
    counts = {"Book1": 3}
    assert extract_curves_allcols(style, 0, len(style), counts) == []
    assert [c["y"] for c in extract_curves_allcols(plot, 0, len(plot), counts)] == ["B"]


def _public(rel: str) -> Path | None:
    for ancestor in Path(__file__).resolve().parents:
        p = ancestor / "test-data" / "origin" / "public" / rel
        if p.is_file():
            return p
    return None


@pytest.mark.realdata
def test_realdata_bqqbar_curves_come_from_plot_records() -> None:
    """Every layer-1 curve of Bqqbar Graph2 is bound by a real plot record
    (its own recorded X), and none plots a column against itself."""
    src = _public("SerialCore_MassInequality/Bqqbar.opju")
    if src is None or not has_project(src):
        pytest.skip("SerialCore Bqqbar.opju not in the local public corpus")
    figs = [f for f in extract_figures_opju(src.read_bytes()) if f["name"] == "Graph2"]
    layer1 = next(f for f in figs if f["layer"] == 1)
    assert layer1["curves"]
    assert all(c.get("xRecorded") for c in layer1["curves"]), layer1["curves"]
    assert all(c["x"] != c["y"] for c in layer1["curves"]), layer1["curves"]
