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
ONE process-wide re-entrant lock, ``RENDER_LOCK`` (now in the matplotlib-free
sibling ``calc.render_lock``, imported here and re-exported so existing
callers/tests keep working). Renders are CPU-bound Python holding the GIL
almost throughout, so serializing them costs essentially no throughput. It is
an ``RLock`` because renders nest (a figure-page panel runs
``safe_mathtext_label`` and ``draw_series_axes`` inside the page's own scope).
The acquire is BOUNDED (``RENDER_LOCK_TIMEOUT_S``): a stuck or pathologically
slow render must fail its own request with a retryable ``RenderLockTimeout``
(mapped to HTTP 503 by ``routes._errors``) rather than block every other
export -- and hog a threadpool token each -- forever.

Everything else is kept free of global state: figures are built with the
object-oriented API (``matplotlib.figure.Figure`` + an explicit Agg canvas, via
``new_figure``) -- never pyplot, so there is no global figure registry
(``Gcf``) to register into or ``plt.close`` from -- and the one export-wide rc
default (``svg.fonttype = "none"``) is applied per render inside the scope
instead of by mutating the global ``rcParams`` at import time. ``new_figure``
also asserts (loudly -- ``RuntimeError``, not a silent no-op) that it is only
ever called from inside a ``render_scope``: the lock is a correctness
requirement, not a convention a future renderer could accidentally skip.

matplotlib's own backend selection is left alone (no import-time
``matplotlib.use("Agg")``): the OO path here always attaches its own
``FigureCanvasAgg`` explicitly and never touches pyplot's backend, so there is
nothing for a global backend switch to protect -- and forcing one used to
force-switch a notebook/desktop caller's own pyplot backend as a side effect
of merely importing this module.

Pure layer: no fastapi/pydantic. Lock ordering: a renderer's lazy
cross-import mid-render takes ``quantized.heavy_import``'s per-package import
locks while ``RENDER_LOCK`` is held; never the reverse (a ``heavy_imports``
block only imports, and no module takes ``RENDER_LOCK`` at import time --
``tests/test_heavy_import_guard.py`` and
``tests/test_render_lock_import_time.py``), so there is no ordering hazard.
"""

from __future__ import annotations

import functools
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from io import BytesIO
from typing import Any, ParamSpec, TypeVar

import matplotlib
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from quantized.calc.render_lock import (
    RENDER_LOCK,
    RENDER_LOCK_TIMEOUT_S,
    RenderLockTimeout,
    acquire_render_lock,
    render_lock_is_held,
)

__all__ = [
    "BASE_RC",
    "RENDER_LOCK",
    "RENDER_LOCK_TIMEOUT_S",
    "RenderLockTimeout",
    "in_render_scope",
    "new_figure",
    "render_scope",
    "savefig_bytes",
]

P = ParamSpec("P")
R = TypeVar("R")

# Export-wide rc defaults, applied under every render's own rc (a caller's rc
# wins on a clash). svg.fonttype "none": editable SVG <text>, not glyph outlines.
BASE_RC: Mapping[str, Any] = {"svg.fonttype": "none"}


@contextmanager
def render_scope(rc: Mapping[str, Any] | None = None) -> Iterator[None]:
    """Hold ``RENDER_LOCK`` (bounded -- see ``RENDER_LOCK_TIMEOUT_S``) and
    apply ``BASE_RC`` + ``rc`` for one render.

    Everything that builds, lays out, draws or saves a figure must run inside
    this scope -- the lock is what makes the ``rc_context`` (global rcParams)
    and the shared mathtext parser safe under the threadpool. Raises
    ``RenderLockTimeout`` (never blocks forever) when the lock cannot be
    acquired within ``RENDER_LOCK_TIMEOUT_S`` -- routes map that to HTTP 503.
    """
    merged: dict[str, Any] = {**BASE_RC, **(rc or {})}
    # (matplotlib's RcParams Literal-key type is impractical with the dynamic
    # font.<generic> key the styles use -- hence the targeted ignore.)
    with acquire_render_lock(), matplotlib.rc_context(merged):  # type: ignore[arg-type]
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
    and ``savefig`` behave identically) but never registered in pyplot's
    global figure manager, so there is nothing to ``plt.close``. The figure
    is NOT simply "freed when the last reference drops" (a prior version of
    this doc claimed exactly that, incorrectly): a ``Figure`` keeps back-
    references into its own ``Axes``/canvas (a reference cycle, not a simple
    tree), so dropping the last external reference alone only makes it
    eligible for a future cyclic-GC pass, not an immediate free -- the
    caller's own ``fig.clear()`` (if it wants one) or, ultimately, the
    cyclic collector reclaims it. ``Figure.subplots(...)`` replaces
    ``plt.subplots(...)``.

    Must be called from inside a ``render_scope`` -- raises ``RuntimeError``
    otherwise (loudly, rather than building an unlocked, unsafe-to-draw
    ``Figure`` that merely looks fine until two of them race).
    """
    if not render_lock_is_held():
        raise RuntimeError(
            "new_figure() called outside a render_scope() -- every Figure "
            "must be built, drawn and saved while holding RENDER_LOCK (see "
            "calc.figure_render's module doc); wrap the caller in "
            "figure_render.render_scope(...) (or figure_labels.in_render_scope "
            "for a helper meant to be called either nested or standalone)"
        )
    fig = Figure(**kwargs)
    FigureCanvasAgg(fig)
    return fig


def savefig_bytes(fig: Figure, fmt: str, **kwargs: Any) -> bytes:
    """``fig.savefig`` into an in-memory buffer, returning its bytes.

    Dedupes the ``BytesIO() + savefig(...) + buf.getvalue()`` boilerplate
    every renderer repeated verbatim (11 call sites as of the 2026-09-27
    sweep, including ``figure_multivar``'s own local ``_savefig``). Must be
    called inside the caller's own ``render_scope`` -- ``savefig``, like
    every other figure operation, is not thread-safe on its own.
    """
    buf = BytesIO()
    fig.savefig(buf, format=fmt, **kwargs)
    return buf.getvalue()
