"""Run an analysis template saved in the app, headless (gap audit 5, item 6).

An analysis template (``frontend/src/lib/template.ts``: ``{"version": 1,
"name", "steps", "outputs", ...}``, saved from the Pipeline panel or the Recipe
Library) is a named, ordered list of recorded pipeline steps. This module
replays it on one :class:`DataStruct` the way the app's template batch does
(``components/workshops/pipeline/executeSteps.ts`` + ``runTemplate.ts``), on
the public :mod:`quantized.api` -- the SAME calls the app's exported pipeline
script makes (``lib/pipeline.ts`` ``pipelineToPython``), so a recipe run, the
exported script and the app agree.

What replays (step ``kind`` -> call):

* ``import``      the input slot: the file given on the command line;
* ``correction``  ``apply_corrections`` on the UNcorrected base, then the
                  formula columns are recomputed on top (the app's order); a
                  background subtraction uses the next of ``backgrounds`` (one
                  file per such step, in step order);
* ``reset``       back to that base (formula columns recomputed);
* ``expression``  a formula column (``add_formula_columns``), when the
                  formula is in the headless subset (``calc/column_formula``);
                  an EDITED formula is refused (its record carries only the
                  new name, and the app's batch re-adds it as a new column);
* ``fit``         ``fit_model`` on the recorded channels, X range, starts,
                  bounds and held parameters;
* ``transform``   ``resample`` (n points / step / range) via
                  ``align_resample`` and the signal / Reduce XY operations
                  (``sigop``) via ``run_signal_op``; the output becomes the
                  data every later step works on, as in the app;
* ``ui``          not replayed -- the app's batch skips it too. One that can
                  change the data is reported as a warning.

FAIL CLOSED. :func:`recipe_problems` lists every enabled step that cannot be
replayed headless (a formula outside the subset, a derived column with units,
a transform with a second input, a weighted fit, ...). ``qz run`` refuses the
whole recipe when there is one -- it never writes numbers that differ from the
app's. Disabled steps are skipped, as in the app, and every step after a
disabled transform too (it was recorded on that transform's output). A step
that fails fails the whole input (the app's batch keeps going and flags the
row; headless, nothing half-done is written).

Not recorded by the app and so not replayed: rows excluded or filtered in the
app (every row is used) and error-column roles changed by hand. The roles the
app SEEDS on import (Origin designations, a parser's declaration, the label
guess: ``io/error_seed.py``) are applied to every correction, as the app sends
them, so a bound error column is scaled but never offset.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np

import quantized.api as qz
from quantized.calc.column_formula import formula_problem
from quantized.datastruct import DataStruct
from quantized.io.error_seed import seed_error_roles
from quantized.recipe_params import expectation_warnings, resample_params, sigop_params

__all__ = [
    "Recipe",
    "RecipeRun",
    "extract_outputs",
    "is_formula_edit",
    "parse_recipe",
    "recipe_problems",
    "run_recipe",
]

STEP_KINDS = ("ui", "import", "expression", "correction", "reset", "fit", "transform")
#: lib/pipeline.ts VIEW_ONLY: recorded actions that only change what is shown.
_VIEW_ONLY = re.compile(
    r"^qz\.(setXScale|setYScale|setPlotTitle|setWaterfall|setShowGrid|setXKey|setYKeys|setGroupKey)\("
)


@dataclass(frozen=True)
class Recipe:
    """A parsed analysis template."""

    name: str
    steps: tuple[Mapping[str, Any], ...]
    outputs: tuple[str, ...] = ()
    description: str = ""
    revision: int | None = None
    #: The recording input's layout (``lib/recipeExpect.ts``), when saved.
    expects: Mapping[str, Any] | None = None


@dataclass
class RecipeRun:
    """One input's run: the final data, every fit (label, result), the log."""

    data: DataStruct
    fits: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    log: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def parse_recipe(text: str) -> Recipe:
    """Parse a template file (``lib/template.ts`` ``parseTemplate``'s rules).
    Raises ``ValueError`` naming what is wrong."""
    try:
        doc = json.loads(text)
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError("not a valid template file (bad JSON)") from exc
    if not isinstance(doc, Mapping):
        raise ValueError("not a template file")
    if doc.get("version") != 1 or isinstance(doc.get("version"), bool):
        raise ValueError(f"unsupported template version: {doc.get('version')!r}")
    name = doc.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("template needs a name")
    steps = doc.get("steps")
    if not isinstance(steps, list) or not all(_is_step(s) for s in steps):
        raise ValueError("template has malformed steps")
    outputs = doc.get("outputs")
    rev = doc.get("revision")
    return Recipe(
        name=name.strip(),
        steps=tuple(dict(s) for s in steps),
        outputs=tuple(o for o in outputs if isinstance(o, str))
        if isinstance(outputs, list)
        else (),
        description=str(doc.get("description") or "").strip(),
        revision=rev if isinstance(rev, int) and not isinstance(rev, bool) and rev > 0 else None,
        expects=dict(doc["expects"]) if isinstance(doc.get("expects"), Mapping) else None,
    )


def _is_step(s: Any) -> bool:
    return (
        isinstance(s, Mapping)
        and isinstance(s.get("label"), str)
        and isinstance(s.get("code"), str)
        and s.get("kind") in STEP_KINDS
        and isinstance(s.get("params"), Mapping)
    )


def _enabled(step: Mapping[str, Any]) -> bool:
    return step.get("enabled") is not False


def is_formula_edit(step: Mapping[str, Any]) -> bool:
    """An "Edit column" recording: ``params`` carry the NEW name and formula
    only (a rename loses the old name), and the app's own batch replays it as
    an added column. Neither can be reproduced faithfully, so it is refused."""
    code, label = str(step.get("code", "")), str(step.get("label", ""))
    return code.startswith("qz.editColumn(") or label.startswith("Edit column")


def _background_steps(recipe: Recipe) -> int:
    return sum(
        1
        for s in recipe.steps
        if _enabled(s) and s["kind"] == "correction" and isinstance(s["params"].get("bg"), Mapping)
    )


def _step_problem(step: Mapping[str, Any]) -> str | None:
    """Why ``step`` cannot replay headless, or ``None``."""
    kind = step["kind"]
    p: Mapping[str, Any] = step["params"]
    if kind == "expression":
        if not isinstance(p.get("name"), str) or not isinstance(p.get("expr"), str):
            return "this worksheet operation has no headless equivalent"
        if is_formula_edit(step):
            return "an edited formula column (re-record the pipeline with the final formula)"
        if p.get("derived") is True:
            return "a derived column (units / error propagation) is evaluated only in the app"
        problem = formula_problem(str(p["expr"]))
        return f"formula {p['expr']!r}: {problem}" if problem else None
    if kind == "correction":
        if not isinstance(p.get("params", {}), Mapping):
            return "its correction parameters are malformed"
        bg = p.get("bg")
        if bg and not (isinstance(bg, Mapping) and isinstance(bg.get("interp", ""), str)):
            return "its background reference is malformed"
        return None
    if kind == "fit":
        if p.get("fitTemplate") is not None:
            return "a Curve Fit template step has no headless equivalent yet"
        if not isinstance(p.get("model"), str) or not p["model"]:
            return "the fit model was not recorded"
        if isinstance(p.get("rowIds"), list):
            return "it fitted an explicit row selection"
        if p.get("weight") and not (
            isinstance(p["weight"], Mapping) and p["weight"].get("mode") == "none"
        ):
            return "a weighted fit has no headless equivalent yet"
        return None
    if kind == "transform":
        op = p.get("op")
        try:
            if op == "resample":
                resample_params(p)
                return None
            if op == "sigop":
                sigop_params(p)
                return None
        except ValueError as exc:
            return str(exc)
        return f"the {op or 'unknown'} transform has no headless equivalent"
    return None


def recipe_problems(recipe: Recipe, *, backgrounds: int = 0) -> list[str]:
    """``"step N (label): why"`` for every enabled step that cannot replay,
    plus a background-file count that does not match the recipe's
    background-subtraction steps (one file per step, in step order)."""
    out: list[str] = []
    for n, step in enumerate(recipe.steps, start=1):
        if not _enabled(step):
            continue
        why = _step_problem(step)
        if why:
            out.append(f"step {n} ({step['label']}): {why}")
    need = _background_steps(recipe)
    if need != backgrounds:
        out.append(
            f"the recipe has {need} background-subtraction step(s): give that many "
            f"--background files, one per step in order ({backgrounds} given)"
        )
    return out


def _fit(data: DataStruct, p: Mapping[str, Any]) -> tuple[dict[str, Any], int]:
    if isinstance(p.get("yKey"), int):
        x = np.asarray(
            data.column(p["xKey"]) if isinstance(p.get("xKey"), int) else data.time, dtype=float
        )
        y = np.asarray(data.column(int(p["yKey"])), dtype=float)
    else:  # a legacy {model}-only step: X vs the first channel, as the app replays it
        x, y = np.asarray(data.time, dtype=float), np.asarray(data.column(0), dtype=float)
    keep = np.isfinite(x) & np.isfinite(y)
    rng = p.get("range")
    # lib/fitStepDecode.ts: only two finite, ordered numbers, and only for a
    # step that recorded its channels; anything else fits every row.
    if (
        isinstance(p.get("yKey"), int)
        and isinstance(rng, list)
        and len(rng) == 2
        and all(isinstance(v, int | float) and not isinstance(v, bool) for v in rng)
        and all(math.isfinite(v) for v in rng)
        and rng[0] <= rng[1]
    ):
        keep &= (x >= float(rng[0])) & (x <= float(rng[1]))
    if not keep.any():
        raise ValueError("no finite X/Y pairs are available to fit")  # the app's message
    kwargs: dict[str, Any] = {}
    if isinstance(p.get("p0"), list):
        kwargs["p0"] = p["p0"]
        for key in ("lower", "upper", "fixed"):
            if isinstance(p.get(key), list):
                kwargs[key] = p[key]
    return qz.fit_model(str(p["model"]), x[keep], y[keep], **kwargs), int(keep.sum())


def _transform(data: DataStruct, p: Mapping[str, Any]) -> tuple[DataStruct, list[str]]:
    if p["op"] == "resample":
        res = qz.resample(data, **resample_params(p))
        return res.data, [str(w.get("text", "")) for w in res.warnings]
    method, channels, args = sigop_params(p)
    sig = qz.run_signal_op(data, method, channels, args)
    return sig.data, list(sig.warnings)


def run_recipe(
    recipe: Recipe, data: DataStruct, *, backgrounds: Sequence[DataStruct] = ()
) -> RecipeRun:
    """Replay ``recipe`` on ``data`` (the module doc). ``backgrounds``: one
    dataset per background-subtraction step, in step order. Raises
    ``ValueError`` when the recipe has a problem :func:`recipe_problems` lists,
    or a step fails (the message names it) -- a half-replayed result is never
    returned."""
    problems = recipe_problems(recipe, backgrounds=len(backgrounds))
    if problems:
        raise ValueError("cannot run headless: " + "; ".join(problems))
    run = RecipeRun(data=data)
    run.warnings.extend(f"input: {w}" for w in expectation_warnings(recipe.expects, data))
    raw = base = data
    # The roles the app seeds on import and sends with every correction
    # (io/error_seed.py); a transform's output gets none, as in the app.
    roles = seed_error_roles(data)
    formulas: list[tuple[str, str]] = []
    bg_next = 0
    blocked = ""
    for n, step in enumerate(recipe.steps, start=1):
        label = f"{n}. {step['label']}"
        p: Mapping[str, Any] = step["params"]
        kind = step["kind"]
        if not _enabled(step) or blocked:
            # As executeSteps: a step after a disabled transform was recorded
            # on that transform's output, which does not exist -- not run.
            run.log.append(f"{label}: not run ({blocked or 'disabled'})")
            if kind == "transform" and not blocked:
                blocked = f"it follows the disabled step {n}"
            continue
        try:
            if kind == "import":
                run.log.append(f"{label}: the input file")
                continue
            if kind == "ui":
                if not _VIEW_ONLY.match(str(step["code"])):
                    run.warnings.append(
                        f"{label}: a recorded app action, not replayed "
                        "(the app's batch skips it too)"
                    )
                continue
            if kind == "expression":
                formulas.append((str(p["name"]), str(p["expr"])))
                if isinstance(p.get("errorOf"), str):
                    run.warnings.append(f"{label}: computed; its error-bar binding is not applied")
            elif kind == "correction":
                bg = None
                if isinstance(p.get("bg"), Mapping):
                    bg, bg_next = backgrounds[bg_next], bg_next + 1
                interp = str(p["bg"].get("interp", "linear")) if bg is not None else "linear"
                base = qz.apply_corrections(
                    raw,
                    dict(p.get("params") or {}),
                    bg_dataset=bg,
                    bg_interp=interp,
                    error_bindings=roles,
                )
            elif kind == "reset":
                base = raw
            elif kind == "fit":
                fit, n_fit = _fit(run.data, p)
                run.fits.append((label, fit))
                if p.get("statsVersion") != 2:
                    run.warnings.append(
                        f"{label}: recorded with the legacy (v1) fit statistics; "
                        "this uses the current ones"
                    )
                run.log.append(f"{label}: fit {n_fit} points, R2={fit.get('R2', math.nan):.6g}")
                continue
            else:  # transform: a new dataset; its formula columns become plain values
                out, warns = _transform(run.data, p)
                run.warnings.extend(f"{label}: {w}" for w in warns if w)
                raw = base = out
                formulas = []
                roles = None
            run.data = qz.add_formula_columns(base, formulas) if formulas else base
            run.log.append(f"{label}: ok")
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ValueError(f"{label} failed: {exc}") from exc
    return run


def extract_outputs(outputs: Sequence[str], fit: Mapping[str, Any] | None) -> list[float]:
    """The declared outputs from the LAST fit (``lib/template.ts``
    ``extractOutputs``): parameter i by position, ``"R2"`` the goodness of
    fit, NaN where absent."""
    if fit is None:
        return [math.nan for _ in outputs]
    raw = fit.get("params")
    params = np.asarray(raw if raw is not None else [], dtype=float).ravel()
    out: list[float] = []
    for i, name in enumerate(outputs):
        if name == "R2":
            r2 = fit.get("R2")
            out.append(float(r2) if isinstance(r2, int | float | np.floating) else math.nan)
        else:
            out.append(float(params[i]) if i < params.size else math.nan)
    return out
