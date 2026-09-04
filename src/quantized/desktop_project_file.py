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
import time
from collections.abc import Mapping
from typing import Any

__all__ = [
    "WORKSPACE_FORMAT",
    "WORKSPACE_VERSIONS",
    "WRITE_TEMP_PREFIX",
    "cleanup_stray_write_temps",
    "declared_source_paths_of",
    "extract_declared_source_paths",
    "parse_workspace_payload",
    "payload_declares_source",
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


def extract_declared_source_paths(content: str) -> list[str]:
    """Every ``datasets[].source.path`` string a project payload itself
    names — for P1.7's server-side consent-enforcement fix (``desktop_bridge
    .py``'s ``_read_granted``, ``desktop_consent.set_declared_sources``): the
    backend must record what THIS project's own OPENED FILE declares as its
    sources, so ``grant_source_paths`` can refuse to trust an arbitrary
    caller-supplied list later (the frontend's argument becomes a request,
    never an authority — see ``desktop_consent.py``'s "declared sources"
    section for the full ruling).

    Best-effort and never raises: a malformed/foreign/non-workspace payload
    yields ``[]`` rather than an exception, since this runs on the SAME read
    path as a plain "open project" click and a bad file must still open (or
    fail) exactly as it did before this existed — the parse here is read-
    only reconnaissance, never the gate on whether ``content`` IS a valid
    workspace (``validate_workspace_payload`` above owns that, ahead of a
    WRITE; the frontend's own ``parseWorkspace`` owns full semantic
    validation on open)."""
    try:
        payload = json.loads(content)
    except (json.JSONDecodeError, ValueError):
        return []
    if not isinstance(payload, dict):
        return []
    return declared_source_paths_of(payload)


def declared_source_paths_of(payload: Mapping[str, Any]) -> list[str]:
    """``extract_declared_source_paths`` for an ALREADY-parsed document —
    the half that walks ``datasets[].source.path``; same tolerance."""
    datasets = payload.get("datasets")
    if not isinstance(datasets, list):
        return []
    paths: list[str] = []
    for ds in datasets:
        if not isinstance(ds, dict):
            continue
        source = ds.get("source")
        if not isinstance(source, dict):
            continue
        path = source.get("path")
        if isinstance(path, str) and path:
            paths.append(path)
    return paths


def payload_declares_source(payload: Mapping[str, Any], resolved_dest: str) -> bool:
    """Is ``resolved_dest`` (already ``os.path.realpath``-ed by the caller)
    one of the dataset source paths ``payload`` itself declares? The check
    ``write_project_file`` refuses a save destination on (P1.2 box 4,
    review round on #291).

    Why the payload and not only the cached ``desktop_consent`` set: that
    set is populated ONLY by a native project open (``_read_granted``), so a
    workspace built from fresh imports, a relinked source, or a project
    opened any other way is not described by it — it may even still describe
    the PREVIOUS project. The payload being written is the authoritative
    description of the workspace it describes.

    Cost discipline (self-review on #291): this runs on EVERY quick save and
    Save As, under the exclusive OS lock, and ``os.path.realpath`` on
    Windows opens each path (``_getfinalpathname``) — on a source that lives
    on an unreachable network share that is the SMB timeout, per source, per
    save, in the exact "offline" state the relink workflow models as
    first-class. So: a pure-string comparison first (``normcase(abspath)``,
    no I/O — catches the identical and the ``sub/../raw.csv`` spellings),
    and ``realpath`` (the symlink/junction/case-folded spellings) only for a
    source on the SAME drive/UNC root as the destination — a source on
    another root cannot be the destination file (a cross-root link from the
    destination's side is already folded into ``resolved_dest``). A string
    that cannot be normalised at all is skipped (same tolerance as
    ``desktop_consent._normalize``) rather than turning a save into a
    crash."""
    dest_norm = os.path.normcase(os.path.normpath(resolved_dest))
    dest_root = os.path.normcase(os.path.splitdrive(dest_norm)[0])
    for raw in declared_source_paths_of(payload):
        try:
            candidate = os.path.normcase(os.path.abspath(raw))
        except (OSError, ValueError):
            continue
        if candidate == dest_norm:
            return True
        if os.path.normcase(os.path.splitdrive(candidate)[0]) != dest_root:
            continue
        try:
            real = os.path.realpath(raw)
        except (OSError, ValueError):
            continue
        if real == resolved_dest or os.path.normcase(os.path.normpath(real)) == dest_norm:
            return True
    return False


def parse_workspace_payload(content: str) -> tuple[dict[str, Any] | None, str | None]:
    """``(payload, None)`` when ``content`` is acceptable to write, else
    ``(None, reason)`` with a human-readable reason safe to report straight
    back to the frontend as ``error``. One ``json.loads`` serves both the
    validation and the declared-source check ``write_project_file`` runs
    next (``payload_declares_source``) — an embedded-mode workspace carries
    every dataset's data, so parsing a multi-megabyte document twice per
    Ctrl+S, under the exclusive OS lock, was measurable (self-review on
    #291)."""
    try:
        payload = json.loads(content)
    except (json.JSONDecodeError, ValueError) as exc:
        return None, f"not valid JSON: {exc}"
    if not isinstance(payload, dict):
        return None, "not a JSON object"
    if payload.get("format") != WORKSPACE_FORMAT:
        return None, "missing or unexpected 'format' field"
    if payload.get("version") not in WORKSPACE_VERSIONS:
        return None, f"unsupported workspace version: {payload.get('version')!r}"
    if not isinstance(payload.get("datasets"), list):
        return None, "missing or non-array 'datasets' field"
    return payload, None


def validate_workspace_payload(content: str) -> str | None:
    """``None`` when ``content`` is acceptable to write; else the reason.
    ``parse_workspace_payload`` is the same check that also hands back the
    parsed document."""
    return parse_workspace_payload(content)[1]


# The exact prefix `write_project_file` gives every temp file it creates —
# shared with `cleanup_stray_write_temps` below so the two can never drift
# apart (a mismatched prefix there would either miss real strays or, worse,
# start deleting files that were never ours).
WRITE_TEMP_PREFIX = ".qz-write-"


# R1 round-3 fix (F3): a save holding the project lock ALREADY runs this
# under that exclusive OS lock (see `desktop_bridge.py::write_project_file`
# — `cleanup_stray_write_temps` moved INSIDE `_replace`, so it now shares
# `write_holding_token`'s serialization), which is what actually prevents a
# second concurrent LOCKED save from ever running this concurrently with a
# first save's still-open temp file. The LEGACY no-token path calls this
# completely unlocked, though, so this age floor is belt-and-braces there:
# a temp file younger than this might be a DIFFERENT unlocked save's own
# in-flight file, not a genuine crash leftover, and must never be swept.
_MIN_STRAY_AGE_SECONDS = 600.0  # 10 minutes


def cleanup_stray_write_temps(
    directory: str, *, min_age_seconds: float = _MIN_STRAY_AGE_SECONDS
) -> None:
    """Remove any leftover ``.qz-write-*`` file in ``directory`` older than
    `min_age_seconds` — the anonymous temp file a crash between a PRIOR
    write's ``os.fdopen`` success and its ``os.replace`` can strand
    forever, since nothing else ever looks for one. Safe by construction:
    the prefix is exclusively ours (chosen for `tempfile.mkstemp` in
    ``desktop_bridge.py``), and `directory` is always one this process
    itself holds WRITE consent for (the caller resolves it from `granted`,
    never from unvalidated input) — so this can only ever delete a file
    this same bridge created.

    The age floor exists so this can never delete a DIFFERENT, still
    in-flight save's own temp file — see the module-level comment above
    `_MIN_STRAY_AGE_SECONDS` for why that risk is real for the unlocked
    legacy call site specifically. A file whose mtime cannot even be
    stat'd (already gone, a stat race) falls through to the removal
    attempt below rather than being skipped — nothing is lost either way,
    since the removal itself is already best-effort.

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
    now = time.time()
    for name in entries:
        if not name.startswith(WRITE_TEMP_PREFIX):
            continue
        full_path = os.path.join(directory, name)
        try:
            age = now - os.path.getmtime(full_path)
        except OSError:
            age = None
        if age is not None and age < min_age_seconds:
            continue  # too young — plausibly a concurrent in-flight save
        try:
            os.remove(full_path)
        except OSError:
            pass  # best-effort — see docstring
