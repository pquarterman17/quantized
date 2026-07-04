"""Extract figure definitions from ``.opj`` graph windows (plan items 12/13).

Per ``docs/origin_re/opj_figures.md``: a graph window = a header block
(``00 00 <Name> 00`` + template token) followed by a layer-continuation block
(head ``00 00 1f 00``) holding the axis ranges as float64 ``(from, to, step)``
triples at offsets 15/23/31 (X) and 58/66/74 (Y), then typed child objects —
legend text (``\\l(n) %(n)`` per curve), axis titles, and text annotations.

The recoverable content is the plot-state snapshot the owner asked for: axis
ranges, a log-scale heuristic (the stored scale *flag* is still un-isolated —
a positive axis spanning ≥ 3 decades reads as log), titles/annotations, and
the curve count. The curve→column selector lives in the undecoded DataPlot
body, so figures name their source only loosely (``source_hint``).
"""

from __future__ import annotations

import re
import struct
from typing import Any

from quantized.io.origin_project.container import walk_blocks
from quantized.io.origin_project.windows import _cstring, _is_window_header

__all__ = ["extract_figures"]

_LEGEND_RE = re.compile(r"\\l\((\d+)\)")
_AUTO_TITLE = re.compile(r"^%\(\?[XY]\)")


def _axis(p: bytes, base: int) -> tuple[float, float]:
    lo, hi = struct.unpack_from("<d", p, base)[0], struct.unpack_from("<d", p, base + 8)[0]
    return float(lo), float(hi)


def _log_heuristic(lo: float, hi: float) -> bool:
    return lo > 0 and hi > 0 and hi / lo >= 1000.0


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
    figures: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    n_curves = 0
    texts: list[str] = []

    def flush() -> None:
        nonlocal current, n_curves, texts
        if current is None:
            return
        titles = [t for t in texts if not _AUTO_TITLE.match(t) and "\\l(" not in t]
        legend_ns = [int(n) for t in texts for n in _LEGEND_RE.findall(t)]
        current["n_curves"] = max(legend_ns) if legend_ns else n_curves
        current["annotations"] = titles[:12]
        figures.append(current)
        current, n_curves, texts = None, 0, []

    i = 0
    while i < len(blocks):
        size, payload = blocks[i]
        name = _is_window_header(payload)
        if name is not None:
            nxt = blocks[i + 1][1] if i + 1 < len(blocks) else b""
            if len(nxt) >= 90 and nxt[:4] == b"\x00\x00\x1f\x00":
                flush()  # a new GRAPH window begins
                x_from, x_to = _axis(nxt, 15)
                y_from, y_to = _axis(nxt, 58)
                hint = _cstring(nxt, 208, 24) or ""
                current = {
                    "name": name,
                    "x_from": x_from,
                    "x_to": x_to,
                    "x_log": _log_heuristic(x_from, x_to),
                    "y_from": y_from,
                    "y_to": y_to,
                    "y_log": _log_heuristic(y_from, y_to),
                    "source_hint": hint,
                }
                i += 2
                continue
            flush()  # a worksheet (or other) window ends any open graph
        elif current is not None:
            if size == 133 and len(payload) > 2 and payload[2] == 0x07:
                n_curves += 1
            elif size < 1200:
                texts.extend(_texts_in(payload))
        i += 1
    flush()
    return figures
