"""Freshness guard: ``frontend/api/openapi.json`` must match the live schema.

The frontend generates its typed API foundation (``lib/api/schema.d.ts``, via
``openapi-typescript``) from the committed ``frontend/api/openapi.json``
snapshot, not from a live backend — so a route or model change that isn't
re-dumped would silently drift the generated types out of sync with reality.
This test is the tripwire: it rebuilds the schema from ``create_app()`` the
same way ``tools/dump_openapi.py`` does and diffs it against the committed
file, byte for byte.

Loaded by path (not ``import tools.dump_openapi``) because ``tools/`` has no
``__init__.py`` and isn't installed as a package.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DUMP_SCRIPT = ROOT / "tools" / "dump_openapi.py"
COMMITTED = ROOT / "frontend" / "api" / "openapi.json"

REGEN_HINT = (
    "frontend/api/openapi.json is stale relative to the live FastAPI schema. Run:\n"
    "  uv run python tools/dump_openapi.py && cd frontend && npm run api:types"
)


def _load_dump_openapi() -> types.ModuleType:
    spec = importlib.util.spec_from_file_location("dump_openapi", DUMP_SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_committed_openapi_json_matches_live_schema() -> None:
    dump_openapi = _load_dump_openapi()
    live = dump_openapi.normalized_openapi()
    live_text = json.dumps(live, indent=2, sort_keys=True) + "\n"

    assert COMMITTED.exists(), REGEN_HINT
    committed_text = COMMITTED.read_text(encoding="utf-8")

    assert json.loads(committed_text) == live, REGEN_HINT
    # Also require byte-identical formatting (sorted keys, 2-space indent, one
    # trailing newline) so `git diff` on the committed file is meaningful and
    # the frontend CI step's `git diff --exit-code` has nothing to chase.
    assert committed_text == live_text, REGEN_HINT
