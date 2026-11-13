"""The Origin-project part of an import response: decoded graph figures plus
the project-level fidelity manifest (split out of ``routes/parsers.py``).

Thin adapter over pure ``io.origin_project`` functions: figure extraction
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
from quantized.io.origin_project.worksheet_fidelity import worksheet_fidelity_summary

__all__ = ["origin_figures_and_fidelity"]


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
    try:
        if container == "opj":
            raw_figs = extract_figures(raw)
            preview_diagnostics: list[PreviewDiagnostic] = []
        else:
            raw_figs = extract_figures_opju(raw)
            raw_figs, preview_diagnostics = attach_opju_graph_previews(raw_figs, raw)
        figs, fidelity = assess_origin_figures(
            raw_figs,
            container=container,
            source_names=book_source_names(books),
            preview_diagnostics=preview_diagnostics,
        )
    except (IndexError, ValueError, ArithmeticError, KeyError, struct.error):
        # Figures are an optional nicety; a decode hiccup on a malformed or
        # truncated project must degrade to "no figures", never fail the
        # whole import (the data books already succeeded above).
        figs = []
        fidelity = origin_figure_decode_failure(container=container)
    manifest = apply_container_integrity(fidelity, raw, container)
    worksheet = primary.metadata.get("origin_worksheet_fidelity") if primary is not None else None
    if isinstance(worksheet, Mapping):
        manifest = {**manifest, "worksheet": worksheet_fidelity_summary(worksheet)}
    return figs, manifest
