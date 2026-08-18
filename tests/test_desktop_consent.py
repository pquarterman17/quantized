"""User-consented paths (MAIN_PLAN #31).

This is a security boundary: it widens the ``/import`` containment guard, so
the tests are written around what must NOT be possible as much as what must.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.desktop_consent import (
    clear_consent,
    consent_count,
    consented_path,
    consented_write_path,
    grant_paths,
    grant_write_path,
    is_consented,
    is_write_consented,
    write_consent_count,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean() -> None:
    clear_consent()
    yield
    clear_consent()


def _csv(tmp_path: Path, name: str = "run.csv") -> Path:
    p = tmp_path / name
    p.write_text("T,M\n1,10\n2,20\n", encoding="utf-8")
    return p


# --- the registry ----------------------------------------------------------


def test_grant_returns_normalized_paths(tmp_path: Path) -> None:
    """Both sides must agree on normalization or consent silently never
    matches — /import compares the realpath."""
    f = _csv(tmp_path)
    granted = grant_paths([str(f)])
    assert granted == [os.path.realpath(str(f))]
    assert is_consented(os.path.realpath(str(f)))


def test_consent_is_per_exact_path_not_a_prefix(tmp_path: Path) -> None:
    """Consenting to one file must grant nothing about its siblings — a
    directory-prefix rule would quietly hand over a whole folder."""
    a = _csv(tmp_path, "a.csv")
    sibling = _csv(tmp_path, "b.csv")
    grant_paths([str(a)])
    assert is_consented(os.path.realpath(str(a)))
    assert not is_consented(os.path.realpath(str(sibling)))
    assert not is_consented(os.path.realpath(str(tmp_path)))


def test_grant_ignores_directories_and_missing_entries(tmp_path: Path) -> None:
    assert grant_paths([str(tmp_path)]) == []
    assert grant_paths([str(tmp_path / "nope.csv")]) == []
    assert consent_count() == 0


def test_grant_is_bounded(tmp_path: Path) -> None:
    """A long desktop session must not accumulate an ever-growing allowlist."""
    from quantized.desktop_consent import _MAX_ENTRIES

    for i in range(_MAX_ENTRIES + 20):
        grant_paths([str(_csv(tmp_path, f"f{i}.csv"))])
    assert consent_count() == _MAX_ENTRIES


def test_oldest_grant_is_evicted_first(tmp_path: Path) -> None:
    from quantized.desktop_consent import _MAX_ENTRIES

    first = _csv(tmp_path, "first.csv")
    grant_paths([str(first)])
    for i in range(_MAX_ENTRIES):
        grant_paths([str(_csv(tmp_path, f"f{i}.csv"))])
    assert not is_consented(os.path.realpath(str(first)))


def test_regranting_refreshes_recency(tmp_path: Path) -> None:
    from quantized.desktop_consent import _MAX_ENTRIES

    first = _csv(tmp_path, "first.csv")
    grant_paths([str(first)])
    for i in range(_MAX_ENTRIES - 1):
        grant_paths([str(_csv(tmp_path, f"f{i}.csv"))])
    grant_paths([str(first)])  # re-picked -> newest again
    grant_paths([str(_csv(tmp_path, "extra.csv"))])
    assert is_consented(os.path.realpath(str(first)))


def test_clear_consent_revokes_everything(tmp_path: Path) -> None:
    grant_paths([str(_csv(tmp_path))])
    clear_consent()
    assert consent_count() == 0


# --- the write-consent registry (P1.1: native Save/Save As) ----------------
#
# Mirrors the read-side suite above exactly — same bounded-with-eviction,
# recency-refresh, and clear-everything mechanics — plus the one property
# that only matters once TWO grant kinds exist: a write grant must never
# answer a read-consent question and vice versa. `grant_write_path` does NOT
# require the path to exist (a Save As destination usually doesn't yet), so
# these use plain paths under `tmp_path` rather than `_csv`'s real files.


def test_write_grant_returns_normalized_path(tmp_path: Path) -> None:
    """Both sides must agree on normalization or consent silently never
    matches — write_project_file compares the realpath."""
    dest = tmp_path / "new_workspace.dwk"
    granted = grant_write_path(str(dest))
    assert granted == os.path.realpath(str(dest))
    assert is_write_consented(os.path.realpath(str(dest)))


def test_write_grant_is_bounded(tmp_path: Path) -> None:
    """A long desktop session must not accumulate an ever-growing write
    allowlist either."""
    from quantized.desktop_consent import _MAX_ENTRIES

    for i in range(_MAX_ENTRIES + 20):
        grant_write_path(str(tmp_path / f"f{i}.dwk"))
    assert write_consent_count() == _MAX_ENTRIES


def test_oldest_write_grant_is_evicted_first(tmp_path: Path) -> None:
    from quantized.desktop_consent import _MAX_ENTRIES

    first = tmp_path / "first.dwk"
    grant_write_path(str(first))
    for i in range(_MAX_ENTRIES):
        grant_write_path(str(tmp_path / f"f{i}.dwk"))
    assert not is_write_consented(os.path.realpath(str(first)))


def test_regranting_write_refreshes_recency(tmp_path: Path) -> None:
    from quantized.desktop_consent import _MAX_ENTRIES

    first = tmp_path / "first.dwk"
    grant_write_path(str(first))
    for i in range(_MAX_ENTRIES - 1):
        grant_write_path(str(tmp_path / f"f{i}.dwk"))
    grant_write_path(str(first))  # re-picked (re-saved) -> newest again
    grant_write_path(str(tmp_path / "extra.dwk"))
    assert is_write_consented(os.path.realpath(str(first)))


def test_clear_consent_revokes_write_grants_too(tmp_path: Path) -> None:
    grant_write_path(str(tmp_path / "workspace.dwk"))
    clear_consent()
    assert write_consent_count() == 0


def test_consented_write_path_returns_the_stored_string(tmp_path: Path) -> None:
    dest = tmp_path / "workspace.dwk"
    granted = grant_write_path(str(dest))
    assert consented_write_path(os.path.realpath(str(dest))) == granted
    assert consented_write_path("/never/granted.dwk") is None


# --- read/write consent isolation (P1.1) ------------------------------------


def test_a_write_grant_never_answers_a_read_consent_question(tmp_path: Path) -> None:
    """Picking a SAVE destination must not also grant READ access to it —
    the two consent kinds are deliberately independent (see the module
    doc)."""
    dest = tmp_path / "workspace.dwk"
    grant_write_path(str(dest))
    resolved = os.path.realpath(str(dest))
    assert not is_consented(resolved)
    assert consented_path(resolved) is None


def test_a_read_grant_never_answers_a_write_consent_question(tmp_path: Path) -> None:
    """Opening/picking a file must not also authorize overwriting it."""
    f = _csv(tmp_path, "picked.dwk")
    grant_paths([str(f)])
    resolved = os.path.realpath(str(f))
    assert not is_write_consented(resolved)
    assert consented_write_path(resolved) is None


# --- the /import guard -----------------------------------------------------


def test_import_still_refuses_an_unconsented_outside_path() -> None:
    """The containment guard is unchanged for anything not user-picked."""
    resp = client.post("/api/parsers/import", json={"path": "/etc/passwd"})
    assert resp.status_code in (403, 404)


def test_import_refuses_a_traversal_attempt() -> None:
    resp = client.post(
        "/api/parsers/import", json={"path": "/tmp/../etc/shadow"}
    )
    assert resp.status_code in (403, 404)


def test_consent_does_not_leak_to_a_sibling_of_a_granted_file(tmp_path: Path) -> None:
    """The dangerous mistake would be consenting to a directory. Granting one
    file must not make its neighbour importable."""
    granted = _csv(tmp_path, "granted.csv")
    other = _csv(tmp_path, "other.csv")
    grant_paths([str(granted)])
    # tmp_path IS inside an allowed root here, so assert the registry directly
    # rather than the route (which would allow both for the wrong reason).
    assert is_consented(os.path.realpath(str(granted)))
    assert not is_consented(os.path.realpath(str(other)))


def test_consented_path_outside_the_roots_is_importable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole point of #31: a file on a network share or second drive is
    outside home/cwd/temp, so without consent it would 403 forever."""
    f = _csv(tmp_path)
    # No allowed roots at all — the strictest possible stand-in for "this file
    # lives on a UNC share / second drive that home, cwd and temp never cover".
    monkeypatch.setattr("quantized.routes.parsers._allowed_roots", lambda: ())
    assert client.post("/api/parsers/import", json={"path": str(f)}).status_code == 403
    grant_paths([str(f)])
    resp = client.post("/api/parsers/import", json={"path": str(f)})
    assert resp.status_code == 200
    assert resp.json()["labels"] == ["M"]


def test_consent_does_not_bypass_the_file_existence_check(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A granted path that later disappears must 404, not 200."""
    f = _csv(tmp_path)
    grant_paths([str(f)])
    monkeypatch.setattr("quantized.routes.parsers._allowed_roots", lambda: ())
    f.unlink()
    assert client.post("/api/parsers/import", json={"path": str(f)}).status_code == 404
