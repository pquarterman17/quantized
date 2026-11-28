// Residue of sheet protection (plan item 34): the column type and Set As lock, the Library refusing a rename or a
// delete of a protected sheet, the macro recorder's lines for Protect, Pivot and Insert into similar sheets, and
// the script exporter saying NOT REPRODUCED with a reason for each. The store is the real one.

import { beforeEach, describe, expect, it } from "vitest";

import { buildAppActions } from "../appCommands";
import { loadFormulaExtension } from "../lib/formulaExt";
import { pipelineToPython } from "../lib/pipeline";
import { PROTECTED_NOTICE } from "../lib/sheetProtection";
import type { Dataset } from "../lib/types";
import { removeDatasetsPruningCollapsed } from "./collapsedWorkbookActions";
import { setColumnDesignation } from "./columnDesignationActions";
import { setColumnsModelingType } from "./columnTypeActions";
import { insertIntoSimilar } from "./insertSimilar";
import { runPivot, runUnpivot } from "./pivotRun";
import { setSheetProtected } from "./sheetProtection";
import { useApp } from "./useApp";

const st = () => useApp.getState();
const sheet = (id = "w"): Dataset => st().datasets.find((d) => d.id === id)!;

const mk = (id: string, name: string, over: Partial<Dataset> = {}): Dataset => ({
  id,
  name,
  data: { time: [0, 1, 2], values: [[3, 30], [1, 10], [2, 20]], labels: ["A", "B"], units: ["", ""], metadata: {} },
  ...over,
});

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [mk("w", "Run 1"), mk("o", "Run 2")],
    activeId: "w",
    worksheetId: null,
    workbooks: [],
    recalcMode: "auto",
    staleDatasets: [],
    history: [],
    future: [],
    trash: [],
    status: "",
    statusDanger: null,
    macroRecording: false,
    macroSteps: [],
    pipelineRunning: false,
    plotWindows: [],
    layoutMode: "classic",
  } as Partial<ReturnType<typeof useApp.getState>>);
});

const lines = () => st().macroSteps.map((m) => m.code);

describe("column type and Set As on a protected sheet", () => {
  beforeEach(() => {
    setSheetProtected("w", true);
    useApp.setState({ history: [], status: "" });
  });

  it("setChannelType (the grid badge and the Inspector) refuses with the reason and changes nothing", () => {
    const before = sheet();
    st().setChannelType("w", 0, "nominal");
    expect(sheet()).toEqual(before);
    expect(st().status).toBe(`Run 1: ${PROTECTED_NOTICE}`);
    expect(st().history).toHaveLength(0);
  });

  it("the column menu's multi-column type pick refuses", () => {
    const before = sheet();
    setColumnsModelingType("w", [0, 1], "ordinal");
    expect(sheet()).toEqual(before);
    expect(st().status).toBe(PROTECTED_NOTICE);
    expect(st().history).toHaveLength(0);
  });

  it("Set As (the menu and the column list) refuses with the reason", () => {
    const before = sheet();
    setColumnDesignation("w", 1, "Y-error");
    expect(sheet()).toEqual(before);
    expect(st().status).toBe(PROTECTED_NOTICE);
    expect(st().history).toHaveLength(0);
  });

  it("another sheet is not locked, and Unprotect restores both", () => {
    st().setChannelType("o", 0, "nominal");
    expect(sheet("o").channelTypes).toEqual({ 0: "nominal" });
    setSheetProtected("w", false);
    st().setChannelType("w", 0, "nominal");
    setColumnDesignation("w", 1, "Y-error");
    expect(sheet().channelTypes).toEqual({ 0: "nominal" });
    expect(sheet().columnDesignations?.[1]).toBe("Y-error");
  });
});

describe("Library rename and delete of a protected sheet", () => {
  beforeEach(() => {
    setSheetProtected("w", true);
    useApp.setState({ history: [], status: "" });
  });

  it("rename is refused with the sheet's name and the reason", () => {
    st().renameDataset("w", "Renamed");
    expect(sheet().name).toBe("Run 1");
    expect(st().status).toBe(`Run 1: ${PROTECTED_NOTICE}`);
    expect(st().history).toHaveLength(0);
  });

  it("Move to trash, Delete and permanent delete are refused: the sheet stays, the trash stays empty", () => {
    st().removeDataset("w");
    st().removeDatasets(["w"]);
    st().removeDatasets(["w"], { permanent: true });
    expect(st().datasets.map((d) => d.id)).toEqual(["w", "o"]);
    expect(st().trash).toHaveLength(0);
    expect(st().history).toHaveLength(0);
    expect(st().status).toBe(`Run 1: ${PROTECTED_NOTICE}`);
  });

  it("a bulk delete holding a protected sheet removes nothing, not even the unprotected ones", () => {
    useApp.setState({ selectedIds: ["w", "o"] });
    st().removeSelected();
    removeDatasetsPruningCollapsed(["o", "w"]);
    expect(st().datasets.map((d) => d.id)).toEqual(["w", "o"]);
    expect(st().trash).toHaveLength(0);
  });

  it("deleting the workbook that holds a protected sheet is refused", () => {
    useApp.setState({
      workbooks: [{ id: "wb", name: "Book" }],
      datasets: [mk("w", "Run 1", { workbookId: "wb", protectedSheet: true }), mk("o", "Run 2", { workbookId: "wb" })],
    });
    st().deleteWorkbook("wb");
    expect(st().workbooks).toHaveLength(1);
    expect(st().datasets).toHaveLength(2);
    expect(st().trash).toHaveLength(0);
    expect(st().status).toBe(`Run 1: ${PROTECTED_NOTICE}`);
  });

  it("Unprotect is one click and the sheet then renames and goes to the trash", () => {
    setSheetProtected("w", false);
    st().renameDataset("w", "Renamed");
    expect(sheet().name).toBe("Renamed");
    st().removeDataset("w");
    expect(st().datasets.map((d) => d.id)).toEqual(["o"]);
    expect(st().trash).toHaveLength(1);
  });
});

describe("the macro recorder", () => {
  beforeEach(() => {
    st().startMacro();
  });

  it("records Protect and Unprotect with the sheet's name", () => {
    setSheetProtected("w", true);
    setSheetProtected("w", false);
    expect(lines()).toEqual(['qz.protectSheet("Run 1")', 'qz.unprotectSheet("Run 1")']);
    expect(st().macroSteps[0].label).toBe("Protect sheet Run 1");
  });

  it("records a pivot with the chosen rule, and a stack with its columns", () => {
    const long: Dataset = {
      id: "l",
      name: "Long",
      data: { time: [0, 0, 1, 1], values: [[1, 10], [2, 20], [1, 11], [2, 21]], labels: ["key", "val"], units: ["", ""], metadata: {} },
    };
    useApp.setState({ datasets: [long], activeId: "l" });
    const out = runPivot("l", { time: -1, key: { channel: 0 }, value: 1, rule: "mean" });
    expect(out.ok).toBe(true);
    expect(lines()).toEqual(['qz.pivot("Long", { time: -1, key: { channel: 0 }, value: 1, rule: "mean" })']);
    expect(st().macroSteps[0].label).toBe("Pivot Long (long to wide, mean)");
    const stacked = runUnpivot("l", [0, 1], true);
    expect(stacked.ok).toBe(true);
    expect(lines()[1]).toBe('qz.unpivot("Long", { columns: [0, 1], skipEmpty: true })');
  });

  it("a refused pivot records nothing", () => {
    useApp.setState({ datasets: [{ ...sheet(), pending: {} as never }] });
    expect(runPivot("w", { time: -1, key: { channel: 0 }, value: 1, rule: "mean" }).ok).toBe(false);
    expect(lines()).toEqual([]);
  });

  it("records ONE line for an insert into similar sheets, not one per sheet and per edit", () => {
    const out = insertIntoSimilar(["w", "o"], { name: "Sum", expr: "A + B", designation: "Y" });
    expect(out.ok).toBe(true);
    expect(lines()).toEqual(['qz.insertIntoSimilarSheets(["Run 1", "Run 2"], { name: "Sum", expr: "A + B", designation: "Y" })']);
    expect(st().pipelineRunning).toBe(false); // the recorder's guard is put back
    expect(sheet().formulas).toHaveLength(1);
    expect(sheet("o").formulas).toHaveLength(1);
  });

  it("a refused insert (a protected sheet) records nothing and leaves the guard as it was", () => {
    setSheetProtected("o", true);
    useApp.setState({ macroSteps: [] });
    const out = insertIntoSimilar(["w", "o"], { name: "Sum", expr: "A + B", designation: "Y" });
    expect(out.ok).toBe(false);
    expect(lines()).toEqual([]);
    expect(st().pipelineRunning).toBe(false);
    expect(sheet().formulas).toBeUndefined(); // all or nothing
  });
});

describe("the script exporter", () => {
  it("says NOT REPRODUCED with the reason for each; a lock does not stop the steps after it, a pivot does", () => {
    st().startMacro();
    setSheetProtected("w", true);
    st().recordMacro("Pivot Run 1", 'qz.pivot("Run 1", { time: -1 })');
    st().recordMacro("Stack", 'qz.unpivot("Run 1", { columns: [0] })');
    st().recordMacro("Insert", 'qz.insertIntoSimilarSheets(["Run 1"], { name: "S" })');
    const py = pipelineToPython(st().macroSteps);
    expect(py).toContain("NOT REPRODUCED: sheet protection is a lock");
    expect(py).toContain("NOT REPRODUCED: the time-series pivot (long to wide) has no quantized.api equivalent");
    // the lock changes no data, so the pivot after it is judged on its own reason
    expect(py).not.toContain("not run: it follows step 1");
    // the pivot makes a new worksheet: the steps after it were recorded on data the script does not have
    expect(py).toContain("not run: it follows step 2");
  });

  it("names the reason for stack and insert when they come first", () => {
    const steps = [
      { id: "a", kind: "ui" as const, label: "Stack", code: 'qz.unpivot("Run 1", { columns: [0] })', params: {}, enabled: true },
    ];
    expect(pipelineToPython(steps)).toContain("stacking columns under a key (wide to long) has no quantized.api equivalent");
    const ins = [{ ...steps[0], code: 'qz.insertIntoSimilarSheets(["Run 1"], { name: "S" })' }];
    expect(pipelineToPython(ins)).toContain("inserting a column into every similar worksheet");
  });
});

describe("the Show formulas palette entry", () => {
  it("refuses with a reason when no worksheet is in front", () => {
    const cmd = buildAppActions(useApp.getState).find((a) => a.id === "show-formulas");
    expect(cmd).toBeDefined();
    useApp.setState({ stageTab: "plot", layoutMode: "classic" } as Partial<ReturnType<typeof useApp.getState>>);
    cmd!.run();
    expect(st().status).toMatch(/No worksheet is in front/);
  });
});
