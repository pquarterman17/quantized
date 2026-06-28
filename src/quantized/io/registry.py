"""Single parser registry: extension map + content sniffers for ambiguous types.

One place to register a parser (no MATLAB-style dual registration). Ambiguous
extensions (``.dat``) resolve by sniffing file content.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from quantized.datastruct import DataStruct
from quantized.io.delimited import import_csv
from quantized.io.excel import import_excel
from quantized.io.ncnr import import_ncnr_dat, import_ncnr_pnr, import_ncnr_refl
from quantized.io.qd import import_ppms, import_qd_vsm, is_ppms_dat, is_qd_file
from quantized.io.refl1d import import_refl1d_dat, is_refl1d_dat
from quantized.io.rigaku import import_rigaku_raw, is_rigaku_raw
from quantized.io.sims import import_sims, is_sims_file
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


def _accept_any(_path: Path) -> bool:
    """Catch-all sniffer: routes to the generic fallback parser for an extension."""
    return True


# Ambiguous extensions resolve by content sniffing — first match wins.
_SNIFFERS: dict[str, list[tuple[Sniffer, Parser]]] = {
    ".dat": [
        (is_qd_file, import_qd_vsm),
        (is_refl1d_dat, import_refl1d_dat),
        (is_ppms_dat, import_ppms),
    ],
    # .raw is Rigaku here (magic "FI"); Bruker .raw -> fermiviewer (out of scope).
    ".raw": [(is_rigaku_raw, import_rigaku_raw)],
    # SIMS depth profiles share .csv/.tsv/.xlsx with generic tables: sniff for the
    # SIMS layout first, else fall back to the generic delimited / Excel parser.
    ".csv": [(is_sims_file, import_sims), (_accept_any, import_csv)],
    ".tsv": [(is_sims_file, import_sims), (_accept_any, import_csv)],
    ".xlsx": [(is_sims_file, import_sims), (_accept_any, import_excel)],
    ".xlsm": [(is_sims_file, import_sims), (_accept_any, import_excel)],
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
