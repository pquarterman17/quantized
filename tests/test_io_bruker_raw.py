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
    alpha_average: float = 1.5406,
    alpha1: float | None = None,
    alpha2: float | None = None,
) -> bytes:
    """Build a synthetic single-range RAW1.01 from the documented layout.

    ``alpha1``/``alpha2`` default to ``None``, leaving the bytes at 624/632
    zeroed — the "legacy file" case, since a zeroed value fails the decoder's
    plausibility guard and the field is simply omitted.
    """
    n = len(intensities) if steps is None else steps
    buf = bytearray(_FILE_HEADER)
    buf[0:8] = magic
    struct.pack_into("<I", buf, 12, range_cnt)
    struct.pack_into("<d", buf, 616, alpha_average)  # Ka average
    if alpha1 is not None:
        struct.pack_into("<d", buf, 624, alpha1)
    if alpha2 is not None:
        struct.pack_into("<d", buf, 632, alpha2)
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


def test_alpha1_decoded(tmp_path: Path) -> None:
    """Byte 624 alpha1 (+ 632 alpha2) decode when finite, in the plausible lab
    X-ray window, and consistent with the file's own alpha_average at 616 --
    real Cu Ka1/Ka2/average values, cross-checked against xylib's own field
    documentation."""
    ds = import_bruker_raw(
        _write(
            tmp_path,
            _make_raw([1.0, 2.0], alpha_average=1.5418, alpha1=1.540598, alpha2=1.544426),
        )
    )
    assert ds.metadata["alpha1"] == pytest.approx(1.540598)
    assert ds.metadata["alpha2"] == pytest.approx(1.544426)
    assert ds.metadata["alpha_average"] == pytest.approx(1.5418)


def test_alpha1_inconsistent_with_average_is_omitted(tmp_path: Path) -> None:
    """A plausible-looking alpha1 that disagrees with alpha_average by more
    than the guard's tolerance (e.g. a mis-decoded or foreign value) is
    dropped -- alpha_average stands alone. Fail closed."""
    ds = import_bruker_raw(
        _write(
            tmp_path,
            _make_raw([1.0, 2.0], alpha_average=1.5418, alpha1=0.9, alpha2=1.544426),
        )
    )
    assert "alpha1" not in ds.metadata
    assert "alpha2" not in ds.metadata
    assert ds.metadata["alpha_average"] == pytest.approx(1.5418)


def test_alpha1_out_of_range_is_omitted(tmp_path: Path) -> None:
    """A value outside the 0.5-2.5 A plausible window (e.g. nm-scaled or
    garbage) never gets adopted, even if it happened to be close to
    alpha_average in absolute terms."""
    ds = import_bruker_raw(
        _write(tmp_path, _make_raw([1.0, 2.0], alpha_average=1.5418, alpha1=15.406))
    )
    assert "alpha1" not in ds.metadata


def test_alpha2_guarded_independently_of_alpha1(tmp_path: Path) -> None:
    """A good alpha1 is still adopted when alpha2 alone is implausible or
    inconsistent with the weighted average; alpha2 is then omitted alone."""
    ds = import_bruker_raw(
        _write(
            tmp_path,
            _make_raw([1.0, 2.0], alpha_average=1.5418, alpha1=1.540598, alpha2=0.1),
        )
    )
    assert ds.metadata["alpha1"] == pytest.approx(1.540598)
    assert "alpha2" not in ds.metadata


def test_legacy_file_missing_alpha1_still_parses(tmp_path: Path) -> None:
    """Older files that leave the 624/632 slots zeroed must still import
    cleanly, with no alpha1/alpha2 in metadata and alpha_average unaffected."""
    ds = import_bruker_raw(_write(tmp_path, _make_raw([1.0, 2.0])))
    assert "alpha1" not in ds.metadata
    assert "alpha2" not in ds.metadata
    assert ds.metadata["alpha_average"] == pytest.approx(1.5406)


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
