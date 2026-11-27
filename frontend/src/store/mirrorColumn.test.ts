// Mirror columns (plans/ROW_RANGE_CONTRACT.md section 6) through the REAL
// store: create, the refused edit, recalculation, a deleted source, save and
// reopen, row-count mismatches, the cycle and sort refusals, Detach with later
// formulas, and one undo per action.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadFormulaExtension } from "../lib/formulaExt";
import { isMirror, mirrorStatus } from "../lib/mirrorColumn";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import type { Dataset } from "../lib/types";
import { createMirror, detachMirror, goToMirrorSource } from "./mirrorColumn";
import { sortWorksheetRows } from "./sortRows";
import { useApp } from "./useApp";
import { useWorksheetReveal } from "./worksheetReveal";

const ds = (id: string, name: string, rows: number[][], labels = ["T", "R"], over: Partial<Dataset> = {}): Dataset => ({
  id,
  name,
  data: { time: rows.map((_, i) => i), values: rows, labels, units: labels.map((l) => (l === "T" ? "K" : "")), metadata: {} },
  ...over,
});
const st = () => useApp.getState();
const get = (id: string) => st().datasets.find((d) => d.id === id)!;
const column = (id: string, c: number) => get(id).data.values.map((r) => r[c]);
const NAN = Number.NaN;

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [ds("src", "Run 2", [[10, 1], [20, 2], [30, 3]]), ds("mir", "Summary", [[100], [200], [300]], ["Q"])],
    activeId: "mir",
    recalcMode: "auto",
    staleDatasets: [],
    staleFits: [],
    history: [],
    future: [],
    status: "",
    macroRecording: false,
  });
  useWorksheetReveal.setState({ rowReveal: null });
});

describe("create", () => {
  it("adds a sheet() column named and united like its source, as ONE undo step", () => {
    expect(createMirror("mir", "src", 0)).toBe(true);
    const f = get("mir").formulas![0];
    expect(f).toMatchObject({ name: "T", expr: 'sheet("Run 2", A)', unit: "K", sheets: [{ name: "Run 2", id: "src" }] });
    expect(isMirror(f)).toBe(true);
    expect(get("mir").data.units).toEqual(["", "K"]);
    expect(column("mir", 1)).toEqual([10, 20, 30]);
    expect(st().history.map((h) => h.label)).toEqual(["add column"]);
    st().undo();
    expect(get("mir").formulas).toBeUndefined();
    expect(get("mir").data.labels).toEqual(["Q"]);
  });

  it("mirrors the X column, and a name already used on the sheet is made unique", () => {
    expect(createMirror("mir", "src", -1)).toBe(true);
    expect(get("mir").formulas![0].expr).toBe('sheet("Run 2", x)');
    expect(createMirror("mir", "src", -1)).toBe(true);
    expect(get("mir").formulas!.map((f) => f.name)).toEqual(["X", "X (mirror)"]);
  });

  it("refuses a text column, itself, and a mirror cycle with the reason, changing nothing", () => {
    expect(createMirror("mir", "src", "Comment")).toBe(false);
    expect(st().status).toBe("text columns cannot be mirrored");
    expect(createMirror("mir", "mir", 0)).toBe(false);
    expect(createMirror("mir", "src", 0)).toBe(true); // Summary mirrors Run 2
    const before = st().history.length;
    expect(createMirror("src", "mir", 0)).toBe(false); // Run 2 would mirror Summary: a circle
    expect(st().status).toMatch(/Can't add column/);
    expect(get("src").formulas).toBeUndefined();
    expect(st().history.length).toBe(before);
  });

  it("allows a mirror of a mirror", async () => {
    useApp.setState({ datasets: [...st().datasets, ds("third", "Third", [[0], [0], [0]], ["Z"])] });
    expect(createMirror("mir", "src", 0)).toBe(true);
    expect(createMirror("third", "mir", 1)).toBe(true);
    expect(column("third", 1)).toEqual([10, 20, 30]);
    st().setCellValue("src", 0, 0, 99);
    await vi.waitFor(() => expect(column("third", 1)).toEqual([99, 20, 30])); // the chain src -> mir -> third
  });
});

describe("edit refused", () => {
  it("a cell edit on a mirror says why in the status line, and changes nothing", () => {
    createMirror("mir", "src", 0);
    st().setCellValue("mir", 0, 1, 5);
    expect(st().status).toBe("T (mirror) follows Run 2 › T: edit it there (Go to Source), or Detach to make it ordinary values");
    expect(column("mir", 1)).toEqual([10, 20, 30]);
    expect(st().history.map((h) => h.label)).toEqual(["add column"]);
  });
});

describe("recalculation", () => {
  it("an edit of the source recalculates the mirror and clears its stale entry", async () => {
    createMirror("mir", "src", 0);
    st().setRecalcMode("manual");
    st().setCellValue("src", 0, 0, 111);
    expect(st().staleDatasets).toContain("mir");
    await st().recalcNow();
    expect(st().staleDatasets).not.toContain("mir");
    expect(column("mir", 1)).toEqual([111, 20, 30]);
  });

  it("a mirror of a mirror settles upstream-first in one manual pass (sheet() edges order the recalculation)", async () => {
    useApp.setState({ datasets: [...st().datasets, ds("third", "Third", [[0], [0], [0]], ["Z"])] }); // listed after both
    createMirror("mir", "src", 0);
    createMirror("third", "mir", 1);
    st().setRecalcMode("manual");
    st().setCellValue("src", 1, 0, 55);
    expect(st().staleDatasets).toEqual(expect.arrayContaining(["mir", "third"]));
    await st().recalcNow();
    expect(column("mir", 1)).toEqual([10, 55, 30]);
    expect(column("third", 1)).toEqual([10, 55, 30]);
    expect(st().staleDatasets).toEqual([]);
  });

  it("in Auto mode the mirror follows without a manual recalculation", async () => {
    createMirror("mir", "src", 1);
    st().setCellValue("src", 2, 1, 42);
    await vi.waitFor(() => expect(column("mir", 1)).toEqual([1, 2, 42]));
    expect(st().staleDatasets).not.toContain("mir");
  });
});

describe("a deleted source", () => {
  it("is Missing, blank, and never re-attaches to a new sheet of the same name", () => {
    createMirror("mir", "src", 0);
    st().removeDataset("src");
    expect(get("mir").formulas![0].sheets).toEqual([{ name: "Run 2", id: null }]);
    expect(mirrorStatus(get("mir"), 0, st().datasets)).toMatchObject({ state: "missing", label: "Missing" });
    expect(column("mir", 1)).toEqual([NAN, NAN, NAN]);
    st().addDataset(ds("impostor", "Run 2", [[7, 7], [7, 7], [7, 7]]));
    st().setCellValue("mir", 0, 0, 1); // any recompute of the mirror's sheet
    expect(column("mir", 1)).toEqual([NAN, NAN, NAN]);
    expect(mirrorStatus(get("mir"), 0, st().datasets)?.state).toBe("missing");
  });

  it("Go to Source is refused, naming the reason", () => {
    createMirror("mir", "src", 0);
    st().removeDataset("src");
    goToMirrorSource("mir", 0);
    expect(st().status).toMatch(/was deleted/);
    expect(useWorksheetReveal.getState().rowReveal).toBeNull();
  });
});

describe("save and reopen", () => {
  const reopen = (): Dataset[] => parseWorkspace(serializeWorkspace({ datasets: st().datasets })).datasets;

  it("a reopened project is Linked, and still follows its source", async () => {
    createMirror("mir", "src", 0);
    const back = reopen();
    expect(back.find((d) => d.id === "mir")!.formulas![0].sheets).toEqual([{ name: "Run 2", id: "src" }]);
    useApp.setState({ datasets: back });
    expect(mirrorStatus(get("mir"), 0, st().datasets)?.state).toBe("linked");
    st().setCellValue("src", 1, 0, 77);
    await vi.waitFor(() => expect(column("mir", 1)).toEqual([10, 77, 30]));
  });

  it("saved with its source deleted, it reopens Missing and does not attach to a same-named sheet", () => {
    createMirror("mir", "src", 0);
    st().removeDataset("src");
    const back = reopen();
    useApp.setState({ datasets: [...back, ds("new", "Run 2", [[5, 5], [5, 5], [5, 5]])] });
    expect(get("mir").formulas![0].sheets).toEqual([{ name: "Run 2", id: null }]);
    expect(mirrorStatus(get("mir"), 0, st().datasets)?.state).toBe("missing");
  });
});

describe("rows", () => {
  it("a source with FEWER rows leaves the rest blank and says so", () => {
    useApp.setState({ datasets: [ds("src", "Run 2", [[10, 1], [20, 2]]), ds("mir", "Summary", [[1], [2], [3], [4]], ["Q"])] });
    createMirror("mir", "src", 0);
    expect(column("mir", 1)).toEqual([10, 20, NAN, NAN]);
    expect(mirrorStatus(get("mir"), 0, st().datasets)?.rowNote).toBe("source has 2 rows, this sheet 4: rows 3-4 are blank");
  });

  it("a source with MORE rows mirrors only this sheet's rows and says which are not", () => {
    useApp.setState({ datasets: [ds("src", "Run 2", [[10, 1], [20, 2], [30, 3], [40, 4]]), ds("mir", "Summary", [[1], [2]], ["Q"])] });
    createMirror("mir", "src", 0);
    expect(column("mir", 1)).toEqual([10, 20]);
    expect(mirrorStatus(get("mir"), 0, st().datasets)).toMatchObject({
      state: "linked",
      rowNote: "source has 4 rows, this sheet 2: rows 3-4 are not mirrored",
    });
  });

  it("a source that is still loading is blank, never its preview rows, and says so", () => {
    createMirror("mir", "src", 0);
    useApp.setState({ datasets: st().datasets.map((d) => (d.id === "src" ? { ...d, pending: { bookId: "b" } as never } : d)) });
    st().setCellValue("mir", 0, 0, 1); // recompute the mirror's sheet against the pending source
    expect(column("mir", 1)).toEqual([NAN, NAN, NAN]);
    expect(get("mir").formulaErrors?.T).toMatch(/has not loaded its full data/);
    expect(mirrorStatus(get("mir"), 0, st().datasets)?.state).toBe("loading");
  });

  it("a removed source column is its own status", () => {
    createMirror("mir", "src", 1);
    useApp.setState({
      datasets: st().datasets.map((d) => (d.id === "mir" ? { ...d, formulas: [{ ...d.formulas![0], expr: 'sheet("Run 2", __removed__)' }] } : d)),
    });
    expect(mirrorStatus(get("mir"), 0, st().datasets)?.state).toBe("removed");
  });
});

describe("sort is refused on both sides", () => {
  it("the mirror's sheet and the source each refuse, naming Detach, with zero mutation", () => {
    createMirror("mir", "src", 0);
    sortWorksheetRows("mir", 0, -1);
    expect(st().status).toMatch(/Can't sort "Summary".*Detach it/);
    sortWorksheetRows("src", 0, -1);
    expect(st().status).toMatch(/Can't sort "Run 2".*Detach those mirror columns/);
    expect(column("src", 0)).toEqual([10, 20, 30]);
    expect(st().history.map((h) => h.label)).toEqual(["add column"]);
    detachMirror("mir", 0);
    sortWorksheetRows("src", 0, -1); // the link is gone: sorting works again
    expect(column("src", 0)).toEqual([30, 20, 10]);
  });
});

describe("Detach", () => {
  it("turns the column into ordinary values: it no longer follows, and it is one undo step", () => {
    createMirror("mir", "src", 0);
    const before = st().history.length;
    detachMirror("mir", 0);
    expect(st().history.length).toBe(before + 1);
    expect(get("mir").formulas).toBeUndefined();
    expect(get("mir").data.labels).toEqual(["Q", "T"]);
    expect(get("mir").data.units).toEqual(["", "K"]);
    expect(column("mir", 1)).toEqual([10, 20, 30]);
    st().setCellValue("src", 0, 0, 5);
    expect(column("mir", 1)).toEqual([10, 20, 30]);
    st().setCellValue("mir", 0, 1, 9); // ordinary now: editable
    expect(column("mir", 1)).toEqual([9, 20, 30]);
    st().undo(); // the edit
    st().undo(); // the src edit
    st().undo(); // the Detach
    expect(isMirror(get("mir").formulas![0])).toBe(true);
    expect(get("mir").data.labels).toEqual(["Q", "T"]);
  });

  it("a mirror that is already the first computed column keeps every later letter, hidden flag, error role and fit spec", () => {
    createMirror("mir", "src", 0); // B: the mirror
    st().addFormula("mir", "twice", "B * 2"); // C reads the mirror
    st().addFormula("mir", "plus", "A + C"); // D reads A and C
    useApp.setState({
      datasets: st().datasets.map((d) =>
        d.id === "mir"
          ? {
              ...d,
              hiddenCols: [3], // "plus"
              errorRoles: [{ channel: 2, target: 1, axis: "y" as const, side: "both" as const }],
              fitSpec: { model: "linear", xKey: 0, yKey: 3 },
              channelRoles: { 3: "label" as const },
            }
          : d,
      ),
    });
    const before = st().history.length;
    detachMirror("mir", 0);
    expect(st().history.length).toBe(before + 1);
    const d = get("mir");
    expect(d.data.labels).toEqual(["Q", "T", "twice", "plus"]);
    expect(d.formulas!.map((f) => [f.name, f.expr])).toEqual([["twice", "B * 2"], ["plus", "A + C"]]);
    expect(column("mir", 2)).toEqual([20, 40, 60]);
    expect(column("mir", 3)).toEqual([120, 240, 360]);
    expect(d.hiddenCols).toEqual([3]);
    expect(d.errorRoles).toEqual([{ channel: 2, target: 1, axis: "y", side: "both" }]);
    expect(d.fitSpec).toMatchObject({ xKey: 0, yKey: 3 });
    expect(d.channelRoles).toEqual({ 3: "label" });
    st().undo();
    expect(get("mir").formulas!.map((f) => f.name)).toEqual(["T", "twice", "plus"]);
    expect(get("mir").hiddenCols).toEqual([3]);
  });

  it("a mirror that is NOT first moves to the end of the base columns and the columns before it shift with it", () => {
    st().addFormula("mir", "plain", "A + 1"); // B
    createMirror("mir", "src", 0); // C
    st().addFormula("mir", "both", "B + C"); // D
    useApp.setState({
      datasets: st().datasets.map((d) =>
        d.id === "mir" ? { ...d, hiddenCols: [1], errorRoles: [{ channel: 1, target: 0, axis: "y" as const, side: "both" as const }], fitSpec: { model: "linear", xKey: 0, yKey: 3 } } : d,
      ),
    });
    detachMirror("mir", 1);
    const d = get("mir");
    // new base [Q, T(detached)] = A, B; formulas [plain, both] = C, D.
    expect(d.data.labels).toEqual(["Q", "T", "plain", "both"]);
    expect(d.formulas!.map((f) => [f.name, f.expr])).toEqual([["plain", "A + 1"], ["both", "C + B"]]);
    expect(column("mir", 1)).toEqual([10, 20, 30]);
    expect(column("mir", 3)).toEqual([111, 221, 331]); // plain (101, 201, 301) + T
    expect(d.hiddenCols).toEqual([2]); // "plain" moved from B to C
    expect(d.errorRoles).toEqual([{ channel: 2, target: 0, axis: "y", side: "both" }]);
    expect(d.fitSpec?.yKey).toBe(3); // "both" stayed at D
  });

  it("refuses to detach an ordinary computed column", () => {
    st().addFormula("mir", "plain", "A + 1");
    detachMirror("mir", 0);
    expect(st().status).toMatch(/not a mirror column/);
    expect(get("mir").formulas).toHaveLength(1);
  });
});

describe("Go to Source", () => {
  it("opens the source worksheet and files a request that selects its column", () => {
    createMirror("mir", "src", 1);
    goToMirrorSource("mir", 0);
    expect(st().worksheetId).toBe("src");
    expect(useWorksheetReveal.getState().rowReveal).toMatchObject({ datasetId: "src", column: 1, selectColumn: true, row: -1 });
  });

  it("from a cell it also reveals and selects the same row", () => {
    createMirror("mir", "src", 0);
    goToMirrorSource("mir", 0, 2);
    expect(useWorksheetReveal.getState().rowReveal).toMatchObject({ datasetId: "src", column: 0, row: 2, select: true });
  });
});
