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
    SYSTEM_COLOR_LIST,
    apply_increment_colors,
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
    width500: int = 0,
    size500: int = 0,
    connect: int = 0,
) -> bytes:
    buf = bytearray(size)
    buf[17] = connect
    struct.pack_into("<H", buf, 21, width500)  # line width, 1/500 pt
    buf[23] = kind
    struct.pack_into("<H", buf, 25, size500)  # symbol size, 1/500 pt
    buf[76] = style
    struct.pack_into("<I", buf, 302, 0xFFFFFFF7)  # the constant auto sentinel
    struct.pack_into("<I", buf, 306, 0xFFFFFFF7 if symbol_color is None else symbol_color)
    buf[310] = term
    struct.pack_into("<I", buf, 362, 0 if line_color is None else line_color)
    return bytes(buf)


def test_style_fields_line_width_and_symbol_size_are_1_500_pt() -> None:
    """u16@21 / u16@25 are 1/500-pt fields (92/92 oracle-exact, both
    containers): 1500 -> 3.0 pt, 795 -> 1.59 pt (LabTalk displays "1.6"),
    4500 -> 9 pt."""
    out = style_fields(_record(kind=2, style=0xC9, width500=1500, size500=4500))
    assert out["lineWidth"] == 3.0 and out["symbolSize"] == 9.0
    out = style_fields(_record(width500=795, size500=2385))
    assert out["lineWidth"] == pytest.approx(1.59)
    assert out["symbolSize"] == pytest.approx(4.77)


def test_style_fields_width_size_fail_closed_bounds() -> None:
    """Zero or implausibly large (>100 pt) width/size fields are omitted,
    never guessed or clamped."""
    out = style_fields(_record(width500=0, size500=0))
    assert "lineWidth" not in out and "symbolSize" not in out
    out = style_fields(_record(width500=60_000, size500=60_000))
    assert "lineWidth" not in out and "symbolSize" not in out


def test_style_fields_symbol_plot_reads_symbol_color() -> None:
    rec = _record(kind=2, style=0xC9, symbol_color=0x014040F1)
    assert style_fields(rec) == {"style": "scatter", "symbol": "circle", "color": "#F14040"}


def test_style_fields_line_plot_reads_line_color() -> None:
    # disk palette is 0-BASED: 14 -> LabTalk 15 -> orange
    rec = _record(kind=0, style=0xC8, line_color=14)
    assert style_fields(rec) == {
        "style": "line", "connect": "straight", "color": "#FF8000"
    }


def test_style_fields_two_point_segment_connection() -> None:
    assert style_fields(_record(style=0xC8, connect=1))["connect"] == "segment2"
    assert "connect" not in style_fields(_record(style=0xC9, connect=1))
    assert "connect" not in style_fields(_record(style=0xC8, connect=99))


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
    # Official Origin plot:=202 / record 0xca is line+symbol. The unknown
    # symbol kind remains omitted independently.
    out = style_fields(_record(kind=9, style=0xCA, symbol_color=1))
    assert out["style"] == "line_symbol" and "symbol" not in out
    assert "symbol" not in style_fields(_record(kind=9, style=0xC8, symbol_color=1))
    # a record too short to hold the line-color field decodes nothing
    assert style_fields(b"\x00" * 100) == {}


def test_style_fields_515_byte_variant_reads_the_same_offsets() -> None:
    """The 4-byte-smaller CPYA anchor variant (XMCD) differs only past offset
    492 -- all style fields sit at identical offsets."""
    rec = _record(kind=3, style=0xC9, symbol_color=0x01515151, size=515)
    assert style_fields(rec) == {"style": "scatter", "symbol": "triangle", "color": "#515151"}


# ── synthetic: auto/increment colour resolution (§13.2 #2) ────────────────────

_PLACEHOLDER = 0x81010151  # the exact increment-placeholder u32 (pixel-verified)


def _inc_record(role: int, line_color: int = _PLACEHOLDER) -> bytes:
    buf = bytearray(_record(kind=0, style=0xC8, line_color=line_color))
    buf[6] = role
    return bytes(buf)


def _curves_for(records: list[bytes]) -> list[dict[str, str | float]]:
    curves: list[dict[str, str | float]] = [dict(style_fields(r)) for r in records]
    apply_increment_colors(curves, list(records))
    return curves


def test_increment_group_walks_the_system_color_list() -> None:
    """head (0x29) + members (0x19) with the 0x81010151 placeholder take
    SYSTEM_COLOR_LIST[0..k] in plot order (render-pixel oracle:
    style_group/style_group12 specimens)."""
    recs = [_inc_record(0x29)] + [_inc_record(0x19) for _ in range(3)]
    colors = [c.get("color") for c in _curves_for(recs)]
    assert colors == list(SYSTEM_COLOR_LIST[:4])


def test_increment_standalone_takes_first_list_color_and_groups_reset() -> None:
    """An ungrouped placeholder (role 0x09) always renders the FIRST list
    colour (style_ungrouped specimen: all 8 curves #515151); a standalone
    plot also ends any open group, and a following head restarts at 0."""
    recs = [
        _inc_record(0x29), _inc_record(0x19),  # group: [0], [1]
        _inc_record(0x09),                     # standalone: [0]
        _inc_record(0x29), _inc_record(0x19),  # new group: [0], [1]
    ]
    colors = [c.get("color") for c in _curves_for(recs)]
    assert colors == [
        SYSTEM_COLOR_LIST[0], SYSTEM_COLOR_LIST[1],
        SYSTEM_COLOR_LIST[0],
        SYSTEM_COLOR_LIST[0], SYSTEM_COLOR_LIST[1],
    ]


def test_increment_fail_closed_cases() -> None:
    """Never guessed: an explicit colour is untouched, a non-placeholder
    0x81-typed value stays unresolved, an unrecognized role byte abstains,
    a member without a preceding head abstains, and members past the
    12-entry verified list stay unresolved (no wrap-guess)."""
    explicit = _inc_record(0x29, line_color=14)  # palette orange, in a group
    assert _curves_for([explicit])[0]["color"] == "#FF8000"
    foreign = _inc_record(0x29, line_color=0x81FF0000)  # unknown 0x81 payload
    assert "color" not in _curves_for([foreign])[0]
    unknown_role = _inc_record(0x42)
    assert "color" not in _curves_for([unknown_role])[0]
    orphan_member = _inc_record(0x19)  # member with no head
    assert "color" not in _curves_for([orphan_member])[0]
    big_group = [_inc_record(0x29)] + [_inc_record(0x19) for _ in range(13)]
    colors = [c.get("color") for c in _curves_for(big_group)]
    assert colors[:12] == list(SYSTEM_COLOR_LIST)
    assert colors[12] is None and colors[13] is None


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
    dims_checked = 0
    dim_wrong: list[tuple[str, str, object, object]] = []
    connect_checked = 0
    connect_wrong: list[tuple[str, object, object]] = []
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
            # line width + symbol size (u16@21/25, 1/500 pt): LabTalk reports
            # a rounded display value (795 -> "1.6"), so compare within the
            # rounding half-width.
            got_w = cur.get("lineWidth")
            if got_w is not None and abs(float(got_w) - float(p["line_width"])) > 0.055:  # type: ignore[arg-type]
                dim_wrong.append((gname, "width", got_w, p["line_width"]))
            got_s = cur.get("symbolSize")
            if got_s is not None and abs(float(got_s) - float(p["symbol_size"])) > 0.055:  # type: ignore[arg-type]
                dim_wrong.append((gname, "size", got_s, p["symbol_size"]))
            dims_checked += got_w is not None
            want_connect = p.get("line_connect")
            expected_connect = {1: "straight", 2: "segment2"}.get(
                int(want_connect) if want_connect is not None else -1
            )
            if expected_connect and cur.get("style") in ("line", "line_symbol"):
                connect_checked += 1
                if cur.get("connect") != expected_connect:
                    connect_wrong.append((gname, cur.get("connect"), expected_connect))
    assert wrong == 0, f"{stem}: {wrong} curves decoded to the WRONG color"
    assert sym_wrong == 0, f"{stem}: {sym_wrong} curves decoded to the wrong symbol"
    assert not dim_wrong, f"{stem}: wrong width/size decodes: {dim_wrong}"
    assert not connect_wrong, f"{stem}: wrong connection decodes: {connect_wrong}"
    if stem == "RockingCurve":
        assert connect_checked >= 8, "RockingCurve connection coverage collapsed"
    assert dims_checked >= floor // 2, f"{stem}: width/size coverage collapsed"
    assert ok >= floor, f"{stem}: color coverage regressed ({ok} < {floor}, omitted={omitted})"


@realdata
def test_realdata_cross_container_style_matches_opj_and_opju() -> None:
    """``hc2convert.opj`` and ``Hc2 data.opju`` are exports of the SAME Origin
    project (see ``test_io_origin_figures_opju.py``'s
    ``test_realdata_hc2_opju_text_routing_matches_opj_conversion``): the two
    independent decoders (the ``.opj`` curve-anchor reader and the ``.opju``
    sparse-token reconstructor, both feeding the shared
    ``curve_style_color.style_fields``) must therefore emit IDENTICAL
    color/symbol/style dicts for every state-matched graph's curves -- not
    just each container's own oracle-correctness. Verified byte-exact on
    Graph1/4/6/8/10/11 (the 6 state-matched, curve-bearing graphs among the
    7 the binding decoder itself resolves in both containers); Graph2 is
    excluded entirely because its ``x`` differs by design (the ``.opju``
    decoder reads the column's own stored X-partner id, giving ``AG`` where
    the ``.opj`` structural-inference fallback gives ``A`` -- a documented
    binding difference, not a style one -- see ``opj_curves.py``'s "X is a
    structural inference" note), so comparing it here would flag a known,
    unrelated divergence rather than a style regression."""
    opj_src = _TD / "hc2convert.opj"
    opju_src = _TD / "Hc2 data.opju"
    if not opj_src.exists() or not opju_src.exists():
        pytest.skip("Hc2 .opj/.opju corpus pair not present on this machine")
    opj = _opj_graph_curves(opj_src)
    opju = _opju_graph_curves(opju_src)
    checked = 0
    for gname in ("Graph1", "Graph4", "Graph6", "Graph8", "Graph10", "Graph11"):
        a = opj.get(gname)
        b = opju.get(gname)
        assert a and b, f"{gname}: missing from one container's decode"
        assert len(a) == len(b), f"{gname}: curve count differs {len(a)} vs {len(b)}"
        for ca, cb in zip(a, b, strict=True):
            assert ca.get("y") == cb.get("y"), f"{gname}: curve binding mismatch"
            for key in ("style", "color", "symbol"):
                assert ca.get(key) == cb.get(key), (
                    f"{gname}/{ca.get('y')}: '{key}' disagrees between containers "
                    f"({ca.get(key)!r} vs {cb.get(key)!r})"
                )
            checked += 1
    assert checked >= 15, f"only {checked} curves cross-checked -- corpus changed?"


@realdata
def test_realdata_moke_line_symbol_family_is_recovered() -> None:
    """Moke contains 36 shared-record 0xca curves. The 200/201/202 byte
    sequence is the official line/scatter/line+symbol plot-id sequence."""
    from quantized.io.origin_project.figures import extract_figures

    src = _TD / "Moke.opj"
    if not src.exists():
        pytest.skip("Moke corpus not present")
    curves = [
        curve
        for figure in extract_figures(src.read_bytes())
        for curve in figure.get("curves", [])
        if curve.get("style") == "line_symbol"
    ]
    assert len(curves) == 36
    assert all(curve.get("symbol") and curve.get("lineWidth") for curve in curves)


@realdata
def test_realdata_style_specimens_resolve_increment_colors() -> None:
    """The by-construction style specimens (generate_specimens_style.py) vs
    their RENDER-PIXEL oracle (expGraph PNG line-colour sampling — the COM
    color property only reports the group-level colour):

    * ``style_group``: 8 grouped placeholders -> SYSTEM_COLOR_LIST[0..7];
    * ``style_group12``: 12 -> the full verified list, no wrap;
    * ``style_ungrouped``: 8 standalone placeholders -> all list[0];
    * ``style_mixed``: 3 grouped + explicit palette-15/16 curves untouched.
    """
    from quantized.io.origin_project.figures_opju import extract_figures_opju

    spec = _TD / "specimens"
    cases = {
        "style_group": list(SYSTEM_COLOR_LIST[:8]),
        "style_group12": list(SYSTEM_COLOR_LIST),
        "style_ungrouped": [SYSTEM_COLOR_LIST[0]] * 8,
        "style_mixed": list(SYSTEM_COLOR_LIST[:3]) + ["#FF8000", "#8000FF"],
    }
    checked = 0
    for stem, want in cases.items():
        src = spec / f"{stem}.opju"
        if not src.exists():
            continue
        figs = extract_figures_opju(src.read_bytes())
        fig = next((f for f in figs if f.get("curves")), None)
        assert fig is not None, f"{stem}: no curves decoded"
        got = [c.get("color") for c in fig["curves"]]
        assert got == want, f"{stem}: {got} != {want}"
        checked += 1
    if checked == 0:
        pytest.skip("style specimens not present on this machine")
