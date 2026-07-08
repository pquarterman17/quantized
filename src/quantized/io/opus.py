"""Bruker OPUS FTIR/NIR/Raman binary spectrum parser (``.opus``).

**NOT a MATLAB port.** ``quantized_matlab`` never implemented
``importOpus.m`` — the roadmap parks it "Paused (awaiting example files)"
(``quantized_matlab/plans/archive/parser-roadmap.md`` item 3;
``PORT_CHECKLIST.md`` line 46) and no source or test exists to freeze golden
values from. This is an independent implementation against Bruker's
block-directory OPUS layout. The block-type/channel-type dispatch table
below is the format's own fixed vocabulary (facts about the binary
protocol, not one implementation's expression of it) — cross-checked
against the open-source readers ``qedsoftware/brukeropusreader``
(LGPL-3.0) and ``Bjorn-G-S/UiO-IR-Reader`` for consistency; no code from
either was copied (both are GPL-family and incompatible with this
project's Apache-2.0 runtime regardless).

No real ``.opus`` sample file was available to validate against (unlike
``spc.py``, which was checked against four real instrument files) — this
parser is exercised with synthetic fixtures built directly from the layout
below. That is an honest gap, not a fabricated golden result.

Binary layout
-------------
Bytes 0-23    file header (magic/version bytes; not decoded here)
Bytes 24-503  up to 40 directory entries, 12 bytes each:
    byte 0        data_type     (block category)
    byte 1        channel_type  (sub-category: which channel/plane)
    byte 2        text_type     (further sub-category, text blocks only)
    byte 3        reserved
    bytes 4-7     chunk_size    (uint32 LE, in 4-byte WORDS)
    bytes 8-11    offset        (uint32 LE, absolute byte offset of the chunk)
A directory entry with ``offset <= 0`` terminates the directory early.

Each chunk is one of three kinds:
  - **text**   raw Latin-1 text (history, sample form, signature, ...)
  - **series** ``chunk_size`` little-endian float32 values (a spectrum)
  - **param**  a sequence of ``{3-byte name}{1 reserved}{type:u16}{size:u16}
    {value: 2*size bytes}`` records terminated by name ``"END"``; value
    type 0=int32, 1=float64, 2-4=null-terminated Latin-1 string.

The primary spectrum is chosen by priority: ``AB`` (final absorbance /
transmittance result) > ``ScSm`` (sample single-channel spectrum) > ``IgSm``
(sample interferogram) > ``PhSm`` > ``PwSm`` > any other series block found.
Its companion ``"<Name> Data Parameter"`` block supplies ``FXV``/``LXV``/
``NPT`` (the x-axis range) and ``DXU`` (the x-axis unit code).
"""

from __future__ import annotations

from pathlib import Path
from struct import calcsize, unpack_from
from struct import error as struct_error
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = ["import_opus", "is_opus"]

_HEADER_LEN = 504
_DIR_START = 24
_DIR_ENTRY_SIZE = 12

# (data_type, channel_type) -> block name. channel_type=None matches any
# (param/text blocks that don't distinguish by channel).
_SERIES_BLOCKS: dict[tuple[int, int], str] = {
    (7, 4): "ScSm", (7, 8): "IgSm", (7, 12): "PhSm", (7, 56): "PwSm",
    (11, 4): "ScRf", (11, 8): "IgRf", (11, 12): "PhRf", (11, 56): "PwRf",
}
_PARAM_CHANNEL_BLOCKS: dict[tuple[int, int], str] = {
    (23, 4): "ScSm Data Parameter", (23, 8): "IgSm Data Parameter",
    (23, 12): "PhSm Data Parameter", (23, 56): "PwSm Data Parameter",
    (27, 4): "ScRf Data Parameter", (27, 8): "IgRf Data Parameter",
    (27, 12): "PhRf Data Parameter", (27, 56): "PwRf Data Parameter",
}
_PARAM_BLOCKS: dict[int, str] = {
    31: "AB Data Parameter", 32: "Instrument", 40: "Instrument (Rf)",
    48: "Acquisition", 56: "Acquisition (Rf)", 64: "Fourier Transformation",
    72: "Fourier Transformation (Rf)", 96: "Optik", 104: "Optik (Rf)",
    160: "Sample",
}
_TEXT_BLOCKS: dict[int, str] = {
    8: "Info Block", 104: "History", 152: "Curve Fit", 168: "Signature",
    240: "Integration Method",
}
_AB_SERIES_TYPE = 15  # data_type for the final absorbance/transmittance block

_PRIMARY_PRIORITY = ("AB", "ScSm", "IgSm", "PhSm", "PwSm", "ScRf", "IgRf", "PhRf", "PwRf")

_DXU_UNITS = {
    "WN": "Wavenumber (cm-1)", "MI": "Minutes", "PNT": "Data Points", "WL": "Wavelength (nm)",
}


def _block_name(data_type: int, channel_type: int, text_type: int) -> tuple[str, str] | None:
    """Returns (name, kind) where kind is 'text'/'series'/'param', or None to skip."""
    if data_type == 0:
        return _TEXT_BLOCKS.get(text_type, "Text Information"), "text"
    if data_type == _AB_SERIES_TYPE:
        return "AB", "series"
    name = _SERIES_BLOCKS.get((data_type, channel_type))
    if name is not None:
        return name, "series"
    name = _PARAM_CHANNEL_BLOCKS.get((data_type, channel_type))
    if name is not None:
        return name, "param"
    name = _PARAM_BLOCKS.get(data_type)
    if name is not None:
        return name, "param"
    return None  # unknown block type: skip (matches every known OPUS reader's behaviour)


def _parse_directory(header: bytes, file_size: int) -> list[tuple[int, int, int, int, int]]:
    entries: list[tuple[int, int, int, int, int]] = []
    cursor = _DIR_START
    while cursor + _DIR_ENTRY_SIZE <= _HEADER_LEN:
        data_type, channel_type, text_type = header[cursor], header[cursor + 1], header[cursor + 2]
        chunk_size, offset = unpack_from("<II", header, cursor + 4)
        if offset <= 0:
            break
        entries.append((data_type, channel_type, text_type, chunk_size, offset))
        if offset + 4 * chunk_size >= file_size:
            break
        cursor += _DIR_ENTRY_SIZE
    return entries


def _parse_params(chunk: bytes) -> dict[str, Any]:
    params: dict[str, Any] = {}
    cursor = 0
    while cursor + 8 <= len(chunk):
        name = chunk[cursor : cursor + 3].decode("ascii", errors="replace")
        if name == "END":
            break
        type_index = unpack_from("<H", chunk, cursor + 4)[0]
        size_words = unpack_from("<H", chunk, cursor + 6)[0]
        value = chunk[cursor + 8 : cursor + 8 + 2 * size_words]
        try:
            if type_index == 0 and len(value) >= calcsize("<i"):
                params[name] = unpack_from("<i", value)[0]
            elif type_index == 1 and len(value) >= calcsize("<d"):
                params[name] = unpack_from("<d", value)[0]
            else:
                end = value.find(b"\x00")
                params[name] = value[: end if end >= 0 else len(value)].decode(
                    "latin-1", errors="replace"
                )
        except struct_error:
            break
        cursor += 8 + 2 * size_words
    return params


def _parse_series(chunk: bytes, chunk_size: int) -> NDArray[np.float64]:
    n = min(chunk_size, len(chunk) // 4)
    return np.frombuffer(chunk, dtype="<f4", count=n).astype(float)


def is_opus(path: str | Path) -> bool:
    """Sniff a file as OPUS: a well-formed block directory with >= 1 entry."""
    try:
        raw = Path(path).read_bytes()
    except OSError:
        return False
    if len(raw) < _HEADER_LEN:
        return False
    return len(_parse_directory(raw[:_HEADER_LEN], len(raw))) > 0


def import_opus(filepath: str | Path) -> DataStruct:
    """Import a Bruker OPUS binary spectrum into a DataStruct."""
    path = Path(filepath)
    raw = path.read_bytes()
    if len(raw) < _HEADER_LEN:
        raise ValueError(f"file too small to be an OPUS file: {path.name}")

    entries = _parse_directory(raw[:_HEADER_LEN], len(raw))
    if not entries:
        raise ValueError(f"no OPUS block directory found (not an OPUS file?): {path.name}")

    blocks: dict[str, Any] = {}
    for data_type, channel_type, text_type, chunk_size, offset in entries:
        resolved = _block_name(data_type, channel_type, text_type)
        if resolved is None:
            continue
        name, kind = resolved
        chunk = raw[offset : offset + 4 * chunk_size]
        if kind == "text":
            blocks[name] = chunk.decode("latin-1", errors="replace").strip("\x00").strip()
        elif kind == "series":
            blocks[name] = _parse_series(chunk, chunk_size)
        else:
            blocks[name] = _parse_params(chunk)

    primary = next(
        (n for n in _PRIMARY_PRIORITY if isinstance(blocks.get(n), np.ndarray)), None
    )
    if primary is None:
        primary = next((n for n, v in blocks.items() if isinstance(v, np.ndarray)), None)
    if primary is None:
        raise ValueError(
            f"no spectral data block (AB/ScSm/IgSm/...) found in OPUS file: {path.name}"
        )

    y = blocks[primary]
    params = blocks.get(f"{primary} Data Parameter", {})
    npt = len(y)
    fxv = float(params.get("FXV", 0.0))
    lxv = float(params.get("LXV", float(npt - 1)))
    x = np.linspace(fxv, lxv, npt) if npt > 1 else np.array([fxv])
    dxu = str(params.get("DXU", ""))

    y_label = "Absorbance" if primary == "AB" else "Intensity"
    param_blocks = {
        name: value for name, value in blocks.items() if isinstance(value, dict)
    }
    text_blocks = {
        name: value for name, value in blocks.items() if isinstance(value, str)
    }
    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_opus",
        "primary_block": primary,
        "x_column_name": _DXU_UNITS.get(dxu, dxu or "Wavenumber (cm-1)"),
        "x_column_unit": dxu,
        "blocks_found": sorted(blocks.keys()),
        "parameters": param_blocks,
        "text": text_blocks,
    }
    return DataStruct.create(x, y, labels=[y_label], units=[""], metadata=metadata)
