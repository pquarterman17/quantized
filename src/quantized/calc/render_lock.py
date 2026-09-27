"""The process-wide matplotlib render lock -- matplotlib-free on purpose.

``calc.figure_render``'s module doc explains WHY every render (and every
mathtext parse) must be serialized under one lock. This tiny module holds
just the lock itself, its bounded-acquire helper, and the dedicated timeout
exception -- split out of ``figure_render`` so:

- ``calc.figure_labels.safe_mathtext_label`` can reach the lock with a plain
  top-level import instead of a lazy ``from quantized.calc.figure_render
  import RENDER_LOCK`` inside the function body (the lazy import existed
  only to avoid paying matplotlib's heavy import cost in a module that is
  otherwise pure string handling -- this module has no matplotlib import at
  all, so there is nothing to defer).
- ``routes/_errors.py`` (a thin adapter, never allowed to import matplotlib
  transitively via ``calc.figure_render``) can import :class:`RenderLockTimeout`
  to map it to an HTTP 503, the same ``CALC_ERRORS`` pattern every other
  calc-layer exception already uses.

Pure layer: no fastapi/pydantic/matplotlib.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager

__all__ = [
    "RENDER_LOCK",
    "RENDER_LOCK_TIMEOUT_S",
    "RenderLockTimeout",
    "acquire_render_lock",
    "render_lock_is_held",
]

#: Serializes every matplotlib render and mathtext parse in the process (see
#: ``calc.figure_render``'s module doc for the two pieces of global state it
#: guards: the shared mathtext parser and global ``rcParams``). An ``RLock``
#: because renders nest -- a figure-page panel runs ``safe_mathtext_label``
#: and ``draw_series_axes`` inside the page's own scope, and a nested
#: ``render_scope``/lock acquire from the SAME thread must not deadlock.
RENDER_LOCK = threading.RLock()

#: Bounded-acquire timeout (seconds) for one top-level render. A render is
#: CPU-bound Python holding the GIL almost throughout, so a normal render
#: clears in well under a second; hitting this means a render is genuinely
#: stuck (or the threadpool is starved many renders deep), and it is better
#: to fail ONE request with a clear, retryable 503 than to let it -- and
#: every request queued behind it -- block a threadpool token forever on an
#: unbounded acquire.
RENDER_LOCK_TIMEOUT_S = 60.0


class RenderLockTimeout(RuntimeError):
    """Raised when :data:`RENDER_LOCK` could not be acquired within the
    timeout -- a busy/stuck-render condition, never a bad-input one.

    Mapped to HTTP 503 (not 422) by ``routes._errors`` -- see
    ``CALC_ERRORS_WITH_LOCK``/``raise_calc_error`` there.
    """


@contextmanager
def acquire_render_lock(timeout: float | None = None) -> Iterator[None]:
    """Hold :data:`RENDER_LOCK` for the body, bounded by ``timeout`` seconds
    (default :data:`RENDER_LOCK_TIMEOUT_S`, read LIVE at call time rather
    than bound as a default-argument value -- so a test can
    ``monkeypatch.setattr(render_lock, "RENDER_LOCK_TIMEOUT_S", 0.05)`` and
    have every caller that omits ``timeout`` pick it up immediately, with no
    real 60-second wait).

    Raises :class:`RenderLockTimeout` instead of blocking forever when a
    render (or a queue of them) is stuck holding the lock past the timeout.
    Re-entrant: a thread that already owns the lock reacquires immediately
    (``RLock`` semantics -- ``threading.RLock.acquire`` counts, rather than
    re-blocks, a same-thread reacquire), so a nested call (e.g.
    ``safe_mathtext_label`` inside a renderer's own ``render_scope``) never
    pays -- or risks -- the timeout a second time.
    """
    resolved = RENDER_LOCK_TIMEOUT_S if timeout is None else timeout
    if not RENDER_LOCK.acquire(timeout=resolved):
        raise RenderLockTimeout(
            f"could not acquire the matplotlib render lock within {resolved:.0f}s "
            "-- another render is stuck or the server is overloaded; retry later"
        )
    try:
        yield
    finally:
        RENDER_LOCK.release()


def render_lock_is_held() -> bool:
    """True when the CURRENT thread already holds :data:`RENDER_LOCK`.

    Used by ``figure_render.new_figure`` to assert every figure is built
    inside a ``render_scope`` (see that function's own doc). ``RLock``
    exposes no *public* "do I own this" query -- only the ``_is_owned``
    method every ``threading.RLock`` implementation (pure-Python and the C
    ``_thread.RLock``) carries -- so it is wrapped here once instead of
    poked at from ``figure_render``/tests directly.
    """
    return RENDER_LOCK._is_owned()  # type: ignore[attr-defined,no-any-return]
