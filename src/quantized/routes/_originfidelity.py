"""Origin import: the project's figures and its ``origin_fidelity`` manifest.

Moved out of ``routes/parsers.py`` (which sits at the module line ceiling)
unchanged, plus one addition: the ``.opju`` worksheet decode's own loss
report (``metadata["origin_worksheet_fidelity"]`` on the primary book) is
folded in as ``origin_fidelity["worksheet"]`` — a short, bounded summary
(``io.origin_project.worksheet_fidelity``) — so worksheet losses are shown
at import time instead of sitting unread in metadata. Thin adapter: every
decision lives in ``io/``.
"""

from __future__ import annotations

import struct
from collections.abc import Mapping
from typing import Any

from quantized.datastruct import DataStruct
from quantized.io.origin_project.fidelity import (
    assess_origin_figures,
    origin_figure_decode_failure,
)
from quantized.io.origin_project.figures import extract_figures
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.graph_preview import (
    PreviewDiagnostic,
    attach_opju_graph_previews,
)
from quantized.io.origin_project.worksheet_fidelity import worksheet_fidelity_summary

__all__ = ["origin_figures_and_fidelity"]


def origin_figures_and_fidelity(
    raw: bytes, suffix: str, primary: DataStruct, books: list[DataStruct]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """``(actionable figures, origin_fidelity manifest)`` for one project."""
    try:
        if suffix == ".opj":
            raw_figs = extract_figures(raw)
            preview_diagnostics: list[PreviewDiagnostic] = []
        else:
            raw_figs = extract_figures_opju(raw)
            raw_figs, preview_diagnostics = attach_opju_graph_previews(raw_figs, raw)
        source_names = {
            str(name)
            for book in books
            for name in (
                book.metadata.get("origin_book", ""),
                book.metadata.get("origin_book_long", ""),
            )
            if name
        }
        figs, fidelity = assess_origin_figures(
            raw_figs,
            container="opj" if suffix == ".opj" else "opju",
            source_names=source_names,
            preview_diagnostics=preview_diagnostics,
        )
    except (IndexError, ValueError, ArithmeticError, KeyError, struct.error):
        # Figures are an optional nicety; a decode hiccup on a malformed or
        # truncated project must degrade to "no figures", never fail the
        # whole import (the data books already succeeded above).
        figs = []
        fidelity = origin_figure_decode_failure(container="opj" if suffix == ".opj" else "opju")
    manifest: dict[str, Any] = dict(fidelity)
    worksheet = primary.metadata.get("origin_worksheet_fidelity")
    if isinstance(worksheet, Mapping):
        manifest["worksheet"] = worksheet_fidelity_summary(worksheet)
    return figs, manifest
