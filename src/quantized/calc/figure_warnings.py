"""Render-time warnings for publication export: what the figure could not
honour exactly, said instead of swallowed.

A figure render returns bytes (or the hit-map dict), so a renderer deep in
``calc.figure*`` has no return channel for "the font you asked for is not
installed" or "this reference line lies outside the axis range and is not
visible". This module is that channel: a route opens
:func:`collect_figure_warnings` around a render, any renderer calls
:func:`note_figure_warning`, and the route hands the collected list to the
client (a response header for ``/figure``, a ``warnings`` key on the
``/figure-hitmap`` preview). Outside a collector a note is a no-op, so a
renderer never needs to know whether anyone is listening.

A ``ContextVar`` (not a module global): FastAPI runs the sync export routes
in a threadpool, and each request's render runs in its own context, so two
requests never see each other's notes even before ``RENDER_LOCK`` serializes
them. Duplicate messages are dropped (a font fallback is noted once per
render, however many text artists ask).

Pure layer: no fastapi/pydantic/matplotlib.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

__all__ = [
    "collect_figure_warnings",
    "note_figure_warning",
    "set_keyed_figure_warning",
]


class _Sink(list[str]):
    """The collected messages, plus each keyed decision's current message
    (:func:`set_keyed_figure_warning`)."""

    def __init__(self) -> None:
        super().__init__()
        self.keyed: dict[object, str] = {}


_SINK: ContextVar[_Sink | None] = ContextVar("figure_warnings", default=None)


@contextmanager
def collect_figure_warnings() -> Iterator[list[str]]:
    """Collect every :func:`note_figure_warning` raised inside the block into
    the yielded list (in order, de-duplicated). Nests: an inner collector
    sees only its own block's notes."""
    sink = _Sink()
    token = _SINK.set(sink)
    try:
        yield sink
    finally:
        _SINK.reset(token)


def note_figure_warning(message: str) -> None:
    """Record ``message`` on the active collector (no-op without one)."""
    sink = _SINK.get()
    if sink is not None and message not in sink:
        sink.append(message)


def set_keyed_figure_warning(key: object, message: str | None) -> None:
    """Set (or, with None, clear) the warning one decision-maker currently
    stands by -- a decision a later layout pass can reverse
    (``calc.figure_tick_hint``). Identity-based (review N3): clearing ``key``
    removes its message only when no other key still holds the same text, so
    one axis' acceptance never retracts another axis' warning."""
    sink = _SINK.get()
    if sink is None:
        return
    old = sink.keyed.pop(key, None)
    if message is not None:
        sink.keyed[key] = message
        if message not in sink:
            sink.append(message)
    if old is not None and old != message and old in sink and old not in sink.keyed.values():
        sink.remove(old)
