"""Layer-frame + page geometry (§13.2 #7) vs the live-COM layer_geometry oracle.

Synthetic tests pin the byte grammar (fail-closed gates included); the
realdata sweep verifies both containers' decoded frames and page sizes
against ``ground_truth/<stem>/layer_geometry.json``.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest

from quantized.io.origin_project.figure_geometry import (
    opj_layer_frame,
    opj_page_size,
    opju_layer_frame,
    opju_page_size,
)


def _resolve_corpus_dir() -> Path:
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


# ── synthetic: byte grammar + fail-closed gates ───────────────────────────────


def test_opj_layer_frame_quad_at_113() -> None:
    payload = bytearray(130)
    struct.pack_into("<4H", payload, 113, 1151, 571, 5537, 4105)
    assert opj_layer_frame(bytes(payload)) == (1151, 571, 5537, 4105)


def test_opj_layer_frame_fail_closed() -> None:
    assert opj_layer_frame(b"\x00" * 60) is None  # too short
    degenerate = bytearray(130)
    struct.pack_into("<4H", degenerate, 113, 500, 600, 400, 700)  # right < left
    assert opj_layer_frame(bytes(degenerate)) is None


def test_opj_page_size_at_35() -> None:
    payload = bytearray(160)
    struct.pack_into("<2H", payload, 35, 6432, 4923)
    assert opj_page_size(bytes(payload)) == {"width": 6432, "height": 4923}
    assert opj_page_size(b"\x00" * 160) is None  # zeros: implausible


def test_opju_layer_frame_marker() -> None:
    b = bytes(50) + b"\x12\x00\x20\x22" + struct.pack("<4H", 548, 239, 3321, 2153) + bytes(20)
    assert opju_layer_frame(b, 0, len(b)) == (548, 239, 3321, 2153)
    assert opju_layer_frame(bytes(400), 0, 400) is None  # no marker
    bad = bytes(10) + b"\x12\x00\x20\x22" + struct.pack("<4H", 900, 239, 300, 2153)
    assert opju_layer_frame(bad, 0, len(bad)) is None  # degenerate quad


def test_opju_page_size_frame_containment() -> None:
    frames = [(548, 239, 3321, 2153), (3731, 2488, 6504, 4402)]
    b = bytes(20) + struct.pack("<2H", 6846, 4784) + bytes(60)
    assert opju_page_size(b, 0, frames) == {"width": 6846, "height": 4784}
    # no frames to validate against -> never guessed
    assert opju_page_size(b, 0, []) is None
    # two distinct passing candidates -> ambiguous -> None
    b2 = bytes(8) + struct.pack("<2H", 6846, 4784) + bytes(8) + struct.pack("<2H", 7000, 5000)
    assert opju_page_size(b2 + bytes(60), 0, frames) is None


# ── realdata: both containers vs the COM layer_geometry oracle ────────────────


@pytest.mark.realdata
def test_realdata_frames_and_page_sizes_match_com_oracle() -> None:
    """Every decoded figure frame/page vs ``layer_geometry.json`` across both
    containers. Baseline 2026-07-06: .opj 41+ frames exact (Moke's linked
    composite layers excluded — COM reports out-of-page link-mode values
    there), .opju 30 frames exact; page sizes exact on every graph that
    emits one. Fail-closed misses (frame None) are counted but not wrong."""
    from quantized.io.origin_project.figures import extract_figures
    from quantized.io.origin_project.figures_opju import extract_figures_opju

    stems = [
        ("XRD", "XRD.opj"),
        ("hc2convert", "hc2convert.opj"),
        ("UnpolPlots", "UnpolPlots.opju"),
        ("RockingCurve", "RockingCurve.opju"),
        ("Hc2 data", "Hc2 data.opju"),
        ("Fixed Lambdas SI", "Fixed Lambdas SI.opju"),
    ]
    frame_ok = frame_bad = page_ok = page_bad = 0
    for stem, fname in stems:
        geo_path = _GT / stem / "layer_geometry.json"
        src = _TD / fname
        if not geo_path.exists() or not src.exists():
            continue
        geo = json.loads(geo_path.read_text(encoding="utf-8"))
        raw = src.read_bytes()
        figs = extract_figures(raw) if fname.endswith(".opj") else extract_figures_opju(raw)
        for f in figs:
            g = geo.get(f["name"])
            if not g or len(g["layers"]) < f["layer"]:
                continue
            lay = g["layers"][f["layer"] - 1]
            pw, ph = g["page_width"], g["page_height"]
            want = (
                lay["left"] * pw / 100,
                lay["top"] * ph / 100,
                (lay["left"] + lay["width"]) * pw / 100,
                (lay["top"] + lay["height"]) * ph / 100,
            )
            fr = f.get("frame")
            if fr is not None:
                got = (fr["left"], fr["top"], fr["right"], fr["bottom"])
                # skip COM link-mode artifacts (oracle rect outside the page)
                if max(want[2], want[3]) <= max(pw, ph) * 1.05:
                    if all(abs(a - b) <= 4 for a, b in zip(got, want, strict=True)):
                        frame_ok += 1
                    else:
                        frame_bad += 1
            pg = f.get("page")
            if pg is not None:
                if abs(pg["width"] - pw) <= 2 and abs(pg["height"] - ph) <= 2:
                    page_ok += 1
                else:
                    page_bad += 1
    if frame_ok == 0 and page_ok == 0:
        pytest.skip("layer_geometry oracle not present on this machine")
    assert frame_bad == 0, f"{frame_bad} layer frames decoded WRONG"
    assert page_bad == 0, f"{page_bad} page sizes decoded WRONG"
    assert frame_ok >= 55, f"frame coverage regressed ({frame_ok})"
    assert page_ok >= 25, f"page-size coverage regressed ({page_ok})"


@pytest.mark.realdata
def test_realdata_tick_increments_match_com_oracle() -> None:
    """Decoded x_step/y_step (§13.2 #8: the axis triples' step double in
    .opj; the real-form span's own step token in .opju) vs the
    ``axis_ticks.json`` COM oracle (``layer.x.inc``/``layer.y.inc``).
    Emitted steps must be exact; a None step is an honest miss (record
    forms that don't carry/agree on it), never a wrong value."""
    from quantized.io.origin_project.figures import extract_figures
    from quantized.io.origin_project.figures_opju import extract_figures_opju

    stems = [
        ("XRD", "XRD.opj"),
        ("hc2convert", "hc2convert.opj"),
        ("Moke", "Moke.opj"),
        ("UnpolPlots", "UnpolPlots.opju"),
        ("RockingCurve", "RockingCurve.opju"),
        ("Fixed Lambdas SI", "Fixed Lambdas SI.opju"),
    ]
    ok = bad = missing = 0
    for stem, fname in stems:
        oracle_path = _GT / stem / "axis_ticks.json"
        src = _TD / fname
        if not oracle_path.exists() or not src.exists():
            continue
        ticks = json.loads(oracle_path.read_text(encoding="utf-8"))
        raw = src.read_bytes()
        figs = extract_figures(raw) if fname.endswith(".opj") else extract_figures_opju(raw)
        for f in figs:
            layers = ticks.get(f["name"])
            if not layers or len(layers) < f["layer"]:
                continue
            lay = layers[f["layer"] - 1]
            for axis in ("x", "y"):
                got = f.get(f"{axis}_step")
                want = lay[f"{axis}_inc"]
                if got is None or not want:
                    missing += got is None
                    continue
                if abs(got - want) <= abs(want) * 1e-6:
                    ok += 1
                else:
                    bad += 1
    if ok == 0 and bad == 0:
        pytest.skip("axis_ticks oracle not present on this machine")
    assert bad == 0, f"{bad} tick increments decoded WRONG"
    assert ok >= 80, f"tick-increment coverage regressed ({ok}, {missing} honest misses)"
