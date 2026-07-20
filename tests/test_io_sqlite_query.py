from __future__ import annotations

import sqlite3
from pathlib import Path

import numpy as np
import pytest

from quantized.io.sqlite_query import query_sqlite


@pytest.fixture
def database(tmp_path: Path) -> Path:
    path = tmp_path / "measurements.sqlite"
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE measurement (sample TEXT, field REAL, moment REAL);
        INSERT INTO measurement VALUES
          ('A', 0, 1.5), ('A', 10, 2.5), ('B', 20, 3.5);
        """
    )
    connection.close()
    return path


def test_query_sqlite_returns_canonical_data_and_text_metadata(database: Path) -> None:
    ds = query_sqlite(database, "SELECT sample, field, moment FROM measurement", x_column="field")
    assert ds.time.tolist() == [0, 10, 20]
    assert ds.labels == ("moment",)
    np.testing.assert_allclose(ds.values[:, 0], [1.5, 2.5, 3.5])
    assert ds.metadata["text_columns"] == {"sample": ["A", "A", "B"]}
    assert ds.metadata["query_truncated"] is False


def test_query_sqlite_is_row_bounded(database: Path) -> None:
    ds = query_sqlite(database, "SELECT field, moment FROM measurement", max_rows=2)
    assert ds.n_points == 2
    assert ds.metadata["query_truncated"] is True


@pytest.mark.parametrize(
    "query",
    ["DELETE FROM measurement", "UPDATE measurement SET moment=0", "CREATE TABLE bad (x INT)"],
)
def test_query_sqlite_rejects_non_select_statements(database: Path, query: str) -> None:
    with pytest.raises(ValueError, match="only SELECT or WITH"):
        query_sqlite(database, query)


@pytest.mark.parametrize(
    "query",
    [
        # SQLite's grammar lets a WITH clause PREFIX a DML statement, so these
        # pass the first-token "select or with" gate as valid SQL. The gate is
        # therefore decorative; the AUTHORIZER is the real enforcement. Earlier
        # this test used `WITH x AS (DELETE ...)` which is a syntax ERROR — it
        # passed because ANY sqlite3.Error matched, so it never actually
        # exercised a valid write bypass. These are the real thing.
        "WITH z(n) AS (SELECT 1) DELETE FROM measurement",
        "WITH z(n) AS (SELECT 1) UPDATE measurement SET moment = 0",
        "WITH z(n) AS (SELECT 99) INSERT INTO measurement(sample, field, moment)"
        " SELECT 'z', n, n FROM z",
    ],
)
def test_query_sqlite_authorizer_blocks_with_prefixed_write(database: Path, query: str) -> None:
    with pytest.raises(ValueError, match="SQLite query failed"):
        query_sqlite(database, query)
    # And the row count is unchanged — the write really did not land.
    check = sqlite3.connect(database)
    try:
        assert check.execute("SELECT count(*) FROM measurement").fetchone()[0] == 3
    finally:
        check.close()
