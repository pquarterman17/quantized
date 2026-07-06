"""Per-curve visual style decode (``curve_style_color.py``) vs Origin's own
``curve_style.json`` ground-truth oracle.

Two layers, mirroring the sibling figure suites:

* **synthetic** -- CI-runnable unit tests of the ocolor decoder, the record
  field reads (fail-closed gates included), and the CPYUA sparse-stream
  reconstructor, using in-test byte fixtures only;
* **realdata** -- the captured oracle (``ground_truth/<stem>/curve_style.json``
  for ``hc2convert``/``Hc2 data``/``RockingCurve``/``UnpolPlots``): every
  type-1 ocolor must reproduce the oracle's ``color_rgb`` exactly, and every
  decoded curve color/symbol on an oracle-covered graph must match the
  oracle with ZERO mismatches (a curve at default color is fine; a curve at
  the wrong color is not).
"""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path

import pytest

from quantized.io.origin_project.curve_style_color import (
    ORIGIN_PALETTE,
    ocolor_to_rgb,
    opju_style_record,
    style_fields,
)


def _resolve_corpus_dir() -> Path:
    """The local-only ``../test-data/origin`` corpus; walks up from
    ``__file__`` so this still resolves inside a worktree agent -- mirrors
    ``test_io_origin_ground_truth.py``."""
    candidate = Path(__file__).resolve().parents[1] / ".." / "test-data" / "origin"
    if candidate.exists():
        return candidate
    for ancestor in Path(__file__).resolve().parents:
        walked = ancestor / "test-data" / "origin"
        if walked.exists():
            return walked
    return candidate


_TD = _resolve_corpus_dir()
_GT = _TD / "specimens" / "ground_truth"
_REF = re.compile(r"\[([^\]]+)\][^!]*!([A-Z]{1,2})")
_ORACLE_STEMS = ["hc2convert", "Hc2 data", "RockingCurve", "UnpolPlots"]
_KIND_NAME = {0: None, 1: "square", 2: "circle", 3: "triangle"}


# ── synthetic: ocolor decoding ────────────────────────────────────────────────


def test_ocolor_type1_is_colorref_bgr() -> None:
    """Type-1 (high byte 0x01) is a direct COLORREF: 0x01BBGGRR -- the four
    distinct type-1 values the oracle corpus contains."""
    assert ocolor_to_rgb(22106449) == "#515151"
    assert ocolor_to_rgb(20988145) == "#F14040"
    assert ocolor_to_rgb(31420186) == "#1A6FDF"
    assert ocolor_to_rgb(16801493) == "#D55E00"


def test_ocolor_palette_is_one_based_classic_table() -> None:
    """Type-0 is a 1-based index into Origin's classic 24-color list (the
    LabTalk convention the oracle uses)."""
    assert ocolor_to_rgb(1) == "#000000"  # black
    assert ocolor_to_rgb(2) == "#FF0000"  # red
    assert ocolor_to_rgb(4) == "#0000FF"  # blue
    assert ocolor_to_rgb(15) == "#FF8000"  # orange
    assert ocolor_to_rgb(24) == "#404040"  # dark gray
    assert len(ORIGIN_PALETTE) == 24
    assert ocolor_to_rgb(0) is None  # below the 1-based range
    assert ocolor_to_rgb(25) is None  # past the classic table: never guess


def test_ocolor_auto_and_unknown_types_yield_none() -> None:
    assert ocolor_to_rgb(-4) is None  # the oracle's auto/increment report
    assert ocolor_to_rgb(0xFFFFFFF7) is None  # the on-disk auto sentinel
    assert ocolor_to_rgb(0x02000001) is None  # unknown color type byte


# ── synthetic: record field reads + gates ─────────────────────────────────────


def _record(
    *,
    kind: int = 0,
    style: int = 0,
    symbol_color: int | None = None,
    line_color: int | None = None,
    term: int = 0xFF,
    size: int = 519,
) -> bytes:
    buf = bytearray(size)
    buf[23] = kind
    buf[76] = style
    struct.pack_into("<I", buf, 302, 0xFFFFFFF7)  # the constant auto sentinel
    struct.pack_into("<I", buf, 306, 0xFFFFFFF7 if symbol_color is None else symbol_color)
    buf[310] = term
    struct.pack_into("<I", buf, 362, 0 if line_color is None else line_color)
    return bytes(buf)


def test_style_fields_symbol_plot_reads_symbol_color() -> None:
    rec = _record(kind=2, style=0xC9, symbol_color=0x014040F1)
    assert style_fields(rec) == {"style": "scatter", "symbol": "circle", "color": "#F14040"}


def test_style_fields_line_plot_reads_line_color() -> None:
    # disk palette is 0-BASED: 14 -> LabTalk 15 -> orange
    rec = _record(kind=0, style=0xC8, line_color=14)
    assert style_fields(rec) == {"style": "line", "color": "#FF8000"}


def test_style_fields_palette_black_is_the_zero_field() -> None:
    # an all-zero color field is disk palette 0 = LabTalk 1 = black
    rec = _record(kind=1, style=0xC9, symbol_color=0)
    assert style_fields(rec) == {"style": "scatter", "symbol": "square", "color": "#000000"}


def test_style_fields_fail_closed_gates() -> None:
    # auto on disk: no color key, never a guessed default
    assert "color" not in style_fields(_record(kind=2, style=0xC9))
    # missing 0xff terminator (hc2convert's 0x1e anchors): no color
    assert "color" not in style_fields(_record(kind=2, style=0xC9, symbol_color=1, term=0x1E))
    # a disk palette index past the classic table: no color
    assert "color" not in style_fields(_record(kind=2, style=0xC9, symbol_color=24))
    # unmapped style byte (0xca line+symbol, 0xe7) and unmapped symbol kinds
    assert "style" not in style_fields(_record(kind=9, style=0xCA, symbol_color=1))
    assert "symbol" not in style_fields(_record(kind=9, style=0xC8, symbol_color=1))
    # a record too short to hold the line-color field decodes nothing
    assert style_fields(b"\x00" * 100) == {}


def test_style_fields_515_byte_variant_reads_the_same_offsets() -> None:
    """The 4-byte-smaller CPYA anchor variant (XMCD) differs only past offset
    492 -- all style fields sit at identical offsets."""
    rec = _record(kind=3, style=0xC9, symbol_color=0x01515151, size=515)
    assert style_fields(rec) == {"style": "scatter", "symbol": "triangle", "color": "#515151"}


# ── synthetic: the CPYUA sparse-stream reconstructor ──────────────────────────


def _chunks_to_519(*chunks: bytes, reached: int) -> bytes:
    """Append chained zero-length skip chunks so the stream completes the
    519-byte record exactly, as every validated real stream does."""
    stream = b"".join(chunks)
    pad = 519 - reached
    tail = b""
    while pad > 0:
        step = min(pad, 0x3F + 3)
        if step < 3:  # a skip chunk can't encode <3; fold into the previous one
            raise AssertionError("fixture reached-position must leave >=3 to pad")
        tail += bytes([0x80 + step - 3, 0x00])
        pad -= step
    return stream + tail


def test_opju_style_record_reconstructs_the_opj_layout() -> None:
    """A sparse stream exercising all three chunk kinds (tagged skip+literal,
    c0-c3 RLE, bare literal continuation) reconstructs the fixed record: id
    at 4, kind at 23, style byte at 76, sentinel+color+terminator at 302-310."""
    stream = _chunks_to_519(
        bytes([0x80, 0x03, 0x07, 0x00, 0x21]),  # skip 3 -> id u16 @4 + byte @6
        bytes([0x8D, 0x01, 0x02]),  # skip 16 -> kind=2 (circle) @23
        bytes([0xB1, 0x01, 0xC9]),  # skip 52 -> style byte c9 @76
        bytes([0xBF, 0x00, 0xBF, 0x00, 0xBF, 0x00]),  # 3 chained 66-zero skips -> @275
        bytes([0x98, 0x01, 0xF7]),  # skip 27 -> sentinel lead f7 @302
        bytes([0xC0, 0xFF]),  # RLE: 3x ff @303-305 (completes 0xFFFFFFF7)
        bytes([0x05, 0xF1, 0x40, 0x40, 0x01, 0xFF]),  # bare literal: color+term @306-310
        reached=311,
    )
    rec = opju_style_record(stream, 0)
    assert rec is not None
    assert struct.unpack_from("<H", rec, 4)[0] == 7
    assert struct.unpack_from("<I", rec, 302)[0] == 0xFFFFFFF7
    assert style_fields(rec) == {"style": "scatter", "symbol": "circle", "color": "#F14040"}


def test_opju_style_record_incomplete_stream_is_none() -> None:
    """A stream that ends (0x00 / unknown escape / truncation) before the
    record completes must NOT decode -- a partial reconstruction would
    misread unreached zeros as palette black."""
    good = _chunks_to_519(bytes([0x80, 0x03, 0x07, 0x00, 0x21]), reached=7)
    assert opju_style_record(good, 0) is not None
    assert opju_style_record(good[:-1], 0) is None  # truncated final chunk
    assert opju_style_record(good[:20], 0) is None  # stream stops mid-record
    bad = bytes([0x80, 0x03, 0x07, 0x00, 0x21, 0x00])  # explicit terminator byte
    assert opju_style_record(bad, 0) is None


# ── realdata: the captured curve_style.json oracle ────────────────────────────

realdata = pytest.mark.realdata


def _oracle(stem: str) -> dict[str, list[dict[str, object]]] | None:
    path = _GT / stem / "curve_style.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8-sig"))


@realdata
def test_realdata_ocolor_reproduces_every_oracle_type1_rgb() -> None:
    """The free unit test: for every one of the oracle's type-1 plots (96
    corpus-wide), ocolor_to_rgb(raw) must equal Origin's own color_rgb."""
    checked = 0
    for stem in _ORACLE_STEMS:
        oracle = _oracle(stem)
        if oracle is None:
            continue
        for plots in oracle.values():
            for p in plots:
                raw = int(p["color"]) & 0xFFFFFFFF  # type: ignore[call-overload]
                if raw >> 24 == 1:
                    assert ocolor_to_rgb(raw) == p["color_rgb"], (stem, p["ref"])
                    checked += 1
    if checked == 0:
        pytest.skip("curve_style oracle not present on this machine")
    assert checked >= 96


def _opj_graph_curves(path: Path) -> dict[str, list[dict[str, str]]]:
    from quantized.io.origin_project.container import walk_blocks
    from quantized.io.origin_project.opj_curves import (
        _is_graph_header,
        book_x_columns,
        column_id_map,
        extract_curves,
    )
    from quantized.io.origin_project.windows import _is_window_header

    blocks = list(walk_blocks(path.read_bytes()))
    id_map = column_id_map(blocks)
    x_cols = book_x_columns(blocks)
    bounds: list[tuple[int, str, bool]] = []
    for i in range(len(blocks)):
        graph = _is_graph_header(blocks, i)
        if graph is not None:
            bounds.append((i, graph, True))
            continue
        window = _is_window_header(blocks[i][1])
        if window is not None:
            bounds.append((i, window, False))
    out: dict[str, list[dict[str, str]]] = {}
    for k, (i, name, is_graph) in enumerate(bounds):
        if not is_graph:
            continue
        end = bounds[k + 1][0] if k + 1 < len(bounds) else len(blocks)
        out[name] = extract_curves(blocks, i, end, id_map, x_cols)
    return out


def _opju_graph_curves(path: Path) -> dict[str, list[dict[str, str]]]:
    from quantized.io.origin_project.opju_figure_curves import (
        column_id_table,
        extract_curves_by_id,
        opju_pages,
    )

    b = path.read_bytes()
    pages = opju_pages(b)
    table = column_id_table(b, pages)
    bounds = [*pages, (len(b), "")]
    return {
        name: extract_curves_by_id(b, start, bounds[i + 1][0], table)
        for i, (start, name) in enumerate(pages)
    }


# (stem, source file, decoder, verified-correct floor on reachable graphs)
_STYLE_CASES = [
    ("hc2convert", "hc2convert.opj", _opj_graph_curves, 49),
    ("Hc2 data", "Hc2 data.opju", _opju_graph_curves, 19),
    ("RockingCurve", "RockingCurve.opju", _opju_graph_curves, 8),
    ("UnpolPlots", "UnpolPlots.opju", _opju_graph_curves, 12),
]


@realdata
@pytest.mark.parametrize(("stem", "fname", "decoder", "floor"), _STYLE_CASES)
def test_realdata_curve_style_matches_oracle(stem, fname, decoder, floor) -> None:
    """Decoded curve color + symbol vs the oracle, per reachable graph: ZERO
    mismatches allowed. A curve whose color we omit (auto on disk -- e.g.
    UnpolPlots' 4 error-bar curves whose oracle reports the inherited
    effective black) counts as omitted, not wrong."""
    src = _TD / fname
    oracle = _oracle(stem)
    if oracle is None or not src.exists():
        pytest.skip(f"corpus/oracle for '{stem}' not present on this machine")
    graphs = decoder(src)
    ok = wrong = omitted = 0
    sym_wrong = 0
    for gname, plots in oracle.items():
        curves = graphs.get(gname)
        if curves is None:
            continue  # structurally unreachable window (fit-report pages etc.)
        for p in plots:
            ref = _REF.match(str(p["ref"]))
            assert ref is not None
            key = (ref.group(1), ref.group(2))
            cur = next((c for c in curves if (c["book"], c["y"]) == key), None)
            if cur is None:
                continue  # binding recall is the figure decoders' concern, not style's
            want_rgb = ocolor_to_rgb(int(p["color"]) & 0xFFFFFFFF)  # type: ignore[call-overload]
            got_rgb = cur.get("color")
            if got_rgb is None:
                if want_rgb is None:
                    ok += 1  # both sides say auto/undecodable
                else:
                    omitted += 1  # honest miss: default color, never wrong
            elif got_rgb == want_rgb:
                ok += 1
            else:
                wrong += 1
            want_kind = int(p["symbol_kind"])  # type: ignore[call-overload]
            if want_kind in _KIND_NAME and cur.get("symbol") != _KIND_NAME[want_kind]:
                sym_wrong += 1
    assert wrong == 0, f"{stem}: {wrong} curves decoded to the WRONG color"
    assert sym_wrong == 0, f"{stem}: {sym_wrong} curves decoded to the wrong symbol"
    assert ok >= floor, f"{stem}: color coverage regressed ({ok} < {floor}, omitted={omitted})"
