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

__all__ = ["collect_figure_warnings", "note_figure_warning"]

_SINK: ContextVar[list[str] | None] = ContextVar("figure_warnings", default=None)


@contextmanager
def collect_figure_warnings() -> Iterator[list[str]]:
    """Collect every :func:`note_figure_warning` raised inside the block into
    the yielded list (in order, de-duplicated). Nests: an inner collector
    sees only its own block's notes."""
    sink: list[str] = []
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
