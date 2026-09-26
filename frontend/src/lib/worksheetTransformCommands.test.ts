// P2.5 dialog flow for the Data-menu reshapes: after the ParamDialog steps,
// the warnings are shown in a review confirm BEFORE anything is created — a
// unit mismatch as a danger confirm naming the override — and declining
// creates nothing and records nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "./types";
import { useApp } from "../store/useApp";

vi.mock("../components/overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../store/confirmDialog", () => ({ askConfirm: vi.fn() }));

const { askParams } = await import("../components/overlays/ParamDialog");
const { askConfirm } = await import("../store/confirmDialog");
const { runJoinWorksheets, runStackWorksheet, runTransposeWorksheet } = await import("./worksheetTransformCommands");

const left: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[1, 10], [2, 20], [2, 21], [Number.NaN, 30]],
  labels: ["T", "a"],
  units: ["K", "emu"],
  metadata: {},
};
const right = (unit: string): DataStruct => ({
  time: [0, 1],
  values: [[1, 7], [2, 8]],
  labels: ["T", "b"],
  units: [unit, "Oe"],
  metadata: {},
});

function setup(rightUnit = "K") {
  useApp.setState({
    datasets: [
      { id: "L", name: "left.dat", data: left },
      { id: "R", name: "right.dat", data: right(rightUnit) },
    ],
    activeId: "L",
    macroRecording: true,
    macroSteps: [],
    pipelineRunning: false,
    status: "",
  });
  vi.mocked(askParams)
    .mockResolvedValueOnce({ right: "right.dat — R", leftKey: "0: T", mode: "inner" })
    .mockResolvedValueOnce({ rightKey: "0: T" });
}

const settle = () => vi.waitFor(() => expect(useApp.getState().status).not.toBe(""));

beforeEach(() => {
  vi.mocked(askParams).mockReset();
  vi.mocked(askConfirm).mockReset();
});

describe("Join by key — review before commit", () => {
  it("shows the duplicate and blank key counts in a plain review, then creates on OK", async () => {
    setup();
    vi.mocked(askConfirm).mockResolvedValue(true);
    runJoinWorksheets(useApp.getState);
    await settle();
    const [title, message, label, danger] = vi.mocked(askConfirm).mock.calls[0];
    expect(title).toBe("Join (inner): review before creating");
    expect(message.split("\n")).toEqual([
      "Result: 2 rows × 2 columns (plus X).",
      '• left.dat: 1 row repeats an earlier key (1 duplicated key value in "T"); only the first row of each key is kept.',
      '• left.dat: 1 row with a blank or non-numeric "T" cannot match anything and is dropped.',
    ]);
    expect(label).toBe("Create");
    expect(danger).toBe(false);
    expect(useApp.getState().datasets).toHaveLength(3);
    expect(useApp.getState().macroSteps[0].kind).toBe("transform");
  });

  it("a key-unit mismatch is a danger confirm; declining creates and records nothing", async () => {
    setup("mK");
    vi.mocked(askConfirm).mockResolvedValue(false);
    runJoinWorksheets(useApp.getState);
    await settle();
    const [title, , label, danger] = vi.mocked(askConfirm).mock.calls[0];
    expect(title).toBe("Join (inner): units differ");
    expect(label).toBe("Create despite unit mismatch");
    expect(danger).toBe(true);
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().macroSteps).toEqual([]);
    expect(useApp.getState().status).toBe("Join (inner) cancelled — nothing was created");
  });
});

describe("Stack / transpose", () => {
  it("stacking channels with different units needs the explicit confirm", async () => {
    setup();
    vi.mocked(askParams).mockReset().mockResolvedValueOnce({ channels: "1,2" });
    vi.mocked(askConfirm).mockResolvedValue(false);
    runStackWorksheet(useApp.getState);
    await settle();
    expect(vi.mocked(askConfirm).mock.calls[0][1]).toContain("T in K; a in emu");
    expect(vi.mocked(askConfirm).mock.calls[0][3]).toBe(true);
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("transpose only has an info note (units dropped), so no review is shown", async () => {
    setup();
    vi.mocked(askParams).mockReset().mockResolvedValueOnce({ confirm: true });
    runTransposeWorksheet(useApp.getState);
    await settle();
    expect(askConfirm).not.toHaveBeenCalled();
    const made = useApp.getState().datasets[2];
    expect(made.name).toBe("left.dat (transposed)");
    expect(made.data.metadata.transform_warnings).toEqual([
      "2 column units cannot be carried through a transpose; the original units are kept in provenance only.",
    ]);
  });
});
