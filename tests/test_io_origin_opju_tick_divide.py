"""``.opju`` tick-label "Divide by" / "Formula" objects (``opju_tick_divide``).

Synthetic tests lock the decoded framing and the factor rules; the realdata
checks compute their expectations at run time from the local corpus (never
committed): every framed object body parses, no name occurs outside the
framing, and the projects whose Origin previews prove a factor decode it.
"""

from __future__ import annotations

import re

import pytest

from origin_corpus import has_project, origin_corpus_dir
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_tick_divide import opju_tick_divide, tick_label_factor

_HEAD = b"\x3e\x00\x3e\x00\xc2\xff\xc2\xff\x91\x02"


def _obj(name: bytes, text: bytes, filler: bytes = b"\xa6\x01\x28\xaa") -> bytes:
    """One framed object: name header, a short token run, then the body
    block ``00 80 <clen> <literal run> <zero run>``."""
    tokens = bytes([len(text)]) + text + b"\x8e"
    block = b"\x00\x80" + bytes([len(tokens)]) + tokens
    return _HEAD + name + filler + block + b"\x00\x00\x00\x00\x0a"


@pytest.mark.parametrize(
    ("kind", "text", "want"),
    [
        ("O", "100", 100.0),
        ("O", "0.1", 0.1),
        ("O", "1E-9", 1e-9),
        ("O", "10^3", 1000.0),
        ("O", "1/(16*96)*1000", 1000 / (16 * 96)),
        ("O", "0", None),  # Origin's "none"
        ("O", "1", None),
        ("O", "-1e6", None),  # a negative factor is not drawn
        ("O", "abs(2)", None),  # names / calls are never evaluated
        ("O", "1+2", None),
        ("F", "5*x", 0.2),
        ("F", "x*4", 0.25),
        ("F", "x/100", 100.0),
        ("F", "100 * x", 0.01),
        ("F", "10^x", None),  # not a factor
        ("F", "x-1920", None),
        ("F", "1*2^-X", None),
    ],
)
def test_tick_label_factor(kind: str, text: str, want: float | None) -> None:
    got = tick_label_factor(kind, text)
    assert got == pytest.approx(want) if want is not None else got is None


def test_framed_objects_decode_per_side() -> None:
    b = b"\x00" * 8 + _obj(b"OL", b"100") + b"\x01" * 5 + _obj(b"FB", b"5*x") + _obj(b"OR", b"0")
    assert opju_tick_divide(b, 0, len(b)) == {"left": 100.0, "bottom": pytest.approx(0.2)}


def test_bytes_after_the_nul_are_stale_and_ignored() -> None:
    b = _obj(b"OB", b"1\x00100")  # "1" with a remnant of an older value
    assert opju_tick_divide(b, 0, len(b)) == {}
    b = _obj(b"OB", b"20\x003")
    assert opju_tick_divide(b, 0, len(b)) == {"bottom": 20.0}


def test_unframed_name_or_malformed_body_is_not_read() -> None:
    bare = b"\x91\x02OL" + b"\xa6\x01\x28\xaa\x00\x80\x05\x03100\x8e"
    assert opju_tick_divide(bare, 0, len(bare)) == {}
    broken = _HEAD + b"OL" + b"\xa6\x01\x28\xaa\x00\x80\x05\x09100\x8e"  # literal crosses clen
    assert opju_tick_divide(broken, 0, len(broken)) == {}
    other = _obj(b"XB", b"100")  # an axis TITLE object, not a factor
    assert opju_tick_divide(other, 0, len(other)) == {}


def test_only_the_layer_window_is_read() -> None:
    b = _obj(b"OL", b"100") + _obj(b"OB", b"10")
    first_end = len(_obj(b"OL", b"100"))
    assert opju_tick_divide(b, 0, first_end) == {"left": 100.0}
    assert opju_tick_divide(b, first_end, len(b)) == {"bottom": 10.0}


def test_two_different_factors_on_one_side_are_dropped() -> None:
    b = _obj(b"OB", b"10") + _obj(b"FB", b"5*x")
    assert opju_tick_divide(b, 0, len(b)) == {}


# ── realdata ─────────────────────────────────────────────────────────────────

_PUBLIC = origin_corpus_dir() / "public"
_NAME = re.compile(rb"\x91\x02[OF][BTLR]")


def _opju_files() -> list:
    return sorted(p for p in _PUBLIC.rglob("*.opju") if has_project(p)) if _PUBLIC.is_dir() else []


@pytest.mark.realdata
def test_realdata_every_tick_label_object_is_framed() -> None:
    files = _opju_files()
    if not files:
        pytest.skip("public Origin corpus not present")
    named = framed = 0
    for p in files:
        raw = p.read_bytes()
        named += len(_NAME.findall(raw))
        framed += raw.count(_HEAD + b"O") + raw.count(_HEAD + b"F")
    assert named > 0
    assert framed >= named  # no name occurs outside the framing


def _figure(rel: str, page: str) -> dict:
    hits = [p for p in _opju_files() if p.as_posix().endswith(rel)]
    if not hits:
        pytest.skip(f"{rel} not in the local corpus")
    figs = [f for f in extract_figures_opju(hits[0].read_bytes()) if f["name"] == page]
    assert figs, page
    return figs[0]


@pytest.mark.realdata
def test_realdata_percent_axis_divides_by_its_object() -> None:
    """成功率 Graph1: Y data in percent, Origin's preview ticks read 0..1."""
    fig = _figure("fig5/plot/成功率.opju", "Graph1")
    assert fig["y_to"] > 50  # the data range is percent ...
    assert fig.get("tick_label_divide") == {"left": 100.0}  # ... the labels are not
    neg = _figure("fig5/plot/成功率.opju", "Graph3")  # data already 0..1: no object
    assert "tick_label_divide" not in neg


@pytest.mark.realdata
def test_realdata_formula_axis_reads_as_a_factor() -> None:
    """Fig3_e Graph2: X 1..100 drawn by Origin as 0..500 (Formula 5*x)."""
    fig = _figure("plot/Fig3_e_修改采样点_不分块能量图.opju", "Graph2")
    assert fig["x_to"] < 200
    assert fig.get("tick_label_divide") == {"bottom": pytest.approx(0.2)}
