"""quantized — Python backend for the quantized toolbox port.

Layered, enforced architecture (see CLAUDE.md):
  - ``datastruct`` + ``io`` + ``calc`` are pure libraries (no web imports).
  - ``routes`` are thin FastAPI adapters.
"""

from __future__ import annotations

__version__ = "0.3.0"
__all__ = ["__version__"]
