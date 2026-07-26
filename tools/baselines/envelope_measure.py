"""Timing + peak-memory measurement primitives for the P0.4 envelope.

Not a pytest harness (nothing here runs in CI) -- a manual measurement tool
used by ``envelope.py``'s case functions. Wall time is measured WITHOUT
tracemalloc active, matching ``tools/bench/bench.py``'s best-of-N convention
(tracemalloc's per-allocation bookkeeping is not free, and mixing it into the
timed loop would inflate every wall-time number). One extra call, with
tracemalloc active, isolates the peak-memory figure instead.
"""

from __future__ import annotations

import gc
import time
import tracemalloc
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from common import REPO_ROOT

__all__ = ["CaseResult", "Measurement", "fixture_rel", "measure"]


@dataclass(frozen=True)
class Measurement:
    """One measured call: best wall time (clean) + peak traced memory."""

    result: Any
    wall_s: float
    peak_mem_mb: float
    repeat: int
    warmup: bool


def measure(fn: Callable[[], Any], *, repeat: int = 3, warmup: bool = True) -> Measurement:
    """Best-of-``repeat`` wall time, then one more tracemalloc-profiled call.

    ``repeat=1, warmup=False`` is the "single run, monster case" mode the
    P0.4 brief calls for (cases whose clean wall time already exceeds
    ~10 s) -- callers pick that explicitly per case, this helper just obeys
    it. Total calls to ``fn``: ``(1 if warmup else 0) + repeat + 1``.
    """
    if warmup:
        fn()
    best = float("inf")
    result: Any = None
    for _ in range(repeat):
        t0 = time.perf_counter()
        result = fn()
        best = min(best, time.perf_counter() - t0)
    # Drop the timing-loop result before the memory-profiled call so its
    # allocations (freed by CPython's refcounting, not tracemalloc-visible
    # after the fact) can't inflate the peak we're about to measure.
    del result
    gc.collect()
    tracemalloc.start()
    try:
        result = fn()
    finally:
        _current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
    return Measurement(
        result=result, wall_s=best, peak_mem_mb=peak / 1e6, repeat=repeat, warmup=warmup
    )


def fixture_rel(path: Path) -> str:
    """``path`` relative to the repo root, forward-slashed, for JSON/reports."""
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


@dataclass(frozen=True)
class CaseResult:
    """One row of the envelope: what ran, on what, and what it cost."""

    case: str
    fixture: str
    fixture_bytes: int | None
    command: str
    wall_s: float
    peak_mem_mb: float
    repeat: int
    warmup: bool
    output_shape: str
    notes: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "case": self.case,
            "fixture": self.fixture,
            "fixture_bytes": self.fixture_bytes,
            "command": self.command,
            "wall_s": round(self.wall_s, 4),
            "peak_mem_mb": round(self.peak_mem_mb, 2),
            "repeat": self.repeat,
            "warmup": self.warmup,
            "output_shape": self.output_shape,
            "notes": self.notes,
        }
