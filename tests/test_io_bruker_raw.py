"""Bruker RAW1.01 .raw binary parser: synthetic guard-rail tests (CI) + a
golden decode of the xylib sample files (realdata).

The synthetic builder writes the documented RAW1.01 layout (magic RAW1.01;
range_cnt at 12; per-range steps/start_2theta/step_size/time/supp_len at
rel 4/16/176/192/256; float32 counts after header+supp). It exercises the
variable supplementary-header offset, multi-range detection, and Rigaku
rejection — things a single committed binary can't.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.bruker_raw import import_bruker_raw, is_bruker_raw

_FILE_HEADER = 712
_RANGE_HEADER = 304


def _make_raw(
    intensities: list[float],
    *,
    start: float = 10.0,
    step: float = 0.02,
    time_per_step: float = 0.5,
    supp_len: int = 0,
    range_cnt: int = 1,
    magic: bytes = b"RAW1.01\x00",
    steps: int | None = None,
) -> bytes:
    """Build a synthetic single-range RAW1.01 from the documented layout."""
    n = len(intensities) if steps is None else steps
    buf = bytearray(_FILE_HEADER)
    buf[0:8] = magic
    struct.pack_into("<I", buf, 12, range_cnt)
    struct.pack_into("<d", buf, 616, 1.5406)  # Ka average
    buf[608:610] = b"Cu"

    rng = bytearray(_RANGE_HEADER + supp_len)
    struct.pack_into("<I", rng, 0, _RANGE_HEADER)
    struct.pack_into("<I", rng, 4, n)
    struct.pack_into("<d", rng, 16, start)
    struct.pack_into("<d", rng, 176, step)
    struct.pack_into("<f", rng, 192, time_per_step)
    struct.pack_into("<I", rng, 256, supp_len)

    data = b"".join(struct.pack("<f", v) for v in intensities)
    return bytes(buf) + bytes(rng) + data


def _write(tmp_path: Path, data: bytes, name: str = "s.raw") -> Path:
    p = tmp_path / name
    p.write_bytes(data)
    return p


def test_synthetic_roundtrip(tmp_path: Path) -> None:
    counts = [10.0, 20.0, 30.0, 40.0, 50.0]
    ds = import_bruker_raw(_write(tmp_path, _make_raw(counts, start=5.0, step=0.05)))
    assert_allclose(ds.time, [5.0, 5.05, 5.10, 5.15, 5.20])
    assert_allclose(ds.values[:, 0], counts)
    assert ds.labels == ("Intensity",) and ds.units == ("counts",)
    assert ds.metadata["format_version"] == "RAW1.01"
    assert ds.metadata["anode_material"] == "Cu"


def test_variable_supplementary_header(tmp_path: Path) -> None:
    # a 40-byte supplementary block must shift the data start, not corrupt it
    counts = [7.0, 8.0, 9.0]
    ds = import_bruker_raw(_write(tmp_path, _make_raw(counts, supp_len=40)))
    assert_allclose(ds.values[:, 0], counts)


def test_counts_per_second(tmp_path: Path) -> None:
    ds = import_bruker_raw(
        _write(tmp_path, _make_raw([100.0, 200.0], time_per_step=2.0)),
        use_counts_per_sec=True,
    )
    assert_allclose(ds.values[:, 0], [50.0, 100.0])
    assert ds.units == ("counts/s",)


def test_multirange_requires_flag(tmp_path: Path) -> None:
    data = _make_raw([1.0, 2.0], range_cnt=2)
    with pytest.raises(ValueError, match="multi-range"):
        import_bruker_raw(_write(tmp_path, data))
    ds = import_bruker_raw(_write(tmp_path, data), allow_partial=True)
    assert ds.values.shape[0] == 2  # first range only


def test_rejects_bad_magic_and_routing(tmp_path: Path) -> None:
    p = _write(tmp_path, _make_raw([1.0], magic=b"FI\x00\x00\x00\x00\x00\x00"))
    assert not is_bruker_raw(p)
    with pytest.raises(ValueError, match="bad magic"):
        import_bruker_raw(p)


def test_rejects_implausible_step(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="step size"):
        import_bruker_raw(_write(tmp_path, _make_raw([1.0, 2.0], step=0.0)))


@pytest.mark.realdata
@pytest.mark.parametrize(
    ("name", "n", "start", "step", "first5"),
    [
        ("xylib_BT86.raw", 2374, 3.0, 0.0155922, [187, 183, 178, 174, 193]),
        ("xylib_Cu3Au.raw", 3901, 22.0, 0.02, [48, 24, 38, 23, 39]),
    ],
)
def test_xylib_golden(
    corpus_dir: Path, name: str, n: int, start: float, step: float, first5: list[int]
) -> None:
    """Decode the canonical xylib RAW1.01 files; values cross-checked against
    xylib's own ASCII UXD export of the same raw file."""
    path = corpus_dir / "bruker" / "xrd" / name
    if not path.exists():
        pytest.skip(f"corpus file missing: {name}")
    ds = import_auto(str(path))
    assert len(ds.time) == n
    assert ds.time[0] == pytest.approx(start)
    assert (ds.time[1] - ds.time[0]) == pytest.approx(step, abs=1e-6)
    assert [int(v) for v in ds.values[:5, 0]] == first5
    assert np.all(ds.values[:, 0] >= 0)  # counts are non-negative
