"""P1.7 "Pack Project" PR 3 — rewriting a workspace payload's dataset
sources from ``kind: "path"`` to ``kind: "bundle"`` once staging has
verified a copy of each source, and the one sanctioned resolver that turns
a ``kind: "bundle"`` source back into a real filesystem path.

## What changes, what never does

:func:`rewrite_payload_for_bundle` deep-copies the workspace payload and
touches EXACTLY ``datasets[i].source`` for a dataset whose original source
(a) is ``kind: "path"`` and (b) matches — by
:func:`quantized.portable.layout.path_key` on ``source.path`` OR any of
its ``original_path_variants`` — a manifest source row that is
``packable`` AND was actually staged this run (matched by
``bundle_path``; a row can be *planned* packable without ever having been
staged, e.g. a caller that stopped early). Everything else in the payload
— embedded data snapshots, corrections, provenance, figures, recipes,
analyses, annotations, history policy, project metadata, and every dataset
whose source was NOT packed — passes through byte-for-byte. A dataset
whose source is left untouched stays exactly as honest as it is today: an
absolute path a future open may report missing/offline.

The result is re-validated with
:func:`quantized.desktop_project_file.parse_workspace_payload` before it is
returned — imported at MODULE level here (review finding #7 on PR 3: the
previous function-local import was justified by a circular-import claim
that does not actually hold). ``quantized.desktop_project_file`` never
imports anything from ``quantized.portable`` at ITS OWN module level — its
one cross-package call, in ``declared_source_paths_of`` (which does resolve
a ``kind: "bundle"`` source through :func:`resolve_bundle_source` below),
stays function-local there for a real reason of its own:
``quantized.portable.publish`` needs
``quantized.desktop_project_file.WRITE_TEMP_PREFIX`` at module-LOAD time, so
a module-level import in the other direction would be the genuine cycle.
Since that direction is one-way, this module importing
``quantized.desktop_project_file`` at the top has nothing to cycle against
— verified by importing each module first, in both orders
(``tests/test_desktop_project_file.py``).
"""

from __future__ import annotations

import copy
import json
import os
from collections.abc import Mapping, Sequence
from typing import Any

from quantized.desktop_project_file import parse_workspace_payload

from .copying import StagedFile
from .layout import is_bundle_relative, join_bundle_path, path_key

__all__ = ["rewrite_payload_for_bundle", "resolve_bundle_source"]


def resolve_bundle_source(base_dir: str, rel: str) -> str | None:
    """The ONE sanctioned way to turn a ``kind: "bundle"`` source's
    bundle-relative ``path`` back into a real filesystem path, resolved
    against ``base_dir`` (the ``.dwk``'s own directory).

    Returns ``None`` — never raises — when ``rel`` fails
    :func:`quantized.portable.layout.is_bundle_relative` or the join
    otherwise cannot be computed (see
    :func:`quantized.portable.layout.join_bundle_path`'s own containment
    check)."""
    try:
        return join_bundle_path(base_dir, rel)
    except ValueError:
        return None


def _row_keys(row: Mapping[str, Any]) -> set[str]:
    keys: set[str] = set()
    original_path = row.get("original_path")
    if isinstance(original_path, str):
        keys.add(path_key(original_path))
    variants = row.get("original_path_variants")
    if isinstance(variants, list):
        for v in variants:
            if isinstance(v, str):
                keys.add(path_key(v))
    return keys


def _staged_mtime(
    bundle_path: str,
    staged_mtimes: Mapping[str, float] | None,
    staging_root: str | None,
) -> float | None:
    if staged_mtimes is not None and bundle_path in staged_mtimes:
        return staged_mtimes[bundle_path]
    if staging_root is not None:
        try:
            dest = join_bundle_path(staging_root, bundle_path)
            return os.stat(dest).st_mtime
        except (OSError, ValueError):
            return None
    return None


def rewrite_payload_for_bundle(
    payload: Mapping[str, Any],
    manifest: Mapping[str, Any],
    staged: Sequence[StagedFile],
    *,
    staged_mtimes: Mapping[str, float] | None = None,
    staging_root: str | None = None,
) -> dict[str, Any]:
    """Deep-copy ``payload`` and rewrite every packed dataset's ``source``
    to ``kind: "bundle"``. See the module docstring for exactly what is and
    is not touched.

    ``staged_mtimes`` (``bundle_path -> mtime``) is consulted first when
    given; otherwise, when ``staging_root`` is given, the staged copy at
    ``join_bundle_path(staging_root, bundle_path)`` is ``os.stat``-ed for
    its mtime. When neither resolves an mtime, the ``"mtime"`` field is
    simply omitted (it is optional in the bundle-source shape) rather than
    written as a lie.

    Raises ``ValueError`` when the rewritten result fails
    ``parse_workspace_payload``. Never mutates ``payload``."""
    result: dict[str, Any] = copy.deepcopy(payload) if isinstance(payload, dict) else dict(
        copy.deepcopy(payload)
    )
    datasets = result.get("datasets")
    if isinstance(datasets, list):
        staged_by_bundle_path = {s.bundle_path: s for s in staged}
        sources_raw = manifest.get("sources")
        rows = sources_raw if isinstance(sources_raw, list) else []

        lookup: dict[str, dict[str, Any]] = {}
        for row in rows:
            if not isinstance(row, dict) or not row.get("packable"):
                continue
            bundle_path = row.get("bundle_path")
            if not isinstance(bundle_path, str) or bundle_path not in staged_by_bundle_path:
                continue  # planned packable but never actually staged this run
            if not is_bundle_relative(bundle_path):
                continue  # defense-in-depth; PR 1 already guarantees this
            for key in _row_keys(row):
                lookup[key] = row

        for ds in datasets:
            if not isinstance(ds, dict):
                continue
            source = ds.get("source")
            if not isinstance(source, dict) or source.get("kind") != "path":
                continue
            path = source.get("path")
            if not isinstance(path, str) or not path:
                continue
            row = lookup.get(path_key(path))
            if row is None:
                continue  # not packed this run -- leave the absolute source untouched
            bundle_path = row["bundle_path"]
            staged_file = staged_by_bundle_path[bundle_path]
            new_source: dict[str, Any] = {
                "kind": "bundle",
                "path": bundle_path,
                "checksum": staged_file.checksum,
                "size": staged_file.bytes,
                "packedFrom": path,
            }
            mtime = _staged_mtime(bundle_path, staged_mtimes, staging_root)
            if mtime is not None:
                new_source["mtime"] = mtime
            ds["source"] = new_source

    validated, error = parse_workspace_payload(json.dumps(result))
    if validated is None:
        raise ValueError(f"rewritten payload failed validation: {error}")
    return result
