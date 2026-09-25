"""HTTP contract for the large-workbook transfer store (Group F).

The cross-process case is modelled the way it happens for real: two
independently built apps (two Quantized backends) that share nothing but the
on-disk transfer directory.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

import quantized.app as app_module
from quantized.app import create_app
from quantized.io import workbook_transfer_store as store_mod
from quantized.io.workbook_transfer_store import (
    DEFAULT_TTL_SECONDS,
    MAX_PACKAGE_BYTES,
    MIN_PACKAGE_BYTES,
    PACKAGE_SUFFIX,
    TransferStore,
)
from quantized.routes import workbook_transfer

BASE = "/api/workbook-transfer/packages"
PKG = json.dumps({"format": "quantized-workbook-transfer", "version": 1, "x": "µ"}).encode()


@pytest.fixture
def transfer_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "xfer"
    monkeypatch.setenv("QZ_TRANSFER_DIR", str(root))
    # Small test payloads: lift the 1 MB minimum (tested on its own below).
    monkeypatch.setattr(
        workbook_transfer, "_store", lambda: TransferStore(root, min_package_bytes=1)
    )
    return root


def _post(client: TestClient, body: bytes = PKG) -> dict[str, object]:
    res = client.post(BASE, content=body, headers={"Content-Type": "application/json"})
    assert res.status_code == 200, res.text
    out: dict[str, object] = res.json()
    return out


def _get(client: TestClient, pid: object, token: object) -> httpx.Response:
    return client.get(f"{BASE}/{pid}", headers={"X-Transfer-Token": str(token)})


def test_store_then_fetch_round_trip(client: TestClient, transfer_root: Path) -> None:
    stored = _post(client)
    assert stored["size"] == len(PKG)
    assert stored["ttl_seconds"] == DEFAULT_TTL_SECONDS
    assert str(stored["expires_at"]).endswith("Z")
    res = _get(client, stored["id"], stored["token"])
    assert res.status_code == 200
    assert res.content == PKG
    assert res.headers["content-type"].startswith("application/json")
    assert res.headers["cache-control"] == "no-store"
    assert (transfer_root / f"{stored['id']}{PACKAGE_SUFFIX}").is_file()


def test_two_backends_share_the_store(transfer_root: Path) -> None:
    """Two-process round trip: source backend stores, destination fetches."""
    source, destination = TestClient(create_app()), TestClient(create_app())
    stored = _post(source)
    res = _get(destination, stored["id"], stored["token"])
    assert res.status_code == 200
    assert res.content == PKG


def test_wrong_token_and_missing_are_both_404(client: TestClient, transfer_root: Path) -> None:
    stored = _post(client)
    assert _get(client, stored["id"], "wrong").status_code == 404
    assert _get(client, "0" * 32, stored["token"]).status_code == 404


def test_missing_token_header_is_rejected(client: TestClient, transfer_root: Path) -> None:
    stored = _post(client)
    assert client.get(f"{BASE}/{stored['id']}").status_code == 422


@pytest.mark.parametrize("bad", ["ZZZ", "A" * 32, "0" * 31, "0" * 33, "0" * 32 + ".qzxfer"])
def test_malformed_ids_reaching_the_route_are_400(
    client: TestClient, transfer_root: Path, bad: str
) -> None:
    _post(client)
    before = sorted(p.name for p in transfer_root.iterdir())
    res = _get(client, bad, "t")
    assert res.status_code == 400
    assert res.json()["detail"] == "invalid transfer package id"
    assert client.delete(f"{BASE}/{bad}", headers={"X-Transfer-Token": "t"}).status_code == 400
    assert sorted(p.name for p in transfer_root.iterdir()) == before


@pytest.mark.parametrize(
    "bad", ["..%2F" + "0" * 29, "..%2F..%2Fetc%2Fpasswd", "%2E%2E%2F" + "0" * 29]
)
def test_encoded_traversal_never_succeeds(
    client: TestClient, transfer_root: Path, bad: str
) -> None:
    """Whether the router normalizes these away (404/405) or they reach the
    handler (400), no traversal spelling is ever served or deletes anything."""
    _post(client)
    before = sorted(p.name for p in transfer_root.iterdir())
    assert _get(client, bad, "t").status_code in (400, 404, 405)
    res = client.delete(f"{BASE}/{bad}", headers={"X-Transfer-Token": "t"})
    assert res.status_code in (400, 404, 405)
    assert sorted(p.name for p in transfer_root.iterdir()) == before


def test_expired_package_is_410_then_404(
    client: TestClient, transfer_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = {"t": time.time()}
    monkeypatch.setattr(
        workbook_transfer,
        "_store",
        lambda: TransferStore(transfer_root, clock=lambda: now["t"], min_package_bytes=1),
    )
    stored = _post(client)
    now["t"] += DEFAULT_TTL_SECONDS + 1
    assert _get(client, stored["id"], stored["token"]).status_code == 410
    assert _get(client, stored["id"], stored["token"]).status_code == 404


def _small_cap(monkeypatch: pytest.MonkeyPatch, root: Path) -> None:
    monkeypatch.setattr(
        workbook_transfer,
        "_store",
        lambda: TransferStore(
            root, max_package_bytes=10, max_total_bytes=10_000, min_package_bytes=1
        ),
    )


def test_oversize_declared_body_is_413_and_writes_nothing(
    client: TestClient, transfer_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _small_cap(monkeypatch, transfer_root)
    res = client.post(BASE, content=b"x" * 11)
    assert res.status_code == 413
    assert res.json()["detail"] == "transfer package too large (limit 10 bytes)"
    assert not transfer_root.exists() or list(transfer_root.iterdir()) == []


def test_oversize_streamed_body_is_413_mid_stream_and_leaves_no_temp(
    client: TestClient, transfer_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No Content-Length (chunked): the cap is enforced while streaming, and
    the half-written temp file is removed."""
    _small_cap(monkeypatch, transfer_root)

    def body() -> Iterator[bytes]:
        yield b"x" * 6
        yield b"x" * 6

    res = client.post(BASE, content=body())
    assert res.status_code == 413
    assert list(transfer_root.iterdir()) == []


def test_streamed_body_round_trips(client: TestClient, transfer_root: Path) -> None:
    def body() -> Iterator[bytes]:
        yield PKG[:5]
        yield PKG[5:]

    res = client.post(BASE, content=body())
    assert res.status_code == 200
    stored = res.json()
    fetched = _get(client, stored["id"], stored["token"])
    assert fetched.content == PKG
    assert fetched.headers["content-length"] == str(len(PKG))


def test_empty_body_is_422(client: TestClient, transfer_root: Path) -> None:
    assert client.post(BASE, content=b"").status_code == 422


def test_security_probe_tiny_posts_cannot_wipe_a_real_copy(
    client: TestClient, transfer_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The review's probe, with the REAL default store: one real package,
    then 32 one-byte POSTs. They are refused (422) and the copy survives."""
    monkeypatch.setattr(workbook_transfer, "_store", lambda: TransferStore(transfer_root))
    real_body = b"r" * MIN_PACKAGE_BYTES
    real = _post(client, real_body)
    for _ in range(32):
        res = client.post(BASE, content=b"x")
        assert res.status_code == 422
        assert res.json()["detail"] == (
            f"transfer package too small (minimum {MIN_PACKAGE_BYTES} bytes)"
        )
    assert _get(client, real["id"], real["token"]).content == real_body


def test_full_store_is_507_and_keeps_every_live_copy(
    client: TestClient, transfer_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        workbook_transfer,
        "_store",
        lambda: TransferStore(transfer_root, max_entries=2, min_package_bytes=1),
    )
    first, second = _post(client), _post(client)
    res = client.post(BASE, content=PKG)
    assert res.status_code == 507
    assert res.json()["detail"].isascii()
    assert "transfer store is full" in res.json()["detail"]
    for stored in (first, second):
        assert _get(client, stored["id"], stored["token"]).content == PKG
    assert len(list(transfer_root.iterdir())) == 2  # no temp left behind


def test_unwritable_store_is_503(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    blocker = tmp_path / "a-file"
    blocker.write_text("not a directory")
    monkeypatch.setenv("QZ_TRANSFER_DIR", str(blocker))
    res = client.post(BASE, content=PKG)
    assert res.status_code == 503
    assert res.json()["detail"] == "transfer store unavailable"


def test_delete_then_fetch_is_404(client: TestClient, transfer_root: Path) -> None:
    stored = _post(client)
    headers = {"X-Transfer-Token": str(stored["token"])}
    assert (
        client.delete(f"{BASE}/{stored['id']}", headers={"X-Transfer-Token": "no"}).status_code
        == 404
    )
    res = client.delete(f"{BASE}/{stored['id']}", headers=headers)
    assert res.status_code == 200 and res.json() == {"deleted": True}
    assert _get(client, stored["id"], stored["token"]).status_code == 404


def test_startup_sweeps_expired_packages(
    transfer_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Running the lifespan also runs its SHUTDOWN half, which would shut the
    # process-global job pool every later test in this worker relies on.
    monkeypatch.setattr(app_module.jobs._pool, "shutdown", lambda **_kw: None)
    monkeypatch.setattr(app_module._datasetcache, "clear_cache", lambda: None)
    past = time.time() - DEFAULT_TTL_SECONDS - 10
    stale = TransferStore(transfer_root, clock=lambda: past, min_package_bytes=1).put(PKG)
    live = TransferStore(transfer_root, min_package_bytes=1).put(PKG)
    with TestClient(create_app()):
        pass
    names = {p.name for p in transfer_root.iterdir()}
    assert f"{stale.package_id}{PACKAGE_SUFFIX}" not in names
    assert f"{live.package_id}{PACKAGE_SUFFIX}" in names


def test_frontend_client_mirrors_the_backend_contract() -> None:
    """The TS client (lib/workbookTransferRef.ts) hard-codes the path, the
    token header, and the per-package cap; pin all three to the backend."""
    root = Path(__file__).resolve().parents[1]
    src = (root / "frontend/src/lib/workbookTransferRef.ts").read_text(encoding="utf-8")
    assert f'const PACKAGES = "{BASE}";' in src
    assert '"X-Transfer-Token"' in src
    cap = f"{MAX_PACKAGE_BYTES:_}"
    assert f"export const MAX_STORED_TRANSFER_BYTES = {cap};" in src
    # the client's strict token shape must accept exactly what the server mints
    assert "const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;" in src
    for _ in range(50):
        assert re.fullmatch(r"[A-Za-z0-9_-]{43}", store_mod._new_token())
