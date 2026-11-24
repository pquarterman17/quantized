"""``qz convert --gui`` and the opt-in right-click entry.

The server and the browser are replaced by recorders, and the Windows registry
by a fake ``winreg`` -- these tests never start uvicorn, open a window or touch
the real registry.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from quantized import convert_context_menu as cm
from quantized import convert_gui_launch as gl
from quantized.cli import main as qz_main
from quantized.cli_convert import convert_command
from quantized.io.convert_session import PREFILL_ENV, prefill_from_env

# ── --gui ───────────────────────────────────────────────────────────────────


@pytest.fixture
def launched(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Replace the server / browser / window; restore the env the launcher sets."""
    rec: dict[str, Any] = {}
    for var in (PREFILL_ENV, "QZ_DATA_ROOTS", "QZ_AUTO_SHUTDOWN", "QZ_API_TOKEN"):
        monkeypatch.setenv(var, "x")  # records the original, so the launcher's writes are undone
        monkeypatch.delenv(var)
    monkeypatch.setattr(gl, "_open_when_healthy", lambda url, host, port: rec.update(opened=url))
    monkeypatch.setattr(
        gl, "_resolve_port", lambda host, port, explicit: rec.update(want=(port, explicit)) or 8765
    )
    monkeypatch.setattr(gl, "_run_desktop", lambda host, port, **kw: rec.update(desktop=(port, kw)))
    import uvicorn

    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: rec.update(served=(app, kw)))
    return rec


def test_gui_prefills_files_opens_convert_page_headless(
    launched: dict[str, Any], tmp_path: Path
) -> None:
    f = tmp_path / "scan.dat"
    f.write_text("x")
    assert convert_command(["--gui", str(f), str(tmp_path / "missing.dat")]) == 0
    assert prefill_from_env() == [str(f)]  # a missing file is left out, said on stderr
    assert launched["opened"].startswith("http://127.0.0.1:8765/convert?token=")
    assert launched["served"] == (
        "quantized.app:app",
        {"host": "127.0.0.1", "port": 8765, "log_level": "warning"},
    )
    assert os.environ["QZ_AUTO_SHUTDOWN"] == "1"  # closing the tab ends the server
    assert launched["want"] == (8000, False)


def test_gui_without_files_and_explicit_port(launched: dict[str, Any]) -> None:
    assert convert_command(["--gui", "--port", "9001"]) == 0
    assert prefill_from_env() == [] and launched["want"] == (9001, True)


def test_gui_desktop_uses_a_small_window_at_convert(
    launched: dict[str, Any], tmp_path: Path
) -> None:
    f = tmp_path / "a.dat"
    f.write_text("x")
    assert convert_command(["--gui", "--desktop", str(f)]) == 0
    port, kw = launched["desktop"]
    assert (
        port == 8765
        and kw["path"] == "/convert"
        and kw["title"] == "Quick Convert"
        and kw["width"] < 1000
    )
    assert "served" not in launched and "opened" not in launched


def test_prefill_widens_data_roots_only_for_outside_files(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(gl, "is_inside_data_roots", lambda p: str(p).startswith(str(tmp_path)))
    env: dict[str, str] = {"QZ_DATA_ROOTS": "/keep"}
    paths = gl.prepare_prefill([tmp_path / "in.dat", Path("/mnt/share/run/x.dat")], env)
    assert json.loads(env[PREFILL_ENV]) == paths
    # The launcher makes each path absolute (on Windows "/mnt/..." gains a drive).
    share = os.path.dirname(os.path.abspath("/mnt/share/run/x.dat"))
    assert env["QZ_DATA_ROOTS"].split(os.pathsep) == ["/keep", share]
    inside: dict[str, str] = {}
    gl.prepare_prefill([tmp_path / "in.dat"], inside)
    assert "QZ_DATA_ROOTS" not in inside


def test_desktop_and_port_need_gui(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as e:
        convert_command(["a.dat", "--desktop"])
    assert e.value.code == 2 and "--gui" in capsys.readouterr().err
    with pytest.raises(SystemExit):
        convert_command([])  # still an error: nothing to convert and no --gui


# ── right-click entry ───────────────────────────────────────────────────────


class FakeKey:
    def __init__(self, reg: FakeWinreg, path: str) -> None:
        self.reg, self.path = reg, path

    def __enter__(self) -> FakeKey:
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class FakeWinreg:
    """Just enough ``winreg`` to record writes; never touches a registry."""

    HKEY_CURRENT_USER = "HKCU"
    HKEY_LOCAL_MACHINE = "HKLM"
    KEY_WRITE = 2
    REG_SZ = 1

    def __init__(self) -> None:
        self.keys: dict[tuple[str, str], dict[str, str]] = {}

    def CreateKeyEx(self, root: str, sub: str, reserved: int, access: int) -> FakeKey:  # noqa: N802
        assert access == self.KEY_WRITE and reserved == 0
        self.keys.setdefault((root, sub), {})
        return FakeKey(self, sub)

    def SetValueEx(self, key: FakeKey, name: str, reserved: int, kind: int, value: str) -> None:  # noqa: N802
        assert kind == self.REG_SZ
        self.keys[("HKCU", key.path)][name] = value

    def DeleteKey(self, root: str, sub: str) -> None:  # noqa: N802
        if (root, sub) not in self.keys:
            raise FileNotFoundError(sub)
        del self.keys[(root, sub)]


ARGV = [r"C:\Py\pythonw.exe", "-m", "quantized.cli", "convert", "--gui"]


def test_windows_install_writes_hkcu_only_and_uninstall_removes_it() -> None:
    reg = FakeWinreg()
    cm.install_windows(reg, ARGV)
    assert {root for root, _ in reg.keys} == {"HKCU"}  # never HKLM: no admin needed
    assert all(sub.startswith(r"Software\Classes\*\shell\QuantizedConvert") for _, sub in reg.keys)
    assert reg.keys[("HKCU", cm.WIN_KEY)][""] == "Convert with Quantized"
    cmd = reg.keys[("HKCU", cm.WIN_KEY + r"\command")][""]
    assert cmd == r'"C:\Py\pythonw.exe" "-m" "quantized.cli" "convert" "--gui" -- "%1"'
    cm.install_windows(reg, ARGV)  # idempotent
    assert len(reg.keys) == 2
    assert len(cm.uninstall_windows(reg)) == 2 and reg.keys == {}
    assert cm.uninstall_windows(reg) == []  # quiet when nothing is there


def test_windows_argv_prefers_pythonw_next_to_the_interpreter(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "python.exe").write_text("")
    (tmp_path / "pythonw.exe").write_text("")
    monkeypatch.setattr("sys.executable", str(tmp_path / "python.exe"))
    assert cm.gui_argv(windows=True)[0].endswith("pythonw.exe")
    (tmp_path / "pythonw.exe").unlink()
    assert cm.gui_argv(windows=True)[0].endswith("python.exe")


def test_linux_install_and_uninstall_under_a_temp_home(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    written = cm.install_linux(tmp_path, ["/opt/qz/bin/qz", "convert", "--gui"])
    script, desktop = (Path(p) for p in written)
    assert script.parent == tmp_path / ".local/share/nautilus/scripts" and os.access(
        script, os.X_OK
    )
    assert script.read_text().splitlines()[-1] == 'exec /opt/qz/bin/qz convert --gui -- "$@"'
    assert "Exec=/opt/qz/bin/qz convert --gui -- %F" in desktop.read_text()
    assert [Path(p).name for p in cm.uninstall_linux(tmp_path)] == [script.name, desktop.name]
    assert not script.exists() and cm.uninstall_linux(tmp_path) == []


def test_cli_install_uninstall_never_use_the_real_registry_or_home(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    monkeypatch.setattr("sys.platform", "linux")
    assert convert_command(["--install-context-menu"]) == 0
    assert (tmp_path / "nautilus/scripts/Convert with Quantized").is_file()
    assert convert_command(["--uninstall-context-menu"]) == 0
    assert not (tmp_path / "nautilus/scripts/Convert with Quantized").exists()
    assert convert_command(["--uninstall-context-menu"]) == 0
    assert "nothing to remove" in capsys.readouterr().out


def test_cli_windows_path_goes_through_the_injected_module(monkeypatch: pytest.MonkeyPatch) -> None:
    reg = FakeWinreg()
    monkeypatch.setattr(cm, "_winreg", lambda: reg)
    monkeypatch.setattr("sys.platform", "win32")
    assert convert_command(["--install-context-menu"]) == 0
    assert ("HKCU", cm.WIN_KEY) in reg.keys
    assert convert_command(["--uninstall-context-menu"]) == 0 and reg.keys == {}


def test_unsupported_platform_is_refused_without_writing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("sys.platform", "darwin")
    assert convert_command(["--install-context-menu"]) == 2
    assert "darwin" in capsys.readouterr().err


def test_qz_main_routes_convert_gui(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[list[str]] = []
    monkeypatch.setattr("quantized.cli_convert.convert_command", lambda a: seen.append(a) or 0)
    with pytest.raises(SystemExit) as e:
        qz_main(["convert", "--gui", "x.dat"])
    assert e.value.code == 0 and seen == [["--gui", "x.dat"]]


def test_desktop_exec_quotes_per_the_desktop_entry_spec() -> None:
    assert cm._desktop_arg("/opt/qz/bin/qz") == "/opt/qz/bin/qz"
    # spaces need DOUBLE quotes (shlex's single quotes are not valid in Exec=)
    assert cm._desktop_arg("/opt/my qz/qz") == '"/opt/my qz/qz"'
    assert cm._desktop_arg("/o/$HOME`x`") == r'"/o/\\$HOME\\`x\\`"'
    assert cm._desktop_arg("/o/100%") == "/o/100%%"  # not a field code


def test_launchers_end_option_parsing_so_a_dash_named_file_is_a_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, launched: dict[str, Any]
) -> None:
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    written = cm.install_linux(tmp_path, ["/opt/my qz/qz", "convert", "--gui"])
    script, desktop = (Path(p) for p in written)
    assert script.read_text().splitlines()[-1].endswith(' -- "$@"')
    assert 'Exec="/opt/my qz/qz" convert --gui -- %F' in desktop.read_text()
    # and the CLI really takes a leading-dash name as an input after `--`
    monkeypatch.chdir(tmp_path)
    (tmp_path / "--install-context-menu").write_text("x")
    assert convert_command(["--gui", "--", "--install-context-menu"]) == 0
    assert prefill_from_env() == [str(tmp_path / "--install-context-menu")]


def test_prefill_never_widens_to_a_filesystem_root(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(gl, "is_inside_data_roots", lambda p: False)
    env: dict[str, str] = {}
    gl.prepare_prefill([Path("/x.dat")], env)
    assert "QZ_DATA_ROOTS" not in env and "drive root" in capsys.readouterr().err
