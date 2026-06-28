"""Rigaku SmartLab .raw binary parser: golden parity vs MATLAB + routing.

The synthetic-fixture tests below build a Rigaku .raw from the documented byte
layout (magic "FI"; float32 counting-time/2theta-start/end/step at 2958/2962/
2966/2970; uint32 num-points at 3154; float32 intensities from 3158). They
exercise guard rails the single committed golden file can't: multi-range
detection, Bruker (.raw magic "RAW") rejection, and malformed files.
"""

from __future__ import annotations

import struct
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.rigaku import import_rigaku_raw, is_rigaku_raw

_HEADER_SIZE = 3158


def _make_raw(
    intensities: list[float],
    *,
    start: float = 10.0,
    step: float = 0.02,
    counting_time: float = 0.5,
    num_points: int | None = None,
    magic: bytes = b"FI",
    extra_ranges: int = 0,
) -> bytes:
    """Build a synthetic Rigaku .raw byte string from the documented layout."""
    n = len(intensities) if num_points is None else num_points
    end = start + (n - 1) * step
    header = bytearray(_HEADER_SIZE)
    header[0:2] = magic
    struct.pack_into("<f", header, 2958, counting_time)
    struct.pack_into("<f", header, 2962, start)
    struct.pack_into("<f", header, 2966, end)
    struct.pack_into("<f", header, 2970, step)
    struct.pack_into("<I", header, 3154, n)
    body = np.asarray(intensities, dtype="<f4").tobytes()
    # Extra ranges = trailing bytes after the first range (triggers multi-range).
    tail = b"\x00" * (extra_ranges * 8)
    return bytes(header) + body + tail


def _write(tmp_path: Path, name: str, content: bytes) -> Path:
    p = tmp_path / name
    p.write_bytes(content)
    return p


@pytest.mark.golden
def test_rigaku_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_rigaku_raw(fixtures_dir / "rigaku_yig.raw")
    assert_golden(ds, "rigaku_yig_default.json")


def test_rigaku_structure(fixtures_dir: Path) -> None:
    ds = import_rigaku_raw(fixtures_dir / "rigaku_yig.raw")
    assert ds.labels == ("Intensity",)
    assert ds.units == ("counts",)
    assert ds.metadata["x_column_name"] == "2-Theta"
    assert ds.n_points == 15385
    assert ds.time[0] < ds.time[-1]  # ascending 2theta


def test_rigaku_counts_per_sec(fixtures_dir: Path) -> None:
    counts = import_rigaku_raw(fixtures_dir / "rigaku_yig.raw")
    cps = import_rigaku_raw(fixtures_dir / "rigaku_yig.raw", use_counts_per_sec=True)
    ct = counts.metadata["counting_time"]
    assert cps.units == ("counts/s",)
    assert_allclose(cps.values, counts.values / ct, rtol=1e-12)


def test_registry_routes_raw(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "rigaku_yig.raw")
    assert ds.metadata["parser_name"] == "import_rigaku_raw"


# ── guard rails (synthetic fixtures from the documented byte layout) ──────────


def test_synthetic_roundtrip(tmp_path: Path) -> None:
    """A built .raw reads back the angles + intensities we wrote."""
    p = _write(tmp_path, "s.raw", _make_raw([100.0, 200.0, 300.0], start=10.0, step=0.02))
    ds = import_rigaku_raw(p)
    assert ds.n_points == 3
    assert_allclose(ds.time, [10.0, 10.02, 10.04], rtol=1e-6)
    assert_allclose(ds.values.ravel(), [100.0, 200.0, 300.0], rtol=1e-6)


def test_sniffer_accepts_fi_rejects_bruker(tmp_path: Path) -> None:
    """is_rigaku_raw keys on the 'FI' magic; Bruker .raw ('RAW') is not Rigaku."""
    rigaku = _write(tmp_path, "r.raw", _make_raw([1.0, 2.0]))
    bruker = _write(tmp_path, "b.raw", b"RAW1" + b"\x00" * 4000)
    assert is_rigaku_raw(rigaku) is True
    assert is_rigaku_raw(bruker) is False


def test_registry_rejects_bruker_raw(tmp_path: Path) -> None:
    """A Bruker .raw (out of scope here) finds no parser, rather than mis-parsing."""
    bruker = _write(tmp_path, "b.raw", b"RAW1" + b"\x00" * 4000)
    with pytest.raises(ValueError, match="no parser registered"):
        import_auto(bruker)


def test_multirange_raises_without_allow_partial(tmp_path: Path) -> None:
    p = _write(tmp_path, "m.raw", _make_raw([1.0, 2.0, 3.0], extra_ranges=4))
    with pytest.raises(ValueError, match="multi-range"):
        import_rigaku_raw(p)


def test_multirange_allow_partial_reads_first_range(tmp_path: Path) -> None:
    p = _write(tmp_path, "m.raw", _make_raw([1.0, 2.0, 3.0], extra_ranges=4))
    ds = import_rigaku_raw(p, allow_partial=True)
    assert ds.n_points == 3
    assert_allclose(ds.values.ravel(), [1.0, 2.0, 3.0], rtol=1e-6)


def test_bad_magic_and_too_small_raise(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="too small"):
        import_rigaku_raw(_write(tmp_path, "tiny.raw", b"FI" + b"\x00" * 10))
    # Full size but wrong magic.
    bad = bytearray(_make_raw([1.0, 2.0]))
    bad[0:2] = b"ZZ"
    with pytest.raises(ValueError, match="bad magic"):
        import_rigaku_raw(_write(tmp_path, "bad.raw", bytes(bad)))


def test_zero_and_implausible_step_raise(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="zero step"):
        import_rigaku_raw(_write(tmp_path, "z.raw", _make_raw([1.0, 2.0], step=0.0)))
    with pytest.raises(ValueError, match="implausible step"):
        import_rigaku_raw(_write(tmp_path, "big.raw", _make_raw([1.0, 2.0], step=50.0)))
