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


def extract_figures(b: bytes) -> list[dict[str, Any]]:
    """Every graph window in a CPYA project as a plot-state snapshot dict."""
    blocks = [(size, payload) for size, payload in walk_blocks(b) if size]
    id_map = column_id_map(blocks)
    x_columns = book_x_columns(blocks)
    figures: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    fig_start = 0
    n_curves = 0
    texts: list[str] = []

    def flush(end_idx: int) -> None:
        nonlocal current, n_curves, texts
        if current is None:
            return
        titles = [t for t in texts if not _AUTO_TITLE.match(t) and "\\l(" not in t]
        legend_ns = [int(n) for t in texts for n in _LEGEND_RE.findall(t)]
        current["n_curves"] = max(legend_ns) if legend_ns else n_curves
        current["annotations"] = titles[:12]
        # item 11: per-curve {book, x, y} binding across the whole window
        # (all layers), same aggregation level n_curves already uses.
        current["curves"] = extract_curves(blocks, fig_start, end_idx, id_map, x_columns)
        figures.append(current)
        current, n_curves, texts = None, 0, []

    i = 0
    while i < len(blocks):
        size, payload = blocks[i]
        name = _is_window_header(payload)
        if name is not None:
            nxt = blocks[i + 1][1] if i + 1 < len(blocks) else b""
            if len(nxt) >= 90 and nxt[:4] == b"\x00\x00\x1f\x00":
                flush(i)  # a new GRAPH window begins
                x_from, x_to = _axis(nxt, 15)
                y_from, y_to = _axis(nxt, 58)
                hint = _cstring(nxt, 208, 24) or ""
                y_log = _y_scale_flag(nxt)
                fig_start = i
                current = {
                    "name": name,
                    "x_from": x_from,
                    "x_to": x_to,
                    "x_log": _log_heuristic(x_from, x_to),  # no isolated X flag found
                    "y_from": y_from,
                    "y_to": y_to,
                    "y_log": y_log if y_log is not None else _log_heuristic(y_from, y_to),
                    "source_hint": hint,
                }
                i += 2
                continue
            flush(i)  # a worksheet (or other) window ends any open graph
        elif current is not None:
            if size == 133 and len(payload) > 2 and payload[2] == 0x07:
                n_curves += 1
            elif size < 1200:
                texts.extend(_texts_in(payload))
        i += 1
    flush(len(blocks))
    return figures
