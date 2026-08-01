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
from quantized.io.registry import resolve_parser
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


# (0x4D left this list 2026-07-25 — the old format is now implemented.)
@pytest.mark.parametrize("fversn,name", [(0x4C, "MSB"), (0xCF, "Shimadzu")])
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


# ── TXYXYS (per-subfile x) — the mode where header fnpts is NOT a point
# count but the byte offset of the trailing subfile directory (0 = none).
# Regression tests for two real-file defects found 2026-07-25: fnpts=0 was
# rejected as "empty", and a multifile read returned subfile 0 ONLY with no
# error (a real 512-scan mass-spec file shrank to 8 points, silently). ────
_TXY = _TXYXYS | _TXVALS  # txyxys implies per-subfile x arrays


def _pack_txyxys_sub(x_ints: list[int], y_ints: list[int], *, subexp: int) -> bytes:
    n = len(x_ints)
    assert n == len(y_ints)
    return (
        _pack_sub(subexp=subexp, subnpts=n)
        + struct.pack(f"<{n}i", *x_ints)
        + struct.pack(f"<{n}i", *y_ints)
    )


def test_txyxys_fnpts_zero_is_legal(tmp_path: Path) -> None:
    """fnpts=0 with per-subfile counts is a valid TXYXYS file, not 'empty'."""
    exp = 8
    x_ints = [1 << 24, 2 << 24, 3 << 24]  # 1.0, 2.0, 3.0 at 2**(8-32)
    y_ints = [100, 200, 300]
    raw = _pack_head(ftflgs=_TXY, fnpts=0, fnsub=1, fexp=exp) + _pack_txyxys_sub(
        x_ints, y_ints, subexp=exp
    )
    ds = import_spc(_write(tmp_path, "txy0.spc", raw))
    assert_allclose(ds.time, [1.0, 2.0, 3.0])
    assert_allclose(ds.values[:, 0], np.array(y_ints, dtype=float) * 2.0 ** (exp - 32))


def test_txyxys_identical_x_stacks_columns(tmp_path: Path) -> None:
    """Subfiles repeating one x grid stack losslessly as columns."""
    exp = 8
    x_ints = [1 << 24, 2 << 24]
    sub_a = _pack_txyxys_sub(x_ints, [10, 20], subexp=exp)
    sub_b = _pack_txyxys_sub(x_ints, [30, 40], subexp=exp)
    raw = _pack_head(ftflgs=_TXY | _TMULTI, fnpts=0, fnsub=2, fexp=exp) + sub_a + sub_b
    ds = import_spc(_write(tmp_path, "txy_same.spc", raw))
    assert ds.n_channels == 2
    assert_allclose(ds.time, [1.0, 2.0])
    assert_allclose(ds.values[:, 1], np.array([30, 40], dtype=float) * 2.0 ** (exp - 32))


def test_txyxys_differing_x_long_form_keeps_every_point(tmp_path: Path) -> None:
    """Differing per-subfile x (e.g. per-scan m/z) concatenates to long form
    with a Subfile index column — NEVER silently drops subfiles 1..N (the
    old behaviour returned subfile 0 only, no error)."""
    exp = 8
    sub_a = _pack_txyxys_sub([1 << 24, 2 << 24], [10, 20], subexp=exp)
    sub_b = _pack_txyxys_sub([5 << 24, 6 << 24, 7 << 24], [30, 40, 50], subexp=exp)
    raw = _pack_head(ftflgs=_TXY | _TMULTI, fnpts=0, fnsub=2, fexp=exp) + sub_a + sub_b
    ds = import_spc(_write(tmp_path, "txy_diff.spc", raw))
    assert len(ds.time) == 5  # 2 + 3: every point survives
    assert_allclose(ds.time, [1.0, 2.0, 5.0, 6.0, 7.0])
    assert ds.labels[1] == "Subfile"
    assert_allclose(ds.values[:, 1], [1, 1, 2, 2, 2])
    assert ds.metadata["txyxys_long_form"] is True
    assert ds.metadata["subfile_points"] == [2, 3]


def test_txyxys_data_may_not_overrun_directory(tmp_path: Path) -> None:
    """When fnpts is a directory offset, a subfile whose declared size would
    run into the directory raises loudly instead of reading it as data."""
    exp = 8
    sub = _pack_txyxys_sub([1 << 24], [10], subexp=exp)
    dir_off = 512 + len(sub)
    # Claim a second subfile but place the directory right after the first —
    # subfile 1 has nowhere to live.
    raw = (
        _pack_head(ftflgs=_TXY, fnpts=dir_off, fnsub=2, fexp=exp)
        + sub
        + struct.pack("<IIf", 512, len(sub), 0.0)
    )
    with pytest.raises(ValueError, match="subfile directory"):
        import_spc(_write(tmp_path, "txy_overrun.spc", raw))


def test_txyxys_zero_subnpts_raises(tmp_path: Path) -> None:
    raw = _pack_head(ftflgs=_TXY, fnpts=0, fnsub=1) + _pack_sub(subnpts=0)
    with pytest.raises(ValueError, match="declares no points"):
        import_spc(_write(tmp_path, "txy_nopts.spc", raw))


@pytest.mark.realdata
def test_real_txyxys_single_subfile_reads_128_points(corpus_dir: Path) -> None:
    """rohanisaac_ms_xyxys.spc: fnpts=0 (legal), subnpts=128 — the upstream
    ``spc`` library reads 128 points; rejecting it as 'empty' was the bug."""
    ds = import_spc(corpus_dir / "spc" / "spectroscopy" / "rohanisaac_ms_xyxys.spc")
    assert len(ds.time) == 128
    assert ds.n_channels == 1


@pytest.mark.realdata
def test_real_txyxys_multifile_loses_nothing(corpus_dir: Path) -> None:
    """rohanisaac_m_xyxy.spc: 512 scans, per-scan m/z. The old reader
    returned subfile 0 only — shape (8, 1), no error, >99% of the file
    silently gone. Oracle: the file's own trailing directory (one 12-byte
    SSFSTC entry per subfile) — entries 1..511 each match the sequential
    subfile boundaries byte-for-byte (posn == computed start, size ==
    32 + 6·subnpts for int32 x + int16 y), and every subheader's subindx
    runs 0..511 contiguously with strictly increasing subtime, so the
    sequential read is exact. Entry 0 alone is anomalous: it points at a
    96-byte tail block just before the directory that is a REWRITTEN COPY
    of subfile 0 (same subindx=0, same subtime, same 8 points, stored at
    8 bytes/point) — a GRAMS update-in-place artifact, excluded from the
    arithmetic below. Scans have VARIABLE length (3..53 pts; the
    MANIFEST's '512 × 8 pts' was shorthand from that copy of subfile 0)."""
    path = corpus_dir / "spc" / "spectroscopy" / "rohanisaac_m_xyxy.spc"
    raw = path.read_bytes()
    dir_off = struct.unpack_from("<I", raw, 4)[0]  # TXYXYS: fnpts = dir offset
    n_sub = struct.unpack_from("<I", raw, 24)[0]
    sub0_pts = struct.unpack_from("<I", raw, 512 + 16)[0]  # subnpts of subfile 0
    sizes = [struct.unpack_from("<IIf", raw, dir_off + 12 * k)[1] for k in range(1, n_sub)]
    expected_total = sub0_pts + sum((size - 32) // 6 for size in sizes)

    ds = import_spc(path)
    assert ds.metadata["n_subfiles"] == n_sub == 512
    assert ds.metadata["txyxys_long_form"] is True
    assert len(ds.time) == expected_total == 4344
    assert sum(ds.metadata["subfile_points"]) == expected_total
    assert min(ds.metadata["subfile_points"]) == 3
    assert max(ds.metadata["subfile_points"]) == 53
    # Subfile column spans every scan — nothing was dropped.
    assert ds.values[:, 1].min() == 1.0
    assert ds.values[:, 1].max() == float(n_sub)


# ── Old (pre-1996) format, fversn=0x4D — implemented 2026-07-25 when the
# corpus gained its first two real specimens. 224-byte header (int16 exp,
# FLOAT32 npts/first/last), first subheader embedded at 224, y as 32-bit
# fixed point in word-swapped order (most significant 16-bit word first —
# settled empirically: msw-first decodes both specimens to smooth spectra,
# lsw-first to full-range noise). ─────────────────────────────────────────
_OLD_HEAD_FMT = "<BBhfffBBHBBBB8sHH7f130s30s"
assert struct.calcsize(_OLD_HEAD_FMT) == 224


def _pack_old_head(
    *, oftflgs: int = 0, oexp: int = 0, onpts: float = 0.0,
    ofirst: float = 0.0, olast: float = 0.0, oxtype: int = 1, oytype: int = 4,
) -> bytes:
    return struct.pack(
        _OLD_HEAD_FMT, oftflgs, 0x4D, oexp, onpts, ofirst, olast, oxtype,
        oytype, 0, 0, 0, 0, 0, b"", 0, 0,
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, b"", b"",
    )


def _old_y_words(y_ints: list[int]) -> bytes:
    """Encode int32 y values as (msw, lsw) little-endian int16 pairs."""
    out = b""
    for v in y_ints:
        out += struct.pack("<hH", (v >> 16) & 0xFFFF if v >= 0 else (v >> 16), v & 0xFFFF)
    return out


def test_old_format_single_subfile(tmp_path: Path) -> None:
    exp = 8
    y_ints = [100, -50, 1 << 20]
    raw = (
        _pack_old_head(oexp=exp, onpts=3.0, ofirst=100.0, olast=102.0)
        + _pack_sub(subexp=exp)
        + _old_y_words(y_ints)
    )
    ds = import_spc(_write(tmp_path, "old.spc", raw))
    assert_allclose(ds.time, [100.0, 101.0, 102.0])
    assert_allclose(ds.values[:, 0], np.array(y_ints, dtype=float) * 2.0 ** (exp - 32))
    assert ds.metadata["spc_format"] == "old (fversn=0x4D)"


def test_old_format_multifile_per_subfile_exponent(tmp_path: Path) -> None:
    y_a, y_b = [1 << 16, 2 << 16], [3 << 16, 4 << 16]
    raw = (
        _pack_old_head(oftflgs=_TMULTI, oexp=4, onpts=2.0, ofirst=0.0, olast=1.0)
        + _pack_sub(subexp=4) + _old_y_words(y_a)
        + _pack_sub(subexp=6) + _old_y_words(y_b)
    )
    ds = import_spc(_write(tmp_path, "old_multi.spc", raw))
    assert ds.n_channels == 2
    assert_allclose(ds.values[:, 0], np.array(y_a, dtype=float) * 2.0 ** (4 - 32))
    assert_allclose(ds.values[:, 1], np.array(y_b, dtype=float) * 2.0 ** (6 - 32))


def test_old_format_size_mismatch_raises(tmp_path: Path) -> None:
    raw = _pack_old_head(onpts=5.0) + _pack_sub() + b"\x00" * 7  # not 5 points
    with pytest.raises(ValueError, match="size mismatch"):
        import_spc(_write(tmp_path, "old_bad.spc", raw))


@pytest.mark.realdata
def test_real_old_format_raman(corpus_dir: Path) -> None:
    """rohanisaac_old_0x4D_doerner.spc: 1602-pt Raman spectrum, 100..1800
    Raman shift. Word-order evidence: msw-first gives a smooth spectrum
    (total variation ~15x the range); lsw-first gives ~535x (noise)."""
    ds = import_spc(corpus_dir / "spc" / "spectroscopy" / "rohanisaac_old_0x4D_doerner.spc")
    assert len(ds.time) == 1602
    assert_allclose(ds.time[0], 100.0)
    assert_allclose(ds.time[-1], 1800.0)
    assert ds.metadata["x_column_name"] == "Raman Shift (cm-1)"
    y = ds.values[:, 0]
    assert np.abs(np.diff(y)).sum() / (y.max() - y.min()) < 30  # smooth, not noise
    assert ds.metadata["date"]["year"] == 2013


@pytest.mark.realdata
def test_real_old_format_ftir_multifile(corpus_dir: Path) -> None:
    """rohanisaac_old_0x4D_m_ordz.spc: 10 subfiles x 857 pts, wavenumber x
    absorbance, per-subfile exponents 3..6. The sequential walk ends exactly
    at EOF, which pins the embedded-first-subheader layout."""
    ds = import_spc(corpus_dir / "spc" / "spectroscopy" / "rohanisaac_old_0x4D_m_ordz.spc")
    assert ds.n_channels == 10
    assert len(ds.time) == 857
    assert ds.metadata["x_column_name"] == "Wavenumber (cm-1)"
    assert ds.labels[0].startswith("Absorbance")
    for k in range(10):  # every channel decodes to smooth absorbance-scale data
        y = ds.values[:, k]
        assert np.abs(y).max() < 20
        assert np.abs(np.diff(y)).sum() / (np.ptp(y) + 1e-12) < 10


# ── .spc is ambiguous in the wild: GRAMS/Thermo vs EDAX EDS (2026-08-01) ────
# The registry routes .spc through the is_spc sniffer, so an EDAX EDS
# spectrum (a different vendor format sharing the extension; fermiviewer's
# io/spc_edax.py owns it) is DECLINED at resolve time with the registry's
# clear no-parser error, never crashed into as a malformed GRAMS header.


def test_edax_shaped_spc_is_declined_not_crashed(tmp_path: Path) -> None:
    """Byte 1 = 0x33 (the common EDAX fVersion pattern) must not route."""
    path = _write(tmp_path, "edax_like.spc", bytes([0x00, 0x33]) + b"\x00" * 64)
    assert is_spc(path) is False
    with pytest.raises(ValueError, match="no parser registered"):
        resolve_parser(path)


@pytest.mark.realdata
def test_real_edax_spc_corpus_is_declined(corpus_dir: Path) -> None:
    """Every EDAX .spc in the shared corpus is declined by the registry —
    the realdata anchor for the synthetic shape above. These files are
    fermiviewer's parser territory (EM scope); quantized must neither crash
    on them nor misparse them as GRAMS."""
    edax_spc = sorted((corpus_dir / "edax").rglob("*.spc"))
    assert edax_spc, "corpus moved: no EDAX .spc files under test-data/edax"
    for path in edax_spc:
        assert is_spc(path) is False, f"{path.name}: EDAX file passed the GRAMS sniffer"
        with pytest.raises(ValueError, match="no parser registered"):
            resolve_parser(path)
