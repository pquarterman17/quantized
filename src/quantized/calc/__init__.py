"""Pure calculation library: corrections, fitting, calculators, stats, plotting math.

Pure layer — MUST NOT import fastapi / pydantic / starlette / quantized.routes
(enforced by tests/test_repo_integrity.py). This is where parity with the
MATLAB toolbox lives.
"""

from __future__ import annotations
