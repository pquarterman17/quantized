"""Positioned Origin annotation marks (``annotation_marks``): the fraction→data
formula, both containers' position decode, and the live-COM oracle.

The coordinate model (see ``io/origin_project/annotation_marks.py``): a text
object stores its box top-left corner as two LE float64 layer-fractions,
``x1 = x_from + frac_a * (x_to - x_from)`` and ``y1 = y_to - frac_b *
(y_to - y_from)`` (y measured from the TOP). The realdata suite checks every
instance the COM capturer recorded (``ground_truth/<stem>/annotations.json``,
fields ``x1``/``y1`` — the box corner, NOT the ``x``/``y`` anchor) across
both containers: hc2convert.opj Graph1/2/3 and Hc2 data.opju Graph1/2.
"""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import pytest

from quantized.io.origin_project.annotation_marks import (
    build_mark,
    frac_to_data,
    opj_text_fractions,
    opju_text_fractions,
)
from quantized.io.origin_project.figures import extract_figures
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_figure_text import routed_figure_text


def _resolve_corpus_dir() -> Path:
    """The local-only ``../test-data/origin`` corpus; walks up from
    ``__file__`` for a ``test-data`` sibling so this still resolves inside a
    worktree agent -- mirrors ``test_io_origin_ground_truth.py``."""
    candidate = Path(__file__).resolve().parents[1] / ".." / "test-data" / "origin"
    if candidate.exists():
        return candidate
    for ancestor in Path(__file__).resolve().parents:
        walked = ancestor / "test-data" / "origin"
        if walked.exists():
            return walked
    return candidate


_TD = _resolve_corpus_dir()

# ── the confirmed fraction→data formula (values from the COM oracle) ─────────


def test_frac_to_data_matches_oracle_graph1() -> None:
    x, y = frac_to_data(0.0574162679425837, -0.0829323521086894, -6.0, 6.0, -0.05, 0.45)
    assert x == pytest.approx(-5.3110, abs=1e-4)
    assert y == pytest.approx(0.4915, abs=1e-4)


def test_frac_to_data_matches_oracle_graph2() -> None:
    x, y = frac_to_data(0.0407837776258829, -0.0611378431927540, -6.0, 6.0, -7.5, 7.5)
    assert x == pytest.approx(-5.5106, abs=1e-4)
    assert y == pytest.approx(8.4171, abs=1e-4)


def test_frac_to_data_y_measured_from_top() -> None:
    # frac_b = 0 pins the box top at y_to; frac_b = 1 at y_from.
    assert frac_to_data(0.0, 0.0, 0.0, 10.0, 0.0, 100.0) == (0.0, 100.0)
    assert frac_to_data(1.0, 1.0, 0.0, 10.0, 0.0, 100.0) == (10.0, 0.0)


# ── .opj: fraction doubles at header payload offsets 19/27 ───────────────────


def _opj_text_header_payload(frac_a: float, frac_b: float) -> bytes:
    payload = bytearray(133)
    struct.pack_into("<d", payload, 19, frac_a)
    struct.pack_into("<d", payload, 27, frac_b)
    payload[70:75] = b"Text\x00"
    return bytes(payload)


def test_opj_text_fractions_reads_offsets_19_27() -> None:
    assert opj_text_fractions(_opj_text_header_payload(0.25, -0.08)) == (0.25, -0.08)


def test_opj_text_fractions_rejects_implausible_doubles() -> None:
    assert opj_text_fractions(_opj_text_header_payload(math.nan, 0.1)) is None
    assert opj_text_fractions(_opj_text_header_payload(0.1, 1e300)) is None
    assert opj_text_fractions(b"\x00" * 20) is None  # too short


# ── .opju: the `85 13` field ending exactly 32 bytes before the name header ──


def _opju_pos_field(frac_a: float, frac_b: float) -> bytes:
    """The 32 bytes preceding a positioned Text object's name header:
    ``85 13 <frac_a:8> <frac_b:8> 80 00 <x> 80 09 <9 bytes>`` (corpus shape;
    only the tag, the doubles, and the ``80 00`` boundary are checked)."""
    return (
        b"\x85\x13"
        + struct.pack("<d", frac_a)
        + struct.pack("<d", frac_b)
        + b"\x80\x00\x2b"
        + b"\x80\x09"
        + bytes(9)
    )


def test_opju_text_fractions_locates_fixed_distance_field() -> None:
    b = bytes(7) + _opju_pos_field(0.0574, -0.0829) + b"\x8a\x01\x10\x83\x04Text"
    assert opju_text_fractions(b, 7 + 32) == (0.0574, -0.0829)


def test_opju_text_fractions_absent_or_malformed_is_none() -> None:
    good = _opju_pos_field(0.1, 0.2)
    hdr = b"\x8a\x01\x10\x83\x04Text"
    assert opju_text_fractions(bytes(32) + hdr, 32) is None  # no tag
    assert opju_text_fractions(b"\x86" + good[1:] + hdr, 32) is None  # 86-tag variant: omit
    bad_sentinel = good[:18] + b"\x00\x00" + good[20:]
    assert opju_text_fractions(bad_sentinel + hdr, 32) is None
    assert opju_text_fractions(good + hdr, 5) is None  # header too close to BOF


# ── build_mark: one mark per OBJECT, multi-line preserved, cleaned ───────────


def test_build_mark_joins_multiline_and_converts() -> None:
    mark = build_mark(
        (0.5, 0.25), ["Field applied in-plane", "T = 1.3 K"], 0.0, 10.0, 0.0, 100.0
    )
    assert mark == {"text": "Field applied in-plane\nT = 1.3 K", "x": 5.0, "y": 75.0}


def test_build_mark_drops_noise_and_empty() -> None:
    assert build_mark((0.5, 0.5), [], 0.0, 1.0, 0.0, 1.0) is None
    assert build_mark(None, ["Real text"], 0.0, 1.0, 0.0, 1.0) is None  # no position: omit
    # internal storage noise and legend/auto-template lines never make a mark
    assert build_mark((0.5, 0.5), ["OriginStorage", "%(?Y)"], 0.0, 1.0, 0.0, 1.0) is None
    mark = build_mark((0.5, 0.5), ["SYSTEM", "Peak label"], 0.0, 1.0, 0.0, 1.0)
    assert mark is not None and mark["text"] == "Peak label"


def test_build_mark_decodes_richtext() -> None:
    mark = build_mark((0.0, 0.0), [r"\g(q) scan"], 0.0, 1.0, 0.0, 1.0)
    assert mark is not None and mark["text"] == "θ scan"


# ── synthetic .opj end-to-end (extract_figures) ──────────────────────────────


def _block(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


def _zero() -> bytes:
    return struct.pack("<I", 0) + b"\n"


def _fig_window_header(name: str) -> bytes:
    payload = b"\x00\x00" + name.encode("latin1") + b"\x00"
    return _block(payload + b"\x00" * (160 - len(payload)))


def _fig_layer_block(x_from: float, x_to: float, y_from: float, y_to: float) -> bytes:
    payload = bytearray(240)
    payload[0:4] = bytes([0, 0, 0x1F, 0])
    struct.pack_into("<d", payload, 15, x_from)
    struct.pack_into("<d", payload, 23, x_to)
    struct.pack_into("<d", payload, 58, y_from)
    struct.pack_into("<d", payload, 66, y_to)
    return _block(bytes(payload))


def _fig_named_header(name: str, frac_a: float | None = None, frac_b: float | None = None) -> bytes:
    payload = bytearray(133)
    if frac_a is not None and frac_b is not None:
        struct.pack_into("<d", payload, 19, frac_a)
        struct.pack_into("<d", payload, 27, frac_b)
    nb = name.encode("latin1")
    payload[70 : 70 + len(nb)] = nb
    payload[70 + len(nb)] = 0
    return _block(bytes(payload))


def _fig_text_block(text: str) -> bytes:
    return _block(text.encode("latin1"))


def test_synthetic_opj_text_object_emits_positioned_mark() -> None:
    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph1")
        + _fig_layer_block(-6.0, 6.0, -0.05, 0.45)
        + _fig_named_header("Text", 0.5, 0.25)
        + _fig_text_block("Field applied in-plane")
        + _fig_text_block("T = 1.3 K")
    )
    figs = extract_figures(blob)
    assert len(figs) == 1
    # both content lines group into ONE mark (one per text OBJECT), \n-joined
    assert figs[0]["annotation_marks"] == [
        {"text": "Field applied in-plane\nT = 1.3 K", "x": 0.0, "y": 0.325}
    ]
    # the flat annotations field is unchanged by the position decode
    assert figs[0]["annotations"] == ["Field applied in-plane", "T = 1.3 K"]


def test_synthetic_opj_undecodable_position_omits_mark_keeps_text() -> None:
    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph1")
        + _fig_layer_block(0.0, 10.0, 0.0, 100.0)
        + _fig_named_header("Text", math.nan, 0.25)  # implausible: no position
        + _fig_text_block("Orphan label")
    )
    figs = extract_figures(blob)
    assert figs[0]["annotation_marks"] == []  # omitted, never guessed
    assert figs[0]["annotations"] == ["Orphan label"]  # text still ships


def test_synthetic_opj_axis_title_objects_never_mark() -> None:
    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph1")
        + _fig_layer_block(0.0, 10.0, 0.0, 100.0)
        + _fig_named_header("YL", 0.5, 0.5)  # titles are positioned too — not marks
        + _fig_text_block("Intensity (arb. units)")
        + _fig_named_header("Text", 0.1, 0.2)
        + _fig_text_block("Peak label")
    )
    figs = extract_figures(blob)
    assert figs[0]["y_title"] == "Intensity (arb. units)"
    assert figs[0]["annotation_marks"] == [{"text": "Peak label", "x": 1.0, "y": 80.0}]


def test_synthetic_opj_two_text_objects_two_marks() -> None:
    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph1")
        + _fig_layer_block(0.0, 10.0, 0.0, 100.0)
        + _fig_named_header("Text", 0.1, 0.1)
        + _fig_text_block("First note")
        + _fig_named_header("Text1", 0.9, 0.9)
        + _fig_text_block("Second note")
    )
    figs = extract_figures(blob)
    assert figs[0]["annotation_marks"] == [
        {"text": "First note", "x": 1.0, "y": 90.0},
        {"text": "Second note", "x": 9.0, "y": 10.0},
    ]


# ── synthetic .opju end-to-end (routed_figure_text) ──────────────────────────


def _opju_text_object(name: str, text: str, pos: bytes | None = None) -> bytes:
    """A CPYUA Text-shape object: optional position field (must END exactly at
    the header start), name header, style filler, framed text — the same
    shapes ``test_io_origin_figures_opju.py`` replicates from the corpus."""
    raw = text.encode("utf-8") + b"\x00"
    hdr = bytes([0x8A, 0x01, 0x10, 0x83, len(name)]) + name.encode("ascii")
    style = b"\x9c\x02\xfb\x07\x85\x01\x08\x90\x00" + bytes(24)
    return (pos or b"") + hdr + style + bytes([0x86, 0x01, 0x80, len(raw)]) + raw


def test_synthetic_opju_positioned_text_object_emits_mark() -> None:
    b = bytes(16) + _opju_text_object(
        "Text", "Field applied in-plane\r\nT = 1.3 K", pos=_opju_pos_field(0.5, 0.25)
    )
    routed = routed_figure_text(b, 0, len(b), axes=(-6.0, 6.0, -0.05, 0.45))
    assert routed is not None
    assert routed.annotation_marks == [
        {"text": "Field applied in-plane\nT = 1.3 K", "x": 0.0, "y": 0.325}
    ]
    # the flat annotations list still splits per line, exactly as before
    assert routed.annotations == ["Field applied in-plane", "T = 1.3 K"]


def test_synthetic_opju_text_without_position_field_is_text_only() -> None:
    b = bytes(16) + _opju_text_object("Text", "Floating note")
    routed = routed_figure_text(b, 0, len(b), axes=(0.0, 1.0, 0.0, 1.0))
    assert routed is not None
    assert routed.annotations == ["Floating note"]
    assert routed.annotation_marks == []  # omitted, never guessed


def test_synthetic_opju_no_axes_yields_no_marks() -> None:
    b = bytes(16) + _opju_text_object("Text", "A note", pos=_opju_pos_field(0.5, 0.5))
    routed = routed_figure_text(b, 0, len(b))
    assert routed is not None and routed.annotation_marks == []


# ── the COM oracle: all captured instances, both containers, 0 mismatches ────


@pytest.mark.realdata
@pytest.mark.parametrize(
    ("stem", "source", "extractor"),
    [
        ("hc2convert", "hc2convert.opj", extract_figures),
        ("Hc2 data", "Hc2 data.opju", extract_figures_opju),
    ],
)
def test_realdata_annotation_positions_match_com_oracle(stem, source, extractor) -> None:
    """Every oracle instance (5 total: hc2convert Graph1/2/3, Hc2 data
    Graph1/2) must have exactly ONE decoded mark on the same-named figure
    with the oracle's text (``\\r\\n`` → ``\\n``) at the oracle's ``x1``/
    ``y1`` box corner. Measured residuals are ≤ 6e-17; the tolerance leaves
    headroom for the oracle's own float round-trips only."""
    oracle_path = _TD / "specimens" / "ground_truth" / stem / "annotations.json"
    src = _TD / source
    if not (oracle_path.exists() and src.exists()):
        pytest.skip("local Origin corpus/oracle not present")
    oracle = json.loads(oracle_path.read_text(encoding="utf-8"))
    figs = extractor(src.read_bytes())
    checked = 0
    for graph, anns in oracle.items():
        marks = [m for f in figs if f["name"] == graph for m in f["annotation_marks"]]
        for a in anns:
            want_text = a["text"].replace("\r\n", "\n")
            hits = [
                m
                for m in marks
                if m["text"] == want_text
                and abs(m["x"] - a["x1"]) < 1e-6
                and abs(m["y"] - a["y1"]) < 1e-6
            ]
            assert len(hits) == 1, (
                f"{stem}/{graph}: expected exactly one mark at "
                f"({a['x1']:.4f}, {a['y1']:.4f}) with {want_text!r}; "
                f"decoded marks: {marks!r}"
            )
            checked += 1
    assert checked >= 2  # both files carry captured instances


@pytest.mark.realdata
def test_realdata_oracle_covers_all_five_instances() -> None:
    """The two oracle files together hold the 5 captured instances this
    feature was verified against — guard against a silently thinned oracle."""
    total = 0
    for stem in ("hc2convert", "Hc2 data"):
        p = _TD / "specimens" / "ground_truth" / stem / "annotations.json"
        if not p.exists():
            pytest.skip("local Origin corpus/oracle not present")
        oracle = json.loads(p.read_text(encoding="utf-8"))
        total += sum(len(v) for v in oracle.values())
    assert total == 5


# ── §13.2 #3 (2026-07-06): legend position + log-axis fraction mapping ────────


def test_frac_to_data_log_axis_maps_in_log10_space() -> None:
    """CONFIRMED against the legend COM oracle on two log-Y graphs (XRD
    Graph2: frac_b=0.0274 over y 1..1e5 -> 7.291e4, where the linear read
    gave 9.73e4). Log axes interpolate the DECADE span."""
    from quantized.io.origin_project.annotation_marks import frac_to_data

    x, y = frac_to_data(0.5, 0.0274, 10.0, 120.0, 1.0, 1e5, False, True)
    assert x == pytest.approx(65.0)
    assert y == pytest.approx(7.291e4, rel=1e-3)
    # non-positive bounds can't be log: degrade to linear, never crash
    _, y_lin = frac_to_data(0.0, 0.5, 0.0, 1.0, -5.0, 5.0, False, True)
    assert y_lin == pytest.approx(0.0)


def test_opju_legend_position_tag_variant_85_1f_at_header_minus_33() -> None:
    """Legend objects carry the same <fracA><fracB> payload under an `85 1f`
    tag one byte further out (header-33) — verified against the legend COM
    oracle on every .opju instance. The unverified `86 13` stays rejected."""
    field = (
        b"\x85\x1f"
        + struct.pack("<d", 0.6024)
        + struct.pack("<d", 0.0352)
        + b"\x80\x00\x2f"
        + b"\x80\x08"
        + bytes(10)
    )
    hdr = b"\x8a\x01\x10\x83\x06Legend"
    b = bytes(5) + field + hdr
    assert opju_text_fractions(b, 5 + 33) == (0.6024, 0.0352)


@pytest.mark.realdata
def test_realdata_legend_positions_match_com_oracle() -> None:
    """Decoded figure `legend_pos` vs the graph_extras.json oracle
    (Legend.x1/.y1 = the box top-left in data coords) across BOTH
    containers: every decoded position must sit within 0.5% of the axis
    span; the 2026-07-06 baseline is 53 exact / 0 wrong / 2 honest misses."""
    from quantized.io.origin_project.figures import extract_figures
    from quantized.io.origin_project.figures_opju import extract_figures_opju

    stems = [
        ("XRD", "XRD.opj"),
        ("Moke", "Moke.opj"),
        ("hc2convert", "hc2convert.opj"),
        ("Hc2 data", "Hc2 data.opju"),
        ("RockingCurve", "RockingCurve.opju"),
        ("UnpolPlots", "UnpolPlots.opju"),
        ("Fixed Lambdas SI", "Fixed Lambdas SI.opju"),
    ]
    ok = wrong = miss = 0
    for stem, fname in stems:
        oracle_path = _TD / "specimens" / "ground_truth" / stem / "graph_extras.json"
        src = _TD / fname
        if not oracle_path.exists() or not src.exists():
            continue
        extras = json.loads(oracle_path.read_text(encoding="utf-8"))
        raw = src.read_bytes()
        figs = extract_figures(raw) if fname.endswith(".opj") else extract_figures_opju(raw)
        by_name: dict[str, list] = {}
        for f in figs:
            by_name.setdefault(f["name"], []).append(f)
        for gname, layers in extras["graphs"].items():
            for lay in layers:
                leg = lay.get("legend")
                cand = by_name.get(gname)
                if not leg or not cand:
                    continue
                ordered = sorted(cand, key=lambda f: f["layer"])
                if len(ordered) < lay["layer"]:
                    continue
                got = ordered[lay["layer"] - 1].get("legend_pos")
                if got is None:
                    miss += 1
                    continue
                xspan = abs(lay["x_to"] - lay["x_from"]) or 1.0
                yspan = abs(lay["y_to"] - lay["y_from"]) or 1.0
                if (
                    abs(got["x"] - leg["x1"]) / xspan < 0.005
                    and abs(got["y"] - leg["y1"]) / yspan < 0.005
                ):
                    ok += 1
                else:
                    wrong += 1
    if ok == 0 and wrong == 0 and miss == 0:
        pytest.skip("graph_extras oracle not present on this machine")
    assert wrong == 0, f"{wrong} legend positions decoded WRONG"
    assert ok >= 50, f"legend-position coverage regressed ({ok} exact, {miss} missed)"
