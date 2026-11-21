"""The Origin-project part of an import: decoded graph figures plus the
project-level fidelity manifest.

Pure ``io`` (moved here from ``routes/_originfigures.py``, which re-exports
it): the import route and ``qz convert --to dwk`` (``io/origin_convert.py``)
build the same figures and manifest from the same function. It composes the
pure ``io.origin_project`` functions: figure extraction
(``.opj`` / ``.opju`` record shapes), the loss-aware assessment
(``fidelity.assess_origin_figures``), and the container completeness
diagnostic (``integrity.apply_container_integrity`` -- a file shorter than
its header records is reported as truncated; parse rules are unchanged).
"""

from __future__ import annotations

import struct
from collections.abc import Mapping
from typing import Any, Literal

from quantized.datastruct import DataStruct
from quantized.io.origin_project.fidelity import (
    OriginFidelityManifest,
    assess_origin_figures,
    book_source_names,
    origin_figure_decode_failure,
)
from quantized.io.origin_project.figures import extract_figures
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.graph_preview import (
    PreviewDiagnostic,
    attach_opju_graph_previews,
)
from quantized.io.origin_project.integrity import apply_container_integrity
from quantized.io.origin_project.opj_graph_windows import unrecovered_graph_windows
from quantized.io.origin_project.opju_bar_kinds import apply_bar_kinds
from quantized.io.origin_project.opju_curve_sheets import unbound_rebinds
from quantized.io.origin_project.opju_embedded_graphs import unrecovered_embedded_graphs
from quantized.io.origin_project.opju_error_bars import attach_error_bars
from quantized.io.origin_project.opju_graph_pages import (
    GraphPageReport,
    unrecovered_graph_pages,
)
from quantized.io.origin_project.opju_hist_cumulative import pair_histogram_cumulative
from quantized.io.origin_project.opju_layer_kind import apply_layer_kinds
from quantized.io.origin_project.opju_map_plots import bind_map_books
from quantized.io.origin_project.opju_memo import import_scoped
from quantized.io.origin_project.opju_no_data import omit_unsaved_curves
from quantized.io.origin_project.opju_stat_plots import apply_stat_kinds
from quantized.io.origin_project.worksheet_fidelity import worksheet_fidelity_summary

__all__ = ["origin_figures_and_fidelity"]


def _connector_books(primary: DataStruct | None) -> list[str]:
    """Books the worksheet decode found saved without their data
    (``origin_worksheet_fidelity["unsaved_books"]``, F-010)."""
    wf = primary.metadata.get("origin_worksheet_fidelity") if primary is not None else None
    rows = wf.get("unsaved_books") if isinstance(wf, Mapping) else None
    return [str(r["book"]) for r in rows or [] if isinstance(r, Mapping) and r.get("book")]


@import_scoped
def origin_figures_and_fidelity(
    raw: bytes, suffix: str, books: list[DataStruct], primary: DataStruct | None = None
) -> tuple[list[dict[str, Any]], OriginFidelityManifest]:
    """``(actionable figures, fidelity manifest)`` for one Origin project.

    ``primary`` (the book the import returns in full): the ``.opju``
    worksheet decode's own loss report (``metadata["origin_worksheet_fidelity"]``)
    is folded in as ``origin_fidelity["worksheet"]`` — a short, bounded
    summary (``io.origin_project.worksheet_fidelity``) — so worksheet losses
    are shown at import time instead of sitting unread in metadata.
    """
    container: Literal["opj", "opju"] = "opj" if suffix == ".opj" else "opju"
    missed = GraphPageReport(0, [])
    embedded: tuple[int, list[dict[str, str]]] = (0, [])
    try:
        if container == "opj":
            # an error-bar plot's bars drawn on the curve it decorates, if proven
            raw_figs = attach_error_bars(extract_figures(raw), books)
            preview_diagnostics: list[PreviewDiagnostic] = []
        else:
            # curves of a book whose data the file does not hold: omitted with
            # that reason first (opju_no_data), before the sheet check below
            raw_figs = omit_unsaved_curves(
                extract_figures_opju(raw), books, _connector_books(primary)
            )
            # curves re-bound to a sheet the import did not produce are
            # omitted + diagnosed, not left for the frontend to skip silently
            raw_figs = unbound_rebinds(raw_figs, books)
            # polar / offset-stacked layers left out, bubble / colour-mapped noted
            raw_figs = apply_layer_kinds(raw_figs, raw)
            # a histogram + cumulative-percent page drawn from Origin's own bins
            raw_figs = pair_histogram_cumulative(raw_figs, books)
            # column / bar / stacked / pie plot types resolved per layer
            raw_figs = apply_bar_kinds(raw_figs, raw, books)
            # box / violin / strip / histogram curves: drawn from Y, or omitted
            raw_figs = apply_stat_kinds(raw_figs, raw)
            # a heatmap / contour / ternary kept only when its book was imported
            raw_figs = bind_map_books(raw_figs, books)
            # an error-bar plot's bars drawn on the curve it decorates, if proven
            raw_figs = attach_error_bars(raw_figs, books)
            raw_figs, preview_diagnostics = attach_opju_graph_previews(raw_figs, raw)
        figs, fidelity = assess_origin_figures(
            raw_figs,
            container=container,
            source_names=book_source_names(books),
            preview_diagnostics=preview_diagnostics,
        )
        if container == "opju":
            # a page counts as recovered when one of its layers is IMPORTED:
            # a page whose decoded layers were all filtered (no curves, no
            # source) is still reported, with Origin's saved preview
            imported = {str(f.get("name")) for f in figs}
            missed = unrecovered_graph_pages(raw, imported)
            embedded = unrecovered_embedded_graphs(raw, imported)
    except (IndexError, ValueError, ArithmeticError, KeyError, struct.error):
        # Figures are an optional nicety; a decode hiccup on a malformed or
        # truncated project must degrade to "no figures", never fail the
        # whole import (the data books already succeeded above).
        figs = []
        fidelity = origin_figure_decode_failure(container=container)
    manifest = apply_container_integrity(fidelity, raw, container)
    if container == "opj":
        # .opj graph windows the layer gate skips (``opj_graph_windows``),
        # reported in the same shape as the .opju pages below.
        try:
            names = unrecovered_graph_windows(raw)
        except (IndexError, ValueError, ArithmeticError, KeyError, struct.error):
            names = []  # same degrade-not-fail rule as the figures above
        missed = GraphPageReport(len(names), [{"page_name": n} for n in names])
    if missed.missing or missed.unattributed:
        # A graph window the figure decoder could not read is diagnosed, not
        # silently absent ("no graph records found" would then be untrue).
        code = "graphs_not_recovered" if missed.missing else "graph_content_unattributed"
        omissions = [o for o in manifest["omissions"] if o != "no_graph_records"]
        manifest = {**manifest, "omissions": sorted({*omissions, code})}
        if missed.missing:
            manifest["unrecovered_graph_count"] = missed.missing
            manifest["unrecovered_graphs"] = [dict(g) for g in missed.pages]
    if embedded[0]:
        # fit-report / sparkline graphs inside a workbook (opju_embedded_graphs):
        # listed apart, not as lost user graphs -- their data are the report's
        # or the sheet's own columns
        manifest["embedded_graph_count"] = embedded[0]
        manifest["embedded_graphs"] = embedded[1]
    worksheet = primary.metadata.get("origin_worksheet_fidelity") if primary is not None else None
    if isinstance(worksheet, Mapping):
        manifest = {**manifest, "worksheet": worksheet_fidelity_summary(worksheet)}
    return figs, manifest
