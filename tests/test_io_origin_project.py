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
    assert ds.metadata["origin_books"] == [
        {"name": "Book1", "long_name": "Book1", "ncols": 2, "nrows": 3}
    ]


def _window_header(book: str) -> bytes:
    """A worksheet window-header block: 00 00 <Book> 00 …, >=150 B."""
    payload = b"\x00\x00" + book.encode() + b"\x00"
    payload += b"\x00" * (165 - len(payload))  # not a multiple of 10
    return _block(payload)


def _prop_block(short: str, designation: int) -> bytes:
    """A 519-byte column-property block (designation@0x11, short name@0x12)."""
    p = bytearray(519)
    p[0x06] = 0x0B
    p[0x11] = designation
    p[0x12 : 0x12 + len(short) + 1] = short.encode() + b"\x00"
    p[0x25] = 0x21
    return _block(bytes(p))


def _label_block(long_name: str, unit: str) -> bytes:
    payload = f"{long_name}\r\n{unit}".encode() + b"\x00"
    if len(payload) % 10 == 0:
        payload += b"\x00"
    return _block(payload)


def test_windows_section_supplies_names_units_and_x_designation(tmp_path) -> None:
    data = (
        _synthetic_opj()
        + _zero()
        + _window_header("Book1")
        + _prop_block("A", 3)  # designation X
        + _label_block("Field", "Oe")
        + _prop_block("B", 0)  # designation Y
        + _label_block("Moment", "emu")
    )
    ds = import_auto(_write(tmp_path, "named.opj", data))
    assert ds.labels == ("Moment",)
    assert ds.units == ("emu",)
    assert ds.metadata["x_column_long"] == "Field"
    assert ds.metadata["x_unit"] == "Oe"
    assert ds.metadata["column_designations"] == {"A": "X", "B": "Y"}
    # data itself is unchanged by the metadata
    assert list(ds.time) == [1.0, 2.0, 3.0]
    assert list(ds.values[:, 0]) == [10.0, 20.0, 30.0]


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
def test_realdata_xrd_column_names_units_from_windows_section() -> None:
    """The windows-section metadata (RE item 1) reaches the DataStruct."""
    ds = import_auto(_CORPUS / "XRD.opj")
    # every XRD book: A = X "2Theta"/"degrees", B = Y "I"/"arb. units", C = Y "dI"
    assert ds.metadata["x_column_long"] == "2Theta"
    assert ds.metadata["x_unit"] == "degrees"
    assert ds.labels[0] == "I"
    assert ds.units[0] == "arb. units"
    assert ds.metadata["column_designations"]["A"] == "X"
    # long book names (source filenames) recovered from window headers
    assert any(
        b["long_name"] != b["name"] for b in ds.metadata["origin_books"]
    )


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
