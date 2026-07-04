"""Origin export: a paired CSV + LabTalk ``.ogs`` script. Port of MATLAB
``+utilities/exportOriginScript.m``.

The ``.ogs`` script, when run in OriginPro, imports the accompanying CSV, sets
column designations (X / Y / yErr by label), long names + units, and optionally
builds a graph — a maintainable alternative to writing binary ``.opju`` files.

Pure layer: ``format_origin_script`` returns ``(csv_text, ogs_text)`` (no disk
I/O). The ``created`` timestamp is injected by the caller so the function stays
deterministic (the route passes the wall-clock time; tests pass a fixed value).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct

__all__ = ["GraphSpec", "format_origin_project_script", "format_origin_script"]

_ERR_KEYWORDS = ("err", "dr", "std", "sigma")


@dataclass(frozen=True, slots=True)
class GraphSpec:
    """Current plot-state snapshot for the ``.ogs`` GRAPH block (item 26) —
    a LabTalk mirror of ``calc.plotting.PlotState`` plus axis limits.

    ``y_keys``/``x_key``/``y2_keys`` are 0-based value-channel indices (the
    same indexing as ``DataStruct.labels``/``.values`` columns — worksheet
    column ``idx + 2``, since column 1 is X). ``y_keys=None`` means "all
    channels" (mirrors ``PlotState``/``build_series``'s default). Channels
    listed in ``y2_keys`` are drawn on a secondary (right) Y axis; they
    should be a subset of the effective y-key set.
    """

    y_keys: tuple[int, ...] | None = None
    x_key: int | None = None
    x_log: bool = False
    y_log: bool = False
    x_lim: tuple[float, float] | None = None
    y_lim: tuple[float, float] | None = None
    y2_keys: tuple[int, ...] = ()


def _meta_get(meta: dict[str, Any], *keys: str, default: Any = None) -> Any:
    """First present, non-empty metadata value among ``keys`` (snake/camel)."""
    for key in keys:
        val = meta.get(key)
        if val not in (None, ""):
            return val
    return default


def _escape_lt(text: str) -> str:
    """Escape double-quotes for a LabTalk string literal."""
    return text.replace('"', '\\"')


def _sanitize(name: str) -> str:
    """LabTalk-safe identifier: non-word chars -> underscore (MATLAB \\W)."""
    return re.sub(r"\W", "_", name)


def _is_err_label(label: str) -> bool:
    low = label.lower()
    return any(kw in low for kw in _ERR_KEYWORDS)


def _col(idx: int) -> int:
    """Worksheet column (1-based) for value-channel index ``idx`` (0-based).
    Column 1 is X; channels start at column 2 (mirrors the designations loop
    in ``format_origin_script``)."""
    return idx + 2


def _axis_title(label: str, unit: str) -> str:
    return label + (f" ({unit})" if unit else "")


def _plot_state_graph(
    graph: GraphSpec,
    *,
    labels: list[str],
    units: list[str],
    x_name: str,
    x_unit: str,
    sheet: str,
) -> list[str]:
    """LabTalk lines recreating the CURRENT PLOT STATE (item 26): selected
    channels, x source, log flags, axis limits, and an optional secondary
    (right) Y axis for ``y2_keys``.

    One ``plotxy`` call plots the whole primary y-set via grouped range
    syntax (``(x,y1):(x,y2):…`` — pairs need not be contiguous columns). The
    secondary axis uses ``layer -nr`` (new right-Y layer linked to the active
    graph's X axis) followed by a ``plotxy`` into layer 2. Both were VERIFIED
    live against OriginPro via COM: the secondary ``plotxy`` must reference the
    worksheet explicitly (``[%(qzbk$)]<sheet>!``) because the graph — not the
    book — is the active window by then, and impASC renamed the book, so
    ``qzbk$`` (captured in the import block) holds its real short name.
    """
    y_indices = list(range(len(labels))) if graph.y_keys is None else list(graph.y_keys)
    if not y_indices:
        return ["", "// Create graph (current plot state): no channels selected -- skipped"]

    y2_set = set(graph.y2_keys)
    primary = [i for i in y_indices if i not in y2_set]
    secondary = [i for i in y_indices if i in y2_set]
    if not primary:
        # Nothing to anchor a left/right split against -- render the would-be
        # y2 set on the single default axis instead.
        primary, secondary = y_indices, []

    x_col = 1 if graph.x_key is None else _col(graph.x_key)
    if graph.x_key is None:
        x_label, x_lbl_unit = x_name, x_unit
    else:
        xi = graph.x_key
        x_label = labels[xi] if xi < len(labels) else x_name
        x_lbl_unit = units[xi] if xi < len(units) else ""

    o: list[str] = ["", "// Create graph (current plot state)"]
    pairs = ":".join(f"({x_col},{_col(i)})" for i in primary)
    o.append(f"plotxy iy:={pairs} plot:=201 ogl:=[<new>];")
    if graph.x_log:
        o.append("layer.x.type = 1;  // Log X")
    if graph.y_log:
        o.append("layer.y.type = 1;  // Log Y")
    if graph.x_lim is not None:
        lo, hi = graph.x_lim
        o.append(f"layer.x.from = {lo:.10g};")
        o.append(f"layer.x.to = {hi:.10g};")
    if graph.y_lim is not None:
        lo, hi = graph.y_lim
        o.append(f"layer.y.from = {lo:.10g};")
        o.append(f"layer.y.to = {hi:.10g};")
    o.append(f'xb.text$ = "{_escape_lt(_axis_title(x_label, x_lbl_unit))}";')
    if len(primary) == 1:
        yi = primary[0]
        y_unit = units[yi] if yi < len(units) else ""
        o.append(f'yl.text$ = "{_escape_lt(_axis_title(labels[yi], y_unit))}";')

    if secondary:
        # Explicit worksheet ref: the graph is the active window here, so a bare
        # (x,y) range would not resolve. qzbk$ (import block) holds the book's
        # post-impASC short name; <sheet> was restored right after import.
        pairs2 = ":".join(f"[%(qzbk$)]{sheet}!({x_col},{_col(i)})" for i in secondary)
        o += [
            "",
            "// Secondary (right) Y axis for y2-assigned channels (item 26).",
            "// New right-Y layer linked to the active graph's X, then plot the",
            "// y2 channels into layer 2 (verified live in OriginPro via COM).",
            "layer -nr;  // new right-Y layer, linked X",
            f"plotxy iy:={pairs2} plot:=201 ogl:=2!;",
            "page.active = 2;  // operate on the new right-Y layer below",
        ]
        if graph.y_log:
            o.append("layer.y.type = 1;  // Log Y (right)")
        if len(secondary) == 1:
            yi = secondary[0]
            y_unit = units[yi] if yi < len(units) else ""
            # A "layer -nr" layer has no pre-made axis-title object, so use the
            # `label -yr` command (yr.text$ / yl.text$ fail here) to title its
            # right Y axis. Verified live in OriginPro via COM.
            o.append(f'label -yr "{_escape_lt(_axis_title(labels[yi], y_unit))}";')
    return o


def format_origin_script(
    data: DataStruct,
    *,
    csv_name: str = "data.csv",
    book_name: str = "",
    sheet_name: str = "",
    log_x: bool = False,
    log_y: bool = False,
    make_graph: bool = True,
    created: str = "",
    book_long_name: str = "",
    graph: GraphSpec | None = None,
) -> tuple[str, str]:
    """Return ``(csv_text, ogs_text)`` for ``data``. Port of exportOriginScript.

    ``csv_name`` is the CSV filename the script references (``impASC``).
    ``book_name``/``sheet_name`` default to the source filename in metadata,
    then ``"data"``; both are sanitized to LabTalk identifiers.

    ``graph`` (item 26), when given, replaces the default single-column graph
    with a full plot-state export: selected channels, x source, log axes,
    limits, and a secondary Y axis. Ignored when ``make_graph`` is False.
    """
    meta = dict(data.metadata)
    source = _meta_get(meta, "source", "filepath", "filename", default="")
    base = str(source).replace("\\", "/").rsplit("/", 1)[-1].rsplit(".", 1)[0]
    book = _sanitize(book_name or base or "data")
    sheet = _sanitize(sheet_name or book)

    x_name = str(_meta_get(meta, "x_column_name", "xColumnName", default="X"))
    x_unit = str(_meta_get(meta, "x_column_unit", "xColumnUnit", default=""))

    labels = list(data.labels)
    units = list(data.units)
    time = np.asarray(data.time, dtype=float)
    values = np.asarray(data.values, dtype=float)

    # ── CSV: header, units, then %.10g data rows ──
    csv_lines = [
        ",".join([x_name, *labels]),
        ",".join([x_unit, *units]),
    ]
    for r in range(values.shape[0]):
        cells = [f"{time[r]:.10g}"]
        cells.extend(f"{values[r, c]:.10g}" for c in range(values.shape[1]))
        csv_lines.append(",".join(cells))
    csv_text = "\n".join(csv_lines) + "\n"

    # ── LabTalk (.ogs) script ──
    o: list[str] = [
        "// LabTalk script generated by quantized_matlab",
        f"// Date: {created}",
        "",
        "// Import data",
        f'newbook name:="{book}" sheet:=1;',
        # impASC auto-detects the 2-row (name/unit) header AND renames the book +
        # sheet to the source file -- so restore the intended names AFTER import.
        # (The historical `options.SkipRows.Count:=2` sub-option is INVALID LabTalk
        # in current Origin and aborts the whole import; bare impASC reads our
        # 2-header CSV correctly and the explicit designations below re-assert
        # names/units. See docs/origin_project_format.md.)
        f'impASC fname:="{csv_name}";',
        *([f'page.longname$ = "{_escape_lt(book_long_name)}";'] if book_long_name else []),
        f'wks.name$ = "{sheet}";',
        # A successful impASC renamed the book; capture its (post-import) short
        # name so the item-26 secondary-axis plotxy can reference the worksheet
        # columns while the GRAPH window -- not the book -- is active.
        *(["string qzbk$ = page.name$;"] if (make_graph and graph is not None) else []),
        "",
        "// Column designations and labels",
        "wks.col1.type = 4;  // X",
        f'wks.col1.lname$ = "{_escape_lt(x_name)}";',
        f'wks.col1.unit$ = "{_escape_lt(x_unit)}";',
    ]
    for k, label in enumerate(labels):
        cn = k + 2
        unit = units[k] if k < len(units) else ""
        if _is_err_label(label):
            o.append(f"wks.col{cn}.type = 3;  // yErr")
        else:
            o.append(f"wks.col{cn}.type = 1;  // Y")
        o.append(f'wks.col{cn}.lname$ = "{_escape_lt(label)}";')
        o.append(f'wks.col{cn}.unit$ = "{_escape_lt(unit)}";')

    if make_graph:
        if graph is not None:
            o += _plot_state_graph(
                graph, labels=labels, units=units, x_name=x_name, x_unit=x_unit, sheet=sheet
            )
        else:
            o += ["", "// Create graph", "plotxy iy:=(1,2) plot:=201 ogl:=[<new>];"]
            if log_x:
                o.append("layer.x.type = 1;  // Log X")
            if log_y:
                o.append("layer.y.type = 1;  // Log Y")
            x_title = x_name + (f" ({x_unit})" if x_unit else "")
            o.append(f'xb.text$ = "{_escape_lt(x_title)}";')
            if len(labels) == 1:
                y_unit = units[0] if units else ""
                y_title = labels[0] + (f" ({y_unit})" if y_unit else "")
                o.append(f'yl.text$ = "{_escape_lt(y_title)}";')

    o += ["", "// Done"]
    ogs_text = "\n".join(o) + "\n"
    return csv_text, ogs_text


def format_origin_project_script(
    items: list[tuple[DataStruct, str]],
    *,
    created: str = "",
    make_graph: bool = False,
) -> tuple[list[tuple[str, str]], str]:
    """Multi-book export: one LabTalk ``.ogs`` importing N CSVs into N books.

    ``items`` is ``[(dataset, book_name), …]`` (an empty name falls back to the
    dataset's ``origin_book`` metadata, then ``dataN``). Returns
    ``([(csv_name, csv_text), …], ogs_text)`` — the script recreates every
    workbook with designations, long names, units, and the book display title
    (``page.longname$``) when the dataset carries one.
    """
    if not items:
        raise ValueError("format_origin_project_script needs at least one dataset")
    csvs: list[tuple[str, str]] = []
    sections: list[str] = [
        "// LabTalk project script generated by quantized",
        f"// Date: {created}",
        f"// Books: {len(items)}",
    ]
    used: set[str] = set()
    for i, (ds, name) in enumerate(items):
        meta = dict(ds.metadata)
        book = _sanitize(str(name or meta.get("origin_book", "") or f"data{i + 1}"))
        base = book
        n = 1
        while book in used:
            n += 1
            book = f"{base}{n}"
        used.add(book)
        long_name = str(meta.get("origin_book_long", "") or "")
        csv_name = f"{book}_data.csv"
        csv_text, ogs_text = format_origin_script(
            ds,
            csv_name=csv_name,
            book_name=book,
            sheet_name=book,
            make_graph=make_graph,
            created=created,
            book_long_name=long_name if long_name != book else "",
        )
        csvs.append((csv_name, csv_text))
        body = ogs_text.splitlines()
        # drop the per-script header comment lines (kept once at the top)
        while body and body[0].startswith("//"):
            body.pop(0)
        sections += ["", f"// ---- Book {i + 1}: {book} ----", *body]
    return csvs, "\n".join(sections) + "\n"
