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

import math
from collections.abc import Callable
from typing import Any, NoReturn, TypeVar

import numpy as np
from fastapi import HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from quantized.calc.render_lock import RenderLockTimeout
from quantized.heavy_import import HeavyImportTimeout

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

#: ``CALC_ERRORS`` plus ``RenderLockTimeout`` (``calc.render_lock`` -- raised
#: when the process-wide matplotlib render lock could not be acquired within
#: its bounded timeout, see ``calc.figure_render``'s module doc), for every
#: figure-export route. Listed separately from ``CALC_ERRORS`` -- a stuck/
#: overloaded render is not a bad-input 422, it is a "the server is busy,
#: retry" 503 (see :func:`raise_calc_error`). A starred unpack directly in an
#: ``except`` clause isn't mypy-checkable (see ``CALC_ERRORS_IO``'s own note
#: above), hence this named tuple rather than ``except (RenderLockTimeout,
#: *CALC_ERRORS))`` inline at each call site. ``HeavyImportTimeout``
#: (``quantized.heavy_import``: a first import stuck behind another thread's
#: import past its bounded wait) is the same "busy, retry" 503 and rides along.
CALC_ERRORS_WITH_LOCK: tuple[type[BaseException], ...] = (
    RenderLockTimeout,
    HeavyImportTimeout,
    *CALC_ERRORS,
)
_BUSY_ERRORS = (RenderLockTimeout, HeavyImportTimeout)


def raise_calc_error(exc: BaseException) -> NoReturn:
    """Map a ``CALC_ERRORS_WITH_LOCK`` exception to its HTTP status and raise.

    ``RenderLockTimeout`` / ``HeavyImportTimeout`` -> 503 (busy/stuck render
    or first import, retryable); every other
    ``CALC_ERRORS`` member -> 422 (bad input), matching :func:`call_calc`'s
    long-standing mapping. Pair with ``except CALC_ERRORS_WITH_LOCK as exc:``
    at a call site that does more than call one ``calc/`` function (so
    ``call_calc`` itself doesn't fit) but still wants this same mapping.
    """
    if isinstance(exc, _BUSY_ERRORS):
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    raise HTTPException(status_code=422, detail=str(exc)) from exc


def call_calc(fn: Callable[..., _T], *args: Any, **kwargs: Any) -> _T:
    """Call a pure ``calc/`` function, turning ``CALC_ERRORS`` into an HTTP 422
    and ``RenderLockTimeout`` (a figure renderer only) into an HTTP 503."""
    try:
        return fn(*args, **kwargs)
    except CALC_ERRORS_WITH_LOCK as exc:
        raise_calc_error(exc)


def _json_safe(value: Any) -> Any:
    """Replace non-finite floats with ``None``, recursively."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    return value


async def heavy_import_timeout_handler(request: Request, exc: Exception) -> JSONResponse:
    """``HeavyImportTimeout`` raised anywhere in a route (a guarded lazy import
    outside any ``CALC_ERRORS_WITH_LOCK`` block) -> the same 503 + message
    :func:`raise_calc_error` gives, never an opaque 500."""
    assert isinstance(exc, HeavyImportTimeout)
    return JSONResponse(status_code=503, content={"detail": str(exc)})


async def validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """FastAPI's default 422 body, minus the crash.

    The default handler echoes each error's ``input`` back, and a request body
    carrying a bare ``NaN``/``Infinity`` token (Python's ``json.dumps`` writes
    them) then fails ``allow_nan=False`` serialization — a 500 in place of the
    422. Same shape as the default; non-finite inputs are echoed as ``null``.
    """
    assert isinstance(exc, RequestValidationError)
    return JSONResponse(
        status_code=422, content={"detail": _json_safe(jsonable_encoder(exc.errors()))}
    )
