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

_CORPUS = Path(__file__).resolve().parents[1] / ".." / "test-data" / "origin"


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
    """One pinned value per .opj container version in the corpus."""
    xrd = read_origin_project(_CORPUS / "XRD.opj")  # CPYA 4.3227
    assert xrd.time[0] == pytest.approx(20.0, abs=0.05)
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
