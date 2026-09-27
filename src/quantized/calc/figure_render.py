"""Thread-safe matplotlib render scope shared by every server-side figure export.

Why this exists (the concurrent-export bug, 2026-09-27): FastAPI runs the sync
export routes in a threadpool, so a ``POST /api/export/figure`` issued while the
publication preview (``/api/export/figure-page``) was still rendering ran two
matplotlib renders at once, and one failed with ``IndexError: pop from empty
list`` (or a spurious mathtext ``ParseException`` -> 422, or a valid ``$...$``
label silently de-mathed). matplotlib is not thread-safe, and the export path
leans on two pieces of process-global state that pure OO use cannot avoid:

- **the mathtext parser** -- ``MathTextParser._parser`` is ONE class-level
  ``_mathtext.Parser`` shared by every figure; its ``parse`` resets and pops a
  per-parse ``_state_stack``, so an interleaved parse empties the other's stack.
  Every ``$...$`` label and every log-axis tick label (``$\\mathdefault{10^{2}}$``)
  goes through it, as does ``figure_labels.safe_mathtext_label``'s trial parse.
- **rcParams** -- ``rc_context`` mutates the one global ``rcParams`` dict and
  restores a snapshot on exit, so two overlapping contexts leak one render's
  typography into the other and can leave the process-global style changed.
  matplotlib has no per-figure rcParams: artists read the global dict at
  construction/draw time, so a style can only be scoped by time, not by figure.

So the whole render (rc scope + build + layout + ``savefig``) is serialized by
ONE process-wide re-entrant lock, ``RENDER_LOCK``. Renders are CPU-bound Python
holding the GIL almost throughout, so serializing them costs essentially no
throughput. It is an ``RLock`` because renders nest (a figure-page panel runs
``safe_mathtext_label`` and ``draw_series_axes`` inside the page's own scope).

Everything else is kept free of global state: figures are built with the
object-oriented API (``matplotlib.figure.Figure`` + an explicit Agg canvas, via
``new_figure``) -- never pyplot, so there is no global figure registry
(``Gcf``) to register into or ``plt.close`` from -- and the one export-wide rc
default (``svg.fonttype = "none"``) is applied per render inside the scope
instead of by mutating the global ``rcParams`` at import time.

Pure layer: no fastapi/pydantic. Lock ordering: ``RENDER_LOCK`` is the only
lock taken in the render path, so there is no ordering hazard.
"""

from __future__ import annotations

import functools
import threading
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from typing import Any, ParamSpec, TypeVar

import matplotlib

# Headless, set explicitly: the OO path below never consults the pyplot backend,
# but anything that does import pyplot in this process must not open a display.
matplotlib.use("Agg")

from matplotlib.backends.backend_agg import FigureCanvasAgg  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402

__all__ = ["BASE_RC", "RENDER_LOCK", "in_render_scope", "new_figure", "render_scope"]

P = ParamSpec("P")
R = TypeVar("R")

# Export-wide rc defaults, applied under every render's own rc (a caller's rc
# wins on a clash). svg.fonttype "none": editable SVG <text>, not glyph outlines.
BASE_RC: Mapping[str, Any] = {"svg.fonttype": "none"}

# Serializes every matplotlib render and mathtext parse in the process (see the
# module doc for the two pieces of global state it guards).
RENDER_LOCK = threading.RLock()


@contextmanager
def render_scope(rc: Mapping[str, Any] | None = None) -> Iterator[None]:
    """Hold ``RENDER_LOCK`` and apply ``BASE_RC`` + ``rc`` for one render.

    Everything that builds, lays out, draws or saves a figure must run inside
    this scope -- the lock is what makes the ``rc_context`` (global rcParams)
    and the shared mathtext parser safe under the threadpool.
    """
    merged: dict[str, Any] = {**BASE_RC, **(rc or {})}
    # (matplotlib's RcParams Literal-key type is impractical with the dynamic
    # font.<generic> key the styles use -- hence the targeted ignore.)
    with RENDER_LOCK, matplotlib.rc_context(merged):  # type: ignore[arg-type]
        yield


def in_render_scope(fn: Callable[P, R]) -> Callable[P, R]:
    """Decorator: run ``fn`` inside ``render_scope()`` (BASE_RC only).

    For a render helper that a caller normally invokes inside its own scope
    (the re-entrant lock and the nested rc context then change nothing) but
    that must also be correct -- locked, export rc applied -- when called
    directly.
    """

    @functools.wraps(fn)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        with render_scope():
            return fn(*args, **kwargs)

    return wrapper


def new_figure(**kwargs: Any) -> Figure:
    """A pyplot-free ``Figure`` with an Agg canvas attached.

    Equivalent to ``plt.figure(**kwargs)`` under the Agg backend (same
    ``Figure`` constructor, same ``FigureCanvasAgg``, so ``fig.canvas.draw()``
    and ``savefig`` behave identically) but never registered in pyplot's global
    figure manager, so there is nothing to ``plt.close``: the figure is freed
    when the last reference drops. ``Figure.subplots(...)`` replaces
    ``plt.subplots(...)``.
    """
    fig = Figure(**kwargs)
    FigureCanvasAgg(fig)
    return fig
