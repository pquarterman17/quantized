"""Curve plot-style tag of a CPYUA (``.opju``) curve token — moved verbatim
out of ``opju_codec`` (which re-exports it); see the section note below."""

from __future__ import annotations

import re

__all__ = ["curve_plot_style"]

# ── curve plot-style (item 35 follow-on: line vs scatter) ─────────────────────
#
# A compact-int property tag inside a CPYUA curve's own object body, found at
# a variable forward offset (22-44 bytes past the curve/column token's start
# -- never a fixed offset; see ``opju_curves.py``'s ``_CURVE_RE``/``_extract_
# curves_0x03`` and ``opju_curves_allcols.py``'s ``extract_curves_allcols``,
# both of which locate a curve token first and then call this on its start).
# Validated 135/147 real-corpus curve tokens, 0 disagreements, and 4/4 on the
# ``fig_pairs`` by-construction oracle (scatter/scatter/scatter/line, matching
# LabTalk's ``plot:=201``/``plot:=200``). Lives in its own dependency-free
# module, not in ``opju_curves.py``, because ``opju_curves_allcols.py`` needs
# it too and already sits *beneath* ``opju_curves.py`` in the import graph
# (the latter imports the former) -- importing it the other way round would
# be circular. It used to sit at the end of ``opju_codec`` (the lowest-level
# module both curve modules import), which still re-exports it unchanged; it
# moved out verbatim to keep that module under the line ceiling.
_STYLE_RE = re.compile(rb"\x8f\x01(.)\x83")
_STYLE_WINDOW = 400  # backstop only; the next-token bound below is the gate
_STYLE_BYTES = {0xC8: "line", 0xC9: "scatter"}
# The two curve-token shapes (opju_figure_curves' unified id token and
# opju_curves' 0x03-family token): the style search must STOP at the next
# curve token so a curve with no style tag of its own can never pick up its
# NEIGHBOR's tag. The old fixed 400-byte window was sized against the
# corpus-wide minimum inter-token gap (697 B) — corpus-shaped: a file packing
# curve objects closer than 400 B aliased the next curve's style (2026-07-06
# genericity audit). A false positive of this pattern only SHRINKS the search
# window (worst case an honest ``None``), never widens it.
_NEXT_TOKEN_RE = re.compile(rb"\x01\x01\x01\x80[\x01\x03]|\x01.\x01\x80\x03.\x00", re.DOTALL)


def curve_plot_style(b: bytes, token_start: int) -> str | None:
    """Plot style ("line"/"scatter") of the curve token starting at
    ``token_start``, or ``None`` when no ``8f 01 <style> 83`` tag is found
    before the next curve token (or the 400-byte backstop), or the style
    byte is unrecognized.

    ~8% of real-corpus curve tokens (composite-window duplicate references)
    legitimately have no tag in range -- this returns ``None`` for those
    rather than fabricating a default.
    """
    hi = min(len(b), token_start + _STYLE_WINDOW)
    nxt = _NEXT_TOKEN_RE.search(b, token_start + 8, hi)
    if nxt is not None:
        hi = nxt.start()
    m = _STYLE_RE.search(b, token_start, hi)
    if m is None:
        return None
    return _STYLE_BYTES.get(m.group(1)[0])
