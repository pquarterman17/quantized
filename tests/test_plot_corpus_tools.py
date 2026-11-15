"""The plot-corpus harness (tools/plot_corpus) without Origin.

Covers what must hold on every machine: the generator is deterministic and
every family still has the edge case it exists for; the type table and the
families cover each other; designations/units are derived from quantized;
and the Origin process guard only ever kills the exact process it started.
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools" / "plot_corpus"
sys.path.insert(0, str(TOOLS))

import families  # noqa: E402
import generate  # noqa: E402
import origin_build  # noqa: E402
import origin_session  # noqa: E402
import plot_types  # noqa: E402
import styles  # noqa: E402

from quantized.io.origin_project.writer import _DESIGNATION_CODE  # noqa: E402
from quantized.unit_display import display_unit  # noqa: E402


def _tree_bytes(root: Path) -> dict[str, bytes]:
    files = sorted(p for p in root.rglob("*") if p.is_file())
    return {str(p.relative_to(root)): p.read_bytes() for p in files}


def test_generator_is_byte_deterministic(tmp_path: Path) -> None:
    generate.main(["--out", str(tmp_path / "a")])
    generate.main(["--out", str(tmp_path / "b")])
    a, b = _tree_bytes(tmp_path / "a"), _tree_bytes(tmp_path / "b")
    assert a == b
    assert len(a) == 2 * len(families.FAMILIES)


def test_seed_changes_noisy_data_only_where_seeded(tmp_path: Path) -> None:
    generate.main(["--out", str(tmp_path / "a"), "--family", "noisy", "--family", "clean"])
    generate.main(["--out", str(tmp_path / "b"), "--seed", "7", "--family", "noisy",
                   "--family", "clean"])
    data = {k: json.loads((tmp_path / k / "noisy" / "family.json").read_text("utf-8"))
            for k in "ab"}
    assert data["a"]["books"] != data["b"]["books"]
    clean = [json.loads((tmp_path / k / "clean" / "family.json").read_text("utf-8"))["books"]
             for k in "ab"]
    assert clean[0] == clean[1]


@pytest.mark.parametrize("name", sorted(families.FAMILIES))
def test_every_family_keeps_its_property_and_feeds_a_type(name: str) -> None:
    fam = families.build_family(name, generate.DEFAULT_SEED)
    families.check_family(fam)
    assert plot_types.applicable(fam.shapes), f"{name} feeds no plot type"


def test_every_plot_type_has_a_family() -> None:
    shapes = set().union(*(families.build_family(n, 1).shapes for n in families.FAMILIES))
    assert {p.shape for p in plot_types.PLOT_TYPES} <= shapes


def test_check_family_catches_a_lost_edge_case() -> None:
    fam = families.build_family("nan_gaps", 1)
    col = fam.books[0].sheets[0].columns[1]
    assert col.values is not None
    col.values[7] = 1.0
    with pytest.raises(AssertionError, match="gap rows"):
        families.check_family(fam)


def test_designations_and_units_derive_from_quantized() -> None:
    assert styles.LT_DESIGNATION == {k: v + 1 for k, v in _DESIGNATION_CODE.items()}
    assert (styles.LT_DESIGNATION["Y"], styles.LT_DESIGNATION["X"]) == (1, 4)
    assert styles.LT_DESIGNATION["Z"] == 6
    with pytest.raises(ValueError):
        families.Column("A", "x", "", "not-a-designation", [1.0])
    truth = generate.truth_payload(families.build_family("unicode_names", 1), 1)
    shown = truth["facts"]["display_units"]
    assert shown == {u: display_unit(u) for u in shown}
    assert shown["Ang^-1"] != "Ang^-1"


def test_truth_lists_only_applicable_types() -> None:
    truth = generate.truth_payload(families.build_family("matrix", 1), 1)
    assert set(truth["plot_types"]) == {"contour_matrix", "heatmap_matrix"}
    truth = generate.truth_payload(families.build_family("loop_x", 1), 1)
    assert "column" not in truth["plot_types"] and "line" in truth["plot_types"]


# -- origin_session: exact-PID safety ------------------------------------------


def test_owned_process_json_round_trip() -> None:
    owned = origin_session.OwnedProcess(1234, 5678)
    assert origin_session.OwnedProcess.from_json(owned.to_json()) == owned
    assert origin_session.OwnedProcess.from_json("not json") is None
    assert origin_session.OwnedProcess.from_json('{"pid": 1}') is None


def test_kill_owned_refuses_a_recycled_pid(monkeypatch: pytest.MonkeyPatch) -> None:
    killed: list[list[str]] = []
    monkeypatch.setattr(origin_session, "origin_pids", lambda: {1234})
    monkeypatch.setattr(origin_session, "process_created", lambda pid: 999)
    monkeypatch.setattr(origin_session.subprocess, "run",
                        lambda cmd, **kw: killed.append(cmd))
    assert not origin_session.kill_owned(origin_session.OwnedProcess(1234, 5678))
    assert killed == []
    monkeypatch.setattr(origin_session, "process_created", lambda pid: 5678)
    assert origin_session.kill_owned(origin_session.OwnedProcess(1234, 5678))
    assert killed == [["taskkill", "/F", "/PID", "1234"]]


def test_kill_owned_never_touches_a_non_origin_pid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(origin_session, "origin_pids", lambda: {42})
    monkeypatch.setattr(origin_session.subprocess, "run",
                        lambda *a, **k: pytest.fail("must not kill"))
    assert not origin_session.kill_owned(origin_session.OwnedProcess(1234, 1))


def test_kill_stale_forgets_the_sidecar(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    side = tmp_path / "o.pid"
    side.write_text(origin_session.OwnedProcess(1, 2).to_json(), encoding="utf-8")
    monkeypatch.setattr(origin_session, "kill_owned", lambda owned: True)
    assert origin_session.kill_stale(side)
    assert not side.exists()
    assert not origin_session.kill_stale(side)


def test_refuses_to_start_beside_another_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(origin_session, "origin_pids", lambda: {77})
    with pytest.raises(origin_session.OriginBusyError):
        origin_session.assert_no_origin()


def test_deadline_kills_the_owned_instance(monkeypatch: pytest.MonkeyPatch) -> None:
    hits: list[origin_session.OwnedProcess] = []
    monkeypatch.setattr(origin_session, "kill_owned", lambda owned: hits.append(owned) or True)
    s = origin_session.OriginSession(Path("unused.pid"))
    s.owned = origin_session.OwnedProcess(9, 9)
    with s.deadline(0.05):
        time.sleep(0.3)
    assert s.timed_out and hits == [s.owned]
    s2 = origin_session.OriginSession(Path("unused.pid"))
    s2.owned = origin_session.OwnedProcess(8, 8)
    with s2.deadline(5.0):
        pass
    assert not s2.timed_out


def test_only_origin_application_is_dispatched() -> None:
    assert origin_session.PROGID == "Origin.Application"
    pattern = re.compile(r"Dispatch\w*\(\s*[\"']Origin\.ApplicationSI")
    for py in TOOLS.glob("*.py"):
        assert not pattern.search(py.read_text(encoding="utf-8")), py.name


# -- origin_build: LabTalk emitted for a book ------------------------------------


class _FakeSession:
    def __init__(self) -> None:
        self.cmds: list[str] = []
        self.puts: list[tuple[str, int]] = []
        outer = self

        class _App:
            def PutWorksheet(self, name: str, data: Any, row: int, col: int) -> None:  # noqa: N802
                outer.puts.append((name, col))

        self.app = _App()

    def lt(self, cmd: str) -> bool:
        self.cmds.append(cmd)
        return True

    def lts(self, expr: str) -> str:
        return "Book1"


def test_build_book_sets_designations_from_the_wire_table() -> None:
    payload = generate.family_payload(families.build_family("error_columns", 1), 1)
    fake = _FakeSession()
    assert origin_build.build_book(fake, payload["books"][0]) == "Book1"  # type: ignore[arg-type]
    types = [c for c in fake.cmds if ".type =" in c]
    assert types == ["wks.col1.type = 4;", "wks.col2.type = 1;", "wks.col3.type = 3;",
                     "wks.col4.type = 7;"]
    assert [c for _, c in fake.puts] == [0, 1, 2, 3]


def test_build_book_masks_and_deletes() -> None:
    fake = _FakeSession()
    masked = generate.family_payload(families.build_family("masked_rows", 1), 1)
    origin_build.build_book(fake, masked["books"][0])  # type: ignore[arg-type]
    assert sum(c.startswith("mark -w1") for c in fake.cmds) == 4
    fake = _FakeSession()
    deleted = generate.family_payload(families.build_family("deleted_sheet", 1), 1)
    origin_build.build_book(fake, deleted["books"][0])  # type: ignore[arg-type]
    assert any('page.active$ = "Gone"; layer -d;' in c for c in fake.cmds)


def test_labtalk_strings_reject_quotes() -> None:
    with pytest.raises(ValueError):
        origin_build._q('a"b')


def test_expected_readback_allows_error_companions_and_aliases() -> None:
    line = plot_types.by_name("line")
    assert line.expected_readback() == {200} | plot_types.ERROR_BAR_TYPES
    assert plot_types.by_name("bubble").expected_readback() == {201, 231, 233}
    # A template-decided type with no measured expectation accepts only error bars.
    assert 202 in plot_types.by_name("double_y").expected_readback()


def test_mapped_symbol_types_are_never_restyled() -> None:
    for name in ("bubble", "color_mapped"):
        assert name not in styles.STYLED_TYPES
