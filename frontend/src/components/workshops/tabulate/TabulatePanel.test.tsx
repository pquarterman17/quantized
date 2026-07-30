// TabulatePanel — component tests (v2, JMP_GAP_PLAN J6). ZoneWell drag/drop +
// click-to-assign wiring for the (now multi-slot, ordered) Group by / Value
// wells, the foreign-dataset reject-with-toast, the stat-set checkboxes, the
// grand-total switch, and the "→ Report" stats_table emission. jsdom has no
// `DragEvent` constructor and RTL's fireEvent.drop sugar silently drops
// dataTransfer, so drops are hand-built the same way as ZoneWell.test.tsx /
// AxisDropZones.test.tsx. Chip text (label + a "×" remove button sharing one
// <span>) isn't reliably queryable via getByText (the span's normalized
// textContent is "label×"), so well contents are asserted via
// container.textContent instead.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHANNEL_DND, encodeChannelDrag } from "../../../lib/dragaxis";
import type { DataStruct } from "../../../lib/types";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import TabulatePanel from "./TabulatePanel";

const { emitMock } = vi.hoisted(() => ({ emitMock: vi.fn() }));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  reportEmit: emitMock,
}));

// 12 rows: channel 0 is a 2-level categorical grouping column (nominal fires at
// ≥12 samples / ≤8 levels); channel 1 is the continuous value column — mirrors
// useTabulate.test.ts's fixture so the aggregate numbers here are known-good.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 10], [0, 12], [0, 14], [0, 16], [0, 18], [0, 20],
    [1, 30], [1, 32], [1, 34], [1, 36], [1, 38], [1, 40],
  ],
  labels: ["grp", "val"],
  units: ["", ""],
  metadata: { x_column_name: "T" },
};

function channelDataTransfer(datasetId: string, channel: number) {
  const payload = encodeChannelDrag({ datasetId, channel });
  return {
    types: [CHANNEL_DND],
    getData: (type: string) => (type === CHANNEL_DND ? payload : ""),
    setData: () => {},
  };
}

function fireDrop(el: Element, dataTransfer: unknown) {
  const evt = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dataTransfer, configurable: true });
  fireEvent(el, evt);
}

function wells(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll(".qzk-zone-well"));
}

/** Assigned-chip labels in a well, ignoring the free-channel "+add" <select>'s
 *  own (always-present) option text — plain textContent assertions on the
 *  whole well would false-positive on an unassigned column that merely
 *  appears as a pickable option. */
function chipLabels(well: Element): string[] {
  return Array.from(well.querySelectorAll(".qzk-zone-chip")).map((c) => c.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    tabulateOpen: true,
    reports: [],
    status: "",
  });
  useToasts.setState({ toasts: [] });
});

describe("TabulatePanel", () => {
  it("defaults the Group by/Value wells to the categorical/continuous columns", () => {
    const { container } = render(<TabulatePanel />);
    const [groupWell, valueWell] = wells(container);
    expect(chipLabels(groupWell).join(" ")).toContain("grp");
    expect(chipLabels(valueWell).join(" ")).toContain("val");
    expect(screen.getByRole("columnheader", { name: "grp" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "val" })).toBeInTheDocument();
  });

  it("reassigns the Group by well via a synthetic channel drop", () => {
    const { container } = render(<TabulatePanel />);
    const [groupWell] = wells(container);
    fireDrop(groupWell, channelDataTransfer("d1", 1)); // add "val" onto Group by (nested alongside "grp")
    const chips = chipLabels(groupWell).join(" ");
    expect(chips).toContain("val");
    expect(chips).toContain("grp"); // still nested — this well is multi-slot now
  });

  it("caps the Group by well at 3 nested columns (only 2 channels exist here, so both fit)", () => {
    const { container } = render(<TabulatePanel />);
    const [groupWell] = wells(container);
    fireDrop(groupWell, channelDataTransfer("d1", 1));
    const chips = chipLabels(groupWell);
    expect(chips).toHaveLength(2);
    expect(chips.join(" ")).toContain("grp");
    expect(chips.join(" ")).toContain("val");
  });

  it("reassigns the Value well via the click-to-assign Select fallback", () => {
    const { container } = render(<TabulatePanel />);
    fireEvent.change(screen.getByLabelText("Assign a channel to Value"), {
      target: { value: "0" }, // "grp" channel, added alongside "val"
    });
    const [, valueWell] = wells(container);
    const chips = chipLabels(valueWell).join(" ");
    expect(chips).toContain("grp");
    expect(chips).toContain("val");
  });

  it("ignores a drop from a foreign dataset and surfaces a toast", () => {
    const { container } = render(<TabulatePanel />);
    const [groupWell] = wells(container);
    fireDrop(groupWell, channelDataTransfer("OTHER", 1));
    expect(chipLabels(groupWell)).toHaveLength(1); // unchanged — still just "grp"
    expect(chipLabels(groupWell).join(" ")).toContain("grp");
    expect(useToasts.getState().toasts).toHaveLength(1);
    expect(useToasts.getState().toasts[0].msg).toMatch(/different dataset/);
  });

  it("toggles a stat column via its checkbox and updates the preview table", () => {
    render(<TabulatePanel />);
    expect(screen.queryByRole("columnheader", { name: "sem" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("sem"));
    expect(screen.getByRole("columnheader", { name: "sem" })).toBeInTheDocument();
  });

  it("appends a grand-total row when the switch is toggled on", () => {
    render(<TabulatePanel />);
    const before = screen.getAllByRole("row").length;
    fireEvent.click(screen.getByRole("switch", { name: "Grand total row" }));
    const after = screen.getAllByRole("row").length;
    expect(after).toBe(before + 1);
  });

  it("emits the group summary as a #36 stats_table report", async () => {
    emitMock.mockResolvedValue({ report: { title: "t", sections: [] } });
    render(<TabulatePanel />);
    fireEvent.click(screen.getByRole("button", { name: "→ Report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "stats_table",
        title: "val by grp — run.dat",
      }),
    );
    expect(useApp.getState().reports[0].datasetId).toBe("d1");
  });

  it("surfaces a report emission failure as a toast instead of throwing", async () => {
    emitMock.mockRejectedValue(new Error("boom"));
    render(<TabulatePanel />);
    fireEvent.click(screen.getByRole("button", { name: "→ Report" }));
    await waitFor(() => expect(emitMock).toHaveBeenCalled());
    expect(useApp.getState().reports).toHaveLength(0);
  });
});
