"""Emitters: turn calc result dicts into :class:`ReportSheet`s (#36).

Each analysis already returns a plain result dict; these functions map the
known fields into the report schema (:mod:`quantized.calc.report`) so a fit,
peak fit, or stats test lands as a structured report that the #37/#38
exporters and the frontend viewer render uniformly. No new math — pure
re-shaping.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from quantized.calc.report import (
    ReportSheet,
    params_block,
    section,
    table_block,
    text_block,
)

__all__ = [
    "from_anova",
    "from_batch_integrate",
    "from_curve_fit",
    "from_integrate",
    "from_multipeak_fit",
    "from_stats_table",
]


def _gof_table(result: Mapping[str, Any], keys: Sequence[tuple[str, str]]) -> dict[str, Any]:
    """A two-column goodness-of-fit table from selected result keys."""
    rows = [[label, result[key]] for label, key in keys if result.get(key) is not None]
    return table_block(["Metric", "Value"], rows, caption="Goodness of fit")


def from_curve_fit(
    result: Mapping[str, Any],
    *,
    param_names: Sequence[str],
    param_units: Sequence[str] | None = None,
    title: str = "Curve fit",
    model_name: str | None = None,
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from a ``calc.fitting`` result dict.

    ``result`` carries ``params`` / ``errors`` arrays (whose order matches
    ``param_names``) plus goodness-of-fit scalars (R2, chiSqRed, RMSE, AIC).
    """
    params = list(result.get("params", []))
    errors = list(result.get("errors", []) or [None] * len(params))
    units = list(param_units) if param_units is not None else [""] * len(params)
    if len(param_names) != len(params):
        raise ValueError(
            f"param_names ({len(param_names)}) must match params ({len(params)})"
        )
    rows = [
        {"name": param_names[i], "value": params[i],
         "error": errors[i] if i < len(errors) else None,
         "unit": units[i] if i < len(units) else ""}
        for i in range(len(params))
    ]
    blocks: list[dict[str, Any]] = []
    if model_name:
        blocks.append(text_block(f"Model: {model_name}"))
    blocks.append(params_block(rows, caption="Fitted parameters"))
    blocks.append(
        _gof_table(result, [
            ("R²", "R2"), ("Reduced χ²", "chiSqRed"),
            ("RMSE", "RMSE"), ("AIC", "AIC"),
            ("Free params", "nFree"), ("Points", "nPoints"),
        ])
    )
    return ReportSheet(
        title=title,
        sections=(section("Fit results", blocks),),
        source_refs=tuple(dict(r) for r in (source_refs or ())),
    )


def from_multipeak_fit(
    result: Mapping[str, Any],
    *,
    title: str = "Multi-peak fit",
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from a ``calc.peak_multifit`` result dict."""
    peaks = list(result.get("peaks", []))
    cols = ["Peak", "Model", "Center", "FWHM", "Height", "Area", "η"]
    rows = []
    for i, pk in enumerate(peaks, start=1):
        rows.append([
            i, pk.get("model", result.get("model", "")),
            pk.get("center"), pk.get("fwhm"), pk.get("height"),
            pk.get("area"), pk.get("eta"),
        ])
    blocks: list[dict[str, Any]] = [
        table_block(cols, rows, caption=f"{len(peaks)} peak(s)"),
        _gof_table(result, [("RMSE", "rmse"), ("Peaks", "nPeaks")]),
    ]
    return ReportSheet(
        title=title,
        sections=(section("Peak fit", blocks),),
        source_refs=tuple(dict(r) for r in (source_refs or ())),
    )


# Human labels + display order for the common ANOVA-style row-dict keys.
_STATS_COLUMNS: dict[str, str] = {
    "source": "Source", "SS": "SS", "df": "df", "MS": "MS", "F": "F", "p": "p",
    "group": "Group", "diff": "Difference", "statistic": "Statistic",
    "ciLow": "CI low", "ciHigh": "CI high", "significant": "Significant",
    "i": "i", "j": "j",
}


def from_stats_table(
    records: Sequence[Mapping[str, Any]],
    *,
    title: str,
    section_title: str = "Results",
    columns: Sequence[str] | None = None,
    caption: str | None = None,
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from a list of uniform row-dicts (ANOVA, post-hoc, ...).

    ``columns`` selects/orders the dict keys to show; by default it uses the
    keys of the first record, relabeled via a small known-key map.
    """
    if not records:
        raise ValueError("from_stats_table needs at least one record")
    keys = list(columns) if columns is not None else list(records[0].keys())
    headers = [_STATS_COLUMNS.get(k, k) for k in keys]
    rows = [[rec.get(k) for k in keys] for rec in records]
    return ReportSheet(
        title=title,
        sections=(section(section_title, [table_block(headers, rows, caption=caption)]),),
        source_refs=tuple(dict(r) for r in (source_refs or ())),
    )


def from_anova(
    result: Mapping[str, Any],
    *,
    title: str = "ANOVA",
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from any ANOVA result dict carrying a ``table`` key."""
    table = result.get("table")
    if not table:
        raise ValueError("from_anova needs a result with a non-empty 'table'")
    return from_stats_table(
        table, title=title, section_title="ANOVA table",
        columns=["source", "SS", "df", "MS", "F", "p"],
        source_refs=source_refs,
    )


def from_integrate(
    result: Mapping[str, Any],
    *,
    title: str = "Peak integration",
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from a ``calc.peak_integrate.integrate_peaks`` result."""
    peaks = list(result.get("peaks", []))
    if not peaks:
        raise ValueError("from_integrate needs a result with peaks")
    cols = ["Region", "Area", "% area", "Centroid", "Height", "Position", "FWHM"]
    rows = []
    for i, pk in enumerate(peaks, start=1):
        region = pk.get("region")
        region_str = f"{region[0]:g}–{region[1]:g}" if isinstance(region, list) else i
        rows.append([
            region_str, pk.get("area"), pk.get("area_pct"), pk.get("centroid"),
            pk.get("height"), pk.get("position"), pk.get("fwhm"),
        ])
    caption = f"{len(peaks)} region(s), {result.get('baseline')} baseline"
    blocks = [
        table_block(cols, rows, caption=caption),
        text_block(f"Total net area: {result.get('total_area')}"),
    ]
    return ReportSheet(
        title=title,
        sections=(section("Integration", blocks),),
        source_refs=tuple(dict(r) for r in (source_refs or ())),
    )


def from_batch_integrate(
    result: Mapping[str, Any],
    *,
    title: str = "Batch peak integration",
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from a ``calc.peak_batch.batch_integrate_peaks`` result.

    The area matrix (spectrum x region) becomes a trend table — one row per
    spectrum, one column per region — plus per-spectrum alignment shift.
    """
    results = list(result.get("results", []))
    regions = list(result.get("regions", []))
    if not results or not regions:
        raise ValueError("from_batch_integrate needs results and regions")
    area_m = result.get("area_matrix", [])
    region_cols = [f"{r[0]:g}–{r[1]:g}" for r in regions]
    header = ["Spectrum", *(["Shift"] if result.get("aligned") else []), *region_cols]
    rows = []
    for i, row in enumerate(results):
        cells: list[Any] = [row.get("label", i)]
        if result.get("aligned"):
            cells.append(row.get("shift_samples"))
        cells.extend(area_m[i] if i < len(area_m) else [None] * len(regions))
        rows.append(cells)
    n_failed = result.get("n_failed", 0)
    caption = f"{len(results)} spectra × {len(regions)} region(s)"
    if n_failed:
        caption += f" ({n_failed} failed)"
    return ReportSheet(
        title=title,
        sections=(section("Area trends", [table_block(header, rows, caption=caption)]),),
        source_refs=tuple(dict(r) for r in (source_refs or ())),
    )
