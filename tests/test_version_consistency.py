"""The five release-version declarations must agree — a guard against the
version-drift footgun.

Quantized carries its version in five places (see ``RELEASE.md``): the Python
package (``pyproject.toml`` + ``quantized.__version__``), the desktop shell
(``src-tauri/Cargo.toml`` + ``src-tauri/tauri.conf.json``), and the SPA
(``frontend/package.json``). The release workflow derives the auto-updater's
``latest.json`` version from the git *tag*, so a file left behind does NOT fail
the build — it silently ships an installer whose internal version disagrees
with the tag, which puts Windows auto-update into an update loop (this bit
v0.2.0–v0.2.3, where ``__version__`` sat at ``0.1.0`` and the health endpoint
reported the wrong version). This test makes the drift a red CI check instead.
"""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _pyproject_version() -> str:
    data = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    return str(data["project"]["version"])


def _dunder_version() -> str:
    text = (ROOT / "src" / "quantized" / "__init__.py").read_text(encoding="utf-8")
    m = re.search(r'^__version__\s*=\s*"([^"]+)"', text, re.MULTILINE)
    assert m, "__version__ not found in src/quantized/__init__.py"
    return m.group(1)


def _cargo_version() -> str:
    data = tomllib.loads((ROOT / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8"))
    return str(data["package"]["version"])


def _tauri_version() -> str:
    data = json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))
    return str(data["version"])


def _frontend_version() -> str:
    data = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    return str(data["version"])


def test_all_version_declarations_agree() -> None:
    """All five release-version declarations must be byte-identical."""
    versions = {
        "pyproject.toml": _pyproject_version(),
        "src/quantized/__init__.py": _dunder_version(),
        "src-tauri/Cargo.toml": _cargo_version(),
        "src-tauri/tauri.conf.json": _tauri_version(),
        "frontend/package.json": _frontend_version(),
    }
    distinct = set(versions.values())
    assert len(distinct) == 1, (
        "release versions disagree (bump ALL of them together — see RELEASE.md):\n"
        + "\n".join(f"  {f}: {v}" for f, v in versions.items())
    )


def test_version_is_pep440_ish() -> None:
    """A plain ``X.Y.Z`` (optionally with a pre-release suffix) — the shape the
    ``vX.Y.Z`` release tag and Cargo/npm/Tauri all accept."""
    version = _pyproject_version()
    assert re.fullmatch(r"\d+\.\d+\.\d+([.-]?(a|b|rc|pre|dev)\.?\d*)?", version), (
        f"version {version!r} is not a clean X.Y.Z(-pre) string"
    )
