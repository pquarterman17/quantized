"""Unit tests for tools/origin_regress.py on SYNTHETIC fingerprints.

No corpus data: fingerprints are built by hand, so these run in CI.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import origin_regress  # noqa: E402
from origin_regress_lib import diff as dfl  # noqa: E402
from origin_regress_lib import fingerprint as fpl  # noqa: E402
from origin_regress_lib import runner as rn  # noqa: E402


def _curve(**kw: Any) -> dict[str, Any]:
    c = {"book": "B1", "x": "A", "y": "B", "xRecorded": True, "plotType": "line", "color": "#111"}
    c.update(kw)
    return c


def _proj(curves: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "status": "best_effort",
        "omissions": ["layer_geometry"],
        "total": 1,
        "actionable": 1,
        "filtered": [],
        "unrecovered": 0,
        "embedded": 0,
        "books": [{"id": "B1", "rows": 10, "cols": 3, "labels": "abc"}],
        "figures": [
            {
                "name": "Graph1",
                "layer": 1,
                "axes": {
                    "x_from": 0.0,
                    "x_to": 1.0,
                    "x_log": False,
                    "y_from": 0,
                    "y_to": 2,
                    "y_log": False,
                },
                "curves": curves if curves is not None else [_curve(), _curve(y="C", color="#222")],
                "omitted": [],
                "fid": [],
            }
        ],
    }


def _snap(**projects: dict[str, Any]) -> dict[str, Any]:
    return {"schema": 1, "meta": {"sha": "abc"}, "projects": projects}


def _kinds(changes: list[dfl.Change]) -> set[str]:
    return {c.kind for c in changes}


def test_identical_snapshots_have_no_changes() -> None:
    assert dfl.diff_snapshots(_snap(p=_proj()), _snap(p=_proj())) == []


def test_lost_and_gained_curves() -> None:
    base = _snap(p=_proj())
    head = _snap(p=_proj([_curve()]))
    ch = dfl.diff_snapshots(base, head)
    assert _kinds(ch) == {"curve_lost"}
    assert dfl.diff_snapshots(head, base)[0].kind == "curve_gained"


def test_x_flip_is_a_changed_binding_not_lost_plus_gained() -> None:
    base = _snap(p=_proj([_curve(x="A")]))
    head = _snap(p=_proj([_curve(x="D")]))
    assert _kinds(dfl.diff_snapshots(base, head)) == {"binding_changed"}


def test_attribute_changes_are_classified() -> None:
    base = _snap(p=_proj([_curve()]))
    head = _snap(
        p=_proj([_curve(color="#999", hidden=True, plotType="scatter", xRecorded=False, yErr="E")])
    )
    assert _kinds(dfl.diff_snapshots(base, head)) == {
        "color_changed",
        "hidden_changed",
        "plot_type_changed",
        "x_recorded_changed",
        "error_role_changed",
    }


def test_omission_axis_fidelity_and_book_changes() -> None:
    b = _proj()
    h = copy.deepcopy(b)
    h["figures"][0]["omitted"] = [{"book": "B1", "x": "A", "y": "Z", "reason": "hidden_in_origin"}]
    h["figures"][0]["axes"]["x_to"] = 5.0
    h["figures"][0]["fid"] = ["curves_left_out"]
    h["books"][0]["rows"] = 9
    h["books"].append({"id": "B2", "rows": 1, "cols": 1, "labels": "z"})
    h["unrecovered"] = 3
    kinds = _kinds(dfl.diff_snapshots(_snap(p=b), _snap(p=h)))
    assert kinds == {
        "omission_added",
        "axis_changed",
        "fidelity_omissions_changed",
        "book_changed",
        "book_gained",
        "unrecovered_changed",
    }
    h2 = copy.deepcopy(h)
    h2["figures"][0]["omitted"][0]["reason"] = "other"
    assert _kinds(dfl.diff_snapshots(_snap(p=h), _snap(p=h2))) == {"omission_reason_changed"}


def test_figure_and_project_presence_and_errors() -> None:
    b = _proj()
    h = copy.deepcopy(b)
    h["figures"] = []
    assert _kinds(dfl.diff_snapshots(_snap(p=b), _snap(p=h))) == {"figure_lost"}
    assert _kinds(dfl.diff_snapshots(_snap(p=b), _snap())) == {"project_lost"}
    assert _kinds(dfl.diff_snapshots(_snap(), _snap(p=b))) == {"project_gained"}
    err = {"error": "OriginProjectError: x"}
    assert _kinds(dfl.diff_snapshots(_snap(p=b), _snap(p=err))) == {"status_changed"}
    assert dfl.diff_snapshots(_snap(p=err), _snap(p=err)) == []


def test_curve_reorder_detected() -> None:
    a, b = _curve(y="B"), _curve(y="C")
    ch = dfl.diff_snapshots(_snap(p=_proj([a, b])), _snap(p=_proj([b, a])))
    assert _kinds(ch) == {"curve_order_changed"}


def test_allow_file_explains_and_flags_stale(tmp_path: Path) -> None:
    ch = dfl.diff_snapshots(
        _snap(p=_proj(), q=_proj()), _snap(p=_proj([_curve()]), q=_proj([_curve()]))
    )
    allow = tmp_path / "allow.json"
    allow.write_text(
        json.dumps(
            {
                "p": [{"kind": "curve_lost", "contains": "Y=C", "reason": "was a phantom"}],
                "nomatch": [{"kind": "*", "reason": "stale"}],
            }
        )
    )
    unexplained, explained, stale = dfl.apply_allow(ch, dfl.load_allow(allow))
    assert [c.project for c in unexplained] == ["q"]
    assert explained[0][1] == "was a phantom"
    assert [r["project"] for r in stale] == ["nomatch"]


def test_allow_file_requires_reason(tmp_path: Path) -> None:
    f = tmp_path / "a.json"
    f.write_text(json.dumps({"p": [{"kind": "curve_lost", "reason": "  "}]}))
    with pytest.raises(dfl.AllowError):
        dfl.load_allow(f)


def test_diff_command_exit_codes(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    base, head = tmp_path / "b.json", tmp_path / "h.json"
    base.write_text(json.dumps(_snap(p=_proj())))
    head.write_text(json.dumps(_snap(p=_proj([_curve()]))))
    assert origin_regress.main(["diff", str(base), str(base)]) == 0
    assert origin_regress.main(["diff", str(base), str(head)]) == 1
    assert "curve_lost" in capsys.readouterr().out
    allow = tmp_path / "allow.json"
    allow.write_text(json.dumps({"p": [{"kind": "curve_lost", "reason": "phantom"}]}))
    assert origin_regress.main(["diff", str(base), str(head), "--allow-file", str(allow)]) == 0


def test_refuses_paths_inside_the_repo() -> None:
    with pytest.raises(SystemExit):
        rn.refuse_in_repo(ROOT / "baseline.json")
    with pytest.raises(SystemExit):
        origin_regress.main(["snapshot", "--out", str(ROOT / "docs" / "x.json")])


def test_allows_paths_outside_the_repo(tmp_path: Path) -> None:
    assert rn.refuse_in_repo(tmp_path / "x.json") == tmp_path / "x.json"


def test_corpus_walk_excludes_generated_and_synthetic(tmp_path: Path) -> None:
    for rel in (
        "a.opj",
        "sub/b.opju",
        "generated/c.opju",
        "_exports/d.opju",
        "CKPEIIKA_deopjufy/tests/fixtures/synthetic/e.opju",
        "BertySnack_norigin/f.opj",
        "g.txt",
    ):
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
    files = rn.collect_files({"c": tmp_path})
    assert sorted(files) == ["c:a.opj", "c:sub/b.opju"]


def test_fingerprint_is_value_free_and_deterministic() -> None:
    payload: dict[str, Any] = {
        "origin_fidelity": {"status": "complete", "omissions": ["b", "a"], "filtered_figures": []},
        "books": [
            {"id": "B1", "rows": 2, "cols": 2, "labels": ["x", "y"], "preview": [[1.5, 2.5]]}
        ],
        "figures": [
            {
                "name": "G",
                "layer": 1,
                "x_from": 0.1234567891234,
                "curves": [{"book": "B1", "x": "A", "y": "B", "data": [1, 2, 3], "yErrPlus": "C"}],
                "curve_sheet_omitted": [
                    {"book": "B1", "x": "A", "y": "D", "reason": "hidden_in_origin"}
                ],
                "fidelity": {"omissions": ["z", "a"]},
            }
        ],
    }
    fp = fpl.fingerprint_payload(payload)
    text = json.dumps(fp)
    assert "1.5" not in text and "data" not in text
    assert fp["omissions"] == ["a", "b"]
    assert fp["figures"][0]["curves"][0] == {"book": "B1", "x": "A", "y": "B", "yErrPlus": "C"}
    assert fp["figures"][0]["omitted"][0]["reason"] == "hidden_in_origin"
    assert fpl.fingerprint_payload(payload) == fp


def _fig(name: str | None, layer: int = 1, y: str = "B", **kw: Any) -> dict[str, Any]:
    f = copy.deepcopy(_proj([_curve(y=y)])["figures"][0])
    f["name"] = name
    f["layer"] = layer
    f.update(kw)
    return f


def _multi(*figs: dict[str, Any]) -> dict[str, Any]:
    p = _proj()
    p["figures"] = list(figs)
    p["actionable"] = len(figs)
    return p


def test_unnamed_and_duplicate_named_figures_are_all_checked() -> None:
    base = _multi(_fig(None, y="B"), _fig(None, y="C"), _fig("G", y="B"), _fig("G", y="C"))
    assert dfl.diff_snapshots(_snap(p=base), _snap(p=copy.deepcopy(base))) == []
    # a regression in the SECOND unnamed and the SECOND duplicate-named figure
    head = copy.deepcopy(base)
    head["figures"][1]["curves"][0]["y"] = "Z"
    head["figures"][3]["curves"] = []
    ch = dfl.diff_snapshots(_snap(p=base), _snap(p=head))
    details = " | ".join(c.detail for c in ch)
    assert "<unnamed>/L1#1" in details and "G/L1#1" in details
    assert "<unnamed>/L1#0" not in details and "G/L1#0" not in details
    # dropping one of two unnamed figures is a lost figure, not silence
    head2 = copy.deepcopy(base)
    del head2["figures"][1]
    assert _kinds(dfl.diff_snapshots(_snap(p=base), _snap(p=head2))) >= {"figure_lost"}
    # the fingerprint itself keeps every figure with its position
    payload = {
        "origin_fidelity": {},
        "figures": [{"name": None, "curves": [{"book": "B1"}]}, {"name": None, "curves": []}],
    }
    fp = fpl.fingerprint_payload(payload)
    assert [f["idx"] for f in fp["figures"]] == [0, 1] and fp["actionable"] == 2


def test_unbound_omitted_entries_are_keyed_uniquely() -> None:
    base = _proj()
    base["figures"][0]["omitted"] = [{"reason": "a"}, {"reason": "a"}, {"reason": "b"}]
    assert dfl.diff_snapshots(_snap(p=base), _snap(p=copy.deepcopy(base))) == []
    head = copy.deepcopy(base)
    head["figures"][0]["omitted"].pop()  # lose one of the unbound entries
    assert _kinds(dfl.diff_snapshots(_snap(p=base), _snap(p=head))) == {"omission_removed"}
    head = copy.deepcopy(base)
    head["figures"][0]["omitted"].append({"reason": "a"})  # a third identical one
    assert _kinds(dfl.diff_snapshots(_snap(p=base), _snap(p=head))) == {"omission_added"}
    head = copy.deepcopy(base)
    head["figures"][0]["omitted"][2] = {"reason": "c"}
    assert _kinds(dfl.diff_snapshots(_snap(p=base), _snap(p=head))) == {"omission_reason_changed"}
    # the fingerprint keeps entries that carry no book/X/Y at all
    fig = {"name": "G", "omitted_curves": [{"reason": "r1"}, {"reason": "r2", "note": "n"}]}
    assert fpl.figure_fp(fig)["omitted"] == [
        {"reason": "r1"},
        {"note": "n", "reason": "r2"},
    ]


def test_timeouts_never_compare_equal() -> None:
    t = {"error": "timeout"}
    assert _kinds(dfl.diff_snapshots(_snap(p=t), _snap(p=t))) == {"incomplete"}
    assert _kinds(dfl.diff_snapshots(_snap(p=_proj()), _snap(p=t))) == {"incomplete"}
    dead = {"error": "worker_died"}
    assert _kinds(dfl.diff_snapshots(_snap(p=dead), _snap(p=_proj()))) == {"incomplete"}


def test_snapshot_reports_totals_and_incomplete(tmp_path: Path) -> None:
    fp = fpl.fingerprint_payload(
        {"origin_fidelity": {}, "figures": [{"name": "G", "curves": [{"book": "B"}] * 3}]}
    )
    assert rn.totals({"a": fp, "b": {"error": "timeout"}}) == {
        "figures": 1,
        "curves": 3,
        "errors": 1,
    }
