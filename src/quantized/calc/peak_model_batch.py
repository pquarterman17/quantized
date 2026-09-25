r"""Fit the mixed-shape peak model to many prepared datasets (audit P2.4 slice 4).

Pure calc layer. The batch half of "run a saved Peak Analyzer recipe over many
datasets": the client prepares one fit problem per dataset (range cut,
baseline, peak find and the recipe's parameter table re-seeded on THAT
dataset's data - the same code the wizard runs, so a batch row is what the
wizard would fit), and this loops :func:`quantized.calc.peak_model_fit.
fit_peak_model` over them. The route runs it on the poll-based job queue.

Guarantees (each pinned by ``tests/test_calc_peak_model_batch.py``):

* **Failure isolation.** Every item is fitted in its own ``try``: an item the
  fitter rejects (a bad parameter table, too few points) or that fails
  unexpectedly becomes a row with ``status == "error"`` and the reason, and the
  loop goes on. A fit that RUNS but does not converge is ``"ok"`` with its own
  ``success`` False and warnings - a diagnostic, not a failure.
* **Cancel.** ``abort_check`` is polled before every item AND before every
  model evaluation inside a fit (``solve_bounded``'s hook), so a cancel never
  waits out a whole fit; it raises :class:`BatchCancelled` and returns nothing
  (the caller - the job queue - reports "cancelled").
* **Deadline.** Each fit gets ``min(item_deadline_s, time left)``; once the
  batch's ``total_deadline_s`` is spent, every remaining item is a
  ``"not_run"`` row saying so, never silently dropped.
* ``progress(fraction, message)`` is called OUTSIDE the per-item ``try``, so
  whatever it raises (the job queue's own cancel exception) propagates.

Each ``"ok"`` row carries the fit result without ``curves`` and
``correlation`` (a table needs neither, and fifty curves would dominate the
payload); every uncertainty, flag, metric and warning is kept verbatim.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any

import numpy as np

from quantized.calc._bounded_lsq import FitAborted
from quantized.calc.peak_model_fit import fit_peak_model

__all__ = ["BatchCancelled", "fit_peak_model_batch"]

# What the fitter raises for bad-but-well-typed input: its message is curated
# ASCII and goes to the row verbatim. Anything else is a bug and gets a
# generic message naming only the exception type.
_EXPECTED = (ValueError, ArithmeticError, KeyError, IndexError, TypeError, np.linalg.LinAlgError)
_DROPPED = ("curves", "correlation")


class BatchCancelled(Exception):
    """The batch was cancelled through ``abort_check``."""


def _row(item_id: str, status: str, *, error: str | None = None,
         fit: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"id": item_id, "status": status, "error": error, "fit": fit}


def fit_peak_model_batch(
    items: Sequence[Mapping[str, Any]],
    *,
    max_nfev: int = 1000,
    item_deadline_s: float = 10.0,
    total_deadline_s: float | None = None,
    progress: Callable[[float, str], None] | None = None,
    abort_check: Callable[[], bool] | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """Fit every item; one row per item, in order.

    Each item is a mapping with ``id`` and :func:`fit_peak_model`'s inputs:
    ``x``, ``y``, optional ``y_err``, ``shapes``, ``background``,
    ``parameters``, optional ``bg_x_ref``. Returns ``rows`` (``id``,
    ``status`` ``"ok" | "error" | "not_run"``, ``error``, ``fit``) and the
    counts ``n_items``, ``n_ok``, ``n_failed``, ``n_not_run``, plus
    ``stopped`` = ``"deadline"`` when the total budget cut the batch short.
    """
    if item_deadline_s <= 0:
        raise ValueError("item_deadline_s must be positive")
    if total_deadline_s is not None and total_deadline_s <= 0:
        raise ValueError("total_deadline_s must be positive")
    n = len(items)
    t_end = None if total_deadline_s is None else clock() + total_deadline_s
    rows: list[dict[str, Any]] = []
    stopped: str | None = None
    for k, item in enumerate(items):
        item_id = str(item.get("id", k))
        if abort_check is not None and abort_check():
            raise BatchCancelled("the batch was cancelled")
        left = None if t_end is None else t_end - clock()
        if left is not None and left <= 0:
            stopped = "deadline"
            rows.append(_row(item_id, "not_run", error=(
                f"not fitted: the batch reached its {total_deadline_s:g} s time limit")))
            continue
        if progress is not None:
            progress(k / n, f"fitting {k + 1}/{n}")
        budget = item_deadline_s if left is None else min(item_deadline_s, left)
        try:
            out = fit_peak_model(
                item["x"], item["y"], list(item["shapes"]), list(item["parameters"]),
                background=str(item.get("background", "linear")),
                y_err=item.get("y_err"), bg_x_ref=item.get("bg_x_ref"),
                max_nfev=max_nfev, deadline_s=budget, abort_check=abort_check,
            )
        except FitAborted as exc:
            raise BatchCancelled("the batch was cancelled") from exc
        except _EXPECTED as exc:
            rows.append(_row(item_id, "error", error=str(exc)))
            continue
        except Exception as exc:  # noqa: BLE001 - one bad item must not end the batch
            rows.append(_row(item_id, "error",
                             error=f"unexpected {type(exc).__name__} while fitting"))
            continue
        rows.append(_row(item_id, "ok", fit={k2: v for k2, v in out.items() if k2 not in _DROPPED}))
    n_ok = sum(r["status"] == "ok" for r in rows)
    if progress is not None and n:
        progress(1.0, f"fitted {n_ok}/{n}")
    return {
        "rows": rows,
        "n_items": n,
        "n_ok": n_ok,
        "n_failed": sum(r["status"] == "error" for r in rows),
        "n_not_run": sum(r["status"] == "not_run" for r in rows),
        "stopped": stopped,
    }
