"""Style-decode specimens (2026-07-06, auto/increment colour work).

The real corpus has NO grouped plots, so Origin's auto/increment colour
replay (OPEN item 13.2 #2) is unverifiable against it. These specimens
create the shapes the corpus lacks:

* ``style_group.opju``  — ONE grouped plotxy over 8 Y columns: Origin
  assigns each group member the next increment-list colour (black, red,
  green, blue, cyan, magenta, yellow, dark yellow by default). The stored
  records should carry the auto sentinel; the oracle records the effective
  colours; byte-diff vs ungrouped reveals the group-membership marker.
* ``style_ungrouped.opju`` — the same 8 curves added one plotxy at a time
  (ungrouped): Origin's default per-add colour behaviour, the control case.
* ``style_mixed.opju``    — 3 grouped + 2 explicit-colour curves in one
  layer: exercises auto and explicit side by side.

COM rules: ONE instance, tiny projects (student page limit), never
concurrent with another COM tool. Run:
    .venv/Scripts/python.exe tools/origin_trial/generate_specimens_style.py
Then capture the oracle:
    .venv/Scripts/python.exe tools/origin_trial/export_curve_style_oracle.py
(after adding the new stems to its FILES list).
"""

from __future__ import annotations

from pathlib import Path

import win32com.client as wc

CORPUS = Path(r"C:\Users\patri\OneDrive\Coding\git\test-data\origin")
SPEC = CORPUS / "specimens"

X = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
YS = [[float(10 * (k + 1) + i) for i in range(8)] for k in range(8)]


def main() -> None:
    SPEC.mkdir(exist_ok=True)
    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 0

    def lt(cmd: str) -> bool:
        ok = bool(app.Execute(cmd))
        if not ok:
            print(f"  LT FAIL: {cmd}")
        return ok

    def save(path: Path) -> None:
        ok = app.Save(str(path))
        print(f"  {'saved' if ok else 'SAVE FAIL'}: {path.name}")

    def put_book(book: str, cols: list[list[float]]) -> None:
        rows = [list(r) for r in zip(*cols, strict=True)]
        app.PutWorksheet(f"[{book}]1", rows, 0, 0)

    print("== style_group (one grouped plotxy, 8 auto-increment curves) ==")
    app.NewProject()
    lt("newbook name:=GrpBook option:=lsname;")
    put_book("GrpBook", [X, *YS])
    lt("plotxy iy:=[GrpBook]1!(1,2):(1,9) plot:=200;")  # grouped line plots
    save(SPEC / "style_group.opju")

    print("== style_ungrouped (8 separate plotxy adds) ==")
    app.NewProject()
    lt("newbook name:=UngBook option:=lsname;")
    put_book("UngBook", [X, *YS])
    lt("plotxy iy:=[UngBook]1!(1,2) plot:=200;")
    for col in range(3, 10):
        lt(f"plotxy iy:=[UngBook]1!(1,{col}) plot:=200 ogl:=1!;")
    save(SPEC / "style_ungrouped.opju")

    print("== style_mixed (3 grouped + 2 explicit-colour curves) ==")
    app.NewProject()
    lt("newbook name:=MixBook option:=lsname;")
    put_book("MixBook", [X, *YS[:5]])
    lt("plotxy iy:=[MixBook]1!(1,2):(1,4) plot:=200;")  # grouped 3
    lt("plotxy iy:=[MixBook]1!(1,5) plot:=200 ogl:=1!;")
    lt("layer.plot4.color = 15;")  # orange, explicit
    lt("plotxy iy:=[MixBook]1!(1,6) plot:=200 ogl:=1!;")
    lt('set %C -c color(#8000FF);')  # violet via direct RGB on active dataset
    save(SPEC / "style_mixed.opju")

    app.NewProject()
    print("done.")


if __name__ == "__main__":
    main()
