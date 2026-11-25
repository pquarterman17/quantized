"""The GUI prefs file (io/prefs_store.py) and its route (routes/prefs.py).

Every test isolates ``QZ_CONFIG_DIR`` to a ``tmp_path`` (autouse), so nothing
touches the real user config directory."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quantized import auth
from quantized.app import app, create_app
from quantized.io import prefs_store


@pytest.fixture(autouse=True)
def _cfg(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    d = tmp_path / "qzconfig"
    monkeypatch.setenv("QZ_CONFIG_DIR", str(d))
    return d


client = TestClient(app, raise_server_exceptions=False)
SLOTS = {"qz.prefs": {"accent": "teal", "sigFigs": 4}, "qz.fitPrefs": {"bootstrapCap": 500}}


# ── pure store ───────────────────────────────────────────────────────────────


def test_missing_file_loads_empty() -> None:
    res = prefs_store.load_prefs()
    assert res.slots == {}
    assert res.moved_aside is None


def test_round_trip(_cfg: Path) -> None:
    merged = prefs_store.apply_update(SLOTS)
    assert merged == SLOTS
    assert prefs_store.load_prefs().slots == SLOTS
    on_disk = json.loads((_cfg / "prefs.json").read_text(encoding="utf-8"))
    assert on_disk == {"version": 1, "slots": SLOTS}


def test_update_merges_and_null_deletes() -> None:
    prefs_store.apply_update(SLOTS)
    merged = prefs_store.apply_update(
        {"qz.fitPrefs": None, "qz.interactionPrefs": {"persistentTool": True}}
    )
    assert merged == {
        "qz.prefs": SLOTS["qz.prefs"],
        "qz.interactionPrefs": {"persistentTool": True},
    }


def test_atomic_write_keeps_old_file_when_replace_fails(
    monkeypatch: pytest.MonkeyPatch, _cfg: Path
) -> None:
    prefs_store.apply_update(SLOTS)
    before = (_cfg / "prefs.json").read_bytes()

    def boom(src: object, dst: object) -> None:
        raise OSError("disk gone")

    monkeypatch.setattr(prefs_store.os, "replace", boom)
    with pytest.raises(OSError):
        prefs_store.apply_update({"qz.prefs": {"accent": "rose"}})
    assert (_cfg / "prefs.json").read_bytes() == before
    assert [p.name for p in _cfg.iterdir()] == ["prefs.json"]  # no temp file left behind


def test_save_goes_through_a_temp_file_and_replace(
    monkeypatch: pytest.MonkeyPatch, _cfg: Path
) -> None:
    seen: list[tuple[str, str]] = []
    real = os.replace

    def spy(src: str, dst: str) -> None:
        seen.append((Path(src).name, Path(dst).name))
        real(src, dst)

    monkeypatch.setattr(prefs_store.os, "replace", spy)
    prefs_store.apply_update(SLOTS)
    assert len(seen) == 1
    tmp, dst = seen[0]
    assert tmp.startswith(".prefs-") and tmp.endswith(".tmp")
    assert dst == "prefs.json"


@pytest.mark.parametrize("text", ["{not json", "[1, 2]", '{"slots": [1]}', "\udcff"])
def test_corrupt_file_is_moved_aside_not_fatal(_cfg: Path, text: str) -> None:
    _cfg.mkdir(parents=True, exist_ok=True)
    path = _cfg / "prefs.json"
    path.write_bytes(text.encode("utf-8", "surrogateescape"))
    res = prefs_store.load_prefs()
    assert res.slots == {}
    assert res.moved_aside is not None
    assert res.moved_aside.name.startswith("prefs.json.corrupt-")
    assert res.moved_aside.read_bytes() == text.encode(
        "utf-8", "surrogateescape"
    )  # kept, never deleted
    assert not path.exists()
    # and the next write starts a fresh, valid file
    assert prefs_store.apply_update(SLOTS) == SLOTS


def test_bad_entries_in_a_valid_file_are_dropped(_cfg: Path) -> None:
    _cfg.mkdir(parents=True, exist_ok=True)
    (_cfg / "prefs.json").write_text(
        json.dumps({"version": 1, "slots": {"qz.prefs": {"a": 1}, "bad key": {}, "qz.x": 3}}),
        encoding="utf-8",
    )
    assert prefs_store.load_prefs().slots == {"qz.prefs": {"a": 1}}


@pytest.mark.parametrize(
    "update",
    [
        [1, 2],
        "qz.prefs",
        {"prefs": {}},  # no qz. prefix
        {"qz.": {}},
        {"qz.prefs": [1]},
        {"qz.prefs": 3},
        {f"qz.s{i}": {} for i in range(prefs_store.MAX_SLOTS + 1)},
    ],
)
def test_validate_refuses(update: object) -> None:
    with pytest.raises(prefs_store.PrefsError):
        prefs_store.apply_update(update)
    assert not prefs_store.prefs_path().exists()  # nothing written


def test_oversized_merge_is_refused_and_writes_nothing() -> None:
    prefs_store.apply_update(SLOTS)
    big = {"qz.big": {"x": "a" * prefs_store.MAX_PREFS_BYTES}}
    with pytest.raises(prefs_store.PrefsError, match="KiB"):
        prefs_store.apply_update(big)
    assert prefs_store.load_prefs().slots == SLOTS


# ── route ────────────────────────────────────────────────────────────────────


def test_route_get_empty_then_put_then_get() -> None:
    r = client.get("/api/prefs")
    assert r.status_code == 200
    assert r.json() == {"slots": {}, "notice": None}
    r = client.put("/api/prefs", json={"slots": SLOTS})
    assert r.status_code == 200
    assert r.json()["slots"] == SLOTS
    assert client.get("/api/prefs").json()["slots"] == SLOTS


def test_route_get_reports_a_moved_aside_file(_cfg: Path) -> None:
    _cfg.mkdir(parents=True, exist_ok=True)
    (_cfg / "prefs.json").write_text("{oops", encoding="utf-8")
    body = client.get("/api/prefs").json()
    assert body["slots"] == {}
    assert "set aside" in body["notice"]


@pytest.mark.parametrize(
    "content",
    [
        b"[1, 2]",
        b'"slots"',
        b"not json",
        b'{"nope": {}}',
        b'{"slots": [1]}',
        b'{"slots": {"qz.prefs": 3}}',
        b'{"slots": {"evil": {}}}',
    ],
)
def test_route_refuses_bad_bodies_with_422(content: bytes) -> None:
    r = client.put("/api/prefs", content=content, headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    assert not prefs_store.prefs_path().exists()


def test_route_refuses_oversized_body_with_422() -> None:
    big = json.dumps({"slots": {"qz.big": {"x": "a" * (prefs_store.MAX_PREFS_BYTES + 4096)}}})
    r = client.put("/api/prefs", content=big.encode(), headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    assert "KiB" in r.json()["detail"]
    assert not prefs_store.prefs_path().exists()


def test_route_requires_the_api_token_and_origin() -> None:
    """Same token and Origin (CSRF) guard as every /api route."""
    guarded = create_app(api_token="t" * 43)
    c = TestClient(guarded, headers={"Host": "127.0.0.1:8000"})
    c.headers.pop(auth.TOKEN_HEADER, None)
    assert c.get("/api/prefs").status_code == 401
    assert c.put("/api/prefs", json={"slots": SLOTS}).status_code == 401
    ok = {auth.TOKEN_HEADER: "t" * 43}
    assert c.get("/api/prefs", headers=ok).status_code == 200
    foreign = {**ok, "Origin": "http://evil.example"}
    assert c.put("/api/prefs", json={"slots": SLOTS}, headers=foreign).status_code == 403
    assert not prefs_store.prefs_path().exists()
