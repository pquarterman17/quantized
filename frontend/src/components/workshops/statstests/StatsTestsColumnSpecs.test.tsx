// GAP_AUDIT_9 G27: the capability tool fills blank LSL / USL / Target from the
// measurement column's spec limits, says so, and a typed value always wins.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetBookTransportForTests } from "../../../lib/bookData";
import type { Dataset } from "../../../lib/types";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useApp } from "../../../store/useApp";
import StatsTestsPanel from "./StatsTestsPanel";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: runMock,
}));

const ds: Dataset = {
  id: "d1", name: "line",
  data: { time: [1, 2, 3, 4], values: [[10, 11, 10, 12]], labels: ["thickness"], units: [""], metadata: {} },
  columnProps: { 0: { spec: { lsl: 8, usl: 14, target: 11 } } },
};

beforeEach(() => {
  resetBookTransportForTests();
  vi.clearAllMocks();
  runMock.mockRejectedValue(new Error("stop"));
  useApp.setState({ datasets: [ds], activeId: "d1", status: "", reports: [], analysisResults: [], history: [], future: [] });
  useStatsTestsStore.setState({ open: true, request: null });
});

function pickCapability(): void {
  const select = screen.getByLabelText("Test") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: Array.from(select.options).find((o) => /Process capability/.test(o.text))!.value } });
  fireEvent.change(screen.getByLabelText("Measurement"), { target: { value: "0" } });
}

describe("capability pre-fill from column spec limits", () => {
  it("names the fallback and sends the column's limits", async () => {
    render(<StatsTestsPanel />);
    pickCapability();
    expect(screen.getByRole("note").textContent).toMatch(/Blank LSL, USL, Target will use the spec limits of "thickness"/);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await screen.findByText(/stop/);
    expect(runMock.mock.calls[0][0].body).toMatchObject({ lsl: 8, usl: 14, target: 11 });
    expect(useApp.getState().status).toMatch(/LSL, USL, Target taken from the spec limits of "thickness"/);
  });

  it("a typed value wins over the column's", async () => {
    render(<StatsTestsPanel />);
    pickCapability();
    fireEvent.change(screen.getByLabelText("USL"), { target: { value: "20" } });
    fireEvent.blur(screen.getByLabelText("USL"));
    expect(screen.getByRole("note").textContent).toMatch(/Blank LSL, Target/);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await screen.findByText(/stop/);
    expect(runMock.mock.calls[0][0].body).toMatchObject({ lsl: 8, usl: 20, target: 11 });
  });

  it("a column without spec limits changes nothing (no note, still refuses)", () => {
    useApp.setState({ datasets: [{ ...ds, columnProps: undefined }] });
    render(<StatsTestsPanel />);
    pickCapability();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
