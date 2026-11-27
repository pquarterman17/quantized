"""Compare a pinned JSON wire fixture with what the calc derives now, floats within a tolerance.

A wire fixture pins the calc's own output so a hand edit or a rule change shows up. Exact
``==`` on that tree also fails on a last-bit difference between platforms: the macOS
runners (Accelerate BLAS, arm64) interpolate the ternary probes a few ULPs away from
Windows and Linux, and the nightly macOS legs failed on that alone (2026-11-27). Floats
are compared relatively at 1e-9, far below any deliberate change and far above
floating-point noise. Everything else (keys, lengths, ints, strings, None, booleans)
stays exact.
"""

from __future__ import annotations

import math
from typing import Any

REL = 1e-9
ABS = 1e-12


def _diff(expected: Any, actual: Any, path: str, rel: float, abs_: float) -> str | None:
    if isinstance(expected, bool) or isinstance(actual, bool):
        return None if expected is actual else f"{path}: {expected!r} != {actual!r}"
    if isinstance(expected, float) or isinstance(actual, float):
        if not isinstance(expected, (int, float)) or not isinstance(actual, (int, float)):
            return f"{path}: {expected!r} != {actual!r}"
        if math.isclose(expected, actual, rel_tol=rel, abs_tol=abs_):
            return None
        return f"{path}: {expected!r} != {actual!r} (rel {rel}, abs {abs_})"
    if isinstance(expected, dict) and isinstance(actual, dict):
        if expected.keys() != actual.keys():
            return f"{path}: keys {sorted(expected)} != {sorted(actual)}"
        for k in expected:
            d = _diff(expected[k], actual[k], f"{path}.{k}", rel, abs_)
            if d:
                return d
        return None
    if isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            return f"{path}: length {len(expected)} != {len(actual)}"
        for i, (e, a) in enumerate(zip(expected, actual, strict=True)):
            d = _diff(e, a, f"{path}[{i}]", rel, abs_)
            if d:
                return d
        return None
    if expected == actual and type(expected) is type(actual):
        return None
    return f"{path}: {expected!r} != {actual!r}"


def assert_tree_close(expected: Any, actual: Any, *, rel: float = REL, abs_: float = ABS) -> None:
    """Assert two JSON-shaped trees match: floats within ``rel``/``abs_``, the rest exactly."""
    d = _diff(expected, actual, "$", rel, abs_)
    assert d is None, d
