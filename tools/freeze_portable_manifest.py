"""Freeze the P1.7 "Pack Project" dry-run manifest schema fixture.

Not a MATLAB freeze (see ``tools/matlab/freeze_calc_values.m`` for that
lineage) -- this is the staleness guard for
``quantized.portable.manifest.build_dry_run_manifest``'s OWN output shape:
a deterministic synthetic workspace payload + a fixed fake probe is run
through the real builder here, and the committed JSON
(``tests/fixtures/portable/manifest_v1.json``) is what
``tests/test_portable_manifest_fixture.py`` byte-compares against forever
-- it never regenerates at test time. If the manifest's field set,
ordering rules, or collision/sanitization behaviour ever change on
purpose, re-run this script and commit the new fixture alongside that
change.

The synthetic payload is built to exercise every rule the manifest builder
implements in one document:
  - a shared source (``/data/shared/run1.csv``) referenced by two datasets
    with different recorded provenance (one checksum-matching, one not);
  - two different files with the same basename in different folders
    (a plain destination collision);
  - a case-variant NAMING collision (``Run1.CSV`` vs ``run1.csv`` in
    DIFFERENT folders -- a destination-basename collision only, never a
    shared-source dedup, since the full paths were never the same key);
  - PR #305 review fix regression cases, same folder, differing only by
    case -- proving dedup is by EXACT path string and collapse is by
    filesystem identity alone, never by a folded key:
    - ``/data/case/A.csv`` vs ``/data/case/a.csv`` with DIFFERENT fake
      ``(dev, ino)`` identities and different checksums -- must stay TWO
      rows with a visible destination suffix, never silently share one
      packed copy;
    - ``/data/same/Run1.csv`` vs ``/data/same/run1.csv`` with the SAME
      fake ``(dev, ino)`` identity and checksum -- provably one physical
      file, so it DOES collapse to one row with both spellings recorded
      in ``original_path_variants``;
  - a Windows path, a UNC path, a POSIX path, and a macOS ``/Volumes/...``
    path reported ``offline``;
  - a ``missing`` file and a ``permission_denied`` file;
  - a Unicode name (``mesures_\u00b50H_\u00e9lan.csv``);
  - a Windows-reserved name (``CON.csv``) and one with a multi-dot extension
    (``CON.tar.gz`` -- Windows reserves the part before the FIRST dot);
  - an over-long name (sanitized+hashed);
  - a keeper-suffix collision (review finding #1): two files named
    ``keep.csv`` in different folders, PLUS two files ALREADY named
    ``keep (2).csv`` in two other folders -- the naive "keeper gets its
    plain name unconditionally" ordering let the second pair's keeper
    collide with the suffix the first pair's second member was assigned;
  - a dataset with no source at all, and one with a malformed source.

Run::

    uv run python tools/freeze_portable_manifest.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from quantized.portable.manifest import build_dry_run_manifest, manifest_json  # noqa: E402

OUT_PATH = REPO_ROOT / "tests" / "fixtures" / "portable" / "manifest_v1.json"

_LONG_NAME = ("mpms_zfc_run_" * 20) + ".dat"


def _cksum(char: str) -> str:
    """A fixed, obviously-fake 64-hex-char checksum -- never a real digest,
    just a distinct, deterministic stand-in per fixture case."""
    return f"sha256:{char * 64}"


# Keyed by the EXACT original path string the synthetic payload declares --
# a fixed, hand-written fake probe (never a real filesystem read) so the
# fixture is reproducible with no I/O at freeze time.
_FAKE_PROBE: dict[str, dict[str, Any]] = {
    "/data/shared/run1.csv": {
        "state": "ok",
        "size": 4096,
        "mtime": 1_700_000_000.0,
        "checksum": _cksum("a"),
    },
    "/data/one/dup.csv": {
        "state": "ok",
        "size": 128,
        "mtime": 1_700_000_100.0,
        "checksum": _cksum("b"),
    },
    "/data/two/dup.csv": {
        "state": "ok",
        "size": 256,
        "mtime": 1_700_000_200.0,
        "checksum": _cksum("c"),
    },
    "/data/one/Run1.CSV": {"state": "ok", "size": 64, "mtime": 1_700_000_300.0},
    "/data/two/run1.csv": {"state": "ok", "size": 96, "mtime": 1_700_000_400.0},
    # PR #305 review fix: same folder, differ only by case, DIFFERENT
    # filesystem identities -- must never collapse into one shared source.
    "/data/case/A.csv": {
        "state": "ok",
        "size": 111,
        "mtime": 1_700_001_500.0,
        "dev": 10,
        "ino": 111,
        "checksum": _cksum("1"),
    },
    "/data/case/a.csv": {
        "state": "ok",
        "size": 222,
        "mtime": 1_700_001_600.0,
        "dev": 10,
        "ino": 222,
        "checksum": _cksum("2"),
    },
    # Same folder, differ only by case, SAME filesystem identity -- provably
    # one physical file, so this DOES collapse into one row.
    "/data/same/Run1.csv": {
        "state": "ok",
        "size": 333,
        "mtime": 1_700_001_700.0,
        "dev": 20,
        "ino": 333,
        "checksum": _cksum("3"),
    },
    "/data/same/run1.csv": {
        "state": "ok",
        "size": 333,
        "mtime": 1_700_001_700.0,
        "dev": 20,
        "ino": 333,
        "checksum": _cksum("3"),
    },
    "C:\\lab\\data\\ok.csv": {
        "state": "ok",
        "size": 512,
        "mtime": 1_700_000_500.0,
        "checksum": _cksum("d"),
    },
    "\\\\labshare\\data\\shared_run.dat": {
        "state": "ok",
        "size": 8192,
        "mtime": 1_700_000_600.0,
        "checksum": _cksum("e"),
    },
    "/Volumes/ExternalDrive/data/moved.csv": {"state": "offline"},
    "/data/gone/vanished.csv": {"state": "missing"},
    "/data/locked/secret.dat": {"state": "permission_denied"},
    "/data/unicode/mesures_\u00b50H_\u00e9lan.csv": {
        "state": "ok",
        "size": 2048,
        "mtime": 1_700_000_700.0,
        "checksum": _cksum("f"),
    },
    "/data/reserved/CON.csv": {"state": "ok", "size": 32, "mtime": 1_700_000_800.0},
    "/data/reserved2/CON.tar.gz": {"state": "ok", "size": 48, "mtime": 1_700_001_000.0},
    f"/data/long/{_LONG_NAME}": {
        "state": "ok",
        "size": 16384,
        "mtime": 1_700_000_900.0,
        "checksum": _cksum("0"),
    },
    "/collide/a/keep.csv": {"state": "ok", "size": 11, "mtime": 1_700_001_100.0},
    "/collide/z/keep.csv": {"state": "ok", "size": 12, "mtime": 1_700_001_200.0},
    "/collide/m/keep (2).csv": {"state": "ok", "size": 13, "mtime": 1_700_001_300.0},
    "/collide/n/keep (2).csv": {"state": "ok", "size": 14, "mtime": 1_700_001_400.0},
}


def _fake_probe(path: str) -> dict[str, Any]:
    return _FAKE_PROBE.get(path, {"state": "missing", "path": path})


def _path_source(path: str, **provenance: Any) -> dict[str, Any]:
    return {"kind": "path", "path": path, **provenance}


def build_fixture_payload() -> dict[str, Any]:
    """The deterministic synthetic workspace payload — also imported
    directly by ``tests/test_portable_manifest_fixture.py`` so the pytest
    side runs the SAME builder, never a hand-copied duplicate."""
    return {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [
            {
                "id": "ds-shared-a",
                "name": "ZFC run (first import)",
                "source": _path_source(
                    "/data/shared/run1.csv", checksum=_cksum("a"), mtime=1_700_000_000.0, size=4096
                ),
            },
            {
                "id": "ds-shared-b",
                "name": "ZFC run (reimported elsewhere)",
                "source": _path_source(
                    "/data/shared/run1.csv", checksum=_cksum("9"), mtime=1_699_000_000.0, size=4000
                ),
            },
            {
                "id": "ds-dup-one",
                "name": "Duplicate basename (folder one)",
                "source": _path_source(
                    "/data/one/dup.csv", checksum=_cksum("b"), mtime=1_700_000_100.0, size=128
                ),
            },
            {
                "id": "ds-dup-two",
                "name": "Duplicate basename (folder two)",
                "source": _path_source(
                    "/data/two/dup.csv", checksum=_cksum("c"), mtime=1_700_000_200.0, size=256
                ),
            },
            {
                "id": "ds-case-one",
                "name": "Case-variant collision (upper)",
                "source": _path_source("/data/one/Run1.CSV"),
            },
            {
                "id": "ds-case-two",
                "name": "Case-variant collision (lower)",
                "source": _path_source("/data/two/run1.csv"),
            },
            {
                "id": "ds-case-identity-upper",
                "name": "Same-folder case variant, DIFFERENT identity (upper)",
                "source": _path_source("/data/case/A.csv"),
            },
            {
                "id": "ds-case-identity-lower",
                "name": "Same-folder case variant, DIFFERENT identity (lower)",
                "source": _path_source("/data/case/a.csv"),
            },
            {
                "id": "ds-same-identity-upper",
                "name": "Same-folder case variant, SAME identity (upper)",
                "source": _path_source("/data/same/Run1.csv"),
            },
            {
                "id": "ds-same-identity-lower",
                "name": "Same-folder case variant, SAME identity (lower)",
                "source": _path_source("/data/same/run1.csv"),
            },
            {
                "id": "ds-windows",
                "name": "Windows path",
                "source": _path_source(
                    "C:\\lab\\data\\ok.csv", checksum=_cksum("d"), mtime=1_700_000_500.0, size=512
                ),
            },
            {
                "id": "ds-unc",
                "name": "UNC path",
                "source": _path_source(
                    "\\\\labshare\\data\\shared_run.dat",
                    checksum=_cksum("e"),
                    mtime=1_700_000_600.0,
                    size=8192,
                ),
            },
            {
                "id": "ds-macos-offline",
                "name": "macOS volume, now offline",
                "source": _path_source("/Volumes/ExternalDrive/data/moved.csv"),
            },
            {
                "id": "ds-missing",
                "name": "Deleted source",
                "source": _path_source("/data/gone/vanished.csv"),
            },
            {
                "id": "ds-permission-denied",
                "name": "Permission-denied source",
                "source": _path_source("/data/locked/secret.dat"),
            },
            {
                "id": "ds-unicode",
                "name": "Unicode filename",
                "source": _path_source(
                    "/data/unicode/mesures_\u00b50H_\u00e9lan.csv",
                    checksum=_cksum("f"),
                    mtime=1_700_000_700.0,
                    size=2048,
                ),
            },
            {
                "id": "ds-reserved",
                "name": "Windows-reserved basename",
                "source": _path_source("/data/reserved/CON.csv"),
            },
            {
                "id": "ds-reserved-multi-dot",
                "name": "Windows-reserved basename, multi-dot extension",
                "source": _path_source("/data/reserved2/CON.tar.gz"),
            },
            {
                "id": "ds-long-name",
                "name": "Over-long basename",
                "source": _path_source(
                    f"/data/long/{_LONG_NAME}",
                    checksum=_cksum("0"),
                    mtime=1_700_000_900.0,
                    size=16384,
                ),
            },
            {
                "id": "ds-collide-keep-a",
                "name": "Keeper-suffix collision (folder a)",
                "source": _path_source("/collide/a/keep.csv"),
            },
            {
                "id": "ds-collide-keep-z",
                "name": "Keeper-suffix collision (folder z)",
                "source": _path_source("/collide/z/keep.csv"),
            },
            {
                "id": "ds-collide-keep2-m",
                "name": "Pre-existing 'keep (2).csv' (folder m)",
                "source": _path_source("/collide/m/keep (2).csv"),
            },
            {
                "id": "ds-collide-keep2-n",
                "name": "Pre-existing 'keep (2).csv' (folder n)",
                "source": _path_source("/collide/n/keep (2).csv"),
            },
            {
                "id": "ds-embedded-only",
                "name": "No source at all (embedded-only import)",
            },
            {
                "id": "ds-malformed",
                "name": "Malformed source object",
                "source": {"kind": "path", "path": ""},
            },
        ],
    }


def build_fixture_manifest() -> dict[str, Any]:
    """The manifest this fixture pins -- also imported directly by
    ``tests/test_portable_manifest_fixture.py``."""
    return build_dry_run_manifest(build_fixture_payload(), "demo_project", _fake_probe)


def main() -> None:
    text = manifest_json(build_fixture_manifest())
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(text, encoding="utf-8")
    print(f"wrote {OUT_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
