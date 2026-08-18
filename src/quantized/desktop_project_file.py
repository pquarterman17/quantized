"""Project-file write helpers shared by :mod:`quantized.desktop_bridge`'s
``write_project_file`` (P1.2 boxes 2/3: atomic-write validation, and stray
crash-temp cleanup).

Split out of ``desktop_bridge.py`` itself once that module crossed the
repo's 500-line god-module ceiling (``tests/test_repo_integrity.py``) — this
is the cohesive, non-``self``-dependent half: neither function below touches
the pywebview window object, so both are testable (and were already tested)
completely on their own. Kept free of any pywebview import for the same
"launch-path helper, not a route" reason ``desktop_bridge.py``'s own module
doc states.
"""

from __future__ import annotations

import json
import os

__all__ = [
    "WORKSPACE_FORMAT",
    "WORKSPACE_VERSIONS",
    "WRITE_TEMP_PREFIX",
    "cleanup_stray_write_temps",
    "validate_workspace_payload",
]

# P1.2 box 2: the top-level shape `write_project_file` requires BEFORE an
# atomic replace. Mirrors the two constants frontend/src/lib/workspace.ts's
# `parseWorkspace` itself gates on (`WORKSPACE_FORMAT` / `WORKSPACE_VERSION`'s
# supported set) — kept in sync with that file BY HAND, since nothing crosses
# the Python/TypeScript boundary to share them. Deliberately NOT the same
# check: the frontend module owns full semantic validation (per-dataset
# DataStruct shape, folder/workbook migration, ...) and stays the ONE place a
# project's *meaning* is understood, exercised on OPEN. This is the narrower,
# backend-appropriate gate — is the payload well-formed JSON that at minimum
# LOOKS like a Quantized workspace — so a truncated write, a stray non-JSON
# string, or a caller bug can never replace a good project file with garbage.
# "Reuse the existing entry point, don't write a second validator" is honored
# by keeping this to exactly the top-level fields `parseWorkspace` itself
# checks before it will even start reading a document, no further.
WORKSPACE_FORMAT = "quantized-workspace"
WORKSPACE_VERSIONS = (1, 2, 3, 4)


def validate_workspace_payload(content: str) -> str | None:
    """``None`` when ``content`` is acceptable to write; else a human-readable
    reason, safe to report straight back to the frontend as ``error``."""
    try:
        payload = json.loads(content)
    except (json.JSONDecodeError, ValueError) as exc:
        return f"not valid JSON: {exc}"
    if not isinstance(payload, dict):
        return "not a JSON object"
    if payload.get("format") != WORKSPACE_FORMAT:
        return "missing or unexpected 'format' field"
    if payload.get("version") not in WORKSPACE_VERSIONS:
        return f"unsupported workspace version: {payload.get('version')!r}"
    if not isinstance(payload.get("datasets"), list):
        return "missing or non-array 'datasets' field"
    return None


# The exact prefix `write_project_file` gives every temp file it creates —
# shared with `cleanup_stray_write_temps` below so the two can never drift
# apart (a mismatched prefix there would either miss real strays or, worse,
# start deleting files that were never ours).
WRITE_TEMP_PREFIX = ".qz-write-"


def cleanup_stray_write_temps(directory: str) -> None:
    """Remove any leftover ``.qz-write-*`` file in ``directory`` — the
    anonymous temp file a crash between a PRIOR write's ``os.fdopen`` success
    and its ``os.replace`` can strand forever, since nothing else ever looks
    for one. Safe by construction: the prefix is exclusively ours (chosen for
    `tempfile.mkstemp` in ``desktop_bridge.py``), and `directory` is always
    one this process itself holds WRITE consent for (the caller resolves it
    from `granted`, never from unvalidated input) — so this can only ever
    delete a file this same bridge created.

    Best-effort and silent: called right before a NEW temp file is opened, so
    a failure here (permissions, a race with another process, the directory
    listing itself failing) must never turn an otherwise-successful save into
    a reported one — the next successful save gets another chance, and a
    stray file that never gets cleaned is a wasted few bytes, not a
    correctness problem."""
    try:
        entries = os.listdir(directory)
    except OSError:
        return
    for name in entries:
        if not name.startswith(WRITE_TEMP_PREFIX):
            continue
        try:
            os.remove(os.path.join(directory, name))
        except OSError:
            pass  # best-effort — see docstring
