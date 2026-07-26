"""Shared paths and small formatting helpers for the baseline generators."""

from __future__ import annotations

from pathlib import Path

# tools/baselines/common.py -> tools/baselines -> tools -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
COMMITTED_DIR = REPO_ROOT / "tests" / "fixtures" / "baselines"
DEFAULT_LARGE_DIR = REPO_ROOT / "tools" / "baselines" / "out"


def fmt_sig(value: float, sig: int = 6) -> str:
    """``value`` at ``sig`` significant figures, using ``e`` notation when that
    is shorter/clearer (mirrors typical instrument export formatting)."""
    return f"{value:.{sig}g}"


def fmt_fixed(value: float, decimals: int = 5) -> str:
    """``value`` at a fixed number of decimal places (e.g. a depth/position axis)."""
    return f"{value:.{decimals}f}"


def fmt_sci(value: float, decimals: int = 5) -> str:
    """``value`` in lowercase scientific notation, e.g. ``4.02533e+21``."""
    return f"{value:.{decimals}e}"


def write_text(path: Path, text: str) -> None:
    """Write ``text`` verbatim (no newline translation) so output is byte-stable
    across platforms — the determinism test byte-compares regenerated output."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="")
