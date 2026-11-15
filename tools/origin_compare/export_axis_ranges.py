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

Relation to ``tools/origin_trial/export_ground_truth.py``: that script
exports worksheet CSVs and curve references for named top-level projects
into ``specimens/ground_truth/<stem>/``. This one records only axis state,
for arbitrary corpus-relative paths, which public files need because their
stems collide. Its isolation is what keeps it safe on the owner's desktop.
The LabTalk queries are the same. A COM-trap fix in one (e.g. the plot-count
probe) belongs in both.

Usage (Windows, Origin installed, pywin32 available)::

    uv run --with pywin32 python -I tools/origin_compare/export_axis_ranges.py <project> <out.json>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # ``-I`` omits the script dir

from origin_proc import origin_pids, pid_file  # noqa: E402

_SENTINEL = -987654321.0


def export(src: Path, out: Path) -> None:
    import win32com.client as wc  # Windows-only optional dependency

    # A COM server is not a child of this process (DCOM launches it), so the
    # only way to name OUR instance is the PID that appeared across our own
    # DispatchEx. It is written BEFORE Load, so a page-limit hang inside Load
    # still leaves the runner an exact target. Two new PIDs in that window (the
    # owner opened Origin at the same moment) is ambiguous: record none, and
    # the runner then kills nothing.
    before = origin_pids()
    app = wc.DispatchEx("Origin.ApplicationSI")
    new = sorted(origin_pids() - before)
    pid_file(out).write_text(json.dumps(new if len(new) == 1 else []), encoding="utf-8")
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
                        # No plot count: ``layer.nplots`` is not a live LabTalk
                        # property (always null). export_ground_truth.py has
                        # the working ``range -w`` probe if one is needed.
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
