"""Concurrent figure exports must not race inside matplotlib (2026-09-27 bug).

FastAPI runs the sync export routes in a threadpool. During an e2e run a
``POST /api/export/figure`` issued while the publication preview
(``/api/export/figure-page``) was still rendering failed with ``IndexError: pop
from empty list``. Root cause: matplotlib's ONE class-level mathtext parser
(``MathTextParser._parser``) keeps a per-parse ``_state_stack`` that a
concurrent parse resets/empties, and ``rc_context`` swaps the one global
``rcParams``. Measured before the fix with 8 concurrent mixed figure /
figure-page exports (``$...$`` titles, log axes): 20 of 20 rounds failed,
73 of 160 requests -- spurious mathtext ``ParseException`` -> 422 or the
``IndexError`` -> 500. The fix (``calc.figure_render``) serializes every render
under one re-entrant lock and builds figures without pyplot.

``test_mathtext_parses_never_overlap`` FORCES the race rather than hoping for
it (``docs/testing.md``): the first parse on each thread waits at a barrier for
the other thread's parse, so without the lock both are provably inside the
shared parser at once (occupancy 2, every run); with it the second render
cannot start until the first finishes (occupancy 1, the barrier times out).
"""

from __future__ import annotations

import re
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import matplotlib
import matplotlib._mathtext as mpl_mathtext
import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.figure import render_figure

client = TestClient(app)

_SRC = Path(__file__).resolve().parents[1] / "src" / "quantized"
# Long enough that, WITHOUT the lock, the second thread (started at the same
# instant, microseconds from its first parse) always arrives in time; with the
# lock it is the (one-off) cost of proving the second parse was held back.
_BARRIER_TIMEOUT_S = 1.0


def _ds(scale: float) -> dict[str, Any]:
    return {
        "time": [1.0, 10.0, 100.0, 1000.0],
        "values": [[100.0 * scale], [1200.0 * scale], [95.0 * scale], [11000.0 * scale]],
        "labels": ["Intensity"],
        "units": ["cps"],
        "metadata": {"x_column_name": "2Theta", "x_column_unit": "deg"},
    }


def test_mathtext_parses_never_overlap(monkeypatch: pytest.MonkeyPatch) -> None:
    real_parse = mpl_mathtext.Parser.parse
    state = threading.Lock()
    inside = 0
    max_inside = 0
    first_parse = threading.Barrier(2, timeout=_BARRIER_TIMEOUT_S)
    seen: set[int] = set()

    def instrumented_parse(self: Any, *args: Any, **kwargs: Any) -> Any:
        nonlocal inside, max_inside
        with state:
            inside += 1
            max_inside = max(max_inside, inside)
            first = threading.get_ident() not in seen
            seen.add(threading.get_ident())
        try:
            if first:
                try:  # hold this parse open until the other thread's arrives
                    first_parse.wait()
                except threading.BrokenBarrierError:
                    pass  # the other thread never got in: the lock held it back
            return real_parse(self, *args, **kwargs)
        finally:
            with state:
                inside -= 1

    # Patched on the class: MathTextParser holds ONE shared Parser instance,
    # resolved at call time, so the patch always applies.
    monkeypatch.setattr(mpl_mathtext.Parser, "parse", instrumented_parse)

    x = np.array([1.0, 10.0, 100.0])
    go = threading.Barrier(2)

    def render(i: int) -> bytes:
        go.wait()
        # A per-call-unique label: MathTextParser memoizes parses by string,
        # so a repeated label would never reach the shared Parser.
        title = rf"$\alpha_{{{i}}}^{{{threading.get_ident() % 997}}}$ run"
        return render_figure(x, [("s", x**2)], title=title, fmt="png", y_log=True)

    with ThreadPoolExecutor(2) as ex:
        outs = list(ex.map(render, range(2)))

    assert all(o[:8] == b"\x89PNG\r\n\x1a\n" for o in outs)
    assert len(seen) == 2, "both threads must have reached the mathtext parser"
    assert max_inside == 1, f"{max_inside} threads were inside the shared mathtext parser at once"


def test_concurrent_figure_and_page_exports_match_serial() -> None:
    """The e2e shape (preview page + single-figure export in flight together),
    6-wide: every response succeeds, is byte-identical to the same request
    rendered alone (no rc/typography cross-talk), and the process-global
    rcParams are left untouched."""
    fig_body = {
        "dataset": _ds(2.0), "fmt": "png", "title": r"$\alpha_{2}^{2}$ scan",
        "x_log": True, "y_log": True,
    }
    page_body = {
        "rows": 2, "cols": 2, "fmt": "png",
        "panels": [
            {"figure": {"dataset": _ds(1.0 + k), "title": rf"$\beta_{k}$", "y_log": True},
             "row": k // 2, "col": k % 2}
            for k in range(4)
        ],
        # A non-default preset: its rc (fonts/sizes) would leak into the
        # single-figure renders if the rc contexts interleaved.
        "style": "nature",
    }
    requests = [("/api/export/figure", fig_body), ("/api/export/figure-page", page_body)]
    serial = {url: client.post(url, json=body) for url, body in requests}
    for resp in serial.values():
        assert resp.status_code == 200, resp.text
    rc_before = dict(matplotlib.rcParams)

    def post(i: int) -> tuple[str, int, bytes]:
        url, body = requests[i % 2]
        resp = client.post(url, json=body)
        return url, resp.status_code, resp.content

    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(post, range(6)))
    for url, status, content in results:
        assert status == 200, (url, content[:300])
        assert content == serial[url].content, f"{url}: concurrent render differs from serial"
    assert dict(matplotlib.rcParams) == rc_before, "a render leaked rcParams globally"


def test_export_code_uses_no_pyplot_or_global_rcparams_mutation() -> None:
    """Static guard for the structural half of the fix: pyplot's global figure
    manager and import-time ``rcParams[...] =`` writes are process-global
    state the render lock would otherwise have to cover forever. Figures come
    from ``figure_render.new_figure``; rc goes through ``render_scope``."""
    pyplot = re.compile(r"^\s*(import matplotlib\.pyplot|from matplotlib import pyplot)", re.M)
    rc_write = re.compile(r"rcParams\[[^\]]+\]\s*=(?!=)|rcParams\.update\(")
    offenders = [
        str(p.relative_to(_SRC))
        for p in sorted(_SRC.rglob("*.py"))
        if pyplot.search(t := p.read_text(encoding="utf-8")) or rc_write.search(t)
    ]
    assert offenders == [], offenders
