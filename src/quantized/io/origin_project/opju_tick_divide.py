"""An ``.opju`` axis's tick-label "Divide by" / "Formula" (Origin's Tick
Labels > Display), the ``.opju`` twin of ``opj_tick_divide``.

**Decode (2026-11-21, lane S).** The ``.opju`` container DOES carry the
per-side tick-label objects the ``.opj`` reader decodes (the earlier note
"no ``O*`` objects in ``.opju``" searched for the ``.opj`` framing). Inside a
graph layer each one is a named object header in CPYUA's sparse grammar,
always framed as::

    3e 00 3e 00 c2 ff c2 ff 91 02 <name: O|F + B|T|L|R> ...

followed, within a few tokens, by its body as an ordinary CPYUA block::

    00 80 <clen> <clen bytes of tokens>   (opju_blocks.rle_expand)

whose expansion is the object's text, NUL-terminated (bytes after the NUL
are stale remnants of an earlier value and are ignored). ``O*`` holds the
"Divide by" factor (labels read value / factor, as in ``.opj``); ``F*`` holds
the "Formula" (labels read f(x)). The side letter is the axis side (bottom,
top, left, right).

Only what maps exactly onto the frontend's ``tick_label_divide`` factor is
read; everything else is left undecoded (fail closed):

* ``O*``: a plain decimal number, or a product / quotient / power of plain
  numbers (Origin evaluates the field: ``10^3``, ``1/16``), > 0 and != 1.
  ``0`` means none. A negative factor (an EIS ``-1e6``) is not drawn.
* ``F*``: exactly ``k*x``, ``x*k`` (factor ``1/k``) or ``x/k`` (factor ``k``).
  Any other formula (``10^x``, ``x-1920``) is not a factor and stays
  undecoded.

**Evidence.** Origin's own saved page previews (public) and COM exports
(owner): ``成功率`` Graph1/Graph2 ``OL = 100`` over 43.8..96.8 % data, preview
ticks 0.0..1.0; ``Fig3_e`` Graph2 ``FB = 5*x`` over X 1..100, preview ticks
0..500 "Time (ns)"; UnpolPlots Graph1 ``OB = 10``, export ticks 0..25 over
Z 0..250. Negative controls: the ``0`` objects (Catchment, Figure_*, FedPB:
hundreds of ``OR``/``OT``) draw undivided labels in their previews, and
``成功率`` Graph3 (no object) draws its 0..1 data as is. Whole corpus (both
corpora, deduplicated): every ``91 02 [OF][BTLR]`` occurrence sits in this
framing (no unframed name); 671 of 679 bodies expand (8 ``SOP_meas`` ``OR``
objects store their text in another, unread framing and stay undecoded):
471 ``0``, 10 ``1``, 178 factors, 9 formulas that are not a factor
(``x-1920``, ``1000*2^-X``, ``10^x``) and one negative factor.

Pure library: bytes in, values out.
"""

from __future__ import annotations

import ast
import math
import operator
import re
from collections.abc import Callable

from quantized.io.origin_project.opj_tick_divide import DIVIDE_SIDES
from quantized.io.origin_project.opju_blocks import rle_expand

__all__ = ["opju_tick_divide", "tick_label_factor"]

_HEAD = re.compile(rb"\x3e\x00\x3e\x00\xc2\xff\xc2\xff\x91\x02([OF])([BTLR])")
_BODY_SEARCH = 24  # bytes after the name in which the body block must start
_BODY_MAX = 64  # longest body token stream read (corpus max 15)
_SIDE = {"B": "bottom", "T": "top", "L": "left", "R": "right"}
assert set(_SIDE.values()) == set(DIVIDE_SIDES.values())

_NUM = r"[+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?"
_FORMULA_MUL = re.compile(rf"^\s*(?:({_NUM})\s*\*\s*x|x\s*\*\s*({_NUM}))\s*$", re.I)
_FORMULA_DIV = re.compile(rf"^\s*x\s*/\s*({_NUM})\s*$", re.I)

_BINOPS: dict[type, Callable[[float, float], float]] = {
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
}


def _number_expr(text: str) -> float | None:
    """A plain number or a * / ^ expression of plain numbers (LabTalk ``^``
    is a power; a sign only as a unary prefix), else ``None``. No names,
    calls, binary + or -: never guessed."""
    if not re.fullmatch(r"[0-9eE.+\-*/^() ]{1,32}", text):
        return None
    try:
        tree = ast.parse(text.replace("^", "**"), mode="eval")
    except SyntaxError:
        return None

    def ev(node: ast.AST) -> float:
        if isinstance(node, ast.Constant) and isinstance(node.value, int | float):
            return float(node.value)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub | ast.UAdd):
            v = ev(node.operand)
            return -v if isinstance(node.op, ast.USub) else v
        if isinstance(node, ast.BinOp) and type(node.op) in _BINOPS:
            return _BINOPS[type(node.op)](ev(node.left), ev(node.right))
        raise ValueError("not a numeric expression")

    try:
        v = ev(tree.body)
    except (ValueError, ZeroDivisionError, OverflowError):
        return None
    return v if math.isfinite(v) else None


def tick_label_factor(kind: str, text: str) -> float | None:
    """The ``value / factor`` divisor an ``O`` (Divide by) or ``F`` (Formula)
    tick-label object's text means, or ``None`` (none, or not a factor)."""
    factor: float | None
    if kind == "O":
        factor = _number_expr(text.strip())
    elif m := _FORMULA_MUL.match(text):
        k = float(m.group(1) or m.group(2))
        factor = 1.0 / k if k else None
    elif m := _FORMULA_DIV.match(text):
        factor = float(m.group(1))
    else:
        factor = None
    if factor is None or not math.isfinite(factor) or factor <= 0 or factor == 1:
        return None
    return factor


def _body_text(b: bytes, p: int, end: int) -> str | None:
    """The NUL-terminated text of the first ``00 80 <clen>`` block starting
    within ``_BODY_SEARCH`` bytes of ``p`` that expands cleanly."""
    stop = min(end, p + _BODY_SEARCH)
    q = b.find(b"\x00\x80", p, stop)
    while q != -1:
        clen = b[q + 2] if q + 2 < end else 0
        if 1 <= clen <= _BODY_MAX and q + 3 + clen <= end:
            body = rle_expand(b, q + 3, clen)
            if body is not None and b"\x00" in body:
                raw = body.split(b"\x00", 1)[0]
                try:
                    text = raw.decode("ascii")
                except UnicodeDecodeError:
                    return None
                return text if text.isprintable() else None
        q = b.find(b"\x00\x80", q + 1, stop)
    return None


_NO_FACTOR = {"", "0", "1", "x", "X"}  # an object that sets no transform at all


def opju_tick_divide(b: bytes, start: int, end: int) -> dict[str, float]:
    """Axis side -> tick-label factor for the layer window ``b[start:end]``.
    A side named twice with different factors is dropped (never guessed), as
    is a side whose other object is undecoded or a transform that is not a
    factor (``10^x`` beside ``OL = 100``: the labels are not value / 100)."""
    out: dict[str, float] = {}
    conflict: set[str] = set()
    for m in _HEAD.finditer(b, start, end):
        text = _body_text(b, m.end(), end)
        side = _SIDE[m.group(2).decode()]
        factor = None if text is None else tick_label_factor(m.group(1).decode(), text)
        if factor is None:
            if text is None or text.strip() not in _NO_FACTOR:
                conflict.add(side)
            continue
        if side in out and out[side] != factor:
            conflict.add(side)
        out[side] = factor
    return {k: v for k, v in out.items() if k not in conflict}
