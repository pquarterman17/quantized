// Statistical tests (lane RB4 review): a run whose Library save throws keeps
// its output, and the book says the run could not be saved, never that its
// saved result was "deleted or undone".

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: runMock,
}));
vi.mock("../../../store/statisticalTestResults", () => ({
  publishStatisticalTestResult: () => { throw new Error("library full"); },
}));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import type { Dataset } from "../../../lib/types";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useApp } from "../../../store/useApp";
import StatsTestsPanel from "./StatsTestsPanel";

const ds: Dataset = {
  id: "d1", name: "films",
  data: { time: [1, 2, 3, 4, 5], values: [[10, 20], [11, 21], [12, 22], [13, 23], [14, 24]], labels: ["Hc", "Ms"], units: ["", ""], metadata: {} },
};

beforeEach(() => {
  runMock.mockResolvedValue({ id: "ks-two-sample", data: { D: 1, p: 0.008, n1: 5, n2: 5, alternative: "two-sided", method: "KS" } });
  useApp.setState({ datasets: [ds], activeId: "d1", status: "", analysisResults: [], history: [], future: [] });
  useStatsTestsStore.setState({ open: true, request: null });
});

describe("Statistical tests save failure", () => {
  it("keeps the output and says the run could not be saved", async () => {
    render(<StatsTestsPanel />);
    const select = screen.getByLabelText("Test") as HTMLSelectElement;
    const option = Array.from(select.options).find((o) => /Two-sample Kolmogorov/.test(o.text))!;
    fireEvent.change(select, { target: { value: option.value } });
    fireEvent.change(screen.getByLabelText("Second column"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await screen.findByText(/p = 0\.008/);
    const send = screen.getByRole("button", { name: "Send to report: Table 1" });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute("title", expect.stringMatching(/could not be saved to the Library \(library full\)/));
    expect(send.getAttribute("title")).not.toMatch(/deleted or undone/);
    expect(screen.queryByText(/the test failed|library full$/)).toBeNull();
  });
});
