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
                  background subtraction uses the ``background`` dataset;
* ``reset``       back to that base (formula columns recomputed);
* ``expression``  a formula column (``add_formula_columns``), when the
                  formula is in the headless subset (``calc/column_formula``);
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
app's. Disabled steps are skipped, as in the app.

Not recorded by the app and so not replayed: rows excluded or filtered in the
app (every row is used) and error-column bindings set by hand.
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

__all__ = [
    "Recipe",
    "RecipeRun",
    "extract_outputs",
    "parse_recipe",
    "recipe_problems",
    "run_recipe",
]

STEP_KINDS = ("ui", "import", "expression", "correction", "reset", "fit", "transform")
#: lib/pipeline.ts VIEW_ONLY: recorded actions that only change what is shown.
_VIEW_ONLY = re.compile(
    r"^qz\.(setXScale|setYScale|setPlotTitle|setWaterfall|setShowGrid|setXKey|setYKeys|setGroupKey)\("
)
_RESAMPLE_MODES = ("n_points", "step", "range")


@dataclass(frozen=True)
class Recipe:
    """A parsed analysis template."""

    name: str
    steps: tuple[Mapping[str, Any], ...]
    outputs: tuple[str, ...] = ()
    description: str = ""
    revision: int | None = None


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


def _step_problem(step: Mapping[str, Any], has_background: bool) -> str | None:
    """Why ``step`` cannot replay headless, or ``None``."""
    kind = step["kind"]
    p: Mapping[str, Any] = step["params"]
    if kind == "expression":
        if not isinstance(p.get("name"), str) or not isinstance(p.get("expr"), str):
            return "this worksheet operation has no headless equivalent"
        if p.get("derived") is True:
            return "a derived column (units / error propagation) is evaluated only in the app"
        problem = formula_problem(str(p["expr"]))
        return f"formula {p['expr']!r}: {problem}" if problem else None
    if kind == "correction":
        if p.get("bg") and not has_background:
            return "it subtracts a background dataset: give its file with --background"
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
        if op == "resample":
            return (
                None if p.get("mode") in _RESAMPLE_MODES else "a resample onto another dataset's X"
            )
        if op == "sigop":
            return None
        return f"the {op or 'unknown'} transform has no headless equivalent"
    return None


def recipe_problems(recipe: Recipe, *, has_background: bool = False) -> list[str]:
    """``"step N (label): why"`` for every enabled step that cannot replay."""
    out: list[str] = []
    for n, step in enumerate(recipe.steps, start=1):
        if not _enabled(step):
            continue
        why = _step_problem(step, has_background)
        if why:
            out.append(f"step {n} ({step['label']}): {why}")
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
    if isinstance(rng, list) and len(rng) == 2:
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
        res = qz.align_resample(
            data,
            mode=str(p["mode"]),
            n_points=p.get("nPoints"),
            step=p.get("step"),
            start=p.get("start"),
            stop=p.get("stop"),
            method=str(p.get("method", "linear")),
            out_of_range=str(p.get("outOfRange", "nan")),
            unsorted="sort" if p.get("sortUnsorted") else "refuse",
        )
        return res.data, [str(w.get("text", "")) for w in res.warnings]
    channels = p.get("channels") or []
    args = p.get("args") or {}
    sig = qz.run_signal_op(data, str(p.get("method", "")), list(channels), dict(args))
    return sig.data, list(sig.warnings)


def run_recipe(
    recipe: Recipe, data: DataStruct, *, background: DataStruct | None = None
) -> RecipeRun:
    """Replay ``recipe`` on ``data`` (the module doc). Raises ``ValueError``
    when the recipe has a step :func:`recipe_problems` lists, or a step fails
    (the message names it) -- a half-replayed result is never returned."""
    problems = recipe_problems(recipe, has_background=background is not None)
    if problems:
        raise ValueError("cannot run headless: " + "; ".join(problems))
    run = RecipeRun(data=data)
    raw = base = data
    formulas: list[tuple[str, str]] = []
    for n, step in enumerate(recipe.steps, start=1):
        label = f"{n}. {step['label']}"
        p: Mapping[str, Any] = step["params"]
        kind = step["kind"]
        if not _enabled(step):
            run.log.append(f"{label}: disabled, not run")
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
                name, expr = str(p["name"]), str(p["expr"])
                hit = next((i for i, f in enumerate(formulas) if f[0] == name), None)
                if hit is not None and str(step["label"]).startswith("Edit column"):
                    formulas[hit] = (name, expr)
                else:
                    formulas.append((name, expr))
                if isinstance(p.get("errorOf"), str):
                    run.warnings.append(f"{label}: computed; its error-bar binding is not applied")
            elif kind == "correction":
                bg = background if p.get("bg") else None
                interp = str(p["bg"].get("interp", "linear")) if bg is not None else "linear"
                base = qz.apply_corrections(
                    raw, dict(p.get("params") or {}), bg_dataset=bg, bg_interp=interp
                )
            elif kind == "reset":
                base = raw
            elif kind == "fit":
                fit, n_fit = _fit(run.data, p)
                run.fits.append((label, fit))
                run.log.append(f"{label}: fit {n_fit} points, R2={fit.get('R2', math.nan):.6g}")
                continue
            else:  # transform: a new dataset; its formula columns become plain values
                out, warns = _transform(run.data, p)
                run.warnings.extend(f"{label}: {w}" for w in warns if w)
                raw = base = out
                formulas = []
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
