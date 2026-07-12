"""Loss-aware fidelity assessment for decoded Origin graph records.

The binary decoders intentionally return every record they can identify. This
module builds the presentation contract separately: actionable figures gain a
conservative per-figure assessment, while filtered/internal records survive as
diagnostic summaries in a versioned project manifest. Nothing here mutates or
reduces the pure decoder output.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Literal, TypedDict

__all__ = ["assess_origin_figures", "origin_figure_decode_failure"]

FidelityStatus = Literal["exact", "best_effort", "reference_only", "unresolved"]


class FigureFidelity(TypedDict):
    status: FidelityStatus
    recovered: list[str]
    omissions: list[str]


class FilteredFigure(TypedDict):
    index: int
    name: str
    layer: int | None
    reason: str


class OriginFidelityManifest(TypedDict):
    version: int
    container: Literal["opj", "opju"]
    status: FidelityStatus
    graph_records_total: int
    graph_records_actionable: int
    graph_records_filtered: int
    omissions: list[str]
    filtered_figures: list[FilteredFigure]


def origin_figure_decode_failure(
    *, container: Literal["opj", "opju"]
) -> OriginFidelityManifest:
    """Manifest used when optional graph decode fails but workbooks survive."""
    return {
        "version": 1,
        "container": container,
        "status": "unresolved",
        "graph_records_total": 0,
        "graph_records_actionable": 0,
        "graph_records_filtered": 0,
        "omissions": ["figure_decode_error"],
        "filtered_figures": [],
    }


_ALWAYS_OMITTED = [
    "saved_graph_preview",
    "graphic_objects",
    "rich_text_run_formatting",
    "advanced_axis_types",
]


def _normalized_sources(source_names: Iterable[str]) -> tuple[str, ...]:
    return tuple(s.strip().lower() for s in source_names if s.strip())


def _source_resolves(fig: dict[str, Any], sources: tuple[str, ...]) -> bool:
    hint = str(fig.get("source_hint") or "").strip().lower()
    return bool(hint) and any(hint == s or hint in s or s in hint for s in sources)


def _filter_reason(fig: dict[str, Any], sources: tuple[str, ...]) -> str | None:
    if fig.get("curves") or _source_resolves(fig, sources):
        return None
    hint = str(fig.get("source_hint") or "").strip()
    return (
        f'source hint "{hint}" did not match an imported workbook'
        if hint
        else "no bound curves or source hint"
    )


def _recovered_groups(fig: dict[str, Any]) -> list[str]:
    recovered = ["axis_ranges", "axis_scales"]
    if fig.get("curves"):
        recovered.extend(("curve_bindings", "curve_order"))
    if fig.get("x_title") is not None or fig.get("y_title") is not None:
        recovered.append("axis_titles")
    if fig.get("legend_labels"):
        recovered.append("legend_labels")
    if fig.get("annotation_marks"):
        recovered.append("positioned_annotations")
    if fig.get("region_shades"):
        recovered.append("region_shades")
    if fig.get("frame") and fig.get("page"):
        recovered.append("layer_geometry")
    curves = fig.get("curves")
    if isinstance(curves, list) and curves:
        if any(isinstance(c, dict) and c.get("style") for c in curves):
            recovered.append("curve_style")
        if any(isinstance(c, dict) and c.get("color") for c in curves):
            recovered.append("curve_color")
        if any(isinstance(c, dict) and c.get("symbol") for c in curves):
            recovered.append("marker_shape")
    return recovered


def _figure_fidelity(fig: dict[str, Any]) -> FigureFidelity:
    omissions = list(_ALWAYS_OMITTED)
    curves = fig.get("curves")
    if not curves:
        omissions.append("exact_curve_bindings")
    elif isinstance(curves, list):
        if any(not isinstance(c, dict) or not c.get("style") for c in curves):
            omissions.append("some_curve_styles")
        if any(not isinstance(c, dict) or not c.get("color") for c in curves):
            omissions.append("some_curve_colors")
    if not (fig.get("frame") and fig.get("page")):
        omissions.append("layer_geometry")
    return {
        # No current decoder proves every visual property, so "exact" is
        # deliberately reserved for a future preview/oracle comparison gate.
        "status": "best_effort",
        "recovered": _recovered_groups(fig),
        "omissions": omissions,
    }


def assess_origin_figures(
    figures: list[dict[str, Any]],
    *,
    container: Literal["opj", "opju"],
    source_names: Iterable[str] = (),
) -> tuple[list[dict[str, Any]], OriginFidelityManifest]:
    """Return actionable annotated figures plus a loss-aware project manifest."""
    actionable: list[dict[str, Any]] = []
    filtered: list[FilteredFigure] = []
    project_omissions: set[str] = set()
    sources = _normalized_sources(source_names)
    for index, fig in enumerate(figures):
        reason = _filter_reason(fig, sources)
        if reason is not None:
            layer = fig.get("layer")
            filtered.append(
                {
                    "index": index,
                    "name": str(fig.get("name") or "SYSTEM"),
                    "layer": int(layer) if isinstance(layer, int) else None,
                    "reason": reason,
                }
            )
            continue
        fidelity = _figure_fidelity(fig)
        project_omissions.update(fidelity["omissions"])
        actionable.append({**fig, "fidelity": fidelity})

    if not figures:
        project_omissions.add("no_graph_records")
    elif filtered:
        project_omissions.add("filtered_internal_graph_records")
    status: FidelityStatus = "best_effort" if actionable else "unresolved"
    manifest: OriginFidelityManifest = {
        "version": 1,
        "container": container,
        "status": status,
        "graph_records_total": len(figures),
        "graph_records_actionable": len(actionable),
        "graph_records_filtered": len(filtered),
        "omissions": sorted(project_omissions),
        "filtered_figures": filtered,
    }
    return actionable, manifest
