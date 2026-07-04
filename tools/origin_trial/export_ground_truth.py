"""Export decoder-independent ground truth from Origin via COM (trial-window tool).

For every corpus `.opju` and every generated specimen, dumps under
../test-data/origin/specimens/ground_truth/<stem>/:

* one CSV per worksheet sheet (expASC: long-name row + unit row + full-precision
  data), named <Book>_s<sheet>.csv, and
* index.json: books -> sheets -> per-column {dataset, long_name, unit, comment},
  plus graphs -> layers -> axis from/to/type (1=linear, 2=log10) and per-plot
  dataset references.

This is what Origin itself says the files contain — the validation oracle for
the native `.opju` decoder (plan items 7-10) and figure importer (11-14).
Origin >= 2023 cannot WRITE old-format `.opj` (OriginLab release note "Stop
saving project as OPJ format"), so this replaces the convert-to-.opj idea.

COM gotchas learned the hard way (this file works around all of them):
* Only ONE Origin instance: a killed/exited instance leaves the next Dispatch
  pointing at a dead server (RPC_E_SERVERFAULT on every call) — taskkill
  Origin64.exe first if faults appear.
* The COM collections (WorksheetPages/GraphPages) iterator throws — enumerate
  windows with LabTalk `doc -e W/P` into a string variable instead.
* GetWorksheet always returns DISP_E_TYPEMISMATCH via pywin32 — use expASC.
* LabTalk string accumulation inside Execute needs %()-substitution quoting:
  __s$ = "%(__s$)%H|".

Run while the trial lasts:  uv run python tools/origin_trial/export_ground_truth.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import win32com.client as wc

CORPUS = Path(r"C:\Users\patri\OneDrive\Coding\git\test-data\origin")
SPEC = CORPUS / "specimens"
GT = SPEC / "ground_truth"


def main() -> None:
    GT.mkdir(parents=True, exist_ok=True)
    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 0

    def lt(cmd: str) -> bool:
        return bool(app.Execute(cmd))

    def lt_str(expr: str) -> str:
        lt(f"string __s$ = {expr};")
        return str(app.LTStr("__s$"))

    def lt_num(expr: str) -> float:
        lt(f"double __d = {expr};")
        return float(app.LTVar("__d"))

    def windows(kind: str) -> list[str]:
        lt('string __acc$ = "";')
        lt(f'doc -e {kind} {{ __acc$ = "%(__acc$)%H|"; }}')
        return [w for w in str(app.LTStr("__acc$")).split("|") if w]

    def dump_project(outdir: Path) -> dict[str, Any]:
        out: dict[str, Any] = {"books": [], "graphs": []}
        for book in windows("W"):
            lt(f"win -a {book};")
            info: dict[str, Any] = {
                "book": book,
                "long_name": lt_str("page.longname$"),
                "sheets": [],
            }
            for si in range(1, int(lt_num("page.nlayers")) + 1):
                lt(f"page.active = {si};")
                cols = []
                for j in range(1, int(lt_num("wks.ncols")) + 1):
                    lt(f"range __rc = [{book}]{si}!col({j});")
                    cols.append(
                        {
                            "dataset": lt_str("__rc.name$"),
                            "long_name": lt_str("__rc.lname$"),
                            "unit": lt_str("__rc.unit$"),
                            "comment": lt_str("__rc.comment$"),
                        }
                    )
                csv = outdir / f"{book}_s{si}.csv"
                lt(
                    f'expASC iw:=[{book}]{si}! type:=csv overwrite:=1 '
                    f'path:="{str(csv).replace(chr(92), "/")}";'
                )
                info["sheets"].append(
                    {
                        "sheet": lt_str("layer.name$"),
                        "nrows": int(lt_num("wks.nrows")),
                        "columns": cols,
                        "csv": csv.name if csv.exists() else None,
                    }
                )
            out["books"].append(info)

        for graph in windows("P"):
            lt(f"win -a {graph};")
            layers = []
            for li in range(1, int(lt_num("page.nlayers")) + 1):
                lt(f"page.active = {li};")
                plots = []
                for pi in range(1, int(lt_num("layer.nplots")) + 1):
                    lt(f"range __rp = {pi};")
                    plots.append(lt_str("__rp.name$"))
                layers.append(
                    {
                        "x": [lt_num("layer.x.from"), lt_num("layer.x.to"), lt_num("layer.x.type")],
                        "y": [lt_num("layer.y.from"), lt_num("layer.y.to"), lt_num("layer.y.type")],
                        "plots": plots,
                    }
                )
            out["graphs"].append(
                {"graph": graph, "long_name": lt_str("page.longname$"), "layers": layers}
            )
        return out

    targets = sorted(CORPUS.glob("*.opju")) + sorted(SPEC.glob("*.opju"))
    for f in targets:
        outdir = GT / f.stem
        outdir.mkdir(exist_ok=True)
        if (outdir / "index.json").exists():
            print(f"== {f.name} == already exported, skipping")
            continue
        print(f"== {f.name} ==")
        try:
            if not app.Load(str(f)):
                print("  LOAD FAIL")
                continue
            snapshot = dump_project(outdir)
            (outdir / "index.json").write_text(
                json.dumps(snapshot, indent=1, default=str), encoding="utf-8"
            )
            nb, ng = len(snapshot["books"]), len(snapshot["graphs"])
            ncsv = len(list(outdir.glob("*.csv")))
            print(f"  {nb} books / {ng} graphs / {ncsv} csv")
        except Exception as exc:  # keep going per-file
            print(f"  ERROR: {exc}")

    app.NewProject()
    print("done.")


if __name__ == "__main__":
    main()
