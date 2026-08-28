"""Shared calc-adapter helper: convert a pure ``calc/`` call into an HTTP 422.

Every calculator route wraps its ``calc.*`` call in a
``try: ... except (...): raise HTTPException(422, ...)`` adapter. Several
route modules (``optics``, ``electrical``, ``magnetic``, ``semiconductor``,
``superconductor``, ``thermal``, ``thin_film``, ``vacuum``,
``electrochemistry``, ``diffusion``) had copy-pasted an *identical* local
``_call`` helper for this -- each one independently caught only
``ValueError``, so a pure numeric function raising ``OverflowError`` or
``ZeroDivisionError`` on finite-but-extreme input (e.g. ``n1=1e308`` in a
refractive-index product) escaped every one of them as an HTTP 500. Import
``call_calc`` (or ``CALC_ERRORS``) from here instead of re-declaring the
adapter, so a new calculator route inherits the same coverage without having
to remember it.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import HTTPException

#: Exception types a pure ``calc/`` function may legitimately raise for
#: bad-but-well-typed input: ``ValueError`` for explicit validation, and
#: ``ArithmeticError`` as the common base of ``OverflowError`` /
#: ``ZeroDivisionError`` / ``FloatingPointError`` from extreme finite input.
#: Routes that also need to catch structural errors (malformed dict/array
#: input) should splice this tuple in, e.g.
#: ``except (*CALC_ERRORS, KeyError, IndexError) as exc:``.
CALC_ERRORS: tuple[type[BaseException], ...] = (ValueError, ArithmeticError)


def call_calc(fn: Callable[..., dict[str, Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    """Call a pure ``calc/`` function, turning ``CALC_ERRORS`` into an HTTP 422."""
    try:
        return fn(*args, **kwargs)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
