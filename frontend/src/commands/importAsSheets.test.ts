// "Import as sheets of one workbook…" (worksheet audit #20): several files
// land as worksheets of ONE workbook (Origin's multi-file import into one
// book), not one workbook each, and the per-file workbooks are not left
// behind empty.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../lib/types";
import { useApp } from "../store/useApp";
import { runImportAsSheets } from "./importAsSheets";

function ds(id: string, name: string, workbookId: string): Dataset {
  return { id, name, workbookId, data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} } };
}

beforeEach(() => {
  useApp.setState({ datasets: [ds("old", "old.csv", "wb-old")], workbooks: [{ id: "wb-old", name: "old" }], expandedWorkbookIds: [] });
});

describe("runImportAsSheets", () => {
  it("puts every imported file into one workbook named after the first, dropping the emptied ones", async () => {
    useApp.setState({
      importFiles: async () => {
        useApp.setState((s) => ({
          datasets: [...s.datasets, ds("a", "a.csv", "wb-a"), ds("b", "b.csv", "wb-b")],
          workbooks: [...s.workbooks, { id: "wb-a", name: "a.csv" }, { id: "wb-b", name: "b.csv" }],
        }));
        return ["a", "b"];
      },
    });
    const files = [new File(["1"], "a.csv"), new File(["2"], "b.csv")];
    const wb = await runImportAsSheets(useApp.getState, files);
    const st = useApp.getState();
    expect(wb).not.toBeNull();
    expect(st.datasets.filter((d) => d.workbookId === wb).map((d) => d.id)).toEqual(["a", "b"]);
    expect(st.workbooks.map((w) => w.name)).toEqual(["old", "a"]);
    expect(st.datasets.find((d) => d.id === "old")?.workbookId).toBe("wb-old"); // untouched
    expect(st.expandedWorkbookIds).toContain(wb);
    expect(st.activeId).toBe("a");
  });

  it("leaves a single import as it is", async () => {
    useApp.setState({ importFiles: async () => ["x"] });
    expect(await runImportAsSheets(useApp.getState, [new File(["1"], "x.csv")])).toBeNull();
  });

  it("suppresses the standard 'create folder?' toast — these files become sheets of one workbook, not folder candidates", async () => {
    const importFiles = vi.fn(async () => {
      useApp.setState((s) => ({
        datasets: [...s.datasets, ds("a", "scan_1.csv", "wb-a"), ds("b", "scan_2.csv", "wb-b")],
        workbooks: [...s.workbooks, { id: "wb-a", name: "scan_1.csv" }, { id: "wb-b", name: "scan_2.csv" }],
      }));
      return ["a", "b"];
    });
    useApp.setState({ importFiles });
    const files = [new File(["1"], "scan_1.csv"), new File(["2"], "scan_2.csv")];
    await runImportAsSheets(useApp.getState, files);
    expect(importFiles).toHaveBeenCalledWith(files, expect.objectContaining({ suppressFolderOffer: true }));
  });
});
