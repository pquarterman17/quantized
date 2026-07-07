"""Origin reader hardening (plan item 29): corpus sweep, malformed input, perf.

Contract under attack: for ANY input, the Origin readers either return a valid
DataStruct or raise :class:`OriginProjectError` — never a stray exception,
never a hang, never silently-wrong garbage. Malformed fixtures run in CI;
the corpus sweep + the 127 MB perf budget are ``realdata``-marked.
"""

from __future__ import annotations

import struct
import time
from pathlib import Path

import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io.origin_project import (
    OriginProjectError,
    read_origin_books,
    read_origin_project,
)
from quantized.io.origin_project.opju_codec import scan_columns
from quantized.io.origin_project.writer import opj_bytes


def _resolve_corpus_dir() -> Path:
    """The local-only ``../test-data/origin`` corpus; walks up from ``__file__``
    for a ``test-data`` sibling so this still resolves inside a worktree agent
    (an extra ``.claude/worktrees/<name>`` deep) -- mirrors
    ``test_io_origin_figures_opju.py``'s ``_resolve_spec_dir``."""
    candidate = Path(__file__).resolve().parents[1] / ".." / "test-data" / "origin"
    if candidate.exists():
        return candidate
    for ancestor in Path(__file__).resolve().parents:
        walked = ancestor / "test-data" / "origin"
        if walked.exists():
            return walked
    return candidate


_CORPUS = _resolve_corpus_dir()


def _block(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


def _read(tmp_path: Path, name: str, data: bytes) -> DataStruct:
    p = tmp_path / name
    p.write_bytes(data)
    return read_origin_project(p)


# ── malformed inputs (CI) ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "payload",
    [
        b"",  # empty file
        b"CPYA",  # bare magic
        b"CPYA 4.3380 188 W64 #\n",  # header only
        b"CPYA 4.3380 188 W64 #\n" + b"\xff" * 64,  # framing garbage
        b"CPYA 4.3380 188 W64 #\n" + struct.pack("<I", 10**9) + b"\n",  # lying size
        b"CPYA 4.3380 188 W64 #\n" + _block(b"\x00" * 40)[:-3],  # truncated block
        b"OPJU" + b"\x00" * 100,  # wrong magic
    ],
)
def test_malformed_opj_raises_origin_error_only(tmp_path, payload: bytes) -> None:
    with pytest.raises(OriginProjectError):
        _read(tmp_path, "bad.opj", payload)


def test_data_block_without_header_is_ignored(tmp_path) -> None:
    data = (
        b"CPYA 4.3380 188 W64 #\n"
        + _block(b"\x00" * 32)
        + _block(b"\x00" * 30)  # data-sized block with no preceding name
    )
    with pytest.raises(OriginProjectError):  # no columns decoded → guidance error
        _read(tmp_path, "orphan.opj", data)


def test_property_block_without_label_is_tolerated(tmp_path) -> None:
    name = b"\x00" * 40 + b"B_A\x00" + b"\x00" * 7
    prop = bytearray(519)
    prop[0x06], prop[0x25] = 0x0B, 0x21
    prop[0x12:0x14] = b"A\x00"
    data = (
        b"CPYA 4.3380 188 W64 #\n"
        + _block(b"\x00" * 32)
        + _block(bytes(name))
        + _block(b"\x00\x00" + struct.pack("<d", 1.0) + b"\x00\x00" + struct.pack("<d", 2.0))
        + _block(b"\x00\x00" + b"B" + b"\x00" + b"\x00" * 200)  # window header, no cols after prop
        + _block(bytes(prop))  # property block, then EOF — pending label never arrives
    )
    ds = _read(tmp_path, "nolabel.opj", data)
    assert list(ds.time) == [1.0, 2.0]


@pytest.mark.parametrize(
    "payload",
    [
        b"CPYUA",  # bare magic
        b"CPYUA 4.3811 222\n",  # header only
        b"CPYUA 4.3811 222\n" + b"\xa5" * 400,  # FPC garbage
        b"CPYUA 4.3811 222\n"
        + b"\x07Fake_A\xff\xff"
        + struct.pack("<H", 50)
        + b"\x9f\x86",  # record truncated mid-stream
        b"CPYUA 4.3380 111\n" + b"\x00" * 64,  # older sub-version, no records
    ],
)
def test_malformed_opju_raises_origin_error_only(tmp_path, payload: bytes) -> None:
    """The .opju top-level contract mirrors the .opj one: any malformed or
    empty container raises ``OriginProjectError`` (with recovery guidance),
    never returns a silently-partial DataStruct (2026-07-06 genericity
    audit: this battery previously existed only for ``.opj``)."""
    with pytest.raises(OriginProjectError):
        _read(tmp_path, "bad.opju", payload)


def test_opju_codec_scan_survives_garbage() -> None:
    assert scan_columns(b"") == []
    assert scan_columns(b"CPYUA 4.3811 222\n" + b"\xa5" * 500) == []
    # a plausible name with a lying record marker
    junk = b"\x07Fake_A" + b"\xff\xff" + struct.pack("<H", 50000) + b"\x9f\x86\x03\x0c"
    assert scan_columns(b"CPYUA 4.3811 222\n" + junk) == []


def test_writer_survives_hostile_labels(tmp_path) -> None:
    ds = DataStruct(
        time=np.array([1.0, 2.0]),
        values=np.array([[3.0], [4.0]]),
        labels=("θ→∞ (µrad)",),  # non-latin1 chars must not crash the writer
        units=("μV",),
        metadata={"origin_book": "有机", "x_column_long": "x\r\ny"},
    )
    p = tmp_path / "hostile.opj"
    p.write_bytes(opj_bytes([ds]))
    back = read_origin_project(p)
    assert list(back.time) == [1.0, 2.0]
    assert back.values[1, 0] == 4.0


# ── corpus sweep + version anchors + perf (realdata) ─────────────────────────

pytestmark_real = pytest.mark.realdata


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
@pytest.mark.parametrize(
    "fname",
    [
        "Moke.opj",
        "XRD.opj",
        "XMCD.opj",
        "MnN_Diffusion_PNR.opj",
        "SuperlatticeFits.opj",
        "hc2convert.opj",
        "XAS.opju",
        "RockingCurve.opju",
        "UnpolPlots.opju",
        "Fixed Lambdas SI.opju",
        "Hc2 data.opju",
    ],
)
def test_corpus_sweep_parses_or_raises_cleanly(fname: str) -> None:
    path = _CORPUS / fname
    if not path.exists():
        pytest.skip(f"{fname} not in local corpus")
    try:
        ds = read_origin_project(path)
    except OriginProjectError:
        return  # clean, actionable refusal is a pass
    assert ds.values.ndim == 2
    assert len(ds.labels) == ds.values.shape[1]


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_version_anchors_43227_and_43380() -> None:
    """One pinned value per .opj container version in the corpus. (The
    2026-07-06 corpus swap replaced XRD.opj with a CPYA 4.3380 project, so
    XMCD.opj is now the sole 4.3227 anchor.)"""
    # 620.0414: re-pinned 2026-07-06 after the genericity fixes — the old
    # 4-char column-name cap dropped every 5+-char short-named column
    # (i0esA/normA/average/difference…), which also shifted the primary-book
    # choice; the recovered columns are verified against the full XMCD COM
    # ground-truth oracle (171 books).
    xmcd = read_origin_project(_CORPUS / "XMCD.opj")  # CPYA 4.3227
    assert xmcd.time[0] == pytest.approx(620.0414, abs=0.001)
    xrd = read_origin_project(_CORPUS / "XRD.opj")  # CPYA 4.3380
    assert xrd.time[0] == pytest.approx(10.0, abs=0.05)
    moke = read_origin_project(_CORPUS / "Moke.opj")  # CPYA 4.3380
    assert moke.time[0] == pytest.approx(-6796.22, abs=0.1)


@pytest.mark.realdata
@pytest.mark.skipif(
    not (_CORPUS / "PNR.opj").exists(), reason="127 MB PNR.opj not in local corpus"
)
def test_perf_budget_127mb_project() -> None:
    """The biggest corpus project must parse (books + names) within budget."""
    t0 = time.monotonic()
    books = read_origin_books(_CORPUS / "PNR.opj")
    elapsed = time.monotonic() - t0
    assert books, "no books decoded from PNR.opj"
    assert elapsed < 120, f"PNR.opj took {elapsed:.1f}s (budget 120s)"


@pytest.mark.realdata
def test_matrix_specimens_fail_closed_and_degrade(tmp_path) -> None:
    """Matrix (MBook) pages are undecoded (§13.2 #9 recon 2026-07-06: their
    data uses a distinct compact codec — no FPC name records, no raw f64
    runs — cracked only with new RE). The CONTRACT this pins: a matrix-only
    project raises a clean OriginProjectError (guidance, never garbage), and
    a MIXED project still decodes its worksheets exactly while matrix pages
    are skipped — graceful degradation for arbitrary real-world projects."""
    spec = _CORPUS / "specimens"
    mat_only = spec / "matrix_spec.opju"
    mixed = spec / "matrix_mixed.opju"
    if not mat_only.exists() or not mixed.exists():
        pytest.skip("matrix specimens not present on this machine")
    with pytest.raises(OriginProjectError):
        read_origin_project(mat_only)
    books = read_origin_books(mixed)
    assert [b.metadata.get("origin_book") for b in books] == ["WBook"]
    assert list(books[0].time) == [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    assert list(books[0].values[:, 0]) == [1.0, 4.0, 9.0, 16.0, 25.0, 36.0]


def test_opju_record_gate_accepts_wide_varints() -> None:
    """The `0a 05 <varint>` before `ff ff` grows with the record (LEB128:
    120000 rows = 3 bytes) — the gate is a structural varint check, not a
    size cap (2026-07-06 audit #16: the old 1-2-byte gate silently rejected
    every large column; confirmed by the 120k-row bigcolumn.opju specimen)."""
    from quantized.io.origin_project.opju_codec import _records

    head = b"\x00" * 8
    one = head + b"\x0a\x05\x20\xff\xff" + b"\x00" * 8
    three = head + b"\x0a\x05\xc0\xa9\x07\xff\xff" + b"\x00" * 8
    malformed = head + b"\x0a\x05\xc0\xa9\xff\xff" + b"\x00" * 8  # dangling continuation
    assert _records(one), "1-byte varint header must gate in"
    assert _records(three), "3-byte varint header must gate in"
    assert not _records(malformed), "ill-formed varint must gate out"


@pytest.mark.realdata
def test_realdata_hardening_specimens_decode() -> None:
    """The 2026-07-06 hardening specimens (generate via live Origin):

    * ``bigcolumn.opju`` — 120k rows decode bit-exact (audit #16);
    * ``designations.opju`` — a book with ALL designations (X/Y/Y-error/
      label/Z/X-error) keeps its whole metadata run: every long name and
      every designation decodes (audit #10 — one unknown marker used to
      drop the entire book's names/units/X role);
    * ``symbol_kinds.opju`` — curve records carry symbol kinds 1..8 exactly
      (audit #15: 4-8 previously unverified).
    """
    spec = _CORPUS / "specimens"
    needed = ["bigcolumn.opju", "designations.opju", "symbol_kinds.opju"]
    if not all((spec / n).exists() for n in needed):
        pytest.skip("hardening specimens not present on this machine")

    big = read_origin_books(spec / "bigcolumn.opju")
    assert big[0].values.shape == (120_000, 1)
    assert big[0].time[0] == 0.0 and big[0].time[-1] == 119_999.0
    assert big[0].values[-1, 0] == 60_000.5

    des = read_origin_books(spec / "designations.opju")[0]
    assert des.metadata["column_designations"] == {
        "A": "X", "B": "Y", "C": "Y-error", "D": "label",
        "E": "Z", "F": "X-error", "G": "Y",
    }
    assert des.metadata["x_column_long"] == "XXlong"
    assert des.labels == ("YYlong", "EYlong", "LBlong", "ZZlong", "EXlong", "DDlong")

    from quantized.io.origin_project.curve_style_color import opju_style_record, style_fields
    from quantized.io.origin_project.opju_figure_curves import (
        _CURVE_TOKEN,
        column_id_table,
        opju_pages,
    )

    b = (spec / "symbol_kinds.opju").read_bytes()
    pages = opju_pages(b)
    table = column_id_table(b, pages)
    got: dict[str, str | float | None] = {}
    for m in _CURVE_TOKEN.finditer(b):
        w = m.group(1)[0]
        cid = b[m.end()] if w == 1 else int.from_bytes(b[m.end() : m.end() + 2], "little")
        info = table.ids.get(cid)
        if info is None:
            continue
        rec = opju_style_record(b, m.start() + 3)
        if rec is not None:
            got[info[1]] = style_fields(rec).get("symbol")
    assert got == {
        "B": "square", "C": "circle", "D": "triangle", "E": "downtriangle",
        "F": "diamond", "G": "plus", "H": "cross", "I": "star",
    }
