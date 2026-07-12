"""Capture per-axis TICK state via COM (§13.2 #8): major increment + tick
label format (digits/type) for X and Y of every graph layer.

Written to ``specimens/ground_truth/<stem>/axis_ticks.json``.

Run: .venv/Scripts/python.exe tools/origin_trial/export_axis_ticks.py XRD hc2convert ...
"""
from __future__ import annotations

import os

import json
import sys
from pathlib import Path

import win32com.client as wc

CORPUS = Path(os.environ.get("QZ_TEST_DATA_ROOT") or (Path(__file__).resolve().parents[3] / "test-data")) / "origin"
GT = CORPUS / "specimens" / "ground_truth"


def main() -> None:
    stems = sys.argv[1:] or ["XRD", "hc2convert", "UnpolPlots", "RockingCurve"]
    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 0

    def lt(c: str) -> bool:
        return bool(app.Execute(c))

    def ltn(expr: str) -> float:
        lt("double __d = -987654;")
        lt(f"__d = {expr};")
        return float(app.LTVar("__d"))

    for stem in stems:
        src = next((CORPUS / f"{stem}{ext}" for ext in (".opju", ".opj")
                    if (CORPUS / f"{stem}{ext}").exists()), None)
        if src is None or not app.Load(str(src)):
            print(f"{stem}: missing/LOAD FAIL")
            continue
        lt('string __g$ = "";')
        lt('doc -e P { __g$ = "%(__g$)%H|"; }')
        graphs = [g for g in str(app.LTStr("__g$")).split("|") if g and "sparkline" not in g]
        out = {}
        for g in graphs:
            lt(f"win -a {g};")
            nl = int(ltn("page.nlayers"))
            layers = []
            for li in range(1, nl + 1):
                lt(f"page.active = {li};")
                layers.append({
                    "layer": li,
                    "x_inc": ltn("layer.x.inc"),
                    "y_inc": ltn("layer.y.inc"),
                    "x_from": ltn("layer.x.from"), "x_to": ltn("layer.x.to"),
                    "y_from": ltn("layer.y.from"), "y_to": ltn("layer.y.to"),
                    # tick-label numeric format (type + significant digits)
                    "x_label_type": ltn("layer.x.label.type"),
                    "x_label_digits": ltn("layer.x.label.digits"),
                    "y_label_type": ltn("layer.y.label.type"),
                    "y_label_digits": ltn("layer.y.label.digits"),
                })
            out[g] = layers
        outdir = GT / stem
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "axis_ticks.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
        print(f"{stem}: {len(out)} graphs -> axis_ticks.json")
        app.NewProject()

    app.Exit()
    print("done.")


if __name__ == "__main__":
    main()
