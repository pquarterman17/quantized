"""Single parser registry: extension map + content sniffers for ambiguous types.

One place to register a parser (no MATLAB-style dual registration). Ambiguous
extensions (``.dat``) resolve by sniffing file content.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from quantized.datastruct import DataStruct
from quantized.io.bruker_brml import import_bruker_brml
from quantized.io.bruker_raw import import_bruker_raw, is_bruker_raw
from quantized.io.delimited import import_csv
from quantized.io.excel import import_excel
from quantized.io.import_filters import match_filter
from quantized.io.import_preview import parse_import
from quantized.io.jcamp import import_jcamp
from quantized.io.ncnr import import_ncnr_dat, import_ncnr_pnr, import_ncnr_refl, is_ncnr_refl
from quantized.io.netcdf import import_netcdf
from quantized.io.opus import import_opus
from quantized.io.origin_project import read_origin_project
from quantized.io.qd import import_ppms, import_qd_vsm, is_ppms_dat, is_qd_file
from quantized.io.refl1d import import_refl1d_dat, is_refl1d_dat
from quantized.io.rigaku import import_rigaku_raw, is_rigaku_raw
from quantized.io.sims import import_sims, is_sims_file
from quantized.io.spc import import_spc
from quantized.io.xrdml import import_xrdml

__all__ = [
    "import_auto",
    "register_parser",
    "resolve_parser",
    "unregister_plugin_parsers",
]

Parser = Callable[[Path], DataStruct]
Sniffer = Callable[[Path], bool]

# Unambiguous extensions map directly (grows as parsers land).
# NOTE: resolve_parser lowercases the suffix, so .datA -> '.data', etc.
_EXT_MAP: dict[str, Parser] = {
    ".xrdml": import_xrdml,
    ".brml": import_bruker_brml,  # Bruker XRD (ZIP of XML); 1-D line scans
    ".jdx": import_jcamp,  # JCAMP-DX spectroscopy (IR/Raman/UV-Vis/...)
    ".dx": import_jcamp,
    ".nc": import_netcdf,  # NetCDF-3/4 (generic + ANDI/AIA chromatography)
    ".cdf": import_netcdf,  # ANDI/AIA chromatography (NetCDF-3 classic)
    ".pnr": import_ncnr_pnr,
    # Origin project files — clean-room reader (no GPL liborigin). Currently
    # recognizes + guides; the binary decoders land against sample files.
    ".opj": read_origin_project,  # Origin ≤2017 binary project
    ".opju": read_origin_project,  # Origin 2018+ Unicode project
    ".data": import_ncnr_dat,  # .datA
    ".datb": import_ncnr_dat,  # .datB
    ".datc": import_ncnr_dat,  # .datC
    ".datd": import_ncnr_dat,  # .datD
    # importSPC.m / importOxford.m / importOpus.m were never written in
    # quantized_matlab (PORT_CHECKLIST.md line 46 — "paused, awaiting example
    # files"); .spc and .opus below are independent implementations against
    # the published formats, not MATLAB ports (see each module's docstring).
    # importOxford stays unported: "format varies by software version" with
    # no spec and no example file — nothing to implement against honestly.
    ".spc": import_spc,  # GRAMS/Thermo spectral binary
    ".opus": import_opus,  # Bruker OPUS FTIR/NIR/Raman binary
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
    # .refl is reductus (JSON "columns" header) for the whole corpus, but refl1d
    # also exports .refl (a "Q (1/A) R dR" column header below # metadata): route
    # those to the refl1d parser. Catch-all stays reductus (the prior behaviour).
    ".refl": [
        (is_ncnr_refl, import_ncnr_refl),
        (is_refl1d_dat, import_refl1d_dat),
        (_accept_any, import_ncnr_refl),
    ],
    # .raw is either Rigaku SmartLab (magic "FI") or Bruker Diffrac-AT RAW1.01
    # (magic "RAW1.01"); the magic bytes disambiguate with no collision.
    ".raw": [(is_rigaku_raw, import_rigaku_raw), (is_bruker_raw, import_bruker_raw)],
    # SIMS depth profiles share .csv/.tsv/.xlsx with generic tables: sniff for the
    # SIMS layout first, else fall back to the generic delimited / Excel parser.
    ".csv": [(is_sims_file, import_sims), (_accept_any, import_csv)],
    ".tsv": [(is_sims_file, import_sims), (_accept_any, import_csv)],
    ".xlsx": [(is_sims_file, import_sims), (_accept_any, import_excel)],
    ".xlsm": [(is_sims_file, import_sims), (_accept_any, import_excel)],
}


def _import_via_saved_filter(path: Path) -> DataStruct:
    """Parse ``path`` under its best-matching saved import filter.

    See :mod:`quantized.io.import_filters` (gap #40): a user-saved
    ``ImportSettings`` bound to a filename glob, consulted by
    :func:`resolve_parser` before the content sniffers below.
    """
    filt = match_filter(path)
    if filt is None:  # pragma: no cover - resolve_parser only routes here on a match
        raise ValueError(f"no saved import filter matches '{path.name}'")
    return parse_import(path.read_text(encoding="latin-1"), filt.settings)


# ── Plugin registration (single-registration path; gap #8) ──────────────────
# Third-party plugins (see quantized.plugins) contribute parsers THROUGH this one
# function — the same ``_EXT_MAP`` / ``_SNIFFERS`` chokepoint the built-ins use
# above — so there is never a second dispatch path. Plugin registrations are
# tracked separately so an idempotent reload / test isolation can remove them
# WITHOUT ever touching a built-in entry.
_PLUGIN_EXTS: set[str] = set()
_PLUGIN_SNIFFERS: dict[str, list[tuple[Sniffer, Parser]]] = {}


def _normalize_ext(ext: str) -> str:
    lowered = ext.lower()
    return lowered if lowered.startswith(".") else f".{lowered}"


def register_parser(
    extensions: list[str], parser: Parser, *, sniff: Sniffer | None = None
) -> None:
    """Register a plugin ``parser`` for one or more file ``extensions``.

    Precedence discipline (identical to saved import filters): a plugin may claim
    a NOVEL extension, but must never SHADOW a built-in one.

    - ``sniff is None`` (unambiguous claim): the extension maps straight to
      ``parser``. Refused with ``ValueError`` when the extension is already known
      — a built-in ``_EXT_MAP`` entry *or* an ambiguous ``_SNIFFERS`` extension.
      This is the "a plugin cannot shadow ``.jdx``" rule.
    - ``sniff`` given (content sniff): ``(sniff, parser)`` is APPENDED to the
      extension's sniffer chain, so built-in sniffers keep precedence and a
      plugin sniffer can only ever act as a fallback.
    """
    for raw in extensions:
        ext = _normalize_ext(raw)
        if sniff is None:
            if ext in _EXT_MAP or ext in _SNIFFERS:
                raise ValueError(
                    f"extension '{ext}' is already claimed by a built-in parser "
                    "(plugins may not shadow built-in extensions)"
                )
            _EXT_MAP[ext] = parser
            _PLUGIN_EXTS.add(ext)
        else:
            _SNIFFERS.setdefault(ext, []).append((sniff, parser))
            _PLUGIN_SNIFFERS.setdefault(ext, []).append((sniff, parser))


def unregister_plugin_parsers() -> None:
    """Remove every plugin-registered parser, restoring the built-in registry.

    Used by :func:`quantized.plugins.load_plugins` for an idempotent reload and
    by tests for isolation; built-in ``_EXT_MAP`` / ``_SNIFFERS`` entries are
    never touched.
    """
    for ext in _PLUGIN_EXTS:
        _EXT_MAP.pop(ext, None)
    _PLUGIN_EXTS.clear()
    for ext, entries in _PLUGIN_SNIFFERS.items():
        chain = _SNIFFERS.get(ext)
        if chain is None:
            continue
        for entry in entries:
            if entry in chain:
                chain.remove(entry)
        if not chain:
            _SNIFFERS.pop(ext, None)
    _PLUGIN_SNIFFERS.clear()


def resolve_parser(path: Path) -> Parser:
    """Pick the parser for ``path``: unambiguous extension, else a saved
    import filter (gap #40 — a user-named glob -> ``ImportSettings``), else
    content sniffing."""
    ext = path.suffix.lower()
    if ext in _EXT_MAP:
        return _EXT_MAP[ext]
    if match_filter(path) is not None:
        return _import_via_saved_filter
    for sniff, parser in _SNIFFERS.get(ext, []):
        if sniff(path):
            return parser
    raise ValueError(f"no parser registered for '{path.name}' (extension '{ext}')")


def import_auto(path: str | Path) -> DataStruct:
    """Auto-detect format and import ``path`` into a DataStruct."""
    resolved = Path(path)
    return resolve_parser(resolved)(resolved)
