"""Single parser registry: extension map + content sniffers for ambiguous types.

One place to register a parser (no MATLAB-style dual registration). Ambiguous
extensions (``.dat``) resolve by sniffing file content.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from quantized.datastruct import DataStruct
from quantized.io.ncnr import import_ncnr_dat, import_ncnr_pnr, import_ncnr_refl
from quantized.io.qd import import_ppms, import_qd_vsm, is_ppms_dat, is_qd_file
from quantized.io.refl1d import import_refl1d_dat, is_refl1d_dat
from quantized.io.xrdml import import_xrdml

__all__ = ["import_auto", "resolve_parser"]

Parser = Callable[[Path], DataStruct]
Sniffer = Callable[[Path], bool]

# Unambiguous extensions map directly (grows as parsers land).
# NOTE: resolve_parser lowercases the suffix, so .datA -> '.data', etc.
_EXT_MAP: dict[str, Parser] = {
    ".xrdml": import_xrdml,
    ".refl": import_ncnr_refl,
    ".pnr": import_ncnr_pnr,
    ".data": import_ncnr_dat,  # .datA
    ".datb": import_ncnr_dat,  # .datB
    ".datc": import_ncnr_dat,  # .datC
    ".datd": import_ncnr_dat,  # .datD
}

# Ambiguous extensions resolve by content sniffing — first match wins.
_SNIFFERS: dict[str, list[tuple[Sniffer, Parser]]] = {
    ".dat": [
        (is_qd_file, import_qd_vsm),
        (is_refl1d_dat, import_refl1d_dat),
        (is_ppms_dat, import_ppms),
    ],
}


def resolve_parser(path: Path) -> Parser:
    """Pick the parser for ``path`` by extension, then by content sniffing."""
    ext = path.suffix.lower()
    if ext in _EXT_MAP:
        return _EXT_MAP[ext]
    for sniff, parser in _SNIFFERS.get(ext, []):
        if sniff(path):
            return parser
    raise ValueError(f"no parser registered for '{path.name}' (extension '{ext}')")


def import_auto(path: str | Path) -> DataStruct:
    """Auto-detect format and import ``path`` into a DataStruct."""
    resolved = Path(path)
    return resolve_parser(resolved)(resolved)
