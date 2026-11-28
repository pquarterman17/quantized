"""``/api/convert/*``: the quick-convert window's routes and engine.

Real committed fixtures (an .xrdml scan, a QD .dat, an RSM map); the routes
run through ``TestClient`` and the job queue like the SPA does. Pinned: the
guess per file, the allowed-roots confinement (reads AND the output folder),
fail-closed overwrite, staged (dropped) files needing an output folder, the
timestamped report that never collides with an earlier run's, and the CLI
staying fail-closed on the same existing report.
"""

from __future__ import annotations

import json
import os
import shutil
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app
from quantized.cli_convert import convert_command
from quantized.io.convert_run import free_report_path
from quantized.io.convert_session import PREFILL_ENV, list_directory, run_conversion

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture
def work(tmp_path: Path) -> Path:
    d = tmp_path / "in"
    d.mkdir()
    for n in ("xrdml_la2nio4.xrdml", "qd_edp124.dat", "xrdml_rsm_synthetic.xrdml"):
        shutil.copy(FIX / n, d / n)
    return d


def _run(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    r = client.post("/api/convert/run", json=body)
    assert r.status_code == 200, r.text
    job = r.json()["job_id"]
    for _ in range(300):
        snap = client.get(f"/api/jobs/{job}").json()
        if snap["status"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.1)
    assert snap["status"] == "done", snap
    res: dict[str, Any] = client.get(f"/api/jobs/{job}/result").json()["result"]
    return res


def test_config_lists_formats_and_prefill(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(PREFILL_ENV, json.dumps(["/a/b.dat", 3]))
    cfg = client.get("/api/convert/config").json()
    assert [f["id"] for f in cfg["formats"]] == [
        "csv",
        "xlsx",
        "xy",
        "h5",
        "nxs",
        "mat",
        "json",
        "npz",
        "sqlite",
        "xml",
        "nc",
    ]
    assert {f["id"]: f["container"] for f in cfg["formats"]}["csv"] is False
    assert cfg["prefill"] == ["/a/b.dat"]  # a malformed item is dropped, not raised
    monkeypatch.setenv(PREFILL_ENV, "{not json")
    assert client.get("/api/convert/config").json()["prefill"] == []


def test_preview_guesses_type_format_columns_units(client: TestClient, work: Path) -> None:
    paths = [
        str(work / n) for n in ("xrdml_la2nio4.xrdml", "qd_edp124.dat", "xrdml_rsm_synthetic.xrdml")
    ]
    paths.append(str(work / "nope.dat"))
    body = client.post("/api/convert/preview", json={"paths": paths}).json()
    assert body["out_dir_status"] == "same"
    xrd, qd, rsm, missing = body["files"]
    assert (xrd["kind_label"], xrd["format"]) == ("PANalytical / Malvern XRDML", "xy")
    assert [(c["name"], c["unit"]) for c in xrd["datasets"][0]["columns"]] == [
        ("2-Theta", "deg"), ("Intensity", "cps")]  # fmt: skip
    assert xrd["outputs"] == ["xrdml_la2nio4.xrdml.xy"]
    assert qd["format"] == "csv" and qd["datasets"][0]["rows"] > 0
    assert rsm["format"] == "h5" and rsm["datasets"][0]["is_map"]
    assert missing["error"] == "file not found"


def test_preview_forced_format_and_unknown_format(client: TestClient, work: Path) -> None:
    f = str(work / "qd_edp124.dat")
    got = client.post("/api/convert/preview", json={"paths": [f], "format": "npz"}).json()
    assert got["files"][0]["format"] == "npz"
    assert got["files"][0]["format_source"] == "requested"
    bad = client.post("/api/convert/preview", json={"paths": [f], "format": "dwk"})
    assert bad.status_code == 422 and "unknown format" in bad.json()["detail"]


def test_preview_unknown_file_type_is_a_clear_error_not_a_crash(
    client: TestClient, tmp_path: Path
) -> None:
    junk = tmp_path / "notes.zzz"
    junk.write_bytes(b"\x00\x01\x02 not data")
    got = client.post("/api/convert/preview", json={"paths": [str(junk)]}).json()["files"][0]
    assert got["error"] and got["datasets"] == []


def test_preview_out_dir_status(client: TestClient, work: Path, tmp_path: Path) -> None:
    f = str(work / "qd_edp124.dat")

    def status(out: str) -> str:
        r = client.post("/api/convert/preview", json={"paths": [f], "out_dir": out})
        return str(r.json()["out_dir_status"])

    assert status(str(tmp_path)) == "exists"
    assert status(str(tmp_path / "new")) == "will_be_created"
    assert status(f) == "not_a_folder"


def test_run_writes_next_to_input_and_a_timestamped_report(client: TestClient, work: Path) -> None:
    paths = [str(work / "xrdml_la2nio4.xrdml"), str(work / "qd_edp124.dat")]
    res = _run(client, {"paths": paths})
    outcomes = [e["outcome"] for e in res["report"]["files"]]
    assert outcomes == ["done", "done"]
    assert (work / "xrdml_la2nio4.xrdml.xy").is_file() and (work / "qd_edp124.dat.csv").is_file()
    assert res["report_error"] is None and not res["cancelled"]
    report = Path(res["report_path"])
    assert report.parent == work and report.name.startswith("convert-report-")
    assert json.loads(report.read_text())["summary"]["ok"] == 2


def test_run_never_overwrites_unless_ticked(client: TestClient, work: Path) -> None:
    body: dict[str, Any] = {"paths": [str(work / "qd_edp124.dat")], "format": "csv"}
    first = _run(client, body)
    out = work / "qd_edp124.dat.csv"
    out.write_text("precious")
    second = _run(client, body)  # also: convert-report.json-style collisions are not a problem
    e = second["report"]["files"][0]
    assert e["outcome"] == "skipped-exists" and out.read_text() == "precious"
    assert "exists" in e["reason"]
    assert first["report_path"] != second["report_path"]
    third = _run(client, {**body, "overwrite": True})
    assert third["report"]["files"][0]["outcome"] == "done" and out.read_text() != "precious"


def test_second_run_after_a_cli_report_exists_still_works(client: TestClient, work: Path) -> None:
    """The awkward case: ``convert-report.json`` is already there (from the
    CLI). The CLI refuses a second run; the GUI path just names its own."""
    f = work / "qd_edp124.dat"
    assert convert_command([str(f), "--to", "csv"]) == 0
    assert (work / "convert-report.json").is_file()
    assert convert_command([str(f), "--to", "npz"]) == 2  # CLI: fail closed, nothing written
    assert not (work / "qd_edp124.dat.npz").exists()
    res = _run(client, {"paths": [str(f)], "format": "npz"})
    assert res["report"]["files"][0]["outcome"] == "done"
    assert Path(res["report_path"]).name != "convert-report.json"
    assert (work / "convert-report.json").read_text()  # untouched


def test_run_to_an_output_folder_creates_it_and_multi_format(
    client: TestClient, work: Path, tmp_path: Path
) -> None:
    out = tmp_path / "exports" / "deep"
    for fmt, name in (
        ("xlsx", "xrdml_la2nio4.xrdml.xlsx"),
        ("json", "xrdml_la2nio4.xrdml.json"),
        ("mat", "xrdml_la2nio4.xrdml.mat"),
    ):
        res = _run(
            client,
            {"paths": [str(work / "xrdml_la2nio4.xrdml")], "out_dir": str(out), "format": fmt},
        )
        assert res["report"]["files"][0]["outcome"] == "done", res
        assert (out / name).stat().st_size > 0
    assert not list(work.glob("*.xlsx"))  # nothing next to the input when a folder was chosen


def test_rsm_map_to_flat_is_a_long_table(client: TestClient, work: Path, tmp_path: Path) -> None:
    res = _run(
        client,
        {
            "paths": [str(work / "xrdml_rsm_synthetic.xrdml")],
            "out_dir": str(tmp_path / "o"),
            "format": "csv",
        },
    )
    assert res["report"]["files"][0]["outcome"] == "done"
    text = (tmp_path / "o" / "xrdml_rsm_synthetic.xrdml.csv").read_text()
    header = [ln for ln in text.splitlines() if not ln.startswith("#")][0]
    assert header.count(",") >= 3  # X, Y, Z (+ Q) columns, one row per point


def test_bad_and_good_files_in_one_run(client: TestClient, work: Path) -> None:
    junk = work / "notes.zzz"
    junk.write_bytes(b"\x00\x01")
    res = _run(client, {"paths": [str(junk), str(work / "qd_edp124.dat"), str(work / "gone.dat")]})
    got = {Path(e["source"]).name: e for e in res["report"]["files"]}
    assert got["notes.zzz"]["outcome"] == "failed" and got["notes.zzz"]["reason"]
    assert got["qd_edp124.dat"]["outcome"] == "done"
    assert got["gone.dat"]["reason"] == "file not found"


def test_unwritable_output_folder_is_a_per_file_error(client: TestClient, work: Path) -> None:
    blocker = work / "afile"
    blocker.write_text("x")  # a file where a folder is wanted (root can write anywhere else)
    res = _run(client, {"paths": [str(work / "qd_edp124.dat")], "out_dir": str(blocker / "sub")})
    e = res["report"]["files"][0]
    assert e["outcome"] == "failed" and "writing failed" in e["reason"]
    assert res["report_path"] is None and res["report_error"]  # no report either, said plainly


def test_outputs_and_inputs_outside_the_allowed_roots_are_refused(
    client: TestClient, work: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = os.path.realpath(work.parent)
    monkeypatch.setattr("quantized.routes.convert_quick.allowed_data_roots", lambda: (root,))
    monkeypatch.setattr(
        "quantized.routes.convert_quick.allowed_data_prefixes", lambda: (root + os.sep,)
    )
    ok = client.post("/api/convert/preview", json={"paths": [str(work / "qd_edp124.dat")]})
    assert ok.status_code == 200
    r = client.post(
        "/api/convert/run", json={"paths": [str(work / "qd_edp124.dat")], "out_dir": "/etc/qz"}
    )
    assert r.status_code == 403 and "output folder" in r.json()["detail"]
    r = client.post("/api/convert/preview", json={"paths": ["/etc/passwd"]})
    assert r.status_code == 403 and "input file" in r.json()["detail"]
    assert client.get("/api/convert/browse", params={"path": "/etc"}).status_code == 403


def test_staged_upload_needs_an_output_folder(client: TestClient, tmp_path: Path) -> None:
    data = (FIX / "qd_edp124.dat").read_bytes()
    staged = client.post(
        "/api/convert/stage", files={"file": ("../evil/qd_edp124.dat", data)}
    ).json()
    assert staged["name"] == "qd_edp124.dat" and Path(staged["path"]).read_bytes() == data
    r = client.post("/api/convert/run", json={"paths": [staged["path"]]})
    assert r.status_code == 422 and "choose an output folder" in r.json()["detail"]
    out = tmp_path / "from_drop"
    res = _run(client, {"paths": [staged["path"]], "out_dir": str(out), "format": "csv"})
    assert res["report"]["files"][0]["outcome"] == "done" and (out / "qd_edp124.dat.csv").is_file()
    pre = client.post("/api/convert/preview", json={"paths": [staged["path"]]})
    assert pre.status_code == 200 and pre.json()["files"][0]["staged"]  # a preview writes nothing


def test_browse_lists_folders_first_and_hides_dotfiles(client: TestClient, work: Path) -> None:
    (work / "sub").mkdir()
    (work / ".hidden").write_text("x")
    got = client.get("/api/convert/browse", params={"path": str(work)}).json()
    names = [e["name"] for e in got["entries"]]
    assert names[0] == "sub" and ".hidden" not in names and "qd_edp124.dat" in names
    assert got["parent"] == str(work.parent)
    bad = client.get("/api/convert/browse", params={"path": str(work / "qd_edp124.dat")})
    assert bad.status_code == 422


def test_engine_cancel_keeps_finished_files_and_reports_cancelled(work: Path) -> None:
    calls = {"n": 0}

    def abort() -> bool:
        calls["n"] += 1
        return calls["n"] > 1  # let the first file through, stop before the second

    res = run_conversion(
        [work / "qd_edp124.dat", work / "xrdml_la2nio4.xrdml"], None, "csv", abort=abort
    )
    assert res["cancelled"] and len(res["report"]["files"]) == 1
    assert (work / "qd_edp124.dat.csv").is_file() and not (
        work / "xrdml_la2nio4.xrdml.csv"
    ).exists()


def test_free_report_path_never_returns_an_existing_file(tmp_path: Path) -> None:
    now = datetime(2026, 11, 24, 9, 30, 5, tzinfo=UTC)
    a = free_report_path(tmp_path, now)
    assert a.name == "convert-report-20261124-093005.json"
    a.write_text("{}")
    b = free_report_path(tmp_path, now)
    assert b.name == "convert-report-20261124-093005~2.json"


def test_list_directory_caps_and_sorts(tmp_path: Path) -> None:
    for n in ("b.txt", "A.txt"):
        (tmp_path / n).write_text("x")
    (tmp_path / "z").mkdir()
    assert [e["name"] for e in list_directory(tmp_path)["entries"]] == ["z", "A.txt", "b.txt"]


def test_convert_page_is_served_only_with_the_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import quantized.app as app_mod

    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<html>SPA</html>")
    monkeypatch.setattr(app_mod, "_WEB_DIR", web)
    tok = "t" * 40
    c = TestClient(app_mod.create_app(api_token=tok))
    c.headers.pop("x-quantized-token", None)  # conftest adds it; the page has no header
    assert c.get("/convert").status_code == 401
    boot = c.get(f"/convert?token={tok}&files=1")
    assert boot.status_code == 200 and "refresh" in boot.text and "/convert?files=1" in boot.text
    assert "SPA" in c.get("/convert").text  # the cookie from the bootstrap now carries it


def test_preview_names_are_what_a_run_writes_and_flags_existing(
    client: TestClient, work: Path
) -> None:
    f = str(work / "qd_edp124.dat")
    (work / "qd_edp124.dat.csv").write_text("old")
    got = client.post("/api/convert/preview", json={"paths": [f]}).json()["files"][0]
    assert got["outputs"] == ["qd_edp124.dat.csv"] and got["existing"] == ["qd_edp124.dat.csv"]
    out = work / "elsewhere"
    got = client.post("/api/convert/preview", json={"paths": [f], "out_dir": str(out)}).json()[
        "files"
    ][0]
    assert got["outputs"] == ["qd_edp124.dat.csv"] and got["existing"] == []


def test_cancel_between_files_is_a_result_not_a_job_error(client: TestClient, work: Path) -> None:
    """A cancel lands between files; the run's result (not an error) says so."""
    import quantized.routes.convert_quick as route

    real = route.run_conversion

    def cancel_after_first(paths: Any, out: Any, fmt: str, **kw: Any) -> dict[str, Any]:
        calls = {"n": 0}

        def abort() -> bool:
            calls["n"] += 1
            return calls["n"] > 1

        return real(paths, out, fmt, **{**kw, "abort": abort})

    route.run_conversion = cancel_after_first  # type: ignore[assignment]
    try:
        res = _run(
            client,
            {
                "paths": [str(work / "qd_edp124.dat"), str(work / "xrdml_la2nio4.xrdml")],
                "format": "csv",
            },
        )
    finally:
        route.run_conversion = real  # type: ignore[assignment]
    assert res["cancelled"] and len(res["report"]["files"]) == 1


def test_report_can_be_turned_off(client: TestClient, work: Path) -> None:
    res = _run(client, {"paths": [str(work / "qd_edp124.dat")], "report": False})
    assert res["report_path"] is None and res["report_error"] is None
    assert not list(work.glob("convert-report*"))


# ── adversarial review fixes ────────────────────────────────────────────────


def test_a_cancel_during_progress_reporting_still_yields_the_result(
    client: TestClient, work: Path
) -> None:
    """The route's progress callback must swallow JobCancelled (the engine's
    abort() is the cancel path); raising out would lose the finished files'
    report. Fails if the route hands the raw ``progress`` to the engine."""
    import quantized.routes.convert_quick as route
    from quantized.jobs import JobCancelled

    real = route.run_conversion

    seen: dict[str, Any] = {}

    def spy(paths: Any, out: Any, fmt: str, **kw: Any) -> dict[str, Any]:
        from quantized.jobs import jobs

        for j in list(jobs._jobs.values()):
            j._abort.set()  # cancel requested while the engine is mid-run
        try:
            kw["progress"](0.9, "after cancel")
            seen["swallowed"] = True
        except JobCancelled:
            seen["swallowed"] = False
        return real(paths, out, fmt, **{**kw, "abort": lambda: False})

    route.run_conversion = spy  # type: ignore[assignment]
    try:
        r = client.post("/api/convert/run", json={"paths": [str(work / "qd_edp124.dat")]})
        job = r.json()["job_id"]
        for _ in range(300):
            if client.get(f"/api/jobs/{job}").json()["status"] in ("done", "error", "cancelled"):
                break
            time.sleep(0.1)
    finally:
        route.run_conversion = real  # type: ignore[assignment]
    assert seen.get("swallowed") is True


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("../evil/a.dat", "a.dat"),
        ("..\\..\\evil\\a.dat", "a.dat"),
        ("..", "upload.dat"),
        (".", "upload.dat"),
        ("", "upload.dat"),
        (None, "upload.dat"),
        ("a\x00b\n.dat", "ab.dat"),
        ("name. ", "name"),
    ],
)
def test_safe_upload_name(raw: str | None, want: str) -> None:
    from quantized.io.convert_session import safe_upload_name

    assert safe_upload_name(raw) == want
    assert len(safe_upload_name("x" * 400 + ".dat")) <= 200


def test_stage_with_a_dotdot_filename_is_a_clean_upload(client: TestClient) -> None:
    got = client.post("/api/convert/stage", files={"file": ("..", b"abc")})
    assert got.status_code == 200 and got.json()["name"] == "upload.dat"


def test_stage_root_is_private_purged_when_stale_and_capped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import os

    from quantized.io import convert_session as cs

    root = tmp_path / "stage"
    cs.prepare_stage_root(root)
    assert (root.stat().st_mode & 0o077) == 0 or os.name == "nt"
    old, new = root / "aaaaaaaaaaaa", root / "bbbbbbbbbbbb"
    for d in (old, new):
        d.mkdir()
        (d / "f.dat").write_bytes(b"x" * 10)
    t = time.time() - cs.STAGE_MAX_AGE_S - 60
    os.utime(old, (t, t))
    cs.prepare_stage_root(root)
    assert not old.exists() and new.exists()
    monkeypatch.setattr(cs, "STAGE_MAX_BYTES", 5)
    with pytest.raises(cs.StageFullError):
        cs.prepare_stage_root(root)


@pytest.mark.skipif(not hasattr(__import__("os"), "symlink"), reason="needs symlinks")
def test_stage_root_that_is_a_symlink_is_refused(tmp_path: Path) -> None:
    from quantized.io import convert_session as cs

    target = tmp_path / "elsewhere"
    target.mkdir()
    link = tmp_path / "stage"
    link.symlink_to(target)
    with pytest.raises(OSError):
        cs.prepare_stage_root(link)
