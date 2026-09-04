"""Dump the live FastAPI OpenAPI schema to ``frontend/api/openapi.json``.

The frontend has no compile-time link to the backend's route table — 184
hand-written endpoint strings and hand-mirrored request/response shapes in
``frontend/src/lib/api.ts`` + ``lib/api/*.ts``. This script is the frontend
half of closing that gap: it writes a stable, deterministic snapshot of
``create_app().openapi()`` that ``frontend/package.json``'s ``api:types``
script (``openapi-typescript``) turns into generated types, and that
``tests/test_openapi_snapshot.py`` compares the live schema against so the
snapshot can't silently go stale.

Lives outside ``frontend/src`` (in ``frontend/api/``) so nothing can
accidentally import the dump into the Vite bundle.

Run after any route/model change:
    uv run python tools/dump_openapi.py && cd frontend && npm run api:types
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "frontend" / "api" / "openapi.json"


def normalized_openapi() -> dict[str, Any]:
    """Build the app and return its schema with volatile fields pinned.

    ``info.version`` tracks the package version (``pyproject.toml``), which
    bumps on every release for reasons unrelated to route drift — pinned to a
    fixed placeholder so a version bump alone doesn't churn this file (and
    the generated ``schema.d.ts``) or fail the freshness test below.
    """
    from quantized.app import create_app

    schema: dict[str, Any] = create_app().openapi()
    schema["info"] = {**schema["info"], "version": "0.0.0"}
    return schema


def dump(path: Path = OUTPUT) -> str:
    """Serialize the normalized schema as stable, sorted-key, 2-space JSON.

    Returns the text written, so callers (and the freshness test) can compare
    without re-reading the file.
    """
    text = json.dumps(normalized_openapi(), indent=2, sort_keys=True) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text


def main() -> None:
    dump()
    print(f"wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
