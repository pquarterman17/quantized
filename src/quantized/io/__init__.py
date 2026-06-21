"""Pure I/O library: parsers, the single registry, export writers, session I/O.

Pure layer — MUST NOT import fastapi / pydantic / starlette / quantized.routes
(enforced by tests/test_repo_integrity.py). Data in → DataStruct out.
"""

from __future__ import annotations
