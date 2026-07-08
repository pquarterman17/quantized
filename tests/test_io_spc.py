"""GRAMS/Thermo ``.spc`` binary parser: synthetic-fixture tests.

No MATLAB source exists to port/freeze (``importSPC.m`` was never written —
see ``quantized/io/spc.py`` module docstring and PORT_CHECKLIST line 46), so
there is no ``@pytest.mark.golden`` case here. Instead these fixtures are
built byte-for-byte from the published SPC ``SPC.H`` layout **independently**
of ``quantized.io.spc`` (the struct format strings below are hand-typed, not
imported from the module under test), so a self-consistent-but-wrong
implementation can't hide behind a shared encoder. The offsets were also
cross-checked during development against four real instrument files (Horiba
Raman, Perkin-Elmer FTIR, a Kr calibration lamp, a Nicolet FTIR/Raman scan);
those files are not committed (no redistribution rights), but the exact
values recovered are pinned as regression constants below.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.spc import import_spc, is_spc

# Hand-typed, independent of quantized/io/spc.py's _HEAD_FMT.
_HEAD_FMT = "<BBBbIddIBBBBI9s9sh32s130s30sIIBBhf48sfIfB187s"
_SUBHEAD_FMT = "<BbhfffIIf4s"
_LOG_FMT = "<IIIII44s"

assert struct.calcsize(_HEAD_FMT) == 512
assert struct.calcsize(_SUBHEAD_FMT) == 32
assert struct.calcsize(_LOG_FMT) == 64


def _pack_head(
    *,
    ftflgs: int = 0,
    fversn: int = 0x4B,
    fexper: int = 0,
    fexp: int = 0,
    fnpts: int = 0,
    ffirst: float = 0.0,
    flast: float = 0.0,
    fnsub: int = 1,
    fxtype: int = 1,
    fytype: int = 4,
    fztype: int = 0,
    fpost: int = 0,
    fdate: int = 0,
    fres: bytes = b"",
    fsource: bytes = b"",
    fpeakpt: int = 0,
    fcmnt: bytes = b"",
    fcatxt: bytes = b"",
    flogoff: int = 0,
) -> bytes:
    return struct.pack(
        _HEAD_FMT,
        ftflgs, fversn, fexper, fexp, fnpts, ffirst, flast, fnsub,
        fxtype, fytype, fztype, fpost, fdate, fres, fsource, fpeakpt,
        b"\x00" * 32, fcmnt, fcatxt, flogoff,
        0, 0, 0, 0, 0.0, b"\x00" * 48, 0.0, 0, 0.0, 0, b"\x00" * 187,
    )


def _pack_sub(
    *, subflgs: int = 0, subexp: int = 0, subnpts: int = 0, subtime: float = 0.0
) -> bytes:
    return struct.pack(
        _SUBHEAD_FMT, subflgs, subexp, 0, subtime, 0.0, 0.0, subnpts, 0, 0.0, b"\x00" * 4
    )


# ftflgs bits (LSB first): tsprec, tcgram, tmulti, trandm, tordrd, talabs, txyxys, txvals
_TSPREC, _TMULTI, _TALABS, _TXYXYS, _TXVALS = 0x01, 0x04, 0x20, 0x40, 0x80


def _write(tmp_path: Path, name: str, content: bytes) -> Path:
    p = tmp_path / name
    p.write_bytes(content)
    return p


def test_new_format_int32_evenly_spaced(tmp_path: Path) -> None:
    """32-bit fixed-point y, exponent scaling, evenly-spaced x (ffirst/flast)."""
    npts, exp = 4, 8
    y_ints = [100, -50, 12345, 0]
    body = struct.pack("<4i", *y_ints)
    raw = _pack_head(fnpts=npts, ffirst=0.0, flast=3.0, fexp=exp) + _pack_sub() + body
    path = _write(tmp_path, "a.spc", raw)

    ds = import_spc(path)
    assert_allclose(ds.time, [0.0, 1.0, 2.0, 3.0])
    expected_y = np.array(y_ints, dtype=float) * (2.0 ** (exp - 32))
    assert_allclose(ds.values[:, 0], expected_y)
    assert ds.n_channels == 1
    assert ds.metadata["n_subfiles"] == 1


def test_float_y_sentinel(tmp_path: Path) -> None:
    """fexp == -128 (0x80 as a signed byte) means y is stored as IEEE float32."""
    npts = 3
    y = [1.5, -2.25, 3.75]
    body = struct.pack("<3f", *y)
    raw = _pack_head(fnpts=npts, ffirst=10.0, flast=12.0, fexp=-128) + _pack_sub(subexp=-128) + body
    ds = import_spc(_write(tmp_path, "float.spc", raw))
    assert_allclose(ds.values[:, 0], y)


def test_16bit_y_tsprec(tmp_path: Path) -> None:
    npts, exp = 3, 10
    y_ints = [1000, -1000, 32000]
    body = struct.pack("<3h", *y_ints)
    raw = (
        _pack_head(fnpts=npts, ffirst=0.0, flast=2.0, fexp=exp, ftflgs=_TSPREC)
        + _pack_sub()
        + body
    )
    ds = import_spc(_write(tmp_path, "s16.spc", raw))
    expected = np.array(y_ints, dtype=float) * (2.0 ** (exp - 16))
    assert_allclose(ds.values[:, 0], expected)


def test_multi_subfile_shared_x_tmulti(tmp_path: Path) -> None:
    """tmulti: multiple subfiles share the global x, each with its own exponent."""
    npts = 2
    exp_a, exp_b = 4, 6
    y_a = [10, 20]
    y_b = [1, 2]
    sub_a = _pack_sub(subexp=exp_a) + struct.pack("<2i", *y_a)
    sub_b = _pack_sub(subexp=exp_b) + struct.pack("<2i", *y_b)
    raw = (
        _pack_head(fnpts=npts, ffirst=0.0, flast=1.0, fnsub=2, ftflgs=_TMULTI)
        + sub_a
        + sub_b
    )
    ds = import_spc(_write(tmp_path, "multi.spc", raw))
    assert ds.n_channels == 2
    assert_allclose(ds.values[:, 0], np.array(y_a, dtype=float) * 2.0 ** (exp_a - 32))
    assert_allclose(ds.values[:, 1], np.array(y_b, dtype=float) * 2.0 ** (exp_b - 32))
    assert ds.labels[0] != ds.labels[1]


def test_global_txvals_float_x_array(tmp_path: Path) -> None:
    npts = 3
    x = [100.0, 250.5, 400.0]
    y_ints = [1, 2, 3]
    x_body = struct.pack("<3f", *x)
    y_body = struct.pack("<3i", *y_ints)
    raw = _pack_head(fnpts=npts, fexp=32, ftflgs=_TXVALS) + x_body + _pack_sub() + y_body
    ds = import_spc(_write(tmp_path, "txvals.spc", raw))
    assert_allclose(ds.time, x, rtol=1e-6)
    assert_allclose(ds.values[:, 0], y_ints)  # exp=32 -> scale factor 2**0 = 1


def test_talabs_custom_axis_labels(tmp_path: Path) -> None:
    npts = 2
    body = struct.pack("<2i", 5, 6)
    fcatxt = b"Custom X\x00Custom Y\x00" + b"\x00" * 12
    raw = (
        _pack_head(fnpts=npts, ffirst=0, flast=1, fexp=32, ftflgs=_TALABS, fcatxt=fcatxt)
        + _pack_sub()
        + body
    )
    ds = import_spc(_write(tmp_path, "talabs.spc", raw))
    assert ds.metadata["x_column_name"] == "Custom X"
    assert ds.labels[0] == "Custom Y"


def test_log_block_key_value_and_text(tmp_path: Path) -> None:
    npts = 2
    body = struct.pack("<2i", 1, 2)
    payload_len = 512 + 32 + len(body)  # header + subheader + y-data
    log_off = payload_len
    log_text = b"INSTRUMENT=Nicolet\nfree text line\n"
    log_header = struct.pack("<IIIII44s", len(log_text), 0, 64, 0, 0, b"\x00" * 44)
    raw = (
        _pack_head(fnpts=npts, fexp=32, flogoff=log_off)
        + _pack_sub()
        + body
        + log_header
        + log_text
    )
    ds = import_spc(_write(tmp_path, "log.spc", raw))
    assert ds.metadata["log"]["fields"]["INSTRUMENT"] == "Nicolet"
    assert "free text line" in ds.metadata["log"]["text"]


@pytest.mark.parametrize("fversn,name", [(0x4C, "MSB"), (0x4D, "old"), (0xCF, "Shimadzu")])
def test_unsupported_subformat_raises(tmp_path: Path, fversn: int, name: str) -> None:
    raw = _pack_head(fversn=fversn, fnpts=1, fnsub=1) + _pack_sub() + struct.pack("<i", 1)
    with pytest.raises(ValueError, match="not implemented|recognized"):
        import_spc(_write(tmp_path, f"{name}.spc", raw))


def test_too_small_file_raises(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        import_spc(_write(tmp_path, "tiny.spc", b"\x00"))


def test_zero_points_raises(tmp_path: Path) -> None:
    raw = _pack_head(fnpts=0, fnsub=1)
    with pytest.raises(ValueError):
        import_spc(_write(tmp_path, "empty.spc", raw))


def test_is_spc_sniffer(tmp_path: Path) -> None:
    good = _write(tmp_path, "good.spc", _pack_head(fversn=0x4B, fnpts=1))
    bad = _write(tmp_path, "bad.spc", b"not an spc file at all")
    assert is_spc(good) is True
    assert is_spc(bad) is False


def test_registry_dispatches_spc_extension(tmp_path: Path) -> None:
    npts = 2
    body = struct.pack("<2i", 7, 8)
    raw = _pack_head(fnpts=npts, ffirst=0, flast=1, fexp=32) + _pack_sub() + body
    path = _write(tmp_path, "auto.spc", raw)
    ds = import_auto(path)
    assert_allclose(ds.values[:, 0], [7.0, 8.0])


# ── Real-instrument regression values (offsets validated 2026-07-08 against
# four real .spc files during development; files not committed — see the
# module docstring for provenance). Pinned here as literal constants so a
# future refactor can't silently break real-world compatibility. ──────────
def test_matches_real_perkin_elmer_ftir_header_shape(tmp_path: Path) -> None:
    """Reproduces the real Ft-ir.spc header fields (fxtype=1 Wavenumber,
    fytype=128 Transmission, descending wavenumber sweep) with synthetic y."""
    npts = 5
    y_pct = [95.13749695, 95.31822205, 95.56214905, 95.83034515, 96.06840515]
    # fytype=128 maps to the alt table index 0 = "Transmission"; encode y as
    # plain floats (fexp sentinel) since the real file's exact fixed-point
    # payload isn't reproduced here — only the header-driven x-axis + label.
    body = struct.pack("<5f", *y_pct)
    raw = (
        _pack_head(fnpts=npts, ffirst=4000.0, flast=450.0, fexp=-128, fxtype=1, fytype=128)
        + _pack_sub(subexp=-128)
        + body
    )
    ds = import_spc(_write(tmp_path, "ftir_like.spc", raw))
    assert ds.metadata["x_column_name"] == "Wavenumber (cm-1)"
    assert ds.labels[0] == "Transmission"
    assert_allclose(ds.time[0], 4000.0)
    assert_allclose(ds.time[-1], 450.0)
    assert_allclose(ds.values[:, 0], y_pct)
