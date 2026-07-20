from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from quantized.app import create_app


def test_sqlite_query_route(tmp_path: Path) -> None:
    path = tmp_path / "data.db"
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE t (x REAL, y REAL)")
    connection.executemany("INSERT INTO t VALUES (?, ?)", [(1, 2), (3, 4)])
    connection.commit()
    connection.close()
    response = TestClient(create_app()).post(
        "/api/database/sqlite/query",
        json={"path": str(path), "query": "SELECT x, y FROM t", "x_column": "x"},
    )
    assert response.status_code == 200
    assert response.json()["time"] == [1.0, 3.0]
    assert response.json()["values"] == [[2.0], [4.0]]


def test_sqlite_query_route_reports_missing_file(tmp_path: Path) -> None:
    # A path INSIDE an allowed root (tmp) but nonexistent -> 404 (the
    # containment guard checks existence, matching the sibling file routes).
    response = TestClient(create_app()).post(
        "/api/database/sqlite/query",
        json={"path": str(tmp_path / "definitely-missing.db"), "query": "SELECT 1"},
    )
    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


def test_sqlite_query_route_refuses_path_outside_allowed_roots(tmp_path: Path) -> None:
    # The security fix: a real SQLite file OUTSIDE home/cwd/temp/QZ_DATA_ROOTS
    # must be refused (403) BEFORE it is opened — otherwise this route is a
    # read-any-local-SQLite-file primitive (browser login stores, etc.).
    import os
    import sqlite3 as sq

    outside = Path(os.path.realpath(os.sep)) / "quantized_test_outside_root.sqlite"
    created = False
    try:
        try:
            conn = sq.connect(outside)
            conn.execute("CREATE TABLE secret (v TEXT)")
            conn.commit()
            conn.close()
            created = True
        except (OSError, sq.Error):
            # Can't write to the filesystem root here — fall back to asserting a
            # path that is guaranteed outside roots is refused without opening.
            pass
        target = outside if created else Path(os.sep) / "etc" / "passwd"
        response = TestClient(create_app()).post(
            "/api/database/sqlite/query",
            json={"path": str(target), "query": "SELECT * FROM secret"},
        )
        # 403 (outside roots) — never 200. It must NOT read the file.
        assert response.status_code == 403
        assert "allowed roots" in response.json()["detail"]
    finally:
        if created:
            outside.unlink(missing_ok=True)

