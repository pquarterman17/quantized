"""The analysis-oracle harness (tools/origin_oracle) without Origin.

Case parsing, deterministic input generation and JSON writing: what must hold
on every machine and in CI.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import pytest

TOOLS = Path(__file__).resolve().parents[1] / "tools" / "origin_oracle"
sys.path.insert(0, str(TOOLS))

import oracle_cases  # noqa: E402
import oracle_inputs  # noqa: E402
import oracle_store  # noqa: E402
from oracle_model import (  # noqa: E402
    Case,
    Column,
    InputSpec,
    Read,
    find_case,
    input_csv,
    make_input,
    to_json,
    truth_doc,
    validate_case,
)

from quantized.calc import peakshapes  # noqa: E402

CASES = oracle_cases.CASES


def _dummy(rng: np.random.Generator) -> InputSpec:
    return InputSpec((Column("x", "X", np.arange(3.0)),), {})


def test_registry_is_sound_and_covers_the_first_set() -> None:
    assert [p for c in CASES for p in validate_case(c)] == []
    ids = [c.id for c in CASES]
    assert len(set(ids)) == len(ids)
    assert len({c.seed for c in CASES}) == len(CASES)
    first = {"intersect", "levelcrossing", "fitlrxerr", "nlfit_gauss", "integ1_area", "pkfind"}
    assert first <= set(ids)


def test_validate_case_flags_bad_definitions() -> None:
    assert validate_case(Case("a b", "d", 1, _dummy, ("x;",)))
    assert validate_case(Case("ok", "d", 1, _dummy, ()))
    assert validate_case(Case("ok", "d", 1, _dummy, ("a;\nb;",)))
    assert validate_case(Case("ok", "d", 1, _dummy, ("a;",), reads=(Read("v", "bogus"),)))
    assert validate_case(Case("ok", "d", 1, _dummy, ("a;",), load_oc=("../x.c",)))
    assert validate_case(Case("ok", "d", 1, _dummy, (), not_exercised=("tried X",))) == []


def test_labtalk_substitutes_the_book_and_keeps_one_step_each() -> None:
    c = find_case(CASES, "intersect")
    sent = c.labtalk("OracleIn7")
    assert len(sent) == len(c.steps) and "{book}" not in sent[0] and "[OracleIn7]1!" in sent[0]
    with pytest.raises(KeyError):
        find_case(CASES, "nope")


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
def test_inputs_are_byte_deterministic_per_seed(case: Case) -> None:
    a, b = input_csv(make_input(case)), input_csv(make_input(case))
    assert a == b and a.endswith("\n") and "\r" not in a
    other = Case(case.id, case.description, case.seed + 1, case.generate, case.steps)
    assert input_csv(make_input(other)) != a
    t = to_json(truth_doc(case, make_input(case)))
    assert t == to_json(truth_doc(case, make_input(case)))


def test_input_csv_round_trips_floats_exactly() -> None:
    spec = make_input(find_case(CASES, "pkfind"))
    rows = input_csv(spec).splitlines()
    assert rows[0] == "x,y"
    xs, ys = zip(*(map(float, r.split(",")) for r in rows[1:]), strict=True)
    np.testing.assert_array_equal(xs, spec.columns[0].values)
    np.testing.assert_array_equal(ys, spec.columns[1].values)


def test_to_json_is_stable_and_nan_safe() -> None:
    doc = {"b": float("nan"), "a": [np.float64(1.5), float("inf")], "n": np.int64(3)}
    text = to_json(doc)
    assert text == to_json(doc) and text.endswith("\n")
    assert json.loads(text) == {"a": [1.5, None], "b": None, "n": 3}
    assert text.index('"a"') < text.index('"b"')


def test_planted_truth_holds_in_the_generated_data() -> None:
    spec = make_input(find_case(CASES, "intersect"))
    for r in spec.truth["crossings_x"]:
        assert math.sin(r) == pytest.approx(0.3, abs=1e-12)
    assert len(spec.truth["crossings_x"]) == 4
    x = spec.columns[0].values
    assert x[0] == 0.0 and x[-1] == 10.0 and np.all(np.diff(x) >= 0)

    spec = make_input(find_case(CASES, "levelcrossing"))
    w = 2 * math.pi / spec.truth["period"]
    for r in spec.truth["crossings_x"]:
        assert math.sin(w * r + spec.truth["phase"]) == pytest.approx(0.25, abs=1e-12)
    y = spec.columns[1].values
    assert (np.sign(y[:-1] - 0.25) != np.sign(y[1:] - 0.25)).sum() == spec.truth["n_crossings"]

    spec = make_input(find_case(CASES, "integ1_area"))
    x, y = spec.columns[0].values, spec.columns[1].values
    assert float(np.sum(np.diff(x) * (y[:-1] + y[1:]) / 2)) == pytest.approx(25.0, abs=1e-9)


def test_line_fit_input_has_per_point_errors_in_the_right_designations() -> None:
    spec = make_input(find_case(CASES, "fitlrxerr"))
    assert [c.designation for c in spec.columns] == ["X", "Y", "Y-error", "X-error"]
    assert np.all(spec.columns[2].values > 0) and np.all(spec.columns[3].values > 0)
    assert len(set(spec.columns[2].values.tolist())) > 1  # genuinely per-point


def test_peak_inputs_use_quantizeds_own_shapes() -> None:
    assert oracle_inputs.peakshapes is peakshapes
    spec = make_input(find_case(CASES, "pkfind"))
    x, y = spec.columns[0].values, spec.columns[1].values
    for c, h in zip(spec.truth["centers"], spec.truth["heights"], strict=True):
        i = int(np.argmin(np.abs(x - c)))
        assert abs(y[i] - h) < 1.0  # at the planted height, within noise + overlap


def test_store_writes_identical_inputs(tmp_path: Path) -> None:
    case = find_case(CASES, "intersect")
    d1, d2 = tmp_path / "a", tmp_path / "b"
    for d in (d1, d2):
        oracle_store.write_inputs(d, case, make_input(case))
    for name in ("input.csv", "truth.json"):
        assert (d1 / name).read_bytes() == (d2 / name).read_bytes()
    oracle_store.write_oracle(d1, {"status": "failed", "values": {"x": float("nan")}})
    assert json.loads((d1 / "oracle.json").read_text())["values"] == {"x": None}
    assert oracle_store.case_dir(tmp_path, "c") == tmp_path / "origin" / "analysis_oracle" / "c"


def test_corpus_root_env_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QZ_TEST_DATA", str(tmp_path))
    assert oracle_store.corpus_root() == tmp_path


def test_runner_never_dispatches_the_single_instance_server() -> None:
    for src in TOOLS.glob("*.py"):
        text = src.read_text(encoding="utf-8")
        assert not re.search(r"Dispatch(Ex)?\([^)]*ApplicationSI", text), src.name
    run_text = (TOOLS / "run.py").read_text(encoding="utf-8")
    assert "from origin_session import OriginSession" in run_text
    assert "Dispatch(" not in run_text  # session management stays in origin_session.py
