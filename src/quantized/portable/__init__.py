"""P1.7 "Pack Project" — the portable-bundle contract and dry-run manifest.

Pure library (no fastapi/pydantic/starlette/``quantized.routes`` imports —
enforced by ``tests/test_repo_integrity.py``'s ``PURE_LAYERS`` guard). See
``manifest.py``'s module docstring for the security/trust boundary and
``layout.py``'s for the bundle-directory contract this PR defines. Nothing
in this package copies a file or reads file content; PR 2/3/4 of the "Pack
Project" stack (staged verified copy, atomic publish + open-time
resolution, and the pywebview bridge method) build on it.
"""

from __future__ import annotations

from .layout import (
    BUNDLE_FORMAT,
    MANIFEST_FILENAME,
    MANIFEST_VERSION,
    MAX_COMPONENT_BYTES,
    SOURCES_DIR,
    SUPPORTED_MANIFEST_VERSIONS,
    basename_of,
    is_bundle_relative,
    join_bundle_path,
    path_key,
    sanitize_component,
    split_ext,
)
from .manifest import build_dry_run_manifest, manifest_json
from .naming import plan_bundle_names

__all__ = [
    "BUNDLE_FORMAT",
    "MANIFEST_VERSION",
    "MANIFEST_FILENAME",
    "SOURCES_DIR",
    "SUPPORTED_MANIFEST_VERSIONS",
    "MAX_COMPONENT_BYTES",
    "basename_of",
    "path_key",
    "sanitize_component",
    "split_ext",
    "is_bundle_relative",
    "join_bundle_path",
    "plan_bundle_names",
    "build_dry_run_manifest",
    "manifest_json",
]
