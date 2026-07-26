"""GRAMS/Thermo Scientific ``.spc`` spectral binary parser.

**NOT a MATLAB port.** ``quantized_matlab`` never implemented
``importSPC.m`` — the roadmap explicitly parks it "Paused (awaiting example
files)" (``quantized_matlab/plans/archive/parser-roadmap.md`` item 4;
``PORT_CHECKLIST.md`` line 46) and no source or test exists to freeze golden
values from. This is an independent implementation against the published
Galactic Industries "SPC" binary layout (the field names below — ``ftflgs``,
``fnpts``, ``fexp``, ... — are the format's own defined struct fields,
reproduced from the widely-republished ``SPC.H`` header spec, not copied
from any single implementation's source code). Cross-validated against four
real-world instrument files (Horiba Raman, Perkin-Elmer FTIR, a Kr
calibration-lamp spectrum, and a Nicolet FTIR/Raman scan) during development
— see the parser test file for the offset-by-offset sanity checks that
matched every one of those independently-produced binary files.

Only the modern "new format, LSB-first" sub-version (``fversn == 0x4B``) is
implemented — the sub-version every real sample file used, and the one
every actively-maintained OPUS/SPC reader targets. The old pre-1996 format
(``0x4D``), the rare new-format MSB variant (``0x4C``), and the
Shimadzu-specific variant (``0xCF``) are recognized but rejected with a
clear error rather than guessed at (no example file / spec text was
available to validate them against).

Binary layout (new format, 512-byte main header)
--------------------------------------------------
Bytes  0        ftflgs   (flags, see ``_FLAG_BITS``)
Bytes  1        fversn   (0x4B for this parser)
Bytes  2        fexper   (experiment-type code, see ``_EXPERIMENT_TYPES``)
Bytes  3        fexp     (signed; y-scaling exponent, or -128 = IEEE float32 y)
Bytes  4-7      fnpts    (points per subfile, uint32 — EXCEPT when the
                ``txyxys`` flag is set: each subfile then carries its own
                point count in ``subnpts``, and ``fnpts`` is instead the
                byte offset of the trailing subfile DIRECTORY (SSFSTC
                entries), or 0 for none. Verified against a real 512-scan
                TXYXYS mass-spec file whose "fnpts" is exactly the offset
                of a 512×12-byte table ending at EOF.)
Bytes  8-15     ffirst   (first x value, float64)
Bytes 16-23     flast    (last x value, float64)
Bytes 24-27     fnsub    (number of subfiles, uint32)
Bytes 28-31     fxtype, fytype, fztype, fpost  (axis unit codes)
Bytes 32-35     fdate    (packed year<<20|month<<16|day<<11|hour<<6|minute)
Bytes 36-44     fres     (resolution description, 9 bytes text)
Bytes 45-53     fsource  (source instrument, 9 bytes text)
Bytes 54-247    fpeakpt, fspare, fcmnt, fcatxt (comment / custom axis labels)
Bytes 248-251   flogoff  (byte offset of the trailer log block; 0 = none)
Bytes 252-511   fmods, fprocs, flevel, fsampin, ffactor, fmethod, fzinc,
                fwplanes, fwinc, fwtype, freserv (processing/4-D metadata)

Each subfile is a 32-byte subheader followed by its y data (and, when the
``txyxys`` flag is set, its own x data first). See ``_SUBHEAD_FMT``.
"""

from __future__ import annotations

import struct
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = ["import_spc", "is_spc"]

# ── Binary layout constants ──────────────────────────────────────────────
_HEAD_SIZE = 512
_SUBHEAD_SIZE = 32
_LOG_HEAD_SIZE = 64
_FLOAT_EXP_SENTINEL = -128  # fexp/subexp value meaning "y is IEEE float32"

_HEAD_FMT = "<BBBbIddIBBBBI9s9sh32s130s30sIIBBhf48sfIfB187s"
_HEAD_FIELDS = (
    "ftflgs", "fversn", "fexper", "fexp", "fnpts", "ffirst", "flast", "fnsub",
    "fxtype", "fytype", "fztype", "fpost", "fdate", "fres", "fsource",
    "fpeakpt", "fspare", "fcmnt", "fcatxt", "flogoff", "fmods", "fprocs",
    "flevel", "fsampin", "ffactor", "fmethod", "fzinc", "fwplanes", "fwinc",
    "fwtype", "freserv",
)
assert struct.calcsize(_HEAD_FMT) == _HEAD_SIZE

_SUBHEAD_FMT = "<BbhfffIIf4s"
_SUBHEAD_FIELDS = (
    "subflgs", "subexp", "subindx", "subtime", "subnext", "subnois",
    "subnpts", "subscan", "subwlevel", "subresv",
)
assert struct.calcsize(_SUBHEAD_FMT) == _SUBHEAD_SIZE

_LOG_FMT = "<IIIII44s"
assert struct.calcsize(_LOG_FMT) == _LOG_HEAD_SIZE

# ftflgs bit -> name (LSB first; matches the SPC spec's TSPREC..TXVALS bits)
_FLAG_BITS = ("tsprec", "tcgram", "tmulti", "trandm", "tordrd", "talabs", "txyxys", "txvals")

_UNSUPPORTED_FVERSN = {
    0x4C: "new-format MSB-first",
    0x4D: "old format (pre-1996)",
    0xCF: "Shimadzu-specific variant",
}

# X/Z axis unit codes (fxtype/fztype) — the SPC spec's defined enumeration.
_XZ_UNITS = (
    "Arbitrary", "Wavenumber (cm-1)", "Micrometers (um)", "Nanometers (nm)",
    "Seconds", "Minutes", "Hertz (Hz)", "Kilohertz (KHz)", "Megahertz (MHz)",
    "Mass (M/z)", "Parts per million (PPM)", "Days", "Years",
    "Raman Shift (cm-1)", "eV", "XYZ text labels in fcatxt", "Diode Number",
    "Channel", "Degrees", "Temperature (F)", "Temperature (C)",
    "Temperature (K)", "Data Points", "Milliseconds (mSec)",
    "Microseconds (uSec)", "Nanoseconds (nSec)", "Gigahertz (GHz)",
    "Centimeters (cm)", "Meters (m)", "Millimeters (mm)", "Hours",
)
# Y axis unit codes (fytype): 0-26 direct table, 128-131 a second table.
_Y_UNITS = (
    "Arbitrary Intensity", "Interferogram", "Absorbance", "Kubelka-Munk",
    "Counts", "Volts", "Degrees", "Milliamps", "Millimeters", "Millivolts",
    "Log(1/R)", "Percent", "Intensity", "Relative Intensity", "Energy", "",
    "Decibel", "", "", "Temperature (F)", "Temperature (C)",
    "Temperature (K)", "Index of Refraction [N]", "Extinction Coeff. [K]",
    "Real", "Imaginary", "Complex",
)
_Y_UNITS_ALT = ("Transmission", "Reflectance", "Arbitrary or Single Beam", "Emission")

_EXPERIMENT_TYPES = (
    "General SPC", "Gas Chromatogram", "General Chromatogram",
    "HPLC Chromatogram", "FT-IR, FT-NIR, FT-Raman Spectrum or Igram",
    "NIR Spectrum", "UV-VIS Spectrum", "X-ray Diffraction Spectrum",
    "Mass Spectrum", "NMR Spectrum or FID", "Raman Spectrum",
    "Fluorescence Spectrum", "Atomic Spectrum", "Chromatography Diode Array Spectra",
)


def _axis_label(code: int) -> str:
    return _XZ_UNITS[code] if 0 <= code < len(_XZ_UNITS) else "Unknown"


def _y_label(code: int) -> str:
    if 0 <= code < len(_Y_UNITS):
        return _Y_UNITS[code] or "Arbitrary Intensity"
    if 128 <= code < 128 + len(_Y_UNITS_ALT):
        return _Y_UNITS_ALT[code - 128]
    return "Unknown"


def is_spc(path: str | Path) -> bool:
    """Sniff a file as SPC via the ``fversn`` byte (0x4B/0x4C/0x4D/0xCF)."""
    try:
        with Path(path).open("rb") as fh:
            head = fh.read(2)
    except OSError:
        return False
    return len(head) == 2 and head[1] in (0x4B, 0x4C, 0x4D, 0xCF)


def _decode_flags(ftflgs: int) -> dict[str, bool]:
    return {name: bool(ftflgs & (1 << bit)) for bit, name in enumerate(_FLAG_BITS)}


def _decode_date(fdate: int) -> dict[str, int] | None:
    if fdate == 0:
        return None
    return {
        "year": fdate >> 20,
        "month": (fdate >> 16) % 16,
        "day": (fdate >> 11) % 32,
        "hour": (fdate >> 6) % 32,
        "minute": fdate % 64,
    }


def _null_str(raw: bytes) -> str:
    return raw.split(b"\x00", 1)[0].decode("latin-1", errors="replace").strip()


def _parse_log_block(raw: bytes, flogoff: int) -> dict[str, Any] | None:
    """Trailer log block: a small binary header, then '\\n'-joined text lines,
    each either a ``KEY=value`` pair or free text."""
    if flogoff <= 0 or flogoff + _LOG_HEAD_SIZE > len(raw):
        return None
    logsizd, _logsizm, logtxto, _logbins, _logdsks, _logspar = struct.unpack_from(
        _LOG_FMT, raw, flogoff
    )
    log_pos = flogoff + logtxto
    log_end = log_pos + logsizd
    if log_pos < 0 or log_end > len(raw) or log_end < log_pos:
        return None
    lines = raw[log_pos:log_end].replace(b"\r", b"").split(b"\n")
    pairs: dict[str, str] = {}
    other: list[str] = []
    for raw_line in lines:
        text = raw_line.decode("latin-1", errors="replace")
        if "=" in text:
            key, _, value = text.partition("=")
            pairs[key.strip()] = value.strip()
        elif text.strip():
            other.append(text.strip())
    return {"fields": pairs, "text": other}


def _y_from_ints(raw_ints: NDArray[np.integer[Any]], exp: int, bits: int) -> NDArray[np.float64]:
    return np.asarray(raw_ints, dtype=float) * (2.0 ** (exp - bits))


def _read_subfile(
    raw: bytes,
    pos: int,
    *,
    index: int,
    end: int,
    fnpts: int,
    fexp: int,
    tmulti: bool,
    tsprec: bool,
    txyxys: bool,
) -> tuple[NDArray[np.float64] | None, NDArray[np.float64], int, dict[str, Any]]:
    """Returns (own_x or None, y, bytes_consumed, subheader_info).

    ``end`` is the last byte this subfile may occupy (start of the TXYXYS
    directory when one exists, else EOF) — overruns raise instead of letting
    ``frombuffer`` fail cryptically or, worse, read the directory as data.
    """
    if pos + _SUBHEAD_SIZE > end:
        raise ValueError(
            f"truncated SPC file: subfile {index} header would run past "
            f"{'the subfile directory' if end != len(raw) else 'end of file'}"
        )
    sub = dict(zip(_SUBHEAD_FIELDS, struct.unpack_from(_SUBHEAD_FMT, raw, pos), strict=True))
    exp = int(sub["subexp"]) if tmulti else fexp
    if txyxys:
        # Per-subfile point count is authoritative; the header fnpts is the
        # directory offset in this mode and must never be used as a count.
        pts = int(sub["subnpts"])
        if pts <= 0:
            raise ValueError(f"TXYXYS subfile {index} declares no points (subnpts={pts})")
    else:
        pts = fnpts
    cursor = pos + _SUBHEAD_SIZE
    x_bytes = 4 * pts if txyxys else 0
    y_bytes = 4 * pts if (exp == _FLOAT_EXP_SENTINEL or not tsprec) else 2 * pts
    if cursor + x_bytes + y_bytes > end:
        raise ValueError(
            f"truncated SPC file: subfile {index} data ({pts} pts) would run past "
            f"{'the subfile directory' if end != len(raw) else 'end of file'}"
        )

    own_x = None
    if txyxys:
        # Per-subfile x is fixed-point scaled int32 (same exponent formula as y).
        x_ints = np.frombuffer(raw, dtype="<i4", count=pts, offset=cursor)
        own_x = _y_from_ints(x_ints, exp, 32)
        cursor += 4 * pts

    if exp == _FLOAT_EXP_SENTINEL:
        y = np.frombuffer(raw, dtype="<f4", count=pts, offset=cursor).astype(float)
        cursor += 4 * pts
    elif tsprec:
        y_ints = np.frombuffer(raw, dtype="<i2", count=pts, offset=cursor)
        y = _y_from_ints(y_ints, exp, 16)
        cursor += 2 * pts
    else:
        y_ints = np.frombuffer(raw, dtype="<i4", count=pts, offset=cursor)
        y = _y_from_ints(y_ints, exp, 32)
        cursor += 4 * pts

    return own_x, y, cursor - pos, sub


def import_spc(filepath: str | Path) -> DataStruct:
    """Import a GRAMS/Thermo ``.spc`` spectral file into a DataStruct."""
    path = Path(filepath)
    raw = path.read_bytes()
    if len(raw) < 2:
        raise ValueError(f"file too small to be an SPC file: {path.name}")
    fversn = raw[1]
    if fversn in _UNSUPPORTED_FVERSN:
        raise ValueError(
            f"SPC sub-format '{_UNSUPPORTED_FVERSN[fversn]}' (fversn=0x{fversn:02x}) is "
            f"recognized but not implemented: {path.name}. "
            f"Only the modern format (fversn=0x4B) is supported."
        )
    if fversn != 0x4B or len(raw) < _HEAD_SIZE:
        raise ValueError(f"not a recognized SPC file (fversn byte 0x{fversn:02x}): {path.name}")

    head = dict(zip(_HEAD_FIELDS, struct.unpack_from(_HEAD_FMT, raw, 0), strict=True))
    flags = _decode_flags(head["ftflgs"])
    fnpts, fnsub, fexp = int(head["fnpts"]), int(head["fnsub"]), int(head["fexp"])
    if fnsub <= 0:
        raise ValueError(f"empty SPC file (fnsub={fnsub}): {path.name}")
    if fnpts <= 0 and not flags["txyxys"]:
        # In TXYXYS mode fnpts is the directory offset (0 = no directory) and
        # each subfile carries its own count — 0 is legal there.
        raise ValueError(f"empty SPC file (fnpts={fnpts}, fnsub={fnsub}): {path.name}")

    pos = _HEAD_SIZE
    # Subfile data may not run into the trailing subfile directory (TXYXYS,
    # fnpts as offset) or the trailer log block, whichever comes first.
    end = len(raw)
    if flags["txyxys"] and 0 < fnpts <= len(raw):
        end = fnpts
    flogoff = int(head["flogoff"])
    if 0 < flogoff < end:
        end = flogoff
    global_x: NDArray[np.float64] | None = None
    if flags["txvals"] and not flags["txyxys"]:
        global_x = np.frombuffer(raw, dtype="<f4", count=fnpts, offset=pos).astype(float)
        pos += 4 * fnpts
    elif not flags["txyxys"]:
        global_x = np.linspace(head["ffirst"], head["flast"], fnpts)

    subfiles: list[tuple[NDArray[np.float64] | None, NDArray[np.float64], dict[str, Any]]] = []
    for index in range(fnsub):
        own_x, y, consumed, sub_info = _read_subfile(
            raw, pos, index=index, end=end, fnpts=fnpts, fexp=fexp,
            tmulti=flags["tmulti"], tsprec=flags["tsprec"], txyxys=flags["txyxys"],
        )
        subfiles.append((own_x, y, sub_info))
        pos += consumed

    x_label = _axis_label(head["fxtype"])
    y_label = _y_label(head["fytype"])
    if flags["talabs"]:
        parts = head["fcatxt"].split(b"\x00")
        if len(parts) >= 2:
            xl, yl = _null_str(parts[0]), _null_str(parts[1])
            x_label = xl or x_label
            y_label = yl or y_label

    multi_x = flags["txyxys"] and fnsub > 1
    long_form = False
    x: NDArray[np.float64] | None
    if multi_x:
        first_x = subfiles[0][0]
        assert first_x is not None
        if all(
            own_x is not None
            and own_x.shape == first_x.shape
            and bool(np.array_equal(own_x, first_x))
            for own_x, _y, _info in subfiles
        ):
            # Every subfile repeats the same x grid — a shared-x stack loses
            # nothing (common for evenly-gridded TXYXYS map/series files).
            x = first_x
            y_cols = np.column_stack([y for _own_x, y, _info in subfiles])
            y_labels = [f"{y_label} {i + 1}" for i in range(fnsub)]
        else:
            # Genuinely different x per subfile (e.g. per-scan m/z lists).
            # One DataStruct time column can't hold 512 grids, but returning
            # ONLY subfile 0 — the old behaviour — silently discarded >99% of
            # a real mass-spec file with no error. Long form keeps every
            # point: concatenated x/y plus a subfile-index column so
            # downstream can split scans back apart.
            long_form = True
            x = np.concatenate([own_x for own_x, _y, _info in subfiles if own_x is not None])
            sub_index = [
                np.full(len(y), i + 1, dtype=float)
                for i, (_own_x, y, _info) in enumerate(subfiles)
            ]
            y_cols = np.column_stack(
                [
                    np.concatenate([y for _own_x, y, _info in subfiles]),
                    np.concatenate(sub_index),
                ]
            )
            y_labels = [y_label, "Subfile"]
    else:
        x = global_x if global_x is not None else subfiles[0][0]
        y_cols = np.column_stack([y for _own_x, y, _info in subfiles])
        y_labels = [y_label] if fnsub == 1 else [f"{y_label} {i + 1}" for i in range(fnsub)]
    assert x is not None

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_spc",
        "x_column_name": x_label,
        "x_column_unit": "",
        "experiment_type": (
            _EXPERIMENT_TYPES[head["fexper"]]
            if head["fexper"] < len(_EXPERIMENT_TYPES)
            else "Unknown"
        ),
        "comment": _null_str(head["fcmnt"]),
        "source_instrument": _null_str(head["fres"]) or _null_str(head["fsource"]),
        "date": _decode_date(head["fdate"]),
        "n_subfiles": fnsub,
        "flags": flags,
        "log": _parse_log_block(raw, int(head["flogoff"])),
    }
    if multi_x:
        metadata["multi_x_subfiles"] = True
        metadata["n_subfiles_with_own_x"] = fnsub
        metadata["txyxys_long_form"] = long_form
        if long_form:
            metadata["subfile_points"] = [len(y) for _own_x, y, _info in subfiles]
            metadata["subfile_times"] = [float(info["subtime"]) for _ox, _y, info in subfiles]

    return DataStruct.create(
        x, y_cols, labels=y_labels, units=[y_label] * len(y_labels), metadata=metadata
    )
