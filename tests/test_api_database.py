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


def test_sqlite_query_route_reports_missing_file() -> None:
    response = TestClient(create_app()).post(
        "/api/database/sqlite/query",
        json={"path": "definitely-missing.db", "query": "SELECT 1"},
    )
    assert response.status_code == 422
    assert "not found" in response.json()["detail"]

