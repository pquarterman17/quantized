"""The desktop updater is built without its ``zip`` feature; the release must
keep shipping artifacts that do not need it.

``src-tauri/Cargo.toml`` turns off ``tauri-plugin-updater``'s default ``zip``
feature (it only unpacks Tauri-v1 ``.zip``/``.tar.gz`` update bundles, and it
pinned a vulnerable zip crate into the lock). Without it, the Windows updater
can install only a bare signed installer: a ``.zip`` payload fails with
``InvalidUpdaterFormat``, and ``check_for_update`` drops that error silently,
so every installed app would just stop updating. Neither ``ci.yml`` nor any
other PR workflow builds ``src-tauri``, so this test is the guard.
"""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _updater_dep() -> dict[str, object]:
    data = tomllib.loads((ROOT / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8"))
    dep = data["dependencies"]["tauri-plugin-updater"]
    return dep if isinstance(dep, dict) else {"version": dep}


def _updater_zip_enabled() -> bool:
    dep = _updater_dep()
    features = dep.get("features", [])
    assert isinstance(features, list)
    return dep.get("default-features", True) is not False or "zip" in features


def test_updater_builds_without_zip() -> None:
    """The zip feature stays off (RUSTSEC-2026-0367..0369)."""
    assert not _updater_zip_enabled(), (
        "tauri-plugin-updater's `zip` feature is back on; it re-adds the vulnerable zip crate"
    )


def test_release_ships_bare_installer_while_zip_is_off() -> None:
    """With zip off, the updater artifact must be the v2 NSIS installer itself."""
    if _updater_zip_enabled():
        return
    conf = json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))
    bundle = conf["bundle"]
    assert bundle["createUpdaterArtifacts"] is True, (
        "createUpdaterArtifacts must stay `true` (v2 artifacts): `v1Compatible` ships "
        ".zip bundles that an updater without the `zip` feature cannot install"
    )
    assert bundle["targets"] == ["nsis"]
    release = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    assert "*-setup.exe.sig" in release
    assert ".nsis.zip.sig" not in release
