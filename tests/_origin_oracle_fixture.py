"""Load a frozen Origin analysis-oracle fixture by case id.

Fixtures live in ``../test-data/origin/analysis_oracle/<case-id>/`` (written
by ``tools/origin_oracle/run.py``). ``load_fixture`` skips the calling test
cleanly when the corpus, or that case, is absent (CI, other machines).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.typing import NDArray

from conftest import TEST_DATA_CORPUS

SUBDIR = Path("origin") / "analysis_oracle"


@dataclass(frozen=True)
class OracleMatrix:
    """A matrix Origin created: ``z[row, col]`` with rows along ``y`` and
    columns along ``x``; blank cells are NaN."""

    x: NDArray[np.float64]
    y: NDArray[np.float64]
    z: NDArray[np.float64]


def _arr(values: list[float | None]) -> NDArray[np.float64]:
    return np.array([np.nan if v is None else v for v in values], dtype=float)


@dataclass(frozen=True)
class OracleFixture:
    case_id: str
    directory: Path
    truth: dict[str, Any]
    oracle: dict[str, Any]

    @property
    def planted(self) -> dict[str, Any]:
        planted: dict[str, Any] = self.truth["planted"]
        return planted

    @property
    def input_bytes(self) -> bytes:
        return (self.directory / "input.csv").read_bytes()

    def input_columns(self) -> dict[str, NDArray[np.float64]]:
        """The frozen ``input.csv`` columns by header (blank cells are NaN)."""
        lines = self.input_bytes.decode("utf-8").splitlines()
        head = lines[0].split(",")
        rows = [ln.split(",") for ln in lines[1:]]
        return {
            h: np.array([float(r[i]) if r[i] != "" else np.nan for r in rows])
            for i, h in enumerate(head)
        }

    def outputs(self) -> list[NDArray[np.float64]]:
        """Every column Origin created, in creation order (blank cells NaN).
        The input columns are not included."""
        return [
            _arr(c["values"])
            for b in self.oracle["books"]
            for s in b["sheets"]
            for c in s["columns"]
        ]

    def matrix(self, index: int = 0) -> OracleMatrix:
        m = self.oracle["matrices"][index]
        z = np.array(
            [[np.nan if v is None else v for v in row] for row in m["z"]], dtype=float
        )
        return OracleMatrix(np.array(m["x"], dtype=float), np.array(m["y"], dtype=float), z)

    def column(self, long_name: str, occurrence: int = 0) -> list[float | None]:
        """Values of the ``occurrence``-th output column named ``long_name``
        across every sheet Origin created (input columns are not included)."""
        hits = [
            c["values"]
            for b in self.oracle["books"]
            for s in b["sheets"]
            for c in s["columns"]
            if c["long"] == long_name
        ]
        if len(hits) <= occurrence:
            raise KeyError(f"{self.case_id}: no output column {long_name!r} #{occurrence}")
        values: list[float | None] = hits[occurrence]
        return values


def load_fixture(case_id: str) -> OracleFixture:
    directory = TEST_DATA_CORPUS / SUBDIR / case_id
    if not (directory / "oracle.json").is_file():
        pytest.skip(f"oracle fixture {case_id!r} not present under {TEST_DATA_CORPUS / SUBDIR}")
    return OracleFixture(
        case_id,
        directory,
        json.loads((directory / "truth.json").read_text(encoding="utf-8")),
        json.loads((directory / "oracle.json").read_text(encoding="utf-8")),
    )
