"""Read-only SQLite query connector returning the canonical DataStruct."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct

__all__ = ["query_sqlite"]

_DENIED_ACTIONS = {
    sqlite3.SQLITE_INSERT,
    sqlite3.SQLITE_UPDATE,
    sqlite3.SQLITE_DELETE,
    sqlite3.SQLITE_CREATE_INDEX,
    sqlite3.SQLITE_CREATE_TABLE,
    sqlite3.SQLITE_CREATE_TEMP_INDEX,
    sqlite3.SQLITE_CREATE_TEMP_TABLE,
    sqlite3.SQLITE_CREATE_TEMP_TRIGGER,
    sqlite3.SQLITE_CREATE_TEMP_VIEW,
    sqlite3.SQLITE_CREATE_TRIGGER,
    sqlite3.SQLITE_CREATE_VIEW,
    sqlite3.SQLITE_DROP_INDEX,
    sqlite3.SQLITE_DROP_TABLE,
    sqlite3.SQLITE_DROP_TEMP_INDEX,
    sqlite3.SQLITE_DROP_TEMP_TABLE,
    sqlite3.SQLITE_DROP_TEMP_TRIGGER,
    sqlite3.SQLITE_DROP_TEMP_VIEW,
    sqlite3.SQLITE_DROP_TRIGGER,
    sqlite3.SQLITE_DROP_VIEW,
    sqlite3.SQLITE_ALTER_TABLE,
    sqlite3.SQLITE_ATTACH,
    sqlite3.SQLITE_DETACH,
    sqlite3.SQLITE_TRANSACTION,
}


def _numeric(values: list[Any]) -> tuple[np.ndarray, float]:
    out = np.full(len(values), np.nan, dtype=float)
    valid = 0
    for i, value in enumerate(values):
        if value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if np.isfinite(number):
            out[i] = number
            valid += 1
    return out, valid / max(len(values), 1)


def query_sqlite(
    path: str | Path,
    query: str,
    *,
    x_column: str | None = None,
    max_rows: int = 100_000,
    timeout_s: float = 5.0,
) -> DataStruct:
    """Run one SELECT/CTE against a local database opened in read-only mode.

    Duplicate column names are made unique. Numeric columns become DataStruct
    channels; nonnumeric columns remain searchable worksheet text metadata.
    """
    db = Path(path).expanduser().resolve()
    if not db.is_file():
        raise ValueError(f"database file not found: {db}")
    sql = query.strip()
    if not sql or sql.split(None, 1)[0].lower() not in {"select", "with"}:
        raise ValueError("only SELECT or WITH queries are allowed")
    if not 1 <= max_rows <= 1_000_000:
        raise ValueError("max_rows must be between 1 and 1,000,000")

    deadline = time.monotonic() + max(0.1, min(timeout_s, 30.0))
    connection = sqlite3.connect(f"{db.as_uri()}?mode=ro", uri=True)
    try:
        connection.set_authorizer(
            lambda action, _arg1, _arg2, _db, _trigger: (
                sqlite3.SQLITE_DENY if action in _DENIED_ACTIONS else sqlite3.SQLITE_OK
            )
        )
        connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 1_000)
        cursor = connection.execute(sql)
        raw_names = [
            str(item[0] or f"Column {i + 1}")
            for i, item in enumerate(cursor.description or [])
        ]
        if not raw_names:
            raise ValueError("query did not return columns")
        names: list[str] = []
        counts: dict[str, int] = {}
        for name in raw_names:
            counts[name] = counts.get(name, 0) + 1
            names.append(name if counts[name] == 1 else f"{name} ({counts[name]})")
        rows = cursor.fetchmany(max_rows + 1)
        truncated = len(rows) > max_rows
        rows = rows[:max_rows]
    except sqlite3.Error as exc:
        message = "query timed out" if "interrupted" in str(exc).lower() else str(exc)
        raise ValueError(f"SQLite query failed: {message}") from exc
    finally:
        connection.close()

    columns = [[row[i] for row in rows] for i in range(len(names))]
    numeric = [_numeric(values) for values in columns]
    x_index = names.index(x_column) if x_column in names else -1
    if x_column and x_index < 0:
        raise ValueError(f"X column not found: {x_column}")
    if x_index >= 0 and numeric[x_index][1] < 0.8:
        raise ValueError("the selected X column is not at least 80% numeric")
    value_indices = [
        i for i, (_array, ratio) in enumerate(numeric) if i != x_index and ratio >= 0.1
    ]
    if not value_indices:
        raise ValueError("query returned no numeric value columns")
    time_values = numeric[x_index][0] if x_index >= 0 else np.arange(1, len(rows) + 1, dtype=float)
    values = np.column_stack([numeric[i][0] for i in value_indices])
    text_columns = {
        names[i]: ["" if value is None else str(value) for value in columns[i]]
        for i, (_array, ratio) in enumerate(numeric)
        if i != x_index and ratio < 0.1
    }
    metadata: dict[str, Any] = {
        "source": str(db),
        "parser_name": "sqlite_query",
        "x_column_name": names[x_index] if x_index >= 0 else "Row",
        "query": sql,
        "query_truncated": truncated,
    }
    if text_columns:
        metadata["text_columns"] = text_columns
    return DataStruct.create(
        time_values,
        values,
        labels=[names[i] for i in value_indices],
        units=[""] * len(value_indices),
        metadata=metadata,
    )
