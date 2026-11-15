"""Origin COM oracle for ONE project: per graph page, per layer axis state.

Loads the project read-only (never saved) into a fresh hidden instance,
lists every graph page (``doc -e P``) and records, per layer, the axis
ranges and types Origin itself holds. This is the independent oracle the
``.opju`` graph-page recovery work is checked against (see
``test-data/origin/ground_truth_public/README.md``).

Always ``DispatchEx("Origin.ApplicationSI")``: a NEW, separate instance,
so a run never attaches to or closes a window the owner has open. Use
``run_axis_oracle.py`` to drive many files: a Student-edition page-limit
modal hangs COM silently, and that runner supplies the per-file timeout.

Usage (Windows, Origin installed, pywin32 available)::

    uv run --with pywin32 python -I tools/origin_compare/export_axis_ranges.py <project> <out.json>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_SENTINEL = -987654321.0


def export(src: Path, out: Path) -> None:
    import win32com.client as wc  # Windows-only optional dependency

    app = wc.DispatchEx("Origin.ApplicationSI")
    try:
        app.Visible = 0

        def lt(cmd: str) -> bool:
            return bool(app.Execute(cmd))

        def ltn(expr: str) -> float | None:
            lt(f"double __d = {_SENTINEL};")
            lt(f"__d = {expr};")
            v = float(app.LTVar("__d"))
            return None if v == _SENTINEL else v

        if not app.Load(str(src)):
            out.write_text(json.dumps({"load": False}), encoding="utf-8")
            return
        lt('string __g$ = "";')
        lt('doc -e P { __g$ = "%(__g$)%H|"; }')
        pages: dict[str, dict[str, object]] = {}
        for g in (p for p in str(app.LTStr("__g$")).split("|") if p):
            lt(f"win -a {g};")
            layers = []
            for li in range(1, int(ltn("page.nlayers") or 0) + 1):
                lt(f"page.active = {li};")
                layers.append(
                    {
                        "layer": li,
                        "x_from": ltn("layer.x.from"),
                        "x_to": ltn("layer.x.to"),
                        "y_from": ltn("layer.y.from"),
                        "y_to": ltn("layer.y.to"),
                        "x_type": ltn("layer.x.type"),
                        "y_type": ltn("layer.y.type"),
                        "nplots": ltn("layer.nplots"),
                    }
                )
            lt("string __ln$ = page.longname$;")
            pages[g] = {"long_name": str(app.LTStr("__ln$")), "layers": layers}
        out.write_text(json.dumps({"load": True, "pages": pages}, indent=1), encoding="utf-8")
    finally:
        try:
            app.Exit()
        except Exception:  # noqa: BLE001 -- the instance may already be gone
            pass


if __name__ == "__main__":
    export(Path(sys.argv[1]), Path(sys.argv[2]))
