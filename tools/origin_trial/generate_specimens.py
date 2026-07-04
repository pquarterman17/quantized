"""Generate controlled Origin specimen files via the trial install's COM API.

Run while an OriginPro trial/license is present (Windows only):

    uv run python tools/origin_trial/generate_specimens.py

Produces, under ../test-data/origin/specimens/ (LOCAL corpus — never pushed).

REALITY CHECK (learned on first run): Origin >= 2023 CANNOT write old-format
`.opj` at all (OriginLab release note "Stop saving project as OPJ format") —
every save below silently becomes CPYUA `.opju` regardless of the extension
passed, so ALL outputs are `.opju` (version 4.3811 from the 2026b trial):

* rosetta_min.opju               — known content (doubles 111.125, 222.25, ...
                                   + names Field/Moment, units Oe/emu): the
                                   .opju RE Rosetta stone
* rosetta_lname.opju             — rosetta_min with ONE long-name changed
                                   (isolates .opju label storage)
* rosetta_2books.opju            — two workbooks (isolates book separators)
* fig_lin.opju / fig_log.opju    — same project saved twice, only the Y-axis
                                   lin→log flag toggled between saves
                                   (isolates the scale flag — in CPYUA)
* fig_pairs.opju                 — one project, 4 graphs: scatter A-B lin,
                                   scatter A-B logY, scatter A-C, line A-B
                                   (within-file DataPlot/type/column diffs)
* converted/<stem>.opju          — every corpus .opju RE-SAVED by 2026b: a
                                   version-pair Rosetta (same content, corpus
                                   4.3380 vs trial 4.3811), NOT an .opj
                                   conversion (impossible)

For `.opj`-side figure probes use within-corpus diffing per
docs/origin_re/opj_figures.md instead. Ground truth (CSV + JSON) comes from
export_ground_truth.py. The specimens contain only synthetic values authored
here — no private data — but they live in the local test-data corpus all the
same.
"""

from __future__ import annotations

from pathlib import Path

import win32com.client as wc

CORPUS = Path(r"C:\Users\patri\OneDrive\Coding\git\test-data\origin")
SPEC = CORPUS / "specimens"
CONVERTED = SPEC / "converted"

X = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
Y = [111.125, 222.25, 333.375, 444.5, 555.625, 666.75, 777.875, 888.0]
Z = [0.5, 1.5, 4.5, 13.5, 40.5, 121.5, 364.5, 1093.5]  # 0.5*3^n — log-friendly


def main() -> None:
    SPEC.mkdir(exist_ok=True)
    CONVERTED.mkdir(exist_ok=True)
    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 0

    def lt(cmd: str) -> None:
        if not app.Execute(cmd):
            print(f"  LT FAIL: {cmd}")

    def save(path: Path) -> None:
        ok = app.Save(str(path))
        print(f"  {'saved' if ok else 'SAVE FAIL'}: {path.name}")

    def put_book(book: str, cols: list[list[float]]) -> None:
        rows = [list(r) for r in zip(*cols)]
        app.PutWorksheet(f"[{book}]1", rows, 0, 0)

    print("== rosetta_min (.opj + .opju, identical content) ==")
    app.NewProject()
    lt("newbook name:=RBook option:=lsname;")
    put_book("RBook", [X, Y])
    lt('range ra = [RBook]1!col(1); ra.lname$="Field"; ra.unit$="Oe";')
    lt('range rb = [RBook]1!col(2); rb.lname$="Moment"; rb.unit$="emu";')
    save(SPEC / "rosetta_min.opju")
    save(SPEC / "rosetta_min.opj")

    print("== rosetta_lname (one long-name changed) ==")
    lt('range rb = [RBook]1!col(2); rb.lname$="Signal";')
    save(SPEC / "rosetta_lname.opju")

    print("== rosetta_2books ==")
    lt('range rb = [RBook]1!col(2); rb.lname$="Moment";')  # restore
    lt("newbook name:=SBook option:=lsname;")
    put_book("SBook", [X, Z])
    save(SPEC / "rosetta_2books.opju")
    save(SPEC / "rosetta_2books.opj")

    print("== fig_lin / fig_log (single-variable: layer.y.type) ==")
    app.NewProject()
    lt("newbook name:=FBook option:=lsname;")
    put_book("FBook", [X, Y, Z])
    lt("plotxy iy:=[FBook]1!(1,2) plot:=201;")
    save(SPEC / "fig_lin.opj")
    lt("layer.y.type = 2; doc -uw;")
    save(SPEC / "fig_log.opj")

    print("== fig_pairs (4 graphs in one project) ==")
    lt("layer.y.type = 1; doc -uw;")  # graph1 back to linear
    lt("plotxy iy:=[FBook]1!(1,2) plot:=201; layer.y.type = 2;")  # graph2 logY
    lt("plotxy iy:=[FBook]1!(1,3) plot:=201;")  # graph3: column C
    lt("plotxy iy:=[FBook]1!(1,2) plot:=200;")  # graph4: line type
    save(SPEC / "fig_pairs.opj")
    save(SPEC / "fig_pairs.opju")

    print("== corpus .opju -> .opj conversion (ground truth + recovery) ==")
    for opju in sorted(CORPUS.glob("*.opju")):
        target = CONVERTED / (opju.stem + ".opj")
        print(f"  loading {opju.name} ...")
        try:
            if not app.Load(str(opju)):
                print(f"  LOAD FAIL: {opju.name}")
                continue
            save(target)
        except Exception as exc:  # keep converting the rest
            print(f"  ERROR on {opju.name}: {exc}")

    app.NewProject()
    app.Exit()
    print("done.")


if __name__ == "__main__":
    main()
