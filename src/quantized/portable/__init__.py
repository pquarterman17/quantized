"""P1.7 "Pack Project" — the portable-bundle contract, dry-run manifest,
verified staging copy, and (PR 3) atomic publish + bundle validation.

Pure library (no fastapi/pydantic/starlette/``quantized.routes`` imports —
enforced by ``tests/test_repo_integrity.py``'s ``PURE_LAYERS`` guard). See
``manifest.py``'s module docstring for the security/trust boundary,
``layout.py``'s for the bundle-directory contract, ``staging.py``'s for the
staged-copy pipeline, and ``publish.py``'s for the atomic-rename publish
contract + ``validate_bundle``. ``pack.py``'s ``pack_project`` is the pure
orchestration entry point tying all of it together; PR 4 wraps that in the
pywebview bridge method and a cancellable job/state machine.
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
from .pack import PackResult, pack_project
from .project_rewrite import resolve_bundle_source, rewrite_payload_for_bundle
from .publish import (
    BundleCheck,
    PublishResult,
    atomic_replace_file,
    finalize_manifest,
    publish_bundle,
    validate_bundle,
    write_bundle_files,
)
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
    "split_ext",
    "is_bundle_relative",
    "join_bundle_path",
    "plan_bundle_names",
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
    "resolve_bundle_source",
    "rewrite_payload_for_bundle",
    "BundleCheck",
    "PublishResult",
    "atomic_replace_file",
    "finalize_manifest",
    "publish_bundle",
    "validate_bundle",
    "write_bundle_files",
    "PackResult",
    "pack_project",
]
