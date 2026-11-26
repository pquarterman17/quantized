"""The oracle runner's timeout-and-respawn path and matrix capture, without Origin.

The real hang was forced on OriginPro 2026b with a scratch case (a LabTalk
``for`` loop that never ends): the 60 s deadline killed exactly the harness's
own PID, recorded status ``timeout``, and the next case ran in a fresh
session. These tests pin the runner logic around it with a fake session.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "origin_oracle"))
sys.path.insert(0, str(ROOT / "tools" / "plot_corpus"))

import oracle_matrix  # noqa: E402
import run as oracle_run  # noqa: E402
from oracle_model import Case, Column, InputSpec  # noqa: E402


def _gen(rng: np.random.Generator) -> InputSpec:
    return InputSpec((Column("x", "X", np.arange(3.0)),), {})


class FakeSession:
    """Stands in for ``OriginSession``; counts instances and closes."""

    made: list[FakeSession] = []

    def __init__(self, sidecar: Path) -> None:
        self.timed_out = False
        self.closed = False
        FakeSession.made.append(self)

    def start(self) -> FakeSession:
        return self

    def close(self) -> None:
        self.closed = True

    @contextmanager
    def deadline(self, seconds: float) -> Iterator[None]:
        assert seconds == oracle_run.DEADLINE_S == 60.0
        yield


def test_a_hung_case_is_recorded_and_the_next_case_gets_a_fresh_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import origin_session

    FakeSession.made = []
    monkeypatch.setattr(origin_session, "OriginSession", FakeSession)
    monkeypatch.setattr(origin_session, "assert_no_origin", lambda: None)

    def fake_run_case(s: FakeSession, case: Case, spec: InputSpec) -> dict[str, Any]:
        if case.id == "hang":
            s.timed_out = True  # what the watchdog sets after killing the PID
            raise OSError("The remote procedure call failed")
        return {"case": case.id, "status": "ok"}

    monkeypatch.setattr(oracle_run, "run_case", fake_run_case)
    cases = [Case(i, "d", n, _gen, ("x;",)) for i, n in (("a", 1), ("hang", 2), ("b", 3))]
    results = oracle_run.exercise(cases, tmp_path, tmp_path / "sidecar.json")

    assert results == {"a": "ok", "hang": "timeout", "b": "ok"}
    first, second = FakeSession.made
    assert len(FakeSession.made) == 2 and first is not second
    assert first.closed and second.closed  # nothing is left running
    hung = json.loads((tmp_path / "origin/analysis_oracle/hang/oracle.json").read_text())
    assert hung["status"] == "timeout" and "remote procedure call" in hung["error"]
    after = json.loads((tmp_path / "origin/analysis_oracle/b/oracle.json").read_text())
    assert after["status"] == "ok"


class FakeApp:
    def __init__(self, z: list[list[float]], xyz: list[list[float]]) -> None:
        self.z, self.xyz = z, xyz

    def LTStr(self, name: str) -> str:  # noqa: N802 - COM name
        return self.windows[self.kind]

    def GetMatrix(self, ref: str) -> list[list[float]]:  # noqa: N802
        return self.z

    def GetWorksheet(self, ref: str) -> list[list[float]]:  # noqa: N802
        return self.xyz

    windows: dict[str, str]
    kind = "M"


class FakeLT:
    def __init__(self, app: FakeApp) -> None:
        self.app = app
        self.ran: list[str] = []
        self.w_calls = 0

    def lt(self, cmd: str) -> bool:
        self.ran.append(cmd)
        if cmd.startswith("doc -e"):
            self.app.kind = cmd.split()[2]
            if self.app.kind == "W":  # first listing: none; after m2w: the scratch book
                self.app.windows["W"] = "Book9|" if any("m2w" in c for c in self.ran) else ""
        return True


def test_capture_matrices_keeps_orientation_axes_and_cleans_up() -> None:
    # 2 rows (y = 0, 5) x 3 columns (x = 1, 2, 3); m2w writes x-outer XYZ rows
    z = [[1.0, 2.0, 3.0], [4.0, float("nan"), 6.0]]
    xyz = [[1, 0, 1.0], [1, 5, 4.0], [2, 0, 2.0], [2, 5, 0.0], [3, 0, 3.0], [3, 5, 6.0]]
    app = FakeApp(z, [[float(v) for v in r] for r in xyz])
    app.windows = {"M": "MBook1|", "W": ""}
    s = FakeLT(app)
    s.app = app  # type: ignore[assignment]
    out = oracle_matrix.capture_matrices(s, before=set())
    assert len(out) == 1
    m = out[0]
    assert (m["rows"], m["cols"]) == (2, 3)
    assert m["x"] == [1.0, 2.0, 3.0] and m["y"] == [0.0, 5.0]
    assert m["z"] == [[1.0, 2.0, 3.0], [4.0, None, 6.0]]  # NaN becomes null, rows stay rows
    assert "win -cd Book9;" in s.ran and "win -cd MBook1;" in s.ran
    # matrices that were open before the case are skipped
    assert oracle_matrix.capture_matrices(s, before={"MBook1"}) == []
