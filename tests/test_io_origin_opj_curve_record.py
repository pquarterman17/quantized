"""``.opj`` curve binding from the anchor record itself (2026-11-20).

Three fixes to ``opj_curves``, each with its evidence in
``docs/origin_re/curve_bindings_opj.md``:

* the column short-name field is 12 bytes (11 chars + NUL), not 8, so a
  curve on an 8-11 char column ("averages", "difference") binds;
* a plot whose column id still resolves to nothing is left out with a named
  reason (``column_not_resolved``), never dropped silently;
* the record's own X (offsets 35-38, the field ``.opju`` reads,
  ``opju_curve_token_x``) outranks the nearest-preceding-X inference, and a
  plot Origin hides (offset 38 ``21``) is left out as ``hidden_in_origin``.

Synthetic records lock the byte rules in CI; the ``realdata`` checks compare
against Origin's own COM plot lists and the ``Hc2 data.opju`` controlled
specimen, computing every expectation at test time.
"""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path

import numpy as np
import pytest

from quantized.io.origin_project import read_origin_books
from quantized.io.origin_project.container import walk_blocks
from quantized.io.origin_project.figures import extract_figures
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opj_curves import (
    COLUMN_NOT_RESOLVED,
    book_column_designations,
    column_id_map,
    extract_curves,
    x_columns_from_designations,
)

# ── synthetic CPYA builders (same layout as test_io_origin_figures_opj_curves) ─


def _block(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


def _window_header(name: str) -> bytes:
    payload = b"\x00\x00" + name.encode("latin1") + b"\x00"
    return _block(payload + b"\x00" * (165 - len(payload)))


def _layer_block() -> bytes:
    payload = bytearray(240)
    payload[0:4] = bytes([0, 0, 0x1F, 0])
    for off, v in ((15, 0.0), (23, 10.0), (58, 0.0), (66, 1.0)):
        struct.pack_into("<d", payload, off, v)
    return _block(bytes(payload))


def _column_block(short: str, cid: int, designation: int = 0) -> bytes:
    p = bytearray(519)
    struct.pack_into("<H", p, 4, cid)
    p[0x11] = designation
    p[0x12 : 0x12 + len(short) + 1] = short.encode("latin1") + b"\x00"
    return _block(bytes(p))


def _curve(
    cid: int, *, x_id: int | None = None, pair: bytes = b"\x21\x61", kind: int = 0xC8
) -> bytes:
    """Anchor + DataPlot. ``x_id`` writes the record X field (35-38)."""
    p = bytearray(519)
    p[0:4] = b"\x01\x00\x00\x00"
    struct.pack_into("<H", p, 4, cid)
    if x_id is not None:
        struct.pack_into("<H", p, 35, x_id)
        p[37:39] = pair
    p[76] = kind
    body = bytearray(852)
    body[0:8] = b"\x58\x00\x00\x00\x98\x03\x40\xb3"
    return _block(bytes(p)) + _block(bytes(body))


def _book(*cols: tuple[str, int, int]) -> bytes:
    return _window_header("Book1") + b"".join(_column_block(*c) for c in cols)


def _bind(*parts: bytes) -> tuple[list[dict[str, str | float]], list[tuple[int, dict[str, str]]]]:
    blob = b"CPYA 4.3380 188 W64 #\n" + b"".join(parts)
    blocks = [(s, p) for s, p in walk_blocks(blob) if s]
    order = book_column_designations(blocks)
    omitted: list[tuple[int, dict[str, str]]] = []
    curves = extract_curves(
        blocks,
        0,
        len(blocks),
        column_id_map(blocks),
        x_columns_from_designations(order),
        order,
        omitted,
    )
    return curves, omitted


_COLS = (("A", 1, 3), ("averages", 2, 0), ("E", 3, 3), ("difference", 4, 0))


def test_short_names_up_to_eleven_chars_bind() -> None:
    curves, omitted = _bind(_book(*_COLS), _curve(2), _curve(4))
    assert [(c["x"], c["y"]) for c in curves] == [("A", "averages"), ("E", "difference")]
    assert omitted == []


def test_a_name_past_the_field_is_not_a_column() -> None:
    """12+ printable bytes have no NUL inside the 12-byte field: not a name."""
    curves, omitted = _bind(_book(("A", 1, 3), ("abcdefghijkl", 2, 0)), _curve(2))
    assert curves == []
    assert [n["reason"] for _, n in omitted] == [COLUMN_NOT_RESOLVED]


def test_unresolved_plot_is_diagnosed_and_keeps_its_plot_index() -> None:
    curves, omitted = _bind(_book(*_COLS), _curve(99), _curve(2))
    assert [c["y"] for c in curves] == ["averages"]
    assert omitted == [
        (0, {"book": "", "x": "", "y": "", "recorded": "", "reason": COLUMN_NOT_RESOLVED})
    ]


def test_record_x_outranks_the_nearest_preceding_x() -> None:
    curves, _ = _bind(_book(*_COLS), _curve(4, x_id=1))  # inference says E
    assert (curves[0]["x"], curves[0]["y"]) == ("A", "difference")


def test_record_x_without_its_marker_keeps_the_inference() -> None:
    curves, _ = _bind(_book(*_COLS), _curve(4, x_id=1, pair=b"\x30\x61"))  # Y-error pair
    assert curves[0]["x"] == "E"


def test_record_x_naming_no_known_column_fails_closed() -> None:
    curves, omitted = _bind(_book(*_COLS), _curve(4, x_id=77))
    assert curves == []
    assert [n["reason"] for _, n in omitted] == ["x_column_unknown"]


def test_record_x_zero_on_a_histogram_keeps_the_shipped_binding() -> None:
    curves, omitted = _bind(_book(*_COLS), _curve(2, x_id=0, pair=b"\x21\x51", kind=219))
    assert [(c["x"], c.get("plotType")) for c in curves] == [("A", "histogram")]
    assert omitted == []


def test_hidden_plot_is_left_out_as_hidden_in_origin() -> None:
    curves, omitted = _bind(_book(*_COLS), _curve(2, x_id=1, pair=b"\x21\x21"), _curve(4, x_id=3))
    assert [c["y"] for c in curves] == ["difference"]
    assert [(i, n["y"], n["reason"]) for i, n in omitted] == [(0, "averages", "hidden_in_origin")]


# ── realdata: Origin's COM plot lists + the Hc2 controlled specimen ──────────

_REF = re.compile(r'^\[([^\]]+)\][^!]*!([^"]+)')


def _origin(corpus_dir: Path) -> Path:
    return corpus_dir / "origin"


@pytest.mark.realdata
def test_realdata_xmcd_every_drawn_or_hidden_plot_matches_com(corpus_dir: Path) -> None:
    """Every XMCD.opj plot COM lists is decoded (drawn, or left out as hidden),
    none contradicts it, and the only plot not reached is one with no curve
    anchor in its layer at all."""
    src = _origin(corpus_dir) / "XMCD.opj"
    index = _origin(corpus_dir) / "specimens" / "ground_truth" / "XMCD" / "index.json"
    if not src.exists() or not index.exists():
        pytest.skip("XMCD corpus or its COM ground truth not present")
    com: dict[tuple[str, int], list[tuple[str, str]]] = {}
    for g in json.loads(index.read_text(encoding="utf-8"))["graphs"]:
        for li, layer in enumerate(g["layers"], 1):
            refs = [_REF.match(p) for p in layer.get("plots", [])]
            com[(g["graph"], li)] = [(m.group(1), m.group(2)) for m in refs if m]
    matched = unmatched = hidden = 0
    wrong = []
    for f in extract_figures(src.read_bytes()):
        want = list(com.get((f["name"], f["layer"]), []))
        notes = f.get("curve_sheet_omitted", [])
        assert all(n["reason"] == "hidden_in_origin" for n in notes)
        hidden += len(notes)
        for got in [(c["book"], c["y"]) for c in f["curves"]] + [
            (n["book"], n["y"]) for n in notes
        ]:
            if got in want:
                want.remove(got)
                matched += 1
            else:
                wrong.append((f["name"], got))
        unmatched += len(want)
    total = sum(len(v) for v in com.values())
    assert not wrong
    assert hidden > 0
    assert matched == total - unmatched and unmatched <= 1


@pytest.mark.realdata
def test_realdata_hc2convert_record_x_matches_the_opju_save(corpus_dir: Path) -> None:
    """``hc2convert.opj`` is an earlier save of ``Hc2 data.opju``, whose record
    X is COM-verified (``opju_curve_token_x``). Every curve both decode binds
    the same X, and every hc2convert X is a numeric column of its book."""
    opj = _origin(corpus_dir) / "hc2convert.opj"
    opju = _origin(corpus_dir) / "Hc2 data.opju"
    if not opj.exists() or not opju.exists():
        pytest.skip("Hc2 corpus pair not present")
    old = {
        (f["name"], c["book"], c["y"]): c["x"]
        for f in extract_figures(opj.read_bytes())
        for c in f["curves"]
    }
    shared = 0
    for f in extract_figures_opju(opju.read_bytes()):
        for c in [*f["curves"], *f.get("curve_sheet_omitted", [])]:
            key = (f["name"], c["book"], c["y"])
            if key in old:
                shared += 1
                assert old[key] == c["x"], key
    assert shared >= len(old) // 2
    numeric: dict[str, set[str]] = {}
    for ds in read_origin_books(opj):
        names = list(ds.metadata.get("origin_column_names") or [])
        cols = {
            n for n, v in zip(names, np.asarray(ds.values).T, strict=True) if np.isfinite(v).any()
        }
        x_name = ds.metadata.get("x_column_name")
        if x_name and np.isfinite(ds.time).any():
            cols.add(str(x_name))
        numeric[str(ds.metadata.get("origin_book"))] = cols
    for (_, book, _), x in old.items():
        assert x in numeric.get(book, set()), (book, x)
