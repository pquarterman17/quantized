"""Pack Project: flag sources that need attention before they enter a bundle.

An untrusted ``.dwk`` can declare any path as a data source, and Pack Project
copies those bytes into a bundle the user may share. A packable source is
flagged when it sits outside the allowed data folders (the import routes'
allowlist) or is not a recognised data file type (the parser registry).
Flagged sources are excluded unless the user explicitly includes them.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import pytest

from quantized import data_roots
from quantized.desktop_bridge import DesktopApi
from quantized.desktop_consent import clear_consent, set_declared_sources
from quantized.io.registry import is_recognised_data_name
from quantized.portable.attention import annotate_attention, exclude_flagged
from quantized.portable.manifest import build_dry_run_manifest


@pytest.fixture(autouse=True)
def _clean() -> Any:
    clear_consent()
    yield
    clear_consent()


def _payload(*paths: str) -> dict[str, Any]:
    return {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [
            {"id": f"d{i}", "name": f"d{i}", "source": {"kind": "path", "path": p}}
            for i, p in enumerate(paths)
        ],
    }


def _ok_probe(_path: str) -> dict[str, Any]:
    return {"state": "ok", "size": 10, "mtime": 1.0, "checksum": "abc", "dev": 0, "ino": 0}


def _missing_probe(_path: str) -> dict[str, Any]:
    return {"state": "missing"}


# -- pure annotation ---------------------------------------------------------


def test_annotate_flags_each_reason_with_a_short_message() -> None:
    manifest = build_dry_run_manifest(
        _payload("/data/run.csv", "/etc/shadow.csv", "/data/payload.exe"), "p", _ok_probe
    )
    out = annotate_attention(
        manifest,
        inside_roots=lambda p: p.startswith("/data/"),
        recognised=lambda name: name.endswith(".csv"),
    )
    by_path = {r["original_path"]: r["attention"] for r in out["sources"]}
    assert by_path["/data/run.csv"] == []
    assert [a["code"] for a in by_path["/etc/shadow.csv"]] == ["outside_data_roots"]
    assert [a["code"] for a in by_path["/data/payload.exe"]] == ["unrecognised_extension"]
    for flags in by_path.values():
        for a in flags:
            assert a["reason"] and "/" not in a["reason"]  # short, path-free
    assert out["summary"]["attention"] == 2
    # The input is not mutated (the bridge stores what it annotates).
    assert "attention" not in manifest["sources"][0]


def test_annotate_never_inspects_unpackable_rows() -> None:
    """A blocked row is never copied, and may not be consented: no checks run."""
    manifest = build_dry_run_manifest(_payload("/nowhere/x.exe"), "p", _missing_probe)
    calls: list[str] = []

    def spy(p: str) -> bool:
        calls.append(p)
        return False

    out = annotate_attention(manifest, inside_roots=spy, recognised=spy)
    assert out["sources"][0]["attention"] == []
    assert calls == []


def test_exclude_flagged_unpacks_only_flagged_rows() -> None:
    manifest = build_dry_run_manifest(
        _payload("/data/run.csv", "/data/payload.exe"), "p", _ok_probe
    )
    annotated = annotate_attention(
        manifest, inside_roots=lambda _p: True, recognised=lambda n: n.endswith(".csv")
    )
    out = exclude_flagged(annotated)
    rows = {r["original_path"]: r for r in out["sources"]}
    assert rows["/data/run.csv"]["packable"] is True
    assert rows["/data/payload.exe"]["packable"] is False
    assert "excluded_needs_attention" in rows["/data/payload.exe"]["blockers"]
    assert annotated["sources"][1]["packable"] is True  # input untouched


def test_registry_recognises_data_extensions_only() -> None:
    for name in ("run.csv", "scan.XRDML", "m.dat", "proj.opju", "x.brml", "sample.0", "s.12"):
        assert is_recognised_data_name(name), name
    for name in ("id_rsa", "payload.exe", "notes.docx", "shadow"):
        assert not is_recognised_data_name(name), name


def test_is_inside_data_roots_follows_symlinks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    allowed = tmp_path / "allowed"
    outside = tmp_path / "outside"
    allowed.mkdir()
    outside.mkdir()
    (outside / "secret.csv").write_text("1\n")
    link = allowed / "link.csv"
    try:
        link.symlink_to(outside / "secret.csv")
    except OSError:
        pytest.skip("symlinks unavailable")
    monkeypatch.setattr(data_roots, "allowed_data_roots", lambda: (os.path.realpath(allowed),))
    assert not data_roots.is_inside_data_roots(str(link))
    assert data_roots.is_inside_data_roots(str(allowed / "plain.csv"))
    assert not data_roots.is_inside_data_roots(str(tmp_path / "allowed-sibling" / "x.csv"))


# -- the desktop bridge (preview flags, start excludes by default) ----------


class _FakeWindow:
    def __init__(self, result: Any) -> None:
        self.result = result

    def create_file_dialog(self, _kind: Any, **_kw: Any) -> Any:
        return self.result


def _setup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[DesktopApi, str, dict[str, Path]]:
    allowed = tmp_path / "allowed"
    outside = tmp_path / "outside"
    allowed.mkdir()
    outside.mkdir()
    files = {
        "good": allowed / "run.csv",
        "exe": allowed / "payload.exe",
        "outside": outside / "secret.csv",
    }
    for f in files.values():
        f.write_text("T,M\n1,10\n", encoding="utf-8")
    monkeypatch.setattr(data_roots, "allowed_data_roots", lambda: (os.path.realpath(allowed),))
    set_declared_sources([str(f) for f in files.values()])
    content = json.dumps(_payload(*[str(f) for f in files.values()]))
    dest = tmp_path / "dest"
    dest.mkdir()
    api = DesktopApi()
    api.attach(_FakeWindow([str(dest)]))
    picked = api.pick_pack_destination()
    assert picked["path"] is not None
    return api, content, files


def _wait(api: DesktopApi) -> dict[str, Any]:
    deadline = time.time() + 10
    status = api.pack_status()
    while status["phase"] in ("packing", "cancelling") and time.time() < deadline:
        time.sleep(0.01)
        status = api.pack_status()
    return status


def _preview(api: DesktopApi, content: str, tmp_path: Path) -> dict[str, Any]:
    out = api.pack_preview(content, "proj", str(tmp_path / "dest"))
    assert out["ok"], out
    return out


def test_bridge_preview_flags_outside_and_unrecognised(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    api, content, files = _setup(tmp_path, monkeypatch)
    out = _preview(api, content, tmp_path)
    flags = {
        r["original_path"]: [a["code"] for a in r["attention"]] for r in out["manifest"]["sources"]
    }
    assert flags[str(files["good"])] == []
    assert flags[str(files["exe"])] == ["unrecognised_extension"]
    assert flags[str(files["outside"])] == ["outside_data_roots"]
    assert out["manifest"]["summary"]["attention"] == 2


def test_bridge_start_excludes_flagged_by_default(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    api, content, _files = _setup(tmp_path, monkeypatch)
    out = _preview(api, content, tmp_path)
    assert api.pack_start(out["token"], content)["ok"]
    status = _wait(api)
    assert status["phase"] == "completed", status
    packed = sorted(p.name for p in (Path(status["result"]["bundle_dir"]) / "sources").iterdir())
    assert packed == ["run.csv"]


def test_bridge_start_includes_flagged_on_explicit_confirm(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    api, content, _files = _setup(tmp_path, monkeypatch)
    out = _preview(api, content, tmp_path)
    assert api.pack_start(out["token"], content, True)["ok"]
    status = _wait(api)
    assert status["phase"] == "completed", status
    packed = sorted(p.name for p in (Path(status["result"]["bundle_dir"]) / "sources").iterdir())
    assert packed == ["payload.exe", "run.csv", "secret.csv"]
