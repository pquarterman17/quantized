"""Technique tag contract (PLOT_WORKFLOW_PLAN item 1) -- the closed vocabulary
every parser's output is classified into, plus the ONE parser -> technique
mapping table.

Design constraint (owner-set): fix the class at one chokepoint, not N parser
edits. Parsers themselves stay ignorant of this module; :func:`stamp_technique`
is called exactly once, from the registry dispatch chokepoint
(``io/registry.py::import_auto``), which is the only place that knows *which*
parser actually ran. A parser that can refine the technique from content it
already inspected (the QD mvsh/mvst sweep-axis detection, the XRDML 2-D RSM
mesh flag) contributes a small pure function here instead of writing to
``metadata`` itself -- see ``_refine_qd_family`` / ``_refine_xrdml``.

Ambiguous/generic parsers (plain CSV/Excel, saved import filters, Origin
projects, NetCDF's non-chromatography fallback) map to :data:`GENERIC` --
never guessed.

Pure layer: no fastapi/pydantic/starlette imports (enforced by
test_repo_integrity).
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable

from quantized.datastruct import DataStruct

__all__ = [
    "GENERIC",
    "MAGNETOMETRY_MVSH",
    "MAGNETOMETRY_MVST",
    "REFLECTOMETRY",
    "SIMS",
    "SPECTROSCOPY",
    "TECHNIQUES",
    "TRANSPORT",
    "XRD_POWDER",
    "XRD_RSM",
    "resolve_technique",
    "stamp_technique",
]

# ── Closed vocabulary ────────────────────────────────────────────────────────
# Mirrored in the frontend at frontend/src/lib/types.ts (Technique union).
# Extend only when a parser clearly needs a new tag -- do not pre-add entries
# no parser produces yet.
MAGNETOMETRY_MVSH = "magnetometry.mvsh"  # M vs H (hysteresis loop)
MAGNETOMETRY_MVST = "magnetometry.mvst"  # M vs T (temperature sweep)
XRD_POWDER = "xrd.powder"  # 1-D line scan (2theta vs intensity)
XRD_RSM = "xrd.rsm"  # 2-D reciprocal-space / area-detector map
REFLECTOMETRY = "reflectometry"  # X-ray/neutron reflectometry (any polarization)
SIMS = "sims"  # secondary-ion mass spectrometry depth profile
TRANSPORT = "transport"  # resistivity / Hall / other electrical transport
SPECTROSCOPY = "spectroscopy"  # IR/Raman/UV-Vis/NMR/mass spectra
GENERIC = "generic"  # ambiguous or unclassified -- never guess

TECHNIQUES = frozenset(
    {
        MAGNETOMETRY_MVSH,
        MAGNETOMETRY_MVST,
        XRD_POWDER,
        XRD_RSM,
        REFLECTOMETRY,
        SIMS,
        TRANSPORT,
        SPECTROSCOPY,
        GENERIC,
    }
)

TechniqueRefiner = Callable[[DataStruct], str]


# ── Refiners: parsers whose technique depends on what they actually parsed ──
def _refine_qd_family(ds: DataStruct) -> str:
    """QD/PPMS/Lake Shore instruments are multi-purpose: the same [Header]/
    [Data] or plain-CSV shape can carry a VSM moment sweep OR a resistivity/
    transport measurement (see ``io/qd.py``'s PPMS resistance-vs-temperature
    degrade path, guarded by ``test_ppms_resistance_vs_temperature_no_field_
    column``). Check the measured channel first; only then classify the
    magnetometry sweep axis (mvsh vs mvst) the parser already resolved into
    ``metadata['x_column_name']`` (``io/qd.py:99`` ``_X_SWEEP_FALLBACKS`` /
    the Lake Shore default-x resolution) -- reading that resolved value keeps
    this refiner working uniformly across all three parsers without reaching
    into any parser's internals.
    """
    labels_lower = " ".join(ds.labels).lower()
    if any(marker in labels_lower for marker in ("resistance", "resistivity", "voltage")):
        return TRANSPORT
    x_name = str(ds.metadata.get("x_column_name", "")).lower()
    return MAGNETOMETRY_MVSH if "field" in x_name else MAGNETOMETRY_MVST


def _refine_xrdml(ds: DataStruct) -> str:
    """``xrd.rsm`` for a 2-D area-detector map (``metadata['is2D']``, set by
    every ``_build_2d*``/``_build_pole`` path in ``io/xrdml.py`` /
    ``io/_xrdml_scan.py``), else ``xrd.powder`` for the 1-D line-scan case."""
    return XRD_RSM if bool(ds.metadata.get("is2D")) else XRD_POWDER


# ── The one parser -> technique mapping table ───────────────────────────────
# Keyed by the parser's self-reported (or dispatched) `parser_name` -- see
# `stamp_technique`. A parser absent from both maps below is ambiguous /
# not yet classified and stamps GENERIC (the safe default, never a guess).
_STATIC_TECHNIQUE_BY_PARSER: dict[str, str] = {
    "import_bruker_brml": XRD_POWDER,  # 1-D line scans only (registry.py note)
    "import_bruker_raw": XRD_POWDER,
    "import_rigaku_raw": XRD_POWDER,
    "import_jcamp": SPECTROSCOPY,
    "import_spc": SPECTROSCOPY,
    "import_opus": SPECTROSCOPY,
    "import_sims": SIMS,
    "import_ncnr_refl": REFLECTOMETRY,
    "import_ncnr_pnr": REFLECTOMETRY,  # polarized neutron reflectometry
    "import_ncnr_dat": REFLECTOMETRY,  # refl1d-fit cross sections (.datA-D)
    "import_refl1d_dat": REFLECTOMETRY,
    "import_csv": GENERIC,
    "import_excel": GENERIC,
    # NetCDF already degrades to a generic heuristic for non-chromatography
    # content and chromatography has no vocabulary entry -- generic either way.
    "import_netcdf": GENERIC,
    "read_origin_project": GENERIC,  # multi-technique project container
    "import_preview": GENERIC,  # saved import filter / import-wizard path
}

_REFINED_TECHNIQUE_BY_PARSER: dict[str, TechniqueRefiner] = {
    "import_qd_vsm": _refine_qd_family,
    "import_ppms": _refine_qd_family,
    # import_mpms is not reachable via the registry today (no extension/sniffer
    # claims it -- it is called directly), but is kept here so a direct caller
    # that routes its result through `resolve_technique`/`stamp_technique`
    # gets the same classification as the parser it wraps.
    "import_mpms": _refine_qd_family,
    "import_lake_shore": _refine_qd_family,
    "import_xrdml": _refine_xrdml,
}


def resolve_technique(parser_name: str, ds: DataStruct) -> str:
    """The technique tag for a dataset that came from ``parser_name``."""
    refiner = _REFINED_TECHNIQUE_BY_PARSER.get(parser_name)
    if refiner is not None:
        return refiner(ds)
    return _STATIC_TECHNIQUE_BY_PARSER.get(parser_name, GENERIC)


def stamp_technique(ds: DataStruct, parser: Callable[..., DataStruct]) -> DataStruct:
    """Return ``ds`` with ``metadata['technique']`` + ``metadata['parser_name']``
    stamped -- the single chokepoint call made by ``io/registry.py::import_auto``.

    ``parser_name`` prefers what the parser itself already recorded (several
    parsers re-tag it, e.g. ``import_mpms`` delegating to ``import_qd_vsm``, or
    the saved-import-filter path recording ``"import_preview"`` though the
    dispatched callable is a wrapper) and falls back to the dispatched
    callable's own name only when the parser recorded none.
    """
    existing = ds.metadata.get("parser_name")
    parser_name = str(existing) if existing else getattr(parser, "__name__", GENERIC)
    metadata = dict(ds.metadata)
    metadata["parser_name"] = parser_name
    metadata["technique"] = resolve_technique(parser_name, ds)
    return dataclasses.replace(ds, metadata=metadata)
