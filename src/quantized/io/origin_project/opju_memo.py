"""One-entry memo for pure whole-file scans of an ``.opju`` byte stream.

One import hands the same immutable ``bytes`` to several readers that each
re-derive the same table from it. :func:`last_call` keeps the last answer,
keyed on the IDENTITY of the first argument (the bytes; it is held, so its id
cannot be reused) and on equality of the rest. Only for functions that are
pure in their arguments and whose callers never mutate the result.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import Any, TypeVar

__all__ = ["last_call"]

_R = TypeVar("_R")


def last_call(fn: Callable[..., _R]) -> Callable[..., _R]:
    last: tuple[bytes, tuple[Any, ...], _R] | None = None

    @wraps(fn)
    def wrapper(b: bytes, *rest: Any) -> _R:
        nonlocal last
        cached = last
        if cached is None or cached[0] is not b or cached[1] != rest:
            cached = (b, rest, fn(b, *rest))
            last = cached
        return cached[2]

    return wrapper
