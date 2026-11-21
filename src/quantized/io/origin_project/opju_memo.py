"""One-entry memos for pure whole-file scans of an ``.opju`` byte stream, and
the per-import scope that releases them.

One import hands the same immutable ``bytes`` to several readers that each
re-derive the same table from it. :func:`last_call` keeps the last answer,
keyed on the IDENTITY of the first argument (the bytes; it is held, so its id
cannot be reused) and on equality of the rest. Only for functions that are
pure in their arguments and whose callers never mutate the result.

Holding the bytes is what makes the key safe, and what would pin a whole
project file (tens of MB) in a long-running server after its import: so every
memo registers a reset (:func:`on_scope_end`), and an import entry point runs
inside :func:`import_scope` / :func:`import_scoped`, which calls them when the
OUTERMOST scope of its thread ends (an import is several readers in a row; a
nested scope must not drop the memo for the rest of it). A memo is only a
cache: clearing one never changes an answer, only whether it is recomputed.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from functools import wraps
from typing import Any, ParamSpec, TypeVar

__all__ = ["clear_memos", "import_scope", "import_scoped", "last_call", "on_scope_end"]

_R = TypeVar("_R")
_P = ParamSpec("_P")

_resets: list[Callable[[], None]] = []
_local = threading.local()


def on_scope_end(reset: Callable[[], None]) -> None:
    """Register ``reset``, which drops one memo, to run when an import ends."""
    _resets.append(reset)


def clear_memos() -> None:
    """Drop every registered memo (and the file bytes it holds)."""
    for reset in _resets:
        reset()


@contextmanager
def import_scope() -> Iterator[None]:
    """Run an import; when the outermost scope in this thread exits, even by
    an exception, release the memos."""
    depth: int = getattr(_local, "depth", 0)
    _local.depth = depth + 1
    try:
        yield
    finally:
        _local.depth = depth
        if depth == 0:
            clear_memos()


def import_scoped(fn: Callable[_P, _R]) -> Callable[_P, _R]:
    """:func:`import_scope` around every call of ``fn``."""

    @wraps(fn)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        with import_scope():
            return fn(*args, **kwargs)

    return wrapper


def last_call(fn: Callable[..., _R]) -> Callable[..., _R]:
    last: tuple[bytes, tuple[Any, ...], _R] | None = None

    def reset() -> None:
        nonlocal last
        last = None

    on_scope_end(reset)

    @wraps(fn)
    def wrapper(b: bytes, *rest: Any) -> _R:
        nonlocal last
        cached = last
        if cached is None or cached[0] is not b or cached[1] != rest:
            cached = (b, rest, fn(b, *rest))
            last = cached
        return cached[2]

    return wrapper
