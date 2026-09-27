"""Report emitter for SIMS region measures (audit P2.3, box 4).

Maps a ``calc.sims_region.region_measures`` result onto the #36 report schema
(``calc.report``), so the measures land in the workspace's Reports like a fit
or an integration does and export through the same HTML/LaTeX/Word/PowerPoint
renderers. No new math -- pure re-shaping, with the provenance (dataset,
region, the stated method, the threshold rule, every warning) carried as text
blocks beside the table.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from quantized.calc.report import ReportSheet, section, table_block, text_block

__all__ = ["from_sims_region"]


def from_sims_region(
    result: Mapping[str, Any],
    *,
    title: str = "SIMS region measures",
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from a ``calc.sims_region.region_measures`` result."""
    species = list(result.get("species", []))
    if not species:
        raise ValueError("from_sims_region needs a result with species")
    region = result.get("region") or [None, None]
    xu = str(result.get("x_unit") or "")
    d = f" ({xu})" if xu else ""
    method = dict(result.get("method") or {})
    cols = [
        "Species", "Unit", "Integral", "Integral unit", "Kind", "Peak", f"Peak depth{d}",
        "Mean", "Threshold", f"Junction depth{d}", "Direction",
    ]
    rows = [
        [
            s.get("name"), s.get("unit"), s.get("integral"), s.get("integral_unit"),
            s.get("integral_kind"), s.get("peak"), s.get("peak_depth"), s.get("mean"),
            s.get("threshold"), s.get("junction_depth"), s.get("junction_direction"),
        ]
        for s in species
    ]
    lo, hi = region
    if method.get("threshold_mode") == "absolute":
        thr = f"{method.get('threshold')} (absolute, in each species' unit)"
    else:
        thr = f"{float(method.get('threshold', 0.5)) * 100:g}% of each species' peak in the region"
    notes = [
        f"Region: {result.get('x_name', 'x')} {lo:g} to {hi:g}{' ' + xu if xu else ''} "
        f"({method.get('region', '')}), {result.get('rows_in_region')} rows.",
        f"Integral: {method.get('integral', '')}.",
        f"Mean: {method.get('mean', '')}.",
        f"Junction: {method.get('junction', '')}; threshold {thr}.",
    ]
    blocks: list[dict[str, Any]] = [
        table_block(cols, rows, caption=f"{len(species)} species"),
        *(text_block(n) for n in notes),
    ]
    warnings = [str(w.get("text", "")) for w in result.get("warnings", []) if w.get("text")]
    if warnings:
        blocks.append(text_block("Warnings: " + " · ".join(warnings)))
    return ReportSheet(
        title=title,
        sections=(section("Region measures", blocks),),
        source_refs=tuple(dict(r) for r in (source_refs or ())),
    )
