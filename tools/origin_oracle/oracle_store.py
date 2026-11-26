"""Where fixtures live and how they are written (pure; no Origin).

Fixtures go to ``<test-data>/origin/analysis_oracle/<case-id>/`` and never
into the quantized repo. ``test-data`` is found the way ``tests/conftest.py``
does: a sibling of the repo root, else any ancestor's ``test-data``, so it
resolves from a ``.claude/worktrees/<name>`` checkout too.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from oracle_model import Case, InputSpec, input_csv, to_json, truth_doc

HERE = Path(__file__).resolve().parent
SUBDIR = Path("origin") / "analysis_oracle"
FILES = ("input.csv", "truth.json", "oracle.json")


def corpus_root(start: Path = HERE) -> Path:
    """The ``test-data`` directory (env ``QZ_TEST_DATA`` overrides)."""
    env = os.environ.get("QZ_TEST_DATA")
    if env:
        return Path(env)
    for ancestor in start.resolve().parents:
        cand = ancestor / "test-data"
        if cand.is_dir():
            return cand
    raise FileNotFoundError("no test-data directory found above " + str(start))


def case_dir(root: Path, case_id: str) -> Path:
    return root / SUBDIR / case_id


def write_inputs(directory: Path, case: Case, spec: InputSpec) -> None:
    """``input.csv`` and ``truth.json``: pure functions of (case, seed)."""
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "input.csv").write_bytes(input_csv(spec).encode("utf-8"))
    (directory / "truth.json").write_bytes(to_json(truth_doc(case, spec)).encode("utf-8"))


def write_oracle(directory: Path, doc: dict[str, Any]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "oracle.json").write_bytes(to_json(doc).encode("utf-8"))
