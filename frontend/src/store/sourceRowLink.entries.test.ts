// "Go to Source rows" from the two places a subset is found besides its worksheet: the command palette's
// active-dataset entries and the Library row menu (ROW_RANGE_CONTRACT section 4). Both are driven from the real
// registry and the real store, after the source was sorted, so the rows selected are the ORIGINAL ones.

import { beforeEach, describe, expect, it } from "vitest";

import { buildDatasetRowMenu } from "../components/Library/datasetRowMenu";
import { planExtract } from "../components/Stage/worksheet/extractRows";
import { commitExtract } from "../components/Stage/worksheet/extractRowsCommit";
import type { ContextMenuItem } from "../components/overlays/ContextMenu";
import { contextPaletteActions } from "../lib/paletteContextActions";
import type { Dataset } from "../lib/types";
import { sortWorksheetRows } from "./sortRows";
import { useApp } from "./useApp";
import { STAGE_WORKSHEET_SELECTION_KEY } from "./worksheetOpen";

const N = 8;
const SRC: Dataset = {
  id: "src", name: "run.csv",
  data: { time: Array.from({ length: N }, (_, i) => i), values: Array.from({ length: N }, (_, i) => [100 - i * 10]), labels: ["Y"], units: [""], metadata: {} },
};
const st = () => useApp.getState();
const child = () => st().datasets.find((d) => d.id !== "src")!;
const selected = (): number[] => [...(st().selection?.datasetId === "src" ? st().selection!.rows : st().worksheetSelections[STAGE_WORKSHEET_SELECTION_KEY]?.rows ?? [])].sort((a, b) => a - b);
const flat = (items: ContextMenuItem[]): ContextMenuItem[] => items.flatMap((i) => [i, ...(("submenu" in i && Array.isArray(i.submenu) ? flat(i.submenu as ContextMenuItem[]) : []))]);

beforeEach(() => {
  useApp.setState({
    datasets: [SRC], activeId: "src", worksheetId: null, stageTab: "plot", staleDatasets: [], staleFits: [],
    history: [], future: [], status: "", macroRecording: false, analysisResults: [], worksheetSelections: {}, selection: null, selectedIds: [],
  });
  const source = st().datasets[0];
  commitExtract(source, planExtract(source.data, [1, 4, 6])!, () => undefined);
  sortWorksheetRows("src", 0, 1); // the sheet reverses: source row r is now N-1-r
});

describe("Go to Source rows from the command palette", () => {
  it("is offered for the active subset, and selects the original rows in the source", async () => {
    st().setActive(child().id);
    const entry = contextPaletteActions().find((a) => a.label.startsWith("Go to Source rows"));
    expect(entry?.label).toBe("Go to Source rows (run.csv)");
    entry!.run();
    await new Promise((r) => setTimeout(r, 50)); // the lazy store half
    expect(selected()).toEqual([N - 1 - 6, N - 1 - 4, N - 1 - 1]);
  });

  it("is not offered for an ordinary worksheet, nor when the source is gone", () => {
    st().setActive("src");
    expect(contextPaletteActions().some((a) => a.label.startsWith("Go to Source rows"))).toBe(false);
    st().setActive(child().id);
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "src") }));
    expect(contextPaletteActions().some((a) => a.label.startsWith("Go to Source rows"))).toBe(false);
  });
});

describe("Go to Source rows from the Library row menu", () => {
  const menu = (d: Dataset) => flat(buildDatasetRowMenu(d, false, false, [], false, false, () => {}, () => {}));

  it("the subset's row has the entry and it selects the original rows", async () => {
    const item = menu(child()).find((i) => "label" in i && String(i.label).startsWith("Go to Source rows"));
    expect(item && "label" in item && item.label).toBe("Go to Source rows (run.csv)");
    (item as { run: () => void }).run();
    await new Promise((r) => setTimeout(r, 50));
    expect(selected()).toEqual([N - 1 - 6, N - 1 - 4, N - 1 - 1]);
  });

  it("an ordinary worksheet's row has none", () => {
    expect(menu(st().datasets.find((d) => d.id === "src")!).some((i) => "label" in i && String(i.label).startsWith("Go to Source rows"))).toBe(false);
  });
});
