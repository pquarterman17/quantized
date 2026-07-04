"""Origin project (.opj / .opju) reader — M1 worksheet-data decode.

Two layers:
  * a **synthetic** CPY fixture built in-test (no private data) that exercises the
    block-framing walker + column decoder in CI;
  * a **realdata**-marked check against the local Origin corpus (auto-skips where
    the corpus is absent, e.g. CI) pinning a couple of decoded values as
    regression anchors.

Format: see docs/origin_project_format.md.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest

from quantized.io.origin_project import OriginProjectError, read_origin_project
from quantized.io.registry import import_auto, resolve_parser

# ── synthetic CPY .opj builder ────────────────────────────────────────────────


def _block(payload: bytes) -> bytes:
    """One CPY block: <uint32 size LE><0x0A><payload><0x0A>."""
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


def _zero() -> bytes:
    """A section-spacer block (size 0, no payload)."""
    return struct.pack("<I", 0) + b"\n"


def _data(values: list[float]) -> bytes:
    """A column data block: 10-byte <uint16 mask=0><float64> records."""
    return _block(b"".join(b"\x00\x00" + struct.pack("<d", v) for v in values))


def _header(name: str) -> bytes:
    """A column-header block carrying '<book>_<col>\\0'; size kept off a /10 so the
    walker classifies it as a header, not data."""
    payload = b"\x00" * 40 + name.encode("latin1") + b"\x00" + b"\x00" * 6
    if len(payload) % 10 == 0:
        payload += b"\x00"
    return _block(payload)


def _synthetic_opj() -> bytes:
    """A minimal valid CPYA project: Book1 with column A (x) and B (y)."""
    return (
        b"CPYA 4.3380 188 W64 #\n"
        + _block(b"\x00" * 32)  # file-header block (content irrelevant here)
        + _zero()
        + _header("Book1_A") + _data([1.0, 2.0, 3.0])
        + _zero()
        + _header("Book1_B") + _data([10.0, 20.0, 30.0])
    )


def _write(tmp_path: Path, name: str, data: bytes) -> Path:
    p = tmp_path / name
    p.write_bytes(data)
    return p


# ── synthetic decode (runs in CI) ─────────────────────────────────────────────


def test_registry_resolves_origin_extensions(tmp_path) -> None:
    for ext in (".opj", ".opju", ".OPJ", ".OpjU"):  # resolve lowercases the suffix
        f = _write(tmp_path, f"p{ext}", b"\x00\x00")
        assert resolve_parser(f) is read_origin_project


def test_decodes_worksheet_data_from_a_synthetic_opj(tmp_path) -> None:
    ds = import_auto(_write(tmp_path, "synth.opj", _synthetic_opj()))
    # column A → x (time); column B → the single value column.
    assert list(ds.time) == [1.0, 2.0, 3.0]
    assert ds.values.shape == (3, 1)
    assert list(ds.values[:, 0]) == [10.0, 20.0, 30.0]
    assert ds.labels == ("B",)
    assert ds.metadata["source_format"] == "origin_opj"
    assert ds.metadata["origin_book"] == "Book1"
    assert ds.metadata["origin_books"] == [{"name": "Book1", "ncols": 2, "nrows": 3}]


def test_ragged_columns_pad_with_nan(tmp_path) -> None:
    data = (
        b"CPYA 4.3380 188 W64 #\n" + _block(b"\x00" * 8) + _zero()
        + _header("B_A") + _data([1.0, 2.0, 3.0])
        + _zero()
        + _header("B_B") + _data([9.0])  # shorter → padded to len 3
    )
    ds = import_auto(_write(tmp_path, "ragged.opj", data))
    assert ds.values.shape == (3, 1)
    assert ds.values[0, 0] == 9.0
    assert np.isnan(ds.values[1, 0]) and np.isnan(ds.values[2, 0])


def test_non_cpya_opj_raises_actionable_guidance(tmp_path) -> None:
    with pytest.raises(OriginProjectError) as exc:
        import_auto(_write(tmp_path, "bogus.opj", b"not an origin file"))
    msg = str(exc.value)
    assert "bogus.opj" in msg and "Origin Viewer" in msg and "CSV" in msg


def test_opju_still_guides_until_m2(tmp_path) -> None:
    with pytest.raises(OriginProjectError) as exc:
        import_auto(_write(tmp_path, "recent.opju", b"CPYUA 4.3380 188"))
    assert "recent.opju" in str(exc.value) and "Origin Viewer" in str(exc.value)


def test_error_is_a_valueerror_so_the_route_maps_it_to_422() -> None:
    assert issubclass(OriginProjectError, ValueError)


# ── realdata (skips in CI / where the corpus is absent) ───────────────────────

_CORPUS = Path(__file__).resolve().parents[1] / ".." / "test-data" / "origin"


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_moke_field_ramp() -> None:
    ds = import_auto(_CORPUS / "Moke.opj")
    # the largest MOKE book's X column is the field sweep, first point ≈ -6796.22 Oe
    assert ds.time[0] == pytest.approx(-6796.22, abs=0.1)
    assert np.isfinite(ds.time).sum() > 100  # most of the ramp is real (empties → NaN)
    assert ds.values.shape[1] >= 1


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_xrd_two_theta_scan() -> None:
    ds = import_auto(_CORPUS / "XRD.opj")
    # a fine θ–2θ scan: X starts at 20° and increases monotonically over the real
    # rows (trailing empty cells decode to NaN, not Origin's -1.23e-300 sentinel).
    assert ds.time[0] == pytest.approx(20.0, abs=0.05)
    assert ds.time.shape[0] > 1000
    real = ds.time[np.isfinite(ds.time)]
    assert (np.diff(real) > 0).all()
    assert np.isnan(ds.time[-1])  # sentinel-filled tail mapped to NaN
