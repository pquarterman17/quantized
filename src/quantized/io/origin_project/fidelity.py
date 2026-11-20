"""Loss-aware fidelity assessment for decoded Origin graph records.

The binary decoders intentionally return every record they can identify. This
module builds the presentation contract separately: actionable figures gain a
conservative per-figure assessment, while filtered/internal records survive as
diagnostic summaries in a versioned project manifest. Nothing here mutates or
reduces the pure decoder output.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Literal, NotRequired, TypedDict

from quantized.datastruct import DataStruct
from quantized.io.origin_project.graph_preview import PreviewDiagnostic
from quantized.io.origin_project.integrity import ContainerIntegrity
from quantized.io.origin_project.opju_curve_token_x import HIDDEN_IN_ORIGIN

__all__ = [
    "assess_origin_figures",
    "book_source_names",
    "origin_figure_decode_failure",
    "with_data_diagnostics",
]

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
    preview_diagnostics: list[PreviewDiagnostic]
    # Per-dataset reasons behind the DATA omissions (a worksheet dataset or a
    # matrix that was not imported). Present only when there are any.
    data_diagnostics: NotRequired[list[dict[str, str]]]
    # File length vs the size its header records (``integrity.py``); added by
    # ``integrity.apply_container_integrity`` at import time.
    container_integrity: NotRequired[ContainerIntegrity]
    # The ``.opju`` worksheet decode's loss summary
    # (``worksheet_fidelity.worksheet_fidelity_summary``), added at import time.
    worksheet: NotRequired[dict[str, object]]
    # ``.opju`` graph pages present in the file but not recovered as figures
    # (``opju_graph_pages``): their total, and the first pages with Origin's
    # saved image where one is attributable. Added at import time.
    unrecovered_graph_count: NotRequired[int]
    unrecovered_graphs: NotRequired[list[dict[str, object]]]
    # ``.opju`` graphs embedded in a workbook (fit-report / sparkline graphs,
    # ``opju_embedded_graphs``) not recovered: total and the first listed.
    embedded_graph_count: NotRequired[int]
    embedded_graphs: NotRequired[list[dict[str, str]]]


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
        "preview_diagnostics": [],
    }


_ALWAYS_OMITTED = [
    "graphic_objects",
    "rich_text_run_formatting",
    "advanced_axis_types",
]


def book_source_names(books: Iterable[DataStruct]) -> set[str]:
    """Every name a figure's source hint may use for an imported book: its
    Origin short name and its display title (``assess_origin_figures``'s
    ``source_names``)."""
    return {
        str(name)
        for book in books
        for name in (
            book.metadata.get("origin_book", ""),
            book.metadata.get("origin_book_long", ""),
        )
        if name
    }


def _normalized_sources(source_names: Iterable[str]) -> tuple[str, ...]:
    return tuple(s.strip().lower() for s in source_names if s.strip())


def _source_resolves(fig: dict[str, Any], sources: tuple[str, ...]) -> bool:
    hint = str(fig.get("source_hint") or "").strip().lower()
    return bool(hint) and any(hint == s or hint in s or s in hint for s in sources)


def _filter_reason(fig: dict[str, Any], sources: tuple[str, ...]) -> str | None:
    if fig.get("curves") or fig.get("map") or fig.get("ternary") or fig.get("curve_sheet_omitted"):
        return None
    if _source_resolves(fig, sources):
        # A layer whose curves were all left out is a real user
        # graph: it stays, and its fidelity says why it has no curves.
        return None
    hint = str(fig.get("source_hint") or "").strip()
    return (
        f'source hint "{hint}" did not match an imported workbook'
        if hint
        else "no bound curves or source hint"
    )


def _omitted_reasons(fig: dict[str, Any]) -> list[str]:
    notes = fig.get("curve_sheet_omitted") or []
    return [str(n.get("reason", "")) if isinstance(n, dict) else "" for n in notes]


# `.opju` curves left out (`curve_sheet_omitted`), by what is not proven.
# The per-curve detail rides on the figure. Only a sheet that is NOT proven
# is `curve_sheet_unresolved`; most omissions are on a proven sheet.
_SHEET_UNPROVEN = frozenset({"sheet_unknown", "x_sheet_unproven"})  # opju_curve_sheets
_ERROR_BAR_PLOT = "error_bar_plot"  # opju_error_bars: an error-bar plot not attached
# opju_error_bars: an error-bar plot naming no curve of its layer (Origin draws nothing)
_ERROR_BAR_NO_CURVE = "error_bar_no_curve"
_ERROR_FIELDS = ("yErr", "yErrPlus", "xErr", "xErrPlus")  # opju_error_bars: bars on a curve


def _left_out_codes(reasons: list[str]) -> list[str]:
    """Fidelity codes for a figure's omitted curves. A plot Origin itself
    hides (`hidden_in_origin`), or an error-bar plot it draws nothing for
    (`error_bar_no_curve`), is not a loss."""
    codes = []
    if any(r in _SHEET_UNPROVEN for r in reasons):
        codes.append("curve_sheet_unresolved")
    if _ERROR_BAR_PLOT in reasons:
        codes.append("error_bar_plots")
    not_lost = {HIDDEN_IN_ORIGIN, _ERROR_BAR_PLOT, _ERROR_BAR_NO_CURVE}
    if any(r not in _SHEET_UNPROVEN | not_lost for r in reasons):
        codes.append("curves_left_out")  # X, rows, plot kind or data not proven
    return codes


def _recovered_groups(fig: dict[str, Any]) -> list[str]:
    recovered = ["axis_ranges", "axis_scales"]
    if fig.get("saved_preview"):
        recovered.append("saved_graph_preview")
    if fig.get("curves"):
        recovered.extend(("curve_bindings", "curve_order"))
    if fig.get("map") or fig.get("ternary"):  # opju_map_plots
        recovered.append("map_binding")
    if fig.get("x_title") is not None or fig.get("y_title") is not None:
        recovered.append("axis_titles")
    if fig.get("legend_labels"):
        recovered.append("legend_labels")
    if fig.get("legend_title"):
        recovered.append("legend_title")
    if fig.get("annotation_marks"):
        recovered.append("positioned_annotations")
    if fig.get("region_shades"):
        recovered.append("region_shades")
    if fig.get("frame") and fig.get("page"):
        recovered.append("layer_geometry")
    if HIDDEN_IN_ORIGIN in _omitted_reasons(fig):
        # plots hidden in Origin, left out as `hidden_in_origin` (decoded:
        # `opju_curve_token_x.token_hidden`); each one rides on the figure
        recovered.append("curve_visibility")
    curves = fig.get("curves")
    if isinstance(curves, list) and curves:
        if any(isinstance(c, dict) and c.get("style") for c in curves):
            recovered.append("curve_style")
        if any(isinstance(c, dict) and c.get("color") for c in curves):
            recovered.append("curve_color")
        if any(isinstance(c, dict) and c.get("symbol") for c in curves):
            recovered.append("marker_shape")
        if any(isinstance(c, dict) and c.get("lineWidth") for c in curves):
            recovered.append("line_width")
        if any(isinstance(c, dict) and c.get("symbolSize") for c in curves):
            recovered.append("symbol_size")
        if any(isinstance(c, dict) and c.get("style") == "line_symbol" for c in curves):
            recovered.append("line_symbol_mode")
        if any(isinstance(c, dict) and any(c.get(k) for k in _ERROR_FIELDS) for c in curves):
            recovered.append("error_bars")  # opju_error_bars: plot -> its curve's bars
    return recovered


def _figure_fidelity(fig: dict[str, Any]) -> FigureFidelity:
    omissions = list(_ALWAYS_OMITTED)
    if not fig.get("saved_preview"):
        omissions.append("saved_graph_preview")
    curves = fig.get("curves")
    if not curves and not (fig.get("map") or fig.get("ternary")):
        omissions.append("exact_curve_bindings")
    elif isinstance(curves, list):
        if any(not isinstance(c, dict) or not c.get("style") for c in curves):
            omissions.append("some_curve_styles")
        if any(not isinstance(c, dict) or not c.get("color") for c in curves):
            omissions.append("some_curve_colors")
    if not (fig.get("frame") and fig.get("page")):
        omissions.append("layer_geometry")
    if fig.get("curve_sheet_notes"):
        # The per-curve detail is the figure's own `curve_sheet_notes`; the
        # frontend words it against the books that were actually imported.
        omissions.append("curve_sheet_mismatch")
    omissions.extend(_left_out_codes(_omitted_reasons(fig)))
    if fig.get("marker_encoding_not_decoded"):
        # bubble / colour-mapped scatter: X/Y drawn, size/colour map not
        # (`opju_layer_kind`)
        omissions.append("marker_encoding_not_decoded")
    for note in (
        "histogram_bins_not_decoded", "box_marks_not_decoded", "marker_scale_not_decoded",
        "map_scale_not_decoded", "map_plot_not_decoded",  # opju_map_plots
    ):
        if fig.get(note):  # drawn with quantized's own bins / box marks (`opju_stat_plots`)
            omissions.append(note)
    out: FigureFidelity = {
        # No current decoder proves every visual property, so "exact" is
        # deliberately reserved for a future preview/oracle comparison gate.
        "status": "best_effort",
        "recovered": _recovered_groups(fig),
        "omissions": omissions,
    }
    return out


def assess_origin_figures(
    figures: list[dict[str, Any]],
    *,
    container: Literal["opj", "opju"],
    source_names: Iterable[str] = (),
    preview_diagnostics: list[PreviewDiagnostic] | None = None,
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
        "preview_diagnostics": preview_diagnostics or [],
    }
    return actionable, manifest


def with_data_diagnostics(
    manifest: OriginFidelityManifest, diagnostics: object
) -> OriginFidelityManifest:
    """Fold a reader's DATA diagnostics into the project manifest.

    The graph assessment above knows nothing about worksheet or matrix
    data; a reader that omitted a dataset says so in
    ``metadata["origin_data_diagnostics"]`` (``{"omissions": [one line per
    kind of loss], "details": [{category, dataset, reason}]}`` — see
    ``opj_scan.summarize_problems``). Each omission line joins the
    manifest's ``omissions`` (so every surface that lists what was not
    recovered lists it), the details ride along as ``data_diagnostics``.
    Anything not shaped like that is ignored; a clean read returns
    ``manifest`` itself, unchanged.
    """
    if not isinstance(diagnostics, dict):
        return manifest
    lines = [x for x in diagnostics.get("omissions") or [] if isinstance(x, str) and x]
    details = [
        {str(k): str(v) for k, v in item.items()}
        for item in diagnostics.get("details") or []
        if isinstance(item, dict)
    ]
    if not lines and not details:
        return manifest
    out: OriginFidelityManifest = {**manifest}
    out["omissions"] = sorted({*manifest["omissions"], *lines})
    if details:
        out["data_diagnostics"] = details
    return out
