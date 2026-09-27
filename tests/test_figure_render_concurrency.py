"""Concurrent figure exports must not race inside matplotlib (2026-09-27 bug).

FastAPI runs the sync export routes in a threadpool. During an e2e run a
``POST /api/export/figure`` issued while the publication preview
(``/api/export/figure-page``) was still rendering failed with ``IndexError: pop
from empty list``. Root cause: matplotlib's ONE class-level mathtext parser
(``MathTextParser._parser``) keeps a per-parse ``_state_stack`` that a
concurrent parse resets/empties, and ``rc_context`` swaps the one global
``rcParams``. The fix (``calc.render_lock`` / ``calc.figure_render``)
serializes every render under one bounded, re-entrant lock and builds figures
without pyplot.

``test_render_lock_forces_the_mathtext_race`` FORCES the race rather than
hoping for it (``docs/testing.md``): thread A is paused (via an ``Event``,
not a wall-clock guess) INSIDE its own mathtext parse, still holding
``RENDER_LOCK``; the test then asserts thread B has not reached its own
parse call before releasing A -- true by construction whenever the lock
holds (B cannot even acquire it), and reliably caught as false the moment
the lock is disabled (sabotage-verified below), with no dependency on a
barrier timing out in time under load.
"""

from __future__ import annotations

import re
import threading
import uuid
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
from quantized.calc.figure_render import new_figure

client = TestClient(app)

_SRC = Path(__file__).resolve().parents[1] / "src" / "quantized"


def _ds(scale: float) -> dict[str, Any]:
    return {
        "time": [1.0, 10.0, 100.0, 1000.0],
        "values": [[100.0 * scale], [1200.0 * scale], [95.0 * scale], [11000.0 * scale]],
        "labels": ["Intensity"],
        "units": ["cps"],
        "metadata": {"x_column_name": "2Theta", "x_column_unit": "deg"},
    }


def test_render_lock_forces_the_mathtext_race() -> None:
    real_parse = mpl_mathtext.Parser.parse
    a_ident: list[int] = []
    a_inside = threading.Event()
    release_a = threading.Event()
    b_inside = threading.Event()

    def instrumented_parse(self: Any, *args: Any, **kwargs: Any) -> Any:
        if threading.get_ident() == a_ident[0]:
            # Freeze thread A right here, INSIDE the shared parser, still
            # holding RENDER_LOCK (the trial parse in figure_labels runs
            # under the SAME re-entrant lock render_scope already holds).
            a_inside.set()
            release_a.wait(timeout=5.0)
        else:
            b_inside.set()
        return real_parse(self, *args, **kwargs)

    x = np.array([1.0, 10.0, 100.0])
    tag_a, tag_b = uuid.uuid4().hex, uuid.uuid4().hex

    def render_a() -> bytes:
        a_ident.append(threading.get_ident())
        title = rf"$\alpha_{{{tag_a}}}$"
        return render_figure(x, [("s", x**2)], title=title, fmt="png", y_log=True)

    def render_b() -> bytes:
        title = rf"$\alpha_{{{tag_b}}}$"
        return render_figure(x, [("s", x**2)], title=title, fmt="png", y_log=True)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(mpl_mathtext.Parser, "parse", instrumented_parse)
        with ThreadPoolExecutor(2) as ex:
            fut_a = ex.submit(render_a)
            assert a_inside.wait(timeout=5.0), "thread A never reached the mathtext parser"

            fut_b = ex.submit(render_b)
            # Give a BROKEN lock every chance to let B slip in early -- this
            # wait only makes sabotage detection more reliable, it is never
            # required for the assertion below to pass when the lock is
            # correct: B is blocked on RENDER_LOCK's own acquire (a real OS
            # lock, not a timing guess) for as long as release_a is unset,
            # however long that is.
            b_inside.wait(timeout=0.2)
            assert not b_inside.is_set(), (
                "thread B entered the shared mathtext parser while thread A "
                "(holding RENDER_LOCK) was still paused inside its own parse "
                "-- the lock did not serialize them"
            )

            release_a.set()
            out_a = fut_a.result(timeout=5.0)
            out_b = fut_b.result(timeout=5.0)

    assert out_a[:8] == b"\x89PNG\r\n\x1a\n"
    assert out_b[:8] == b"\x89PNG\r\n\x1a\n"
    assert b_inside.is_set(), "thread B never reached the mathtext parser at all"


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
    manager and any global-rcParams mutation are process-global state the
    render lock would otherwise have to cover forever. Figures come from
    ``figure_render.new_figure``; rc goes through ``render_scope`` -- the ONE
    sanctioned ``rc_context`` call, inside that function, is exempted below.

    Extended (review fix) past the original ``import matplotlib.pyplot`` /
    ``rcParams[...] =`` pair, which missed: a bare ``from matplotlib.pyplot
    import ...``; a comma-joined import (``..., matplotlib.pyplot as plt``)
    that the original ``^\\s*`` anchor never saw; ``matplotlib.rc(...)``
    (rcParams via the OTHER pyplot-adjacent setter); ``rcParams.setdefault(``;
    and ``matplotlib.style.use(``/``style.use(`` (a stylesheet is itself a
    bulk global-rcParams mutation).
    """
    pyplot = re.compile(
        r"^\s*(import matplotlib\.pyplot|from matplotlib import pyplot)"
        r"|from matplotlib\.pyplot import"
        r"|import\s+matplotlib\.pyplot\s+as\s+plt\b"
        r"|from\s+matplotlib\s+import\s+pyplot\s+as\s+plt\b",
        re.M,
    )
    rc_write = re.compile(
        r"rcParams\[[^\]]+\]\s*=(?!=)"
        r"|rcParams\.update\("
        r"|rcParams\.setdefault\("
        r"|matplotlib\.rc\("
        r"|\bstyle\.use\("
    )
    # figure_render.render_scope holds RENDER_LOCK for its ENTIRE duration,
    # so it alone may open an ``rc_context`` (it restores the snapshot on
    # exit, and no other render can observe the change mid-flight).
    _rc_context_sanctioned = "calc/figure_render.py"
    rc_context = re.compile(r"matplotlib\.rc_context\(")

    offenders = []
    for p in sorted(_SRC.rglob("*.py")):
        text = p.read_text(encoding="utf-8")
        rel = str(p.relative_to(_SRC))
        if pyplot.search(text) or rc_write.search(text):
            offenders.append(rel)
        elif rc_context.search(text) and rel != _rc_context_sanctioned:
            offenders.append(rel)
    assert offenders == [], offenders


def test_new_figure_outside_render_scope_raises() -> None:
    """``new_figure`` must fail loudly, not build an unlocked Figure that
    merely looks fine until two renders race (review fix: the lock used to
    be enforced only by convention)."""
    with pytest.raises(RuntimeError, match="render_scope"):
        new_figure(figsize=(2.0, 2.0))


def test_importing_figure_render_does_not_change_matplotlib_backend() -> None:
    """Review fix: ``figure_render`` no longer calls ``matplotlib.use("Agg")``
    at import time (the OO ``new_figure`` path never consults the pyplot
    backend at all, so there was nothing for a global backend switch to
    protect, and it used to force-switch a notebook/desktop caller's own
    pyplot backend as a side effect of merely importing this module)."""
    import importlib

    import quantized.calc.figure_render as figure_render_mod

    before = matplotlib.get_backend()
    importlib.reload(figure_render_mod)
    assert matplotlib.get_backend() == before


def test_label_sanitizing_reuses_the_renders_own_lock_acquire(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review fix: every ``safe_mathtext_label`` call used to acquire (and
    release) ``RENDER_LOCK`` BEFORE ``render_scope`` opened, so a title +
    x/y-label render queued behind three separate full-lock round trips
    instead of one. Moved inside the scope, each trial-parse reacquires the
    SAME re-entrant lock the render already holds -- cheap, and only the
    render's own top-level acquire (render_scope's) ever has to contend."""
    import quantized.calc.figure_labels as figure_labels_mod
    import quantized.calc.figure_render as figure_render_mod
    import quantized.calc.render_lock as render_lock_mod

    real_acquire = render_lock_mod.acquire_render_lock
    top_level_acquires = 0

    def counting_acquire(timeout: float | None = None) -> Any:
        nonlocal top_level_acquires
        if not render_lock_mod.RENDER_LOCK._is_owned():
            top_level_acquires += 1
        return real_acquire(timeout)

    monkeypatch.setattr(figure_render_mod, "acquire_render_lock", counting_acquire)
    monkeypatch.setattr(figure_labels_mod, "acquire_render_lock", counting_acquire)

    x = np.array([1.0, 2.0, 3.0])
    tag = uuid.uuid4().hex
    out = render_figure(
        x, [(rf"$\sigma_{{{tag}}}$", x**2)],
        title=rf"$\alpha_{{{tag}}}$", x_label=rf"$\beta_{{{tag}}}$",
        y_label=rf"$\gamma_{{{tag}}}$", fmt="png",
    )
    assert out[:8] == b"\x89PNG\r\n\x1a\n"
    assert top_level_acquires == 1, (
        f"expected exactly 1 top-level RENDER_LOCK acquire for one render "
        f"(title/x_label/y_label/series-label sanitizing should all reuse "
        f"the render's own re-entrant hold), got {top_level_acquires}"
    )


def test_render_lock_timeout_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    """A held lock + a short bounded timeout -> HTTP 503, not an unbounded
    hang (review fix #1). ``RENDER_LOCK_TIMEOUT_S`` is read LIVE by
    ``acquire_render_lock`` (see ``calc.render_lock``'s own doc), so
    patching the module constant is enough -- no real 60-second wait."""
    import quantized.calc.render_lock as render_lock_mod

    monkeypatch.setattr(render_lock_mod, "RENDER_LOCK_TIMEOUT_S", 0.05)

    holder_ready = threading.Event()
    release_holder = threading.Event()

    def hold_lock() -> None:
        render_lock_mod.RENDER_LOCK.acquire()
        try:
            holder_ready.set()
            release_holder.wait(timeout=5.0)
        finally:
            render_lock_mod.RENDER_LOCK.release()

    holder = threading.Thread(target=hold_lock)
    holder.start()
    try:
        assert holder_ready.wait(timeout=5.0), "holder thread never acquired RENDER_LOCK"
        resp = client.post(
            "/api/export/figure", json={"dataset": _ds(1.0), "fmt": "png"}
        )
        assert resp.status_code == 503, resp.text
        assert "render lock" in resp.text.lower() or "retry" in resp.text.lower(), resp.text
    finally:
        release_holder.set()
        holder.join(timeout=5.0)


def test_acquire_render_lock_raises_render_lock_timeout_when_held() -> None:
    """Calc-layer unit test for the same bound, isolated from FastAPI/HTTP:
    ``calc.render_lock.acquire_render_lock`` itself must raise
    ``RenderLockTimeout`` (never block forever) once another thread has held
    the lock past the given ``timeout``."""
    import quantized.calc.render_lock as render_lock_mod

    holder_ready = threading.Event()
    release_holder = threading.Event()

    def hold_lock() -> None:
        with render_lock_mod.acquire_render_lock():
            holder_ready.set()
            release_holder.wait(timeout=5.0)

    holder = threading.Thread(target=hold_lock)
    holder.start()
    try:
        assert holder_ready.wait(timeout=5.0), "holder thread never acquired RENDER_LOCK"
        with pytest.raises(render_lock_mod.RenderLockTimeout):
            with render_lock_mod.acquire_render_lock(timeout=0.05):
                pass
    finally:
        release_holder.set()
        holder.join(timeout=5.0)
