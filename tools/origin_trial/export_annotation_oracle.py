"""Capture the ANNOTATION-POSITION oracle for Hc2 via Origin COM.

The graph oracle (``export_hc2_oracle.py``) recorded curves, axes, and titles,
but never the ``(x, y)`` position of a graph's free-text label objects. The
``.opj``/``.opju`` figure decoders CAN recover those positions from the
text-object header (a double pair at header offset +19/+27 that scans as
layer-fraction coordinates), but "looks plausible" is not "verified" -- there
was no ground truth to check the placement against. This script provides it.

For every graph, for every layer, it enumerates the auto-named text label
objects (``Text``, ``Text1`` .. ``Text{MAX_TEXT}``) and records, per object:

    {"name", "text", "x", "y", "attach", "x1", "y1"}

plus the layer's axis range (``x_from/x_to/y_from/y_to``) so the verifier can
convert a decoded layer-fraction to the same coordinate space Origin reports.
Origin's ``obj.x``/``obj.y`` are in the object's own attach coordinate system
(``obj.attach``: 0=page, 1=layer/scale=data units, 2=layer-frame fraction), so
BOTH the raw value and the attach mode are captured -- the verifier decides the
mapping rather than this capture guessing it.

Written to ``specimens/ground_truth/<stem>/annotations.json`` (a SEPARATE file
from ``index.json`` -- the existing graph oracle is never touched, so a failed
capture cannot corrupt it).

CAVEAT (student/eval page limit): as with the graph oracle, Origin may
enumerate fewer graphs than the binary contains; this oracle is authoritative
for the annotations of the graphs it lists, not a completeness measure.
Enumeration is by auto-name (``Text``/``TextN``); a hand-renamed label would be
missed -- fine for a verification oracle on the auto-named Hc2 corpus.

Run (Windows, Origin installed, Hc2 project available):
    uv run python tools/origin_trial/export_annotation_oracle.py
"""
from __future__ import annotations

import json
from pathlib import Path

import win32com.client as wc

CORPUS = Path(r"C:\Users\patri\OneDrive\Coding\git\test-data\origin")
GT = CORPUS / "specimens" / "ground_truth"
FILES = ["hc2convert.opj", "Hc2 data.opju"]
MAX_TEXT = 30  # highest TextN index probed per layer (auto-named annotations)


def main() -> None:
    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 0

    def lt(c: str) -> bool:
        return bool(app.Execute(c))

    def lts(expr: str) -> str:
        lt('string __s$ = "";')
        lt(f"__s$ = {expr};")
        return str(app.LTStr("__s$"))

    def ltn(expr: str) -> float:
        lt("double __d = 0;")
        lt(f"__d = {expr};")
        return float(app.LTVar("__d"))

    def obj_exists(name: str) -> bool:
        # exist(name, 16) tests for a GRAPHIC object (type code 16, confirmed via
        # diagnostic: exist("Text",16) -> 16 on a graph that has a Text label,
        # while no-arg/1/8 all return 0). A non-empty text$ is still required
        # below so a non-text graphic object can't leak in.
        try:
            return ltn(f"exist({name},16)") > 0
        except Exception:
            return False

    for f in FILES:
        if not (CORPUS / f).exists():
            print(f"{f}: source missing, skipping")
            continue
        if not app.Load(str(CORPUS / f)):
            print(f"{f}: LOAD FAIL")
            continue
        lt('string __g$ = "";')
        lt('doc -e P { __g$ = "%(__g$)%H|"; }')
        graphs = [g for g in str(app.LTStr("__g$")).split("|") if g and "sparkline" not in g]
        out: dict[str, list[dict[str, object]]] = {}
        n_ann = 0
        for g in graphs:
            lt(f"win -a {g};")
            nl = int(ltn("page.nlayers"))
            anns: list[dict[str, object]] = []
            for li in range(1, nl + 1):
                lt(f"page.active = {li};")
                xf, xt = ltn("layer.x.from"), ltn("layer.x.to")
                yf, yt = ltn("layer.y.from"), ltn("layer.y.to")
                for name in ["Text"] + [f"Text{i}" for i in range(1, MAX_TEXT + 1)]:
                    if not obj_exists(name):
                        continue
                    text = lts(f"{name}.text$")
                    if not text:
                        continue
                    anns.append({
                        "layer": li,
                        "name": name,
                        "text": text,
                        "x": ltn(f"{name}.x"),
                        "y": ltn(f"{name}.y"),
                        "attach": ltn(f"{name}.attach"),
                        "x1": ltn(f"{name}.x1"),
                        "y1": ltn(f"{name}.y1"),
                        "x_from": xf, "x_to": xt, "y_from": yf, "y_to": yt,
                    })
                    n_ann += 1
            if anns:
                out[g] = anns
        stem = Path(f).stem
        outdir = GT / stem
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "annotations.json").write_text(
            json.dumps(out, indent=1, default=str), encoding="utf-8"
        )
        print(f"{f}: {len(out)} graphs with text, {n_ann} annotation objects "
              f"-> {outdir / 'annotations.json'}")
        app.NewProject()

    app.Exit()
    print("done.")


if __name__ == "__main__":
    main()
