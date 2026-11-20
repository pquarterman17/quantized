"""``.opj`` graph-page text and axis objects (lane M, 2026-11-20).

* LabTalk button objects (a text object with an attached script) are not
  drawn, as in Origin's own exports (``figure_layers._is_script_object``).
* Page-attached text stores PAGE fractions (``annotation_marks.opj_page_attached``)
  and is placed on the panel Origin draws it beside (``opj_page_marks``).
* An axis' tick-label "Divide by" factor (``opj_tick_divide``).

Synthetic tests lock the decoded byte layouts; the realdata checks compute
their expectations from the file itself at test time.
"""

from __future__ import annotations

import struct

import pytest

from origin_corpus import has_project, origin_corpus_dir
from quantized.io.origin_project.annotation_marks import (
    opj_object_fractions,
    opj_page_attached,
    opj_text_rotation,
)
from quantized.io.origin_project.fidelity import _figure_fidelity
from quantized.io.origin_project.figure_layers import _is_script_object
from quantized.io.origin_project.figures import extract_figures
from quantized.io.origin_project.opj_page_marks import place_window_marks
from quantized.io.origin_project.opj_tick_divide import opj_tick_divide

_CORPUS = origin_corpus_dir()


# ── synthetic builders ───────────────────────────────────────────────────────


def _block(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


def _header(
    name: str,
    *,
    kind: int = 0x00,
    frac: tuple[float, float] = (0.25, 0.5),
    box: tuple[int, int, int, int] = (0, 0, 0, 0),
    attach: int = 0,
    script: int = 0,
) -> bytes:
    """A 133-byte graph-object header: type at 2, page box at 3-10, the
    fraction pair at 19/27, attach at 40, script flag at 57, name at 70."""
    p = bytearray(133)
    p[2] = kind
    struct.pack_into("<4H", p, 3, *box)
    struct.pack_into("<d", p, 19, frac[0])
    struct.pack_into("<d", p, 27, frac[1])
    p[40] = attach
    p[57] = script
    p[70 : 70 + len(name)] = name.encode("ascii")
    return bytes(p)


def _format_block(rotation: int = 0) -> bytes:
    p = bytearray(103)
    struct.pack_into("<H", p, 2, rotation)
    return bytes(p)


def _text(text: str) -> bytes:
    return text.encode("ascii") + b"\x00"


def _layer(
    x: tuple[float, float], y: tuple[float, float], frame: tuple[int, int, int, int]
) -> bytes:
    p = bytearray(240)
    p[0:4] = bytes([0, 0, 0x1F, 0])
    struct.pack_into("<d", p, 15, x[0])
    struct.pack_into("<d", p, 23, x[1])
    struct.pack_into("<d", p, 58, y[0])
    struct.pack_into("<d", p, 66, y[1])
    struct.pack_into("<4H", p, 113, *frame)
    return bytes(p)


def _window(name: str, page: tuple[int, int]) -> bytes:
    p = bytearray(195)
    p[2 : 2 + len(name)] = name.encode("ascii")
    struct.pack_into("<2H", p, 35, *page)
    return bytes(p)


def _opj(*payloads: bytes) -> bytes:
    return b"CPYA 4.3380 188 W64 #\n" + b"".join(_block(p) for p in payloads)


PAGE = (6400, 4800)
TOP = (708, 708, 3070, 2126)
BOTTOM = (708, 2126, 3070, 3546)


def _two_panel_page(*layer1_objects: bytes, layer2_objects: tuple[bytes, ...] = ()) -> bytes:
    return _opj(
        _window("Graph1", PAGE),
        _layer((0.0, 10.0), (0.0, 1.0), TOP),
        *layer1_objects,
        _layer((0.0, 10.0), (-5.0, 5.0), BOTTOM),
        *layer2_objects,
    )


# ── LabTalk button objects ────────────────────────────────────────────────────


def _button(name: str, caption: str, script: str, flag: int = 1) -> list[bytes]:
    return [_header(name, script=flag), _format_block(), _text(caption), _text(script)]


def test_script_object_needs_both_the_flag_and_a_script_block() -> None:
    blocks = [(len(p), p) for p in _button("Text", "rescale plot", "layer -a;")]
    assert _is_script_object(blocks, 0, len(blocks))
    no_flag = [(len(p), p) for p in _button("Text", "rescale plot", "layer -a;", flag=0)]
    assert not _is_script_object(no_flag, 0, len(no_flag))
    empty = [(len(p), p) for p in _button("Text", "a note", "")]  # the 1-byte NUL block
    assert not _is_script_object(empty, 0, len(empty))
    # Only the corpus value 1 is proven; another flag value keeps the text drawn.
    other = [(len(p), p) for p in _button("Text", "a label", "layer -a;", flag=2)]
    assert not _is_script_object(other, 0, len(other))


def test_button_caption_and_script_are_not_drawn_and_are_counted() -> None:
    data = _two_panel_page(
        *_button("Text", "rescale plot", "page.active=3;\r\nlayer -a;"),
        _header("Text1"),
        _format_block(),
        _text("a real note"),
    )
    top = extract_figures(data)[0]
    texts = [m["text"] for m in top["annotation_marks"]]
    assert texts == ["a real note"]
    assert top["annotations"] == ["a real note"]
    assert top["script_objects_not_drawn"] == 1
    assert "script_objects_not_drawn" in _figure_fidelity(top)["omissions"]


# ── page attachment ───────────────────────────────────────────────────────────


def test_attach_bit_reads_the_pair_as_page_fractions() -> None:
    frame = TOP
    layer = _header("Text", frac=(0.25, 0.5))
    page = _header("Text", frac=(0.25, 0.5), attach=1)
    assert not opj_page_attached(layer) and opj_page_attached(page)
    assert opj_object_fractions(layer, frame, PAGE) == (0.25, 0.5)
    fx, fy = opj_object_fractions(page, frame, PAGE)  # type: ignore[misc]
    assert fx == pytest.approx((0.25 * 6400 - 708) / (3070 - 708))
    assert fy == pytest.approx((0.5 * 4800 - 708) / (2126 - 708))
    # Without a page size a page-attached object cannot be placed: no guess.
    assert opj_object_fractions(page, frame, None) is None


def test_page_attached_label_lands_on_the_panel_it_sits_beside() -> None:
    # "(b)" stored in layer 1 but at page y 2200..2300: beside the lower panel.
    data = _two_panel_page(
        _header("Text", frac=(0.1, 2200 / 4800), box=(640, 2200, 700, 2300), attach=1),
        _format_block(),
        _text("(b)"),
    )
    top, bottom = extract_figures(data)
    assert top["annotation_marks"] == []
    (mark,) = bottom["annotation_marks"]
    assert mark["text"] == "(b)"
    assert mark["x"] == pytest.approx(10 * (640 - 708) / (3070 - 708))
    assert mark["y"] == pytest.approx(5 - 10 * (2200 - 2126) / (3546 - 2126))
    assert "_geom" not in mark


def test_rotated_text_left_of_a_panel_is_that_panels_y_title() -> None:
    # Layer-attached text in layer 1, rotated 90 degrees, left of the lower panel.
    fx = (300 - 708) / (3070 - 708)
    fy = (3400 - 708) / (2126 - 708)
    data = _two_panel_page(
        _header("Text7", frac=(fx, fy), box=(250, 2300, 360, 3400)),
        _format_block(rotation=900),
        _text("asymmetry (%)"),
    )
    top, bottom = extract_figures(data)
    assert top["annotation_marks"] == [] and top["y_title"] == ""
    assert bottom["y_title"] == "asymmetry (%)"
    assert bottom["annotation_marks"] == []


def test_unrotated_text_left_of_a_panel_stays_a_mark() -> None:
    fx = (300 - 708) / (3070 - 708)
    fy = (2400 - 708) / (2126 - 708)
    data = _two_panel_page(
        _header("Text7", frac=(fx, fy), box=(250, 2400, 650, 2500)),
        _format_block(rotation=0),
        _text("a note"),
    )
    _, bottom = extract_figures(data)
    assert bottom["y_title"] == ""
    assert [m["text"] for m in bottom["annotation_marks"]] == ["a note"]


def test_unrotated_text_below_a_panel_is_that_panels_x_title() -> None:
    # XMCD GraphT*: "photon energy (eV)" is free text in layer 1, centred
    # below the lowest panel, whose own XB title is blank.
    fx = (1500 - 708) / (3070 - 708)
    fy = (3850 - 708) / (2126 - 708)
    data = _two_panel_page(
        _header("Text8", frac=(fx, fy), box=(1500, 3700, 2300, 3850)),
        _format_block(rotation=0),
        _text("photon energy (eV)"),
    )
    top, bottom = extract_figures(data)
    assert top["annotation_marks"] == [] and top["x_title"] == ""
    assert bottom["x_title"] == "photon energy (eV)"
    assert bottom["annotation_marks"] == []


def test_text_rotation_reads_tenths_of_a_degree() -> None:
    assert opj_text_rotation(_format_block(900)) == 900
    assert opj_text_rotation(_format_block(0)) == 0
    assert opj_text_rotation(b"\x00" * 64) is None


def test_single_layer_marks_are_left_in_place() -> None:
    fig = {
        "layer": 1,
        "frame": {"left": 0, "top": 0, "right": 10, "bottom": 10},
        "x_from": 0.0,
        "x_to": 1.0,
        "y_from": 0.0,
        "y_to": 1.0,
        "y_title": "",
        "annotation_marks": [
            {
                "text": "t",
                "x": 0.5,
                "y": 0.5,
                "_geom": {"anchor": (50.0, 50.0), "box": None, "rotation": 0},
            }
        ],
    }
    place_window_marks([fig])
    assert fig["annotation_marks"] == [{"text": "t", "x": 0.5, "y": 0.5}]


# ── tick-label "Divide by" ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("name", "body", "want"),
    [
        ("OB", b"10\x00", ("bottom", 10.0)),
        ("OL", b"0.00291\x00", ("left", 0.00291)),
        ("OR", b"0.1\x00\x00\x00", ("right", 0.1)),
        ("OT", b"2\x00", ("top", 2.0)),
        ("OB", b"0\x00", None),  # no factor
        ("OB", b"1\x00", None),  # dividing by 1 changes nothing
        ("OB", b"ten\x00", None),
        ("XB", b"10\x00", None),
    ],
)
def test_tick_divide_object(name: str, body: bytes, want: tuple[str, float] | None) -> None:
    blocks = [(133, _header(name, kind=0x06)), (len(body), body)]
    assert opj_tick_divide(name, blocks, 0, 2) == want


def test_tick_divide_needs_the_factor_object_type() -> None:
    blocks = [(133, _header("OB", kind=0x00)), (3, b"10\x00")]
    assert opj_tick_divide("OB", blocks, 0, 2) is None


def test_tick_divide_reaches_the_figure() -> None:
    data = _two_panel_page(_header("OB", kind=0x06), b"10\x00")
    top, bottom = extract_figures(data)
    assert top["tick_label_divide"] == {"bottom": 10.0}
    assert "tick_label_divide" not in bottom


# ── realdata ─────────────────────────────────────────────────────────────────


@pytest.mark.realdata
def test_realdata_no_labtalk_script_is_drawn() -> None:
    """Every script block of every button object in the file, read at test
    time: none of its lines may reach a figure's annotations or marks."""
    from quantized.io.origin_project.container import walk_blocks
    from quantized.io.origin_project.windows import _cstring

    src = _CORPUS / "XMCD.opj"
    if not has_project(src):
        pytest.skip("XMCD.opj not in the local Origin corpus")
    data = src.read_bytes()
    blocks = [(s, p) for s, p in walk_blocks(data) if s]
    script_lines: set[str] = set()
    for k, (size, payload) in enumerate(blocks):
        name = _cstring(payload, 70, 24) if size == 133 else None
        if name and name.startswith("Text") and _is_script_object(blocks, k, len(blocks)):
            body = blocks[k + 3][1].split(b"\x00", 1)[0].decode("latin1")
            script_lines.update(t.strip() for t in body.splitlines() if len(t.strip()) > 6)
    assert script_lines, "expected LabTalk button objects in XMCD.opj"
    figs = extract_figures(data)
    drawn = {t.strip() for f in figs for t in f["annotations"]}
    drawn |= {
        line.strip() for f in figs for m in f["annotation_marks"] for line in m["text"].split("\n")
    }
    assert not (drawn & script_lines), sorted(drawn & script_lines)[:5]
    assert sum(f.get("script_objects_not_drawn", 0) for f in figs) > 0
