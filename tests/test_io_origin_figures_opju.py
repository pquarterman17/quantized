"""``.opju`` (CPYUA) figure extraction — plan item 14.

Two layers, mirroring ``test_io_origin_project.py``'s ``.opj`` figures tests:

* a **synthetic** CPYUA-shaped record built in-test (no private data) that
  exercises the anchor/value-span decoder in CI;
* a **realdata**-marked check against Origin's own ground-truth export for
  the controlled specimens (``fig_lin``/``fig_log``/``fig_pairs`` — a
  single-variable linear/log10 diff pair plus a 4-layer graph), which is the
  only corpus subset whose binary layout this decoder currently understands
  (see ``figures_opju.py``'s module docstring for the real-corpus gap).
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest

from quantized.io.origin_project.figures_opju import extract_figures_opju

# ── synthetic CPYUA figure-record builder ─────────────────────────────────────


def _pack_compact(value: float, width: int) -> bytes:
    """``width`` significant bytes (BE top-N of the double), stored reversed."""
    return bytes(reversed(struct.pack(">d", value)[:width]))


def _encode_value(value: float) -> bytes:
    """A 2-byte tag + the *smallest* compact width that round-trips exactly,
    falling back to a tag + 8-byte literal — mirroring what the real encoder
    does (compact whole/round numbers, literal for "messy" ones)."""
    for width in (1, 2, 3):
        chunk = _pack_compact(value, width)
        be = bytes(reversed(chunk)) + b"\x00" * (8 - width)
        if struct.unpack(">d", be)[0] == value:
            return b"\x00\x00" + chunk
    return b"\x00\x00" + struct.pack("<d", value)


def _layer_bytes(
    x_from: float,
    x_to: float,
    y_from: float,
    y_to: float,
    y_step: float,
    type_byte: int,
    legend: str,
) -> bytes:
    """One CPYUA axis record: anchor + X ``(from, to)`` + step + the
    Y-transition marker (carries ``type_byte``) + Y ``(from, to)`` + step +
    trailing legend text — the shape ``figures_opju.py`` decodes.

    ``from`` is elided (0 bytes) when exactly 0.0, matching the real
    encoding; every other value is a 2-byte tag + the smallest exact compact
    width, or a tag + 8-byte literal when no compact width round-trips (as
    real "messy" values like the ``fig_log`` specimen's ``1e-9`` do). The two
    leading tag bytes are never decoded by the reader (see the module
    docstring), so any 2 bytes work here.
    """
    out = bytearray(b"\x03\x00\x00\x1f")  # anchor
    out += _encode_value(x_from) if x_from != 0.0 else b""
    out += _encode_value(x_to)
    out += b"\x83\x02" + _pack_compact(1.0, 2)  # X step
    out += b"\x81\x04\x06\x00\x00\x01\xc3\x66"  # Y-transition marker
    out += bytes([type_byte])
    out += b"\x7b\x40\x01"  # fixed filler
    out += _encode_value(y_from) if y_from != 0.0 else b""
    out += _encode_value(y_to)
    out += b"\x83\x02" + _pack_compact(y_step, 2)  # Y step
    out += b"\x81\x05\x06\x00\x00\x01\x9a\xc1"  # trailer (unused by the decoder)
    out += legend.encode("latin1") + b"\r\n"
    out += b"\x00" * 32  # padding so the next anchor search has room
    return bytes(out)


def _synthetic_opju(*layers: bytes) -> bytes:
    return b"CPYUA 4.3811 222\n" + b"".join(layers)


# ── synthetic tests ────────────────────────────────────────────────────────────


def test_synthetic_linear_layer_decodes() -> None:
    blob = _synthetic_opju(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    f = figs[0]
    assert (f["x_from"], f["x_to"]) == (0.0, 9.0)
    assert (f["y_from"], f["y_to"]) == (0.0, 1000.0)
    assert f["y_log"] is False
    assert f["n_curves"] == 1


def test_synthetic_log_type_byte_flags_y_log() -> None:
    """The isolated type-byte flag (0x0d) wins over the decade heuristic."""
    blob = _synthetic_opju(
        _layer_bytes(0.79, 8.22, 1e-9, 1000.0, 1.0, 0x0D, r"\l(1) %(1)")
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert (figs[0]["x_from"], figs[0]["x_to"]) == (0.79, 8.22)
    assert figs[0]["y_log"] is True
    assert figs[0]["x_log"] is False  # X has no isolated flag; falls back to the heuristic


def test_synthetic_unrecognized_type_byte_falls_back_to_heuristic() -> None:
    """An unseen type byte (neither 0x03 nor 0x0d) falls back to the decade
    heuristic, exactly like the .opj decoder does for its unresolved flag."""
    blob = _synthetic_opju(
        _layer_bytes(0.0, 10.0, 0.5, 5e5, 1.0, 0xFF, r"\l(1) %(1)")
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["y_log"] is True  # 5e5/0.5 >= 1e3 -> the shared decade heuristic


def test_synthetic_multi_layer_graph_yields_multiple_figures() -> None:
    blob = _synthetic_opju(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)"),
        _layer_bytes(0.0, 9.0, -100.0, 1200.0, 200.0, 0x03, r"\l(1) %(1)"),
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 2
    assert (figs[0]["y_from"], figs[0]["y_to"]) == (0.0, 1000.0)
    assert (figs[1]["y_from"], figs[1]["y_to"]) == (-100.0, 1200.0)


def test_figures_absent_without_anchor() -> None:
    assert extract_figures_opju(b"CPYUA 4.3380 188\nno graph markers here") == []


def test_figures_absent_on_incomplete_record() -> None:
    """An anchor with no Y-transition marker within range (e.g. a real-corpus
    graph, or truncated data) drops cleanly instead of guessing."""
    blob = b"CPYUA 4.3811 222\n\x03\x00\x00\x1f" + b"\x00" * 50
    assert extract_figures_opju(blob) == []


# ── realdata: Origin ground-truth oracle (specimens only — see module docstring) ──

_SPEC = Path(__file__).resolve().parents[1] / ".." / "test-data" / "origin" / "specimens"
_GT = _SPEC / "ground_truth"


@pytest.mark.realdata
@pytest.mark.parametrize("stem", ["fig_lin", "fig_log", "fig_pairs"])
def test_realdata_matches_origin_ground_truth(stem: str) -> None:
    """Every decoded layer must match exactly one oracle layer (axis range +
    linear/log10 flag) within tight tolerance, and every oracle layer must be
    recovered (no drops) — these are the controlled specimens this decoder's
    record shape was reverse-engineered from."""
    src = _SPEC / f"{stem}.opju"
    index_path = _GT / stem / "index.json"
    if not src.exists() or not index_path.exists():
        pytest.skip("Origin specimen/ground-truth not present on this machine")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    expected = [
        (layer["x"], layer["y"]) for g in index["graphs"] for layer in g["layers"]
    ]
    figs = extract_figures_opju(src.read_bytes())
    assert len(figs) == len(expected), f"{stem}: expected {len(expected)} layers, got {len(figs)}"
    remaining = list(expected)
    for f in figs:
        match = next(
            (
                (x, y)
                for x, y in remaining
                if abs(f["x_from"] - x[0]) < 1e-6
                and abs(f["x_to"] - x[1]) < 1e-6
                and abs(f["y_from"] - y[0]) < 1e-6
                and abs(f["y_to"] - y[1]) < 1e-6
            ),
            None,
        )
        assert match is not None, f"{stem}: decoded layer {f} matches no oracle layer"
        remaining.remove(match)
        assert f["y_log"] == (match[1][2] == 2.0), f"{stem}: y_log flag mismatch for {f}"


@pytest.mark.realdata
@pytest.mark.parametrize("stem", ["XAS", "RockingCurve", "UnpolPlots", "Fixed Lambdas SI"])
def test_realdata_real_corpus_is_sound_or_absent(stem: str) -> None:
    """Real corpus graphs (bound curves, custom axis dialogs) use a record
    shape this decoder does not yet understand (see the module docstring's
    documented gap) — it must return cleanly, and IF it ever decodes a figure
    for one of these files, that figure must match a real oracle layer
    (never fabricated data)."""
    src = None
    for parent in (_SPEC.parent, _SPEC):
        for ext in (".opj", ".opju"):
            candidate = parent / f"{stem}{ext}"
            if candidate.exists():
                src = candidate
                break
        if src is not None:
            break
    index_path = _GT / stem / "index.json"
    if src is None or not index_path.exists():
        pytest.skip(f"corpus file/ground-truth for '{stem}' not present on this machine")
    if src.suffix.lower() != ".opju":
        pytest.skip(f"{stem}: not a .opju source")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    expected = [
        (layer["x"], layer["y"]) for g in index["graphs"] for layer in g["layers"]
    ]
    figs = extract_figures_opju(src.read_bytes())
    for f in figs:
        assert any(
            abs(f["x_from"] - x[0]) < 1e-6
            and abs(f["x_to"] - x[1]) < 1e-6
            and abs(f["y_from"] - y[0]) < 1e-6
            and abs(f["y_to"] - y[1]) < 1e-6
            for x, y in expected
        ), f"{stem}: decoded figure {f} matches no oracle layer"
