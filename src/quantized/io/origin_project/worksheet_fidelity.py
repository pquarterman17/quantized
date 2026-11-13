"""A short, bounded summary of what an Origin project's worksheet decode lost.

``opju_worksheet.scan_worksheet`` reports every loss in detail
(``metadata["origin_worksheet_fidelity"]`` on the primary book). This turns
that report into the few lines a user needs at import time — how many
columns came in, and what did not, by kind — for the project's
``origin_fidelity`` manifest (the Library's "Origin fidelity" group and the
import toast). Pure: dict in, dict out.

Loss codes (each ``{"code", "count", "examples"}``, examples at most
``MAX_EXAMPLES``):

* ``columns_not_decoded`` — worksheet column records whose storage form was
  not positively identified, so they were omitted;
* ``datasets_not_decoded`` — other dataset records (loose datasets, function
  plots, matrix objects) that were not read;
* ``matrices_not_imported`` — matrix data read but whose shape was not found;
* ``over_decode_budget`` — records refused because the project declares more
  cells than one import materializes (``opju_codec.DECODE_BUDGET_CELLS``);
* ``complex_imaginary_omitted`` — complex columns, real part imported only;
* ``stale_cells_dropped`` — columns with cells past their used-row extent;
* ``text_unresolved`` — text cells whose string table could not be read;
* ``columns_without_header`` — columns found only by the marker scan;
* ``records_without_header`` — dataset records whose header was not
  recognized at all (a damaged file), so they could not be read.

An allocated but never-filled workbook (Origin's default empty "Book1") is
not a loss — it holds no data — so it is not listed. ``unverified_columns``
(not a loss either: data imported from a build with no record-length field,
checked on grammar alone) is reported separately.
"""

from __future__ import annotations

from collections.abc import Mapping

__all__ = ["MAX_EXAMPLES", "worksheet_fidelity_summary"]

MAX_EXAMPLES = 5

_NAMED = (
    ("over_decode_budget", "over_decode_budget"),
    ("complex_imaginary_omitted", "complex_imaginary_omitted"),
    ("stale_cells_beyond_extent", "stale_cells_dropped"),
    ("text_unresolved", "text_unresolved"),
    ("columns_without_header", "columns_without_header"),
)


def _int(v: object) -> int:
    return v if isinstance(v, int) and not isinstance(v, bool) else 0


def _strs(v: object) -> list[str]:
    return [str(x) for x in v][:MAX_EXAMPLES] if isinstance(v, list) else []


def worksheet_fidelity_summary(fidelity: Mapping[str, object]) -> dict[str, object]:
    """The import-time summary of one ``origin_worksheet_fidelity`` report."""
    losses: list[dict[str, object]] = []

    def add(code: str, count: int, examples: list[str]) -> None:
        if count:
            losses.append({"code": code, "count": count, "examples": examples[:MAX_EXAMPLES]})

    columns: tuple[int, list[str]] = (0, [])
    datasets: tuple[int, list[str]] = (0, [])
    undecoded = fidelity.get("undecoded")
    for entry in undecoded if isinstance(undecoded, list) else []:
        if not isinstance(entry, Mapping):
            continue
        n, ex = _int(entry.get("count")), _strs(entry.get("examples"))
        if entry.get("form") == "dataset":
            datasets = (datasets[0] + n, datasets[1] + ex)
        else:
            columns = (columns[0] + n, columns[1] + ex)
    add("columns_not_decoded", *columns)
    add("datasets_not_decoded", *datasets)
    matrices = fidelity.get("matrix_datasets")
    unshaped = [
        str(m.get("name", ""))
        for m in (matrices if isinstance(matrices, list) else [])
        if isinstance(m, Mapping) and not m.get("imported")
    ]
    add("matrices_not_imported", len(unshaped), unshaped)
    add("records_without_header", _int(fidelity.get("records_without_header")), [])
    for key, code in _NAMED:
        entry = fidelity.get(key)
        if isinstance(entry, Mapping):
            add(code, _int(entry.get("count")), _strs(entry.get("examples")))
    confidence = fidelity.get("confidence")
    unverified = _int(confidence.get("grammar_only")) if isinstance(confidence, Mapping) else 0
    imported = _int(fidelity.get("columns_numeric")) + _int(fidelity.get("columns_text"))
    status = "partial" if losses else ("unverified" if unverified else "complete")
    return {
        "version": 1,
        "status": status,
        "columns_imported": imported,
        "unverified_columns": unverified,
        "losses": losses,
    }
