"""``.opju`` graph-layer attribution: page-header enumeration + separator flag byte.

Two defects were fixed together (2026-11-14, both found against Origin 2026b
COM ``layer.x/y.from/to`` as the independent oracle):

1. **Page enumeration missed windows.** A page header carries a LEB128-style
   varint ``<type>`` (1 byte below 0x80, else 2 bytes ``[80-ff] [00-7f]``). The
   scan read it as one byte, so every window whose serial passed 127 was never
   enumerated; its graph anchors then fell into the PREVIOUS page's span and
   surfaced as phantom extra layers of that page (e.g. a 1-layer ``Graph3``
   reported with ``Graph2``'s four layers) -- with the wrong workbook bound
   to the curves.
2. **Layer-geometry separator.** ``81|80 <id> <plen> 00 <flag> 01``: the 5th
   byte is a flag field. Origin-confirmed values 40/80/88/c0 now decode
   (retry-only); unconfirmed values stay unrecovered.

A third rule: ``layer`` is the anchor's ordinal within its graph page, counted
whether or not the record decodes, so an undecodable layer leaves a gap.

Synthetic bytes only (invented names); the ``realdata`` tests load Origin's own
per-layer axis ranges from ``test-data/origin/ground_truth_public`` and compare
EVERY file/page/layer in it.
"""

from __future__ import annotations

import functools
import json
import math
from pathlib import Path

import pytest

from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_axis_real_form import _SEP_WIDE
from quantized.io.origin_project.opju_figure_curves import opju_pages
from test_io_origin_figures_opju import (
    _column_id_record,
    _id_curve_token,
    _layer_bytes,
    _real_form_bare_raw8,
    _real_form_tagged_and_rle,
)

_TEXT = r"\l(1) %(1)"


def _header(name: str, type_bytes: bytes) -> bytes:
    """``0A 80 <type varint> <namelen+2> 00 00 <name> <hi>`` -- a page header."""
    nm = name.encode("ascii")
    return b"\x0a\x80" + type_bytes + bytes([len(nm) + 2]) + b"\x00\x00" + nm + b"\x90"


_ONE = b"\x7b"  # 1-byte serial (< 128)
_TWO = b"\x87\x01"  # 2-byte serial 135 -- what a window past the 127th carries


# ── page-header enumeration ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "type_bytes", [b"\x00", b"\x7f", b"\x80\x01", b"\x87\x01", b"\x95\x01", b"\xff\x7f"]
)
def test_page_header_varint_type_enumerates(type_bytes: bytes) -> None:
    blob = b"CPYUA 4.3811 222\n" + _header("Plot1", type_bytes) + b"\x00" * 8
    assert [n for _, n in opju_pages(blob)] == ["Plot1"]


def test_page_headers_keep_file_order_across_type_widths() -> None:
    blob = (
        b"CPYUA 4.3811 222\n"
        + _header("A", _ONE)
        + b"\x00" * 6
        + _header("B", _TWO)
        + b"\x00" * 6
        + _header("C", _ONE)
    )
    assert [n for _, n in opju_pages(blob)] == ["A", "B", "C"]


def test_two_byte_type_with_high_continuation_is_not_a_header() -> None:
    """The second type byte must be < 0x80 (varint terminator); a run of three
    high bytes is not a page header, so no page is invented from it."""
    blob = b"CPYUA 4.3811 222\n\x0a\x80\x87\x88\x08\x00\x00Name\x90" + b"\x00" * 8
    assert opju_pages(blob) == []


# ── attribution: positive + negative control ─────────────────────────────────


def _two_graph_project() -> bytes:
    recs = (
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "Y", partner=1)
        + _column_id_record(3, "C", "Y", partner=1)
    )
    g1 = _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, _TEXT) + _id_curve_token(0xBA, cid=2)
    g2 = _layer_bytes(0.0, 5.0, 0.0, 100.0, 20.0, 0x03, _TEXT) + _id_curve_token(0xBB, cid=3)
    return (
        b"CPYUA 4.3811 222\n"
        + _header("WBook", _ONE)
        + recs
        + _header("Graph1", _ONE)
        + g1
        + _header("Graph2", _TWO)  # serial past 127: the header the old scan missed
        + g2
    )


def test_layer_of_a_two_byte_type_page_is_its_own_figure() -> None:
    """Positive control: Graph2 is a figure of its own with its own axes and
    its own curve -- not a second layer of Graph1."""
    figs = extract_figures_opju(_two_graph_project())
    assert [(f["name"], f["layer"]) for f in figs] == [("Graph1", 1), ("Graph2", 1)]
    assert (figs[1]["x_to"], figs[1]["y_to"]) == (5.0, 100.0)
    assert figs[0]["curves"] == [{"book": "WBook", "x": "A", "y": "B"}]
    assert figs[1]["curves"] == [{"book": "WBook", "x": "A", "y": "C"}]


def test_no_phantom_layer_on_the_preceding_page() -> None:
    """Negative control: the old attribution produced ('Graph1', 1) and
    ('Graph1', 2) here -- a layer Origin does not have -- because the Graph2
    anchor was swallowed by Graph1's span."""
    figs = extract_figures_opju(_two_graph_project())
    assert sum(f["name"] == "Graph1" for f in figs) == 1
    assert ("Graph1", 2) not in {(f["name"], f["layer"]) for f in figs}


def test_two_layers_stay_two_layers_of_one_page() -> None:
    """A genuine multi-layer page (two anchors, one header) still yields two
    layers, numbered 1..2, on that page."""
    recs = _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y", partner=1)
    blob = (
        b"CPYUA 4.3811 222\n"
        + _header("WBook", _ONE)
        + recs
        + _header("Graph1", _TWO)
        + _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, _TEXT)
        + _layer_bytes(0.0, 5.0, 0.0, 100.0, 20.0, 0x03, _TEXT)
    )
    figs = extract_figures_opju(blob)
    assert [(f["name"], f["layer"]) for f in figs] == [("Graph1", 1), ("Graph1", 2)]


# ── separator flag byte ──────────────────────────────────────────────────────


def _with_sep_flag(flag: int, lead: int = 0x81) -> bytes:
    rec = _real_form_tagged_and_rle()
    for sep_len in (b"\x0d\x08", b"\x35\x08"):
        old = b"\x81" + sep_len + b"\x00\x00\x01"
        assert old in rec
        rec = rec.replace(old, bytes([lead]) + sep_len + b"\x00" + bytes([flag]) + b"\x01")
    return b"CPYUA 4.3811 222\n" + rec


@pytest.mark.parametrize("lead", [0x81, 0x80])
@pytest.mark.parametrize("flag", [0x00, 0x40, 0x80, 0x88, 0xC0])
def test_confirmed_separator_flags_decode(flag: int, lead: int) -> None:
    figs = extract_figures_opju(_with_sep_flag(flag, lead))
    assert len(figs) == 1
    f = figs[0]
    assert (f["x_from"], f["x_to"]) == (pytest.approx(0.2), 2.0)
    assert (f["y_from"], f["y_to"]) == (1.0, 450000.0)


@pytest.mark.parametrize("flag", [0x01, 0x08, 0x30, 0x41, 0x48, 0x02, 0xFF])
def test_unconfirmed_separator_flags_stay_unrecovered(flag: int) -> None:
    """Fail closed: a flag value no oracle has confirmed drops the record
    (omitted, never guessed)."""
    assert extract_figures_opju(_with_sep_flag(flag)) == []


def test_strict_separator_records_are_unchanged() -> None:
    figs = extract_figures_opju(b"CPYUA 4.3811 222\n" + _real_form_tagged_and_rle())
    assert len(figs) == 1
    assert (figs[0]["y_from"], figs[0]["y_to"]) == (1.0, 450000.0)


# ── layer numbering: ordinal within the page, decoded or not ─────────────────


def _garbage_anchor() -> bytes:
    """A layer anchor whose record decodes by no form (fail closed)."""
    return b"\x03\x00\x00\x1f" + b"\xff" * 48


def test_undecodable_layer_leaves_a_gap_not_a_shift() -> None:
    """Layer numbers are the anchor's ORDINAL in the page. An undecodable
    first layer must leave layer 1 absent and the second layer at 2 -- never
    renumber it down to 1 (that would label Origin's layer 2 as layer 1)."""
    recs = _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y", partner=1)
    blob = (
        b"CPYUA 4.3811 222\n"
        + _header("WBook", _ONE)
        + recs
        + _header("Graph1", _TWO)
        + _garbage_anchor()
        + _layer_bytes(0.0, 5.0, 0.0, 100.0, 20.0, 0x03, _TEXT)
    )
    figs = extract_figures_opju(blob)
    assert [(f["name"], f["layer"]) for f in figs] == [("Graph1", 2)]
    assert (figs[0]["x_to"], figs[0]["y_to"]) == (5.0, 100.0)


def test_layer_ordinal_restarts_on_each_page() -> None:
    recs = _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y", partner=1)
    one = _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, _TEXT)
    blob = (
        b"CPYUA 4.3811 222\n"
        + _header("WBook", _ONE)
        + recs
        + _header("Graph1", _ONE)
        + _garbage_anchor()
        + one
        + _header("Graph2", _TWO)
        + one
    )
    figs = extract_figures_opju(blob)
    assert [(f["name"], f["layer"]) for f in figs] == [("Graph1", 2), ("Graph2", 1)]


def test_embedded_graph_in_a_workbook_page_stays_layer_one() -> None:
    """Anchors inside a workbook page are embedded graphs: unnamed, layer 1
    (a garbage anchor before them must not push the ordinal)."""
    recs = _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y", partner=1)
    blob = (
        b"CPYUA 4.3811 222\n"
        + _header("WBook", _ONE)
        + recs
        + _garbage_anchor()
        + _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, _TEXT)
    )
    assert [(f["name"], f["layer"]) for f in extract_figures_opju(blob)] == [("", 1)]


# ── wide separator pass: first candidate that parses fully ───────────────────


def _wide_only_record(lookalike: bytes = b"") -> bytes:
    """``Fixed Lambdas`` bare-raw8 record whose real separators carry flag 40
    (wide-only); ``lookalike`` is spliced into the geometry filler just past
    the nominal geometry length (where the second-separator search starts),
    replacing the two filler bytes there."""
    rec = _real_form_bare_raw8()
    for plen in (b"\x04\x07", b"\x04\x09"):
        sep = b"\x81" + plen + b"\x00\x00\x01"
        assert sep in rec
        rec = rec.replace(sep, b"\x81" + plen + b"\x00\x40\x01")
    first = b"\x81\x04\x07\x00\x40\x01"
    cut = rec.index(first) + len(first) + 7  # plen = 7
    # the lookalike replaces the 2 filler bytes, keeping the Y span inside the
    # decoder's start-scan window (_Y_START_SCAN)
    assert rec[cut : cut + 2] == b"\x00\x00"
    tail = rec[cut + 2 :] if lookalike else rec[cut:]
    return b"CPYUA 4.3811 222\n" + rec[:cut] + lookalike + tail


def test_wide_pass_skips_a_coincidental_separator_before_the_real_one() -> None:
    """A wide-shape hit sitting BEFORE the real end separator (here in the
    geometry filler, ``81 aa bb 00 40 01``) must not shadow it: the wide retry
    tries each candidate in order and keeps the first whose Y span exact-fills
    up to it. The record decodes exactly as it does without the lookalike."""
    lookalike = bytes([0x81, 0xAA, 0xBB, 0x00, 0x40, 0x01])
    assert _SEP_WIDE.match(lookalike)
    want = extract_figures_opju(_wide_only_record())
    got = extract_figures_opju(_wide_only_record(lookalike))
    assert len(want) == 1
    assert (want[0]["x_from"], want[0]["x_to"]) == (pytest.approx(0.005), pytest.approx(0.035))
    assert [(f["x_from"], f["x_to"], f["y_from"], f["y_to"]) for f in got] == [
        (f["x_from"], f["x_to"], f["y_from"], f["y_to"]) for f in want
    ]


def test_wide_pass_with_only_a_false_separator_still_fails_closed() -> None:
    """Negative control: no real separator after the false one -> no figure."""
    rec = b"CPYUA 4.3811 222\n" + b"\x03\x00\x00\x1f" + b"\x80\x00\x00\x00\x40\x01" + b"\x00" * 60
    assert extract_figures_opju(rec) == []


# ── realdata: Origin 2026b COM (layer.x.from/to, layer.y.from/to) ────────────
#
# The oracle is ``test-data/origin/ground_truth_public/axis_ranges.json``
# (per page, per layer, for every project listed in it). It is the independent
# check for the two defect classes fixed here, over EVERY file/page/layer it
# lists -- including the three large projects (208 and 434 graph pages, up to
# 27 layers per page) that stress layer numbering.
#
#   (a) no PHANTOM: a decoded (page, layer) that Origin does not have;
#   (b) every decoded (page, layer) matches Origin's x/y from/to (rel 1e-6).
#
# What the decoder does not recover is simply absent (fail closed) -- that is
# not asserted here. The two tables below pin the CURRENTLY-WRONG decodes that
# pre-date this fix (each was verified to be produced by the unfixed main
# decoder as well). They are strict: an entry that stops being wrong FAILS the
# test, so a fix is noticed and the entry deleted rather than left to rot.

_AXIS_JSON = "origin/ground_truth_public/axis_ranges.json"
_REL_TOL = 1e-6


# (file, page, layer) -> cause: decoded, but the values differ from Origin's.
# Empty (2026-11-15). The Y-span family that once filled it (a geometry double
# read as ``y_from``, a real-form record taken by the specimen parser) is fixed
# in ``test_io_origin_opju_y_span``; the last seven (items 64-65: Figure 6
# Graph3's Y (-80, 0) read as (0, -80), and Battery Aging Graph2/Graph3 read
# one slot early) in ``test_io_origin_opju_zero_slot``. Stale entries fail the
# test by design.
KNOWN_DEFECTS: dict[tuple[str, str, int], str] = {}

# (file, page, layer) -> cause: decoded under a page NAME Origin does not
# list, so keyed (page, layer) it has no counterpart. Empty (2026-11-15): the
# last class here -- a page-header name the scan truncated or never enumerated
# (``fig_CCCVerror``, ``Graph111``, ``Graph222``: a ``c0 <ch>`` run escape in
# the name field; 23-24 char names) -- is fixed in ``tree_opju._window_name``;
# see ``test_io_origin_opju_window_names``. Stale entries fail the test.
KNOWN_PHANTOMS: dict[tuple[str, str, int], str] = {}

_Key = tuple[str, str, int]


def _same(got: tuple[float, ...], want: tuple[float, ...]) -> bool:
    return all(
        math.isclose(g, w, rel_tol=_REL_TOL, abs_tol=1e-9) for g, w in zip(got, want, strict=True)
    )


@functools.cache
def _compare_to_oracle(corpus_dir: Path) -> tuple[set[_Key], set[_Key], int] | None:
    """``(phantoms, wrong, n_matched)`` over every oracle file (decoded once
    per session); ``None`` when the oracle JSON is absent."""
    oracle_path = corpus_dir / _AXIS_JSON
    if not oracle_path.is_file():
        return None
    files = json.loads(oracle_path.read_text(encoding="utf-8"))["files"]
    phantoms: set[_Key] = set()
    wrong: set[_Key] = set()
    matched = 0
    for rel, pages in files.items():
        project = corpus_dir / rel
        if not project.is_file():
            continue
        want = {
            (page, int(lay["layer"])): (lay["x_from"], lay["x_to"], lay["y_from"], lay["y_to"])
            for page, info in pages.items()
            for lay in info["layers"]
        }
        for f in extract_figures_opju(project.read_bytes()):
            if not f["name"]:  # embedded (workbook) graph: no page identity
                continue
            key = (f["name"], f["layer"])
            if key not in want:
                phantoms.add((rel, *key))
            elif _same((f["x_from"], f["x_to"], f["y_from"], f["y_to"]), want[key]):
                matched += 1
            else:
                wrong.add((rel, *key))
    return phantoms, wrong, matched


@pytest.fixture
def axis_comparison(corpus_dir: Path) -> tuple[set[_Key], set[_Key], int]:
    result = _compare_to_oracle(corpus_dir)
    if result is None:
        pytest.skip(f"{_AXIS_JSON} not present")
    return result


@pytest.mark.realdata
def test_realdata_no_phantom_layers(axis_comparison: tuple[set[_Key], set[_Key], int]) -> None:
    """(a) No decoded (page, layer) that Origin does not have."""
    phantoms, _, matched = axis_comparison
    assert matched > 1000  # the oracle really was exercised
    unexpected = sorted(phantoms - KNOWN_PHANTOMS.keys())
    assert not unexpected, f"phantom layers: {unexpected}"
    stale = sorted(KNOWN_PHANTOMS.keys() - phantoms)
    assert not stale, f"KNOWN_PHANTOMS entries no longer phantom -- delete them: {stale}"


@pytest.mark.realdata
def test_realdata_decoded_layers_match_origin(
    axis_comparison: tuple[set[_Key], set[_Key], int],
) -> None:
    """(b) Every decoded (page, layer) carries Origin's axis ranges, except the
    pinned KNOWN_DEFECTS -- which must STILL be wrong (strict-xfail)."""
    _, wrong, _ = axis_comparison
    unexpected = sorted(wrong - KNOWN_DEFECTS.keys())
    assert not unexpected, f"decoded layers that disagree with Origin: {unexpected}"
    fixed = sorted(KNOWN_DEFECTS.keys() - wrong)
    assert not fixed, (
        f"KNOWN_DEFECTS entries now match Origin (or vanished) -- delete them: {fixed}"
    )
