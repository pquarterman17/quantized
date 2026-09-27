"""Shared plain-language warning shape (private; sims_correct + sims_depth +
resample_align — audit P2.3/P2.5 review finding 10).

Pure calc layer: one dict builder, `{"code", "text", ...extras}`, matching
the frontend's `TransformWarning` wire shape (`lib/transformWarnings.ts`).
Each of the three modules above defined its own byte-for-byte identical
``_warn`` before this extraction; this is the one copy they now share.
"""

from __future__ import annotations

from typing import Any

__all__ = ["warn"]


def warn(code: str, text: str, **extra: Any) -> dict[str, Any]:
    """A warning dict: ``code``, ``text``, plus any non-None keyword extras
    (``count``, ``columns``, ``confirm``, ``info``, ...)."""
    out: dict[str, Any] = {"code": code, "text": text}
    out.update({k: v for k, v in extra.items() if v is not None})
    return out
