"""Shared calc-adapter helper: convert a pure ``calc/`` call into an HTTP 422.

Every calculator route wraps its ``calc.*`` call in a
``try: ... except (...): raise HTTPException(422, ...)`` adapter. Several
route modules (``optics``, ``electrical``, ``magnetic``, ``semiconductor``,
``superconductor``, ``thermal``, ``thin_film``, ``vacuum``,
``electrochemistry``, ``diffusion``) had copy-pasted an *identical* local
``_call`` helper for this -- each one independently caught only
``ValueError``, so a pure numeric function raising ``OverflowError`` or
``ZeroDivisionError`` on finite-but-extreme input (e.g. ``n1=1e308`` in a
refractive-index product) escaped every one of them as an HTTP 500.
``numpy.linalg.LinAlgError`` is included explicitly too (a singular-matrix
failure inside a calc function, e.g. ``violin_kde``'s ``gaussian_kde`` on
degenerate/duplicate data): it happens to subclass ``ValueError`` in the
numpy version this repo currently pins, so today it is already caught
incidentally, but that is an implementation detail of one numpy release,
not a contract -- listing it explicitly makes the coverage correct by
construction rather than by version accident.

As of the 2026-09-03 repo-wide sweep, ``KeyError``, ``IndexError`` and
``TypeError`` were folded into ``CALC_ERRORS`` too: a repo audit found 140
hand-rolled ``except (...): raise HTTPException(422, ...)`` sites across 35
route modules, and a majority of them already spliced these three onto the
base tuple locally (malformed dict/array/tuple input -- a missing key, a
short array, a wrong-shaped argument -- from a calc function is exactly the
same "422 not 500" case as a bad ``ValueError``). Folding them into the
shared tuple instead of leaving per-route splices means every calculator
route gets the same coverage without having to remember it. Import
``call_calc`` (or ``CALC_ERRORS``) from here instead of re-declaring the
adapter.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar

import numpy as np
from fastapi import HTTPException

_T = TypeVar("_T")

#: Exception types a pure ``calc/`` function may legitimately raise for
#: bad-but-well-typed input: ``ValueError`` for explicit validation,
#: ``ArithmeticError`` as the common base of ``OverflowError`` /
#: ``ZeroDivisionError`` / ``FloatingPointError`` from extreme finite input,
#: ``KeyError`` / ``IndexError`` / ``TypeError`` for malformed dict/array/
#: tuple input, and ``numpy.linalg.LinAlgError`` for a singular/degenerate
#: linear-algebra failure (listed explicitly, not relied on as a ValueError
#: subclass -- see the module docstring). Routes that also need to catch
#: something outside this set should define their own
#: ``tuple[type[BaseException], ...]`` constant built from this one (see
#: ``CALC_ERRORS_IO`` below) rather than splicing inline -- mypy cannot
#: type-check a starred unpack (``except (*CALC_ERRORS, OSError) as exc:``)
#: written directly in an ``except`` clause, only a name bound to a tuple.
CALC_ERRORS: tuple[type[BaseException], ...] = (
    ValueError,
    ArithmeticError,
    KeyError,
    IndexError,
    TypeError,
    np.linalg.LinAlgError,
)

#: ``CALC_ERRORS`` plus ``OSError``, for routes that read/parse an on-disk or
#: uploaded file (a missing file, a permission error, a corrupt/truncated
#: read) in addition to doing calc-shaped validation -- e.g. ``routes.parsers``
#: and ``routes.database``. ``FileNotFoundError`` / ``FileExistsError`` are
#: ``OSError`` subclasses, so this also covers routes that used to name those
#: explicitly.
CALC_ERRORS_IO: tuple[type[BaseException], ...] = (*CALC_ERRORS, OSError)


def call_calc(fn: Callable[..., _T], *args: Any, **kwargs: Any) -> _T:
    """Call a pure ``calc/`` function, turning ``CALC_ERRORS`` into an HTTP 422."""
    try:
        return fn(*args, **kwargs)
    except CALC_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
