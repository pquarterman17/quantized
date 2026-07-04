"""Extract figure definitions from ``.opj`` graph windows (plan items 12/13).

Per ``docs/origin_re/opj_figures.md``: a graph window = a header block
(``00 00 <Name> 00`` + template token) followed by a layer-continuation block
(head ``00 00 1f 00``) holding the axis ranges as float64 ``(from, to, step)``
triples at offsets 15/23/31 (X) and 58/66/74 (Y), then typed child objects —
legend text (``\\l(n) %(n)`` per curve), axis titles, and text annotations.

**Y-axis scale flag — solved 2026-07-04** (the "real form scale bit" item):
the 2 bytes at payload offsets 98/99 are an exact Y lin/log flag, ``01 00``
= linear, ``08 01`` = log10 — the same two byte values (in the same order)
as the independently-discovered ``.opju`` real-corpus-form flag
(``figures_opju.py``'s ``_real_y_log_flag``), just at a different fixed
offset in this container's layer-continuation block. Isolated by
byte-diffing XRD's single log-Y ``Graph1`` layer against all 15 recovered
linear-Y layers in ``Moke.opj`` (identical at every byte except 98/99 and a
second, unrelated candidate at 189 that a wider corpus scan ruled out — see
``docs/origin_project_format.md`` §6.1) and validated against >300 further
layers across PNR/MnN_Diffusion_PNR/XMCD/hc2convert/SuperlatticeFits: only
these two byte values ever occur, and several instances (reflectivity R(Q)
curves zoomed to a sub-decade log range, e.g. Y=(0.9772, 1.2916)) are flag
log but heuristic-linear — cases the flag resolves correctly where the old
decade heuristic could not. **X has no known equivalent flag** (the search
that isolated Y's did not find one for X in this corpus) and stays
heuristic-only, same as before. See §6.1 for the byte-level trail.

The recoverable content is the plot-state snapshot the owner asked for: axis
ranges, an exact Y-scale flag (falling back to the decade heuristic only
when the flag byte pair is unrecognized), an X-scale decade heuristic (a
positive axis spanning ≥ 3 decades reads as log — no isolated X flag found),
titles/annotations, the curve count, and — **solved 2026-07-04, item 11** —
an exact per-curve ``{book, x, y}`` column binding (the ``"curves"`` field,
same shape as ``.opju``'s). See ``opj_curves.py``'s module docstring for the
full byte-level trail: every curve carries a small "anchor" record right
before its DataPlot style+body pair, holding the plotted column's own
global, project-wide serial id (independently confirmed against each
column's own storage block in the windows section) — book and column are
both resolved by this one id; X is a structural inference (the book's own
designated-X column), unverified against any oracle, exactly like
``.opju``. Figures still also carry the looser ``source_hint`` (the layer's
source book display name) for cases the per-curve binding can't reach.

**One dict PER LAYER — solved 2026-07-04.** A graph window is one figure to
Origin's user but can hold several **layers** — independent axis systems
with their own curves, overlaid in the same window (double-Y plots, or
composite/"panel" windows that union several source graphs' layers, e.g.
Moke's ``Graph10`` = ``Graph7``'s two layers + ``Graph4``'s two layers).
Each layer gets its own **layer-continuation block** (head ``00 00 1f 00``,
the axis-range record described below) and these repeat, one per layer,
positionally in the block stream — the first right after the window
header, each next one immediately following the previous layer's own
child objects (axis titles, legend, curves). `extract_figures` now walks
every layer-continuation block found inside a window's span (from its
header to the next window header, of either kind) and emits one figure
dict per layer, identical in shape to before plus a new 1-based ``"layer"``
key; ``"name"`` repeats the window name across all its layers' dicts.
**Curve attribution is positional**: every curve anchor (see
``opj_curves.py``) between one layer-continuation block and the next
belongs to that layer — validated exactly (both curve count and the exact
per-layer ``(book, column)`` sets) against Moke's ``Graph4`` (2 layers, 2
curves each), ``Graph7`` (2 layers, 3 curves each), and ``Graph10`` (4
layers, the literal union of ``Graph7``'s + ``Graph4``'s, 3/3/2/2 curves) —
see §6.1 for the full trail. Single-layer windows are unaffected: they get
exactly one figure dict, ``"layer": 1``, byte-identical to the pre-split
decode.
"""

from __future__ import annotations

import re
import struct
from typing import Any

from quantized.io.origin_project.container import walk_blocks
from quantized.io.origin_project.opj_curves import book_x_columns, column_id_map, extract_curves
from quantized.io.origin_project.windows import _cstring, _is_window_header

__all__ = ["extract_figures"]

_LEGEND_RE = re.compile(r"\\l\((\d+)\)")
_AUTO_TITLE = re.compile(r"^%\(\?[XY]\)")

# Y-axis scale flag: 2 bytes at the layer-continuation payload's offset 98/99
# (see the module docstring). Any other value falls back to the heuristic.
_Y_SCALE_FLAG_OFFSET = 98
_Y_LIN_FLAG = bytes([0x01, 0x00])
_Y_LOG_FLAG = bytes([0x08, 0x01])


def _axis(p: bytes, base: int) -> tuple[float, float]:
    lo, hi = struct.unpack_from("<d", p, base)[0], struct.unpack_from("<d", p, base + 8)[0]
    return float(lo), float(hi)


def _log_heuristic(lo: float, hi: float) -> bool:
    return lo > 0 and hi > 0 and hi / lo >= 1000.0


def _y_scale_flag(payload: bytes) -> bool | None:
    """Exact Y lin/log flag from the layer-continuation payload, or ``None``
    when the block is too short or the byte pair is unrecognized (caller
    falls back to ``_log_heuristic``) -- see the module docstring."""
    if len(payload) < _Y_SCALE_FLAG_OFFSET + 2:
        return None
    flag = payload[_Y_SCALE_FLAG_OFFSET : _Y_SCALE_FLAG_OFFSET + 2]
    if flag == _Y_LIN_FLAG:
        return False
    if flag == _Y_LOG_FLAG:
        return True
    return None


# A layer-continuation block's 3rd payload byte -- normally 0x1f (every
# window's first layer, and every subsequent OVERLAID layer, e.g. a
# double-Y graph's 2nd layer: validated on Moke's Graph7 AND on
# SLD_DoubleY.otp's two-layer double-Y template, both 0x1f/0x1f). A second,
# rarer value, 0x1f - 0x08 = 0x17, appears ONLY as a subsequent STACKED/
# TILED-PANEL layer (Origin's "N Panels" layout, a structurally different
# multi-layer mechanism from double-Y overlay) -- isolated on Moke's Graph4
# (layers 0x1f then 0x17, second layer's axis range (400.0, 1500.0) matches
# the oracle's 2nd-layer Y range exactly) and its composite copy inside
# Graph10. Corpus-wide grep (Moke/XRD/SuperlatticeFits/PNR/hc2convert/XMCD/
# MnN_Diffusion_PNR) finds 0x17 nowhere else at all -- and never outside a
# graph window's own span -- so accepting it is not a guess, it is confirmed
# structural evidence, not (yet) a generalized "any byte works" heuristic:
# only these two exact values are recognized; anything else falls through
# and is not treated as a layer boundary.
_LAYER_HEAD_BYTES = (0x1F, 0x17)


def _is_layer_block(payload: bytes) -> bool:
    """A layer-continuation block: head ``00 00 <0x1f|0x17> 00``, ≥90 B (the
    axis-range triples' fixed offsets need at least that much). Graph windows
    repeat this block once per layer (see module docstring); this same
    detector both identifies a window header as a *graph* header (checked
    against the block right after it -- always the first layer, always
    0x1f) and finds every subsequent layer boundary inside one (0x1f or the
    rarer 0x17 -- see ``_LAYER_HEAD_BYTES``)."""
    return (
        len(payload) >= 90
        and payload[0] == 0
        and payload[1] == 0
        and payload[2] in _LAYER_HEAD_BYTES
        and payload[3] == 0
    )


_WORDY = re.compile(r"[A-Za-z0-9 ()\[\].,%/+°:=-]")


def _texts_in(payload: bytes) -> list[str]:
    """Human-looking text runs of a text-object body (annotations, titles, legend).

    Binary blocks are full of short printable accidents and internal tokens —
    keep only strings that read like labels: mostly word-ish characters, at
    least two letters, not internal ``_``/``@${`` machinery.
    """
    out = []
    for m in re.finditer(rb"[\x20-\x7e\\]{3,}", payload):
        s = m.group().decode("latin1").strip()
        if not s or s.startswith(("@${", "_", "*")):
            continue
        if "\\l(" in s:  # legend text: keep verbatim for curve counting
            out.append(s)
            continue
        letters = sum(c.isalpha() for c in s)
        if letters < 2 or len(_WORDY.findall(s)) / len(s) < 0.85:
            continue
        if re.fullmatch(r"(Text|Line|Legend|Graph|Layer)\d*", s):
            continue  # object names, not user text
        if len(s) >= 4 or " " in s or "(" in s:
            out.append(s)
    return out


def _build_layer(
    blocks: list[tuple[int, bytes]],
    id_map: dict[int, tuple[str, str]],
    x_columns: dict[str, str],
    name: str,
    layer_no: int,
    start: int,
    end: int,
) -> dict[str, Any]:
    """One layer's plot-state dict: axis ranges from its own
    layer-continuation block (``blocks[start]``); curves/curve-count/
    annotations scoped to the half-open ``blocks[start:end)`` -- exactly this
    layer's own content, since layer records and curve anchors are
    sequential within a window span (module docstring; validated against
    Moke's Graph4/Graph7/Graph10)."""
    layer_payload = blocks[start][1]
    x_from, x_to = _axis(layer_payload, 15)
    y_from, y_to = _axis(layer_payload, 58)
    hint = _cstring(layer_payload, 208, 24) or ""
    y_log = _y_scale_flag(layer_payload)
    n_curves = 0
    texts: list[str] = []
    for k in range(start + 1, end):
        size, payload = blocks[k]
        if size == 133 and len(payload) > 2 and payload[2] == 0x07:
            n_curves += 1
        elif size < 1200 and not _is_layer_block(payload):
            texts.extend(_texts_in(payload))
    titles = [t for t in texts if not _AUTO_TITLE.match(t) and "\\l(" not in t]
    legend_ns = [int(n) for t in texts for n in _LEGEND_RE.findall(t)]
    return {
        "name": name,
        "layer": layer_no,
        "x_from": x_from,
        "x_to": x_to,
        "x_log": _log_heuristic(x_from, x_to),  # no isolated X flag found
        "y_from": y_from,
        "y_to": y_to,
        "y_log": y_log if y_log is not None else _log_heuristic(y_from, y_to),
        "source_hint": hint,
        "n_curves": max(legend_ns) if legend_ns else n_curves,
        "annotations": titles[:12],
        # item 2: curves attributed positionally to THIS layer only.
        "curves": extract_curves(blocks, start, end, id_map, x_columns),
    }


def extract_figures(b: bytes) -> list[dict[str, Any]]:
    """Every layer of every graph window in a CPYA project as a plot-state
    snapshot dict -- one dict per layer (see module docstring)."""
    blocks = [(size, payload) for size, payload in walk_blocks(b) if size]
    id_map = column_id_map(blocks)
    x_columns = book_x_columns(blocks)
    figures: list[dict[str, Any]] = []

    n = len(blocks)
    i = 0
    while i < n:
        name = _is_window_header(blocks[i][1])
        if name is None:
            i += 1
            continue
        nxt = blocks[i + 1][1] if i + 1 < n else b""
        if not _is_layer_block(nxt):
            i += 1  # a worksheet (or other non-graph) window: not a figure
            continue
        # A GRAPH window: its span runs to the next window header of either
        # kind (graph or worksheet), or EOF.
        j = i + 2
        while j < n and _is_window_header(blocks[j][1]) is None:
            j += 1
        win_end = j
        layer_starts = [k for k in range(i + 1, win_end) if _is_layer_block(blocks[k][1])]
        for pos, layer_start in enumerate(layer_starts):
            layer_end = layer_starts[pos + 1] if pos + 1 < len(layer_starts) else win_end
            figures.append(
                _build_layer(blocks, id_map, x_columns, name, pos + 1, layer_start, layer_end)
            )
        i = win_end
    return figures
