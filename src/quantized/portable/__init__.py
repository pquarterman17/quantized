"""P1.7 "Pack Project" — the portable-bundle contract, dry-run manifest,
and (PR 2) verified staging copy.

Pure library (no fastapi/pydantic/starlette/``quantized.routes`` imports —
enforced by ``tests/test_repo_integrity.py``'s ``PURE_LAYERS`` guard). See
``manifest.py``'s module docstring for the security/trust boundary,
``layout.py``'s for the bundle-directory contract, and ``staging.py``'s
for the staged-copy pipeline PR 2 adds. Nothing in this package publishes
a bundle or reads a source's original directory tree; PR 3/4 of the "Pack
Project" stack (atomic publish + open-time resolution, and the pywebview
bridge method) build on it.
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
)
from .manifest import build_dry_run_manifest, manifest_json
from .staging import (
    STAGING_PREFIX,
    StagedFile,
    StageError,
    StageProgress,
    StageResult,
    cleanup_staging_dir,
    create_staging_dir,
    stage_sources,
)

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
    "is_bundle_relative",
    "join_bundle_path",
    "build_dry_run_manifest",
    "manifest_json",
    "STAGING_PREFIX",
    "StagedFile",
    "StageError",
    "StageProgress",
    "StageResult",
    "create_staging_dir",
    "cleanup_staging_dir",
    "stage_sources",
]
