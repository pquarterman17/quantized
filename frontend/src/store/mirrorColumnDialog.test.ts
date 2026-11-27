// "Mirror column…": pick a worksheet, then a column of it, through the real
// parameter-dialog store; one undo step; cancel at either step changes nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadFormulaExtension } from "../lib/formulaExt";
import type { Dataset } from "../lib/types";
import { useParamDialog } from "./paramDialog";
import { useApp } from "./useApp";
import { mirrorColumnDialog } from "./mirrorColumnDialog";

const mk = (id: string, name: string, labels: string[], units: string[]): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [labels.map(() => 1), labels.map(() => 2)], labels, units, metadata: {} },
});
const st = () => useApp.getState;
const answer = async (title: RegExp, values: Record<string, string> | null) => {
  await vi.waitFor(() => expect(useParamDialog.getState().title).toMatch(title));
  const { resolve, close } = useParamDialog.getState();
  close();
  resolve?.(values);
};

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [mk("a", "Alpha", ["T", "R"], ["K", "ohm"]), mk("b", "Beta", ["Q"], [""])],
    activeId: "b",
    history: [],
    future: [],
    status: "",
  });
});

describe("Mirror column… dialog", () => {
  it("asks for the worksheet, then the column, and adds one mirror (Alpha's R, with its unit)", async () => {
    const done = mirrorColumnDialog("b");
    await answer(/Mirror column — worksheet/, { sheet: "Alpha" });
    await vi.waitFor(() => expect(useParamDialog.getState().fields[0]?.options).toEqual(["X — X", "A — T [K]", "B — R [ohm]"]));
    await answer(/Mirror column — Alpha/, { col: "B — R [ohm]" });
    await done;
    await vi.waitFor(() => expect(st()().datasets.find((d) => d.id === "b")!.formulas).toHaveLength(1));
    const f = st()().datasets.find((d) => d.id === "b")!.formulas![0];
    expect(f).toMatchObject({ name: "R", expr: 'sheet("Alpha", B)', unit: "ohm" });
    expect(st()().history.map((h) => h.label)).toEqual(["add column"]);
  });

  it("cancel at the second step adds nothing", async () => {
    const done = mirrorColumnDialog("b");
    await answer(/worksheet/, { sheet: "Alpha" });
    await answer(/Mirror column — Alpha/, null);
    await done;
    expect(st()().datasets.find((d) => d.id === "b")!.formulas).toBeUndefined();
    expect(st()().history).toHaveLength(0);
  });

  it("with no other worksheet it says so instead of opening a dialog", async () => {
    useApp.setState({ datasets: [mk("b", "Beta", ["Q"], [""])] });
    await mirrorColumnDialog("b");
    expect(useParamDialog.getState().title).toBeNull();
    expect(st()().status).toMatch(/needs another worksheet/);
  });
});
