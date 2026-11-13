"""The LabTalk GRAPH block of the Origin ``.ogs`` export (split out of
``io/origin.py``): plot-state snapshot (``GraphSpec``), axis-limit lines,
Origin rich-text units, and the curve set -- every Y column against its
nearest-preceding X column, with its bound Y-error column.

Pure layer: no fastapi/pydantic imports.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from quantized.unit_display import display_unit

__all__ = [
    "CurveSet",
    "GraphSpec",
    "curve_set",
    "default_graph",
    "escape_lt",
    "origin_rich_unit",
    "plot_state_graph",
]

# C0/C1 controls plus the Unicode line/paragraph separators (see escape_lt).
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]")
# LabTalk substitution sigils (see escape_lt).
_PERCENT_RUN = re.compile(r"%{2,}(?=[A-Za-z(@0-9])")
_REGISTER_SUB = re.compile(r"%(?=[A-Za-z])")
_OPEN_SUB = re.compile(r"(%(?=[(@0-9])|\$(?=\())")
# A run of Unicode superscript digits/signs (display_unit's exponent output).
_SUPERSCRIPT_RUN = re.compile("[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+")
_FROM_SUPERSCRIPT = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻", "0123456789+-")


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
    x_lim: tuple[float | None, float | None] | None = None
    y_lim: tuple[float | None, float | None] | None = None
    y2_keys: tuple[int, ...] = ()
    # The plot's x axis runs high-to-low (``PlotView.xReversed``).
    x_reversed: bool = False


def escape_lt(text: str) -> str:
    """Make ``text`` safe inside a LabTalk string literal.

    Control characters become spaces first: a newline in a file-derived label
    would end the statement's line and run the rest as LabTalk (``run -e``
    starts a program) when the user runs the script (security audit
    2026-10-01). LabTalk has no backslash escape (``\\"`` lands literally,
    live-verified 2026-07-04, docs/origin_re/validation_log.md), so a double
    quote becomes ``'``, as in ``origin_com._escape_lt``.

    LabTalk also SUBSTITUTES inside a quoted string before the statement
    runs: ``%A``-``%Z`` expand to string registers, ``%(...)`` to a string /
    worksheet-cell lookup and ``$(...)`` to an evaluated expression
    (OriginLab LabTalk guide, "Substitution Notation",
    docs.originlab.com/labtalk/guide/labtalk-substitution-notation, and
    "String Registers", docs.originlab.com/labtalk/guide/string-registers).
    A file-derived label or free-text comment must land literally, so:

    * ``%`` + letter is written ``%%`` + letter -- the documented way to stop
      register substitution (LabTalk "Language Fundamentals" tutorial,
      docs.originlab.com/labtalk/tutorials/tutorial-language-fundamental:
      "by prefixing a % symbol you can stop the substitution"; re-checked
      against that page's text 2026-11-13);
    * ``%(``, ``%`` + digit (script arguments ``%1``...), ``%@`` and ``$(``
      have no documented escape, so a space is inserted after the sigil
      (``$ (``): the notation requires adjacency and can no longer form.
      This changes the text by one space, deliberately.

    Not live-verified in Origin (no license window since the 2026-11 audit)."""
    text = _CONTROL_CHARS.sub(" ", text)
    # A RUN of percents before a sigil target ("%%A") cannot be doubled
    # unambiguously ("%%%A" may read as "%%" + "%A"): break it with a space.
    text = _PERCENT_RUN.sub(r"\g<0> ", text)
    text = _REGISTER_SUB.sub("%%", text)
    text = _OPEN_SUB.sub(r"\1 ", text)
    return text.replace('"', "'")


def _col(idx: int) -> int:
    """Worksheet column (1-based) for value-channel index ``idx`` (0-based).
    Column 1 is X; channels start at column 2 (mirrors the designations loop
    in ``format_origin_script``)."""
    return idx + 2


def _lim_lines(axis: str, lim: tuple[float | None, float | None] | None) -> list[str]:
    """The ``layer.<axis>.from/to`` lines for one axis limit. A ``None`` side is
    auto for that side (the GUI's half-open limit, a blank min or max field):
    only the typed side is emitted, so Origin keeps its own autoscale for the
    other. Only finite limits are emitted -- NaN/Inf would format as invalid
    LabTalk literals (``layer.x.from = nan;``), so a non-finite member skips
    the whole pair, letting Origin auto-scale that axis."""
    if lim is None or any(v is not None and not math.isfinite(v) for v in lim):
        return []
    sides = zip(("from", "to"), lim, strict=True)
    return [f"layer.{axis}.{side} = {v:.10g};" for side, v in sides if v is not None]


def _reversed_x_lines(
    lim: tuple[float | None, float | None] | None, x_data: NDArray[np.float64]
) -> list[str]:
    """``layer.x.from/to`` for a REVERSED x axis: Origin draws an axis reversed
    when From > To, so the range is written high-to-low. Each side is the
    typed limit when finite, else the x data's own finite extent; with no
    finite extent either, nothing is emitted (Origin auto-scales upright)."""
    finite = x_data[np.isfinite(x_data)]
    lo, hi = lim if lim is not None else (None, None)
    if lo is None or not math.isfinite(lo):
        lo = float(finite.min()) if finite.size else None
    if hi is None or not math.isfinite(hi):
        hi = float(finite.max()) if finite.size else None
    if lo is None or hi is None:
        return []
    return [f"layer.x.from = {hi:.10g};  // reversed X", f"layer.x.to = {lo:.10g};"]


def origin_rich_unit(unit: str) -> str:
    """``unit`` as Origin graph rich text: the screen/export spelling
    (``display_unit``) with each superscript run as LabTalk's ``\\+(...)``
    escape, so ``cm^-1`` -> ``cm\\+(-1)`` and ``emu/cm3`` -> ``emu/cm\\+(3)``.
    Å and µ stay Unicode (Origin 2018+ draws them). A mathtext (``$``) unit
    is returned as written. Graph text only: worksheet units stay raw."""
    if "$" in unit:
        return unit
    return _SUPERSCRIPT_RUN.sub(
        lambda m: "\\+(" + m.group(0).translate(_FROM_SUPERSCRIPT) + ")", display_unit(unit)
    )


def _axis_title(label: str, unit: str) -> str:
    """A graph axis title; the unit in Origin rich text (``origin_rich_unit``)."""
    return label + (f" ({origin_rich_unit(unit)})" if unit else "")


@dataclass(frozen=True, slots=True)
class CurveSet:
    """The worksheet's structural curves: each Y-designated value channel
    (``y_channels``, in column order), the worksheet column of its X
    (``x_col``: the nearest-PRECEDING X-designated column -- column 1, the
    exported ``.time``, unless a later channel is designated X), and the
    worksheet column of its bound Y-error column (``err_col``), if any."""

    y_channels: tuple[int, ...]
    x_col: dict[int, int]
    err_col: dict[int, int]


def curve_set(designations: list[str], err_targets: dict[int, int]) -> CurveSet:
    """Origin's own binding rules over a designation list (one entry per value
    channel): a Y binds to the nearest-preceding X (multi-X ``X,Y,X,Y``
    worksheets keep every pair -- never collapsed to the first X), and a
    Y-error binds to its declared target (``err_targets``, from the live
    error roles) or else to the nearest-preceding Y. Label / disregard / Z /
    X-error / X columns are not curves."""
    y_channels: list[int] = []
    x_col: dict[int, int] = {}
    err_col: dict[int, int] = {}
    current_x = 1
    last_y: int | None = None
    for j, desig in enumerate(designations):
        if desig == "X":
            current_x = _col(j)
        elif desig == "Y":
            y_channels.append(j)
            x_col[j] = current_x
            last_y = j
        elif desig == "Y-error":
            tgt = err_targets.get(j, last_y)
            if tgt is not None and 0 <= tgt < len(designations) and designations[tgt] == "Y":
                err_col.setdefault(tgt, _col(j))
    return CurveSet(tuple(y_channels), x_col, err_col)


def _xy_range(x_col: int, y: int, curves: CurveSet) -> str:
    """One XYRange: ``(x,y)``, or ``(x,y,yErr)`` when ``y`` has a bound error
    column. The triple is X, Y, Y-error per the plotxy X-Function reference
    (docs.originlab.com/x-function/ref/plotxy, example
    ``plotxy iy:=(1,2,3); // Plot col(2) with col(3) as error bar``;
    re-checked against that page's text 2026-11-13). Documented, not
    live-verified in Origin (no license window since the 2026-11 audit)."""
    err = curves.err_col.get(y)
    return f"({x_col},{_col(y)})" if err is None else f"({x_col},{_col(y)},{err})"


def default_graph(
    curves: CurveSet,
    *,
    labels: list[str],
    units: list[str],
    x_name: str,
    x_unit: str,
    log_x: bool,
    log_y: bool,
) -> list[str]:
    """The default GRAPH block (no plot-state snapshot): EVERY Y column against
    its nearest-preceding X, with its Y-error bars, in one grouped ``plotxy``."""
    if not curves.y_channels:
        return ["", "// Create graph: no Y-designated column -- skipped"]
    pairs = ":".join(_xy_range(curves.x_col[y], y, curves) for y in curves.y_channels)
    o = ["", "// Create graph", f"plotxy iy:={pairs} plot:=201 ogl:=[<new>];"]
    if log_x:
        o.append("layer.x.type = 1;  // Log X")
    if log_y:
        o.append("layer.y.type = 1;  // Log Y")
    o.append(f'xb.text$ = "{escape_lt(_axis_title(x_name, x_unit))}";')
    if len(curves.y_channels) == 1:
        yi = curves.y_channels[0]
        y_unit = units[yi] if yi < len(units) else ""
        o.append(f'yl.text$ = "{escape_lt(_axis_title(labels[yi], y_unit))}";')
    return o


def plot_state_graph(
    graph: GraphSpec,
    *,
    labels: list[str],
    units: list[str],
    x_name: str,
    x_unit: str,
    sheet: str,
    x_data: NDArray[np.float64],
    curves: CurveSet,
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

    ``y_keys=None`` ("all channels") plots the structural Y set of ``curves``
    -- error / label / disregard / Z / X columns are not curves -- and every
    plotted Y carries its bound Y-error column as error bars. With no
    ``x_key`` each Y uses its nearest-preceding X column.
    """
    y_indices = list(curves.y_channels) if graph.y_keys is None else list(graph.y_keys)
    if not y_indices:
        return ["", "// Create graph (current plot state): no channels selected -- skipped"]

    # Validate channel indices up front: an out-of-range or negative index would
    # otherwise emit a `plotxy` referencing a worksheet column that was never
    # declared (or column 0 / a wrapped-around label), silently producing a
    # broken .ogs. The route converts this ValueError to a 422.
    n_ch = len(labels)
    checked = [*y_indices, *graph.y2_keys, *([] if graph.x_key is None else [graph.x_key])]
    out_of_range = sorted({k for k in checked if not 0 <= k < n_ch})
    if out_of_range:
        raise ValueError(
            f"graph channel index out of range for {n_ch} channel(s): {out_of_range}"
        )

    y2_set = set(graph.y2_keys)
    primary = [i for i in y_indices if i not in y2_set]
    secondary = [i for i in y_indices if i in y2_set]
    if not primary:
        # Nothing to anchor a left/right split against -- render the would-be
        # y2 set on the single default axis instead.
        primary, secondary = y_indices, []

    def x_of(y: int) -> int:
        return curves.x_col.get(y, 1) if graph.x_key is None else _col(graph.x_key)

    if graph.x_key is None:
        x_label, x_lbl_unit = x_name, x_unit
    else:
        xi = graph.x_key
        x_label = labels[xi] if xi < len(labels) else x_name
        x_lbl_unit = units[xi] if xi < len(units) else ""

    o: list[str] = ["", "// Create graph (current plot state)"]
    pairs = ":".join(_xy_range(x_of(i), i, curves) for i in primary)
    o.append(f"plotxy iy:={pairs} plot:=201 ogl:=[<new>];")
    if graph.x_log:
        o.append("layer.x.type = 1;  // Log X")
    if graph.y_log:
        o.append("layer.y.type = 1;  // Log Y")
    if graph.x_reversed:
        o.extend(_reversed_x_lines(graph.x_lim, x_data))
    else:
        o.extend(_lim_lines("x", graph.x_lim))  # finite sides only (see _lim_lines)
    o.extend(_lim_lines("y", graph.y_lim))
    o.append(f'xb.text$ = "{escape_lt(_axis_title(x_label, x_lbl_unit))}";')
    if len(primary) == 1:
        yi = primary[0]
        y_unit = units[yi] if yi < len(units) else ""
        o.append(f'yl.text$ = "{escape_lt(_axis_title(labels[yi], y_unit))}";')

    if secondary:
        # Explicit worksheet ref: the graph is the active window here, so a bare
        # (x,y) range would not resolve. qzbk$ (import block) holds the book's
        # post-impASC short name; <sheet> was restored right after import.
        pairs2 = ":".join(f"[%(qzbk$)]{sheet}!{_xy_range(x_of(i), i, curves)}" for i in secondary)
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
            o.append(f'label -yr "{escape_lt(_axis_title(labels[yi], y_unit))}";')
    return o


