// The filter and Reduce XY UIs: live preview from the backend (mocked), flagged
// spikes shown, and Create commits through runTransform as a recorded `sigop` step.

import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SigopRequest, SigopResult } from "../../../lib/api/sigop";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import ReduceXYSection from "../resample/ReduceXYSection";
import SignalProcessingPanel from "./SignalProcessingPanel";

vi.mock("../../../lib/api/sigop", () => ({ sigopDataset: vi.fn() }));
vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));
const { sigopDataset } = await import("../../../lib/api/sigop");

const dataset: Dataset = {
  id: "src",
  name: "raman.dat",
  data: {
    time: [0, 1, 2, 3, 4, 5],
    values: [[1], [1], [90], [1], [1], [1]],
    labels: ["I"],
    units: ["cts"],
    metadata: { xUnit: "nm" },
  },
};

function fake(body: SigopRequest): Promise<SigopResult> {
  const { time, values } = body.dataset;
  if (body.method === "reduce-nth") {
    const n = Number(body.args?.n);
    const rows = time.map((_, i) => i).filter((i) => i % n === 0);
    return Promise.resolve({
      dataset: { ...body.dataset, time: rows.map((i) => time[i]), values: rows.map((i) => values[i]), cat_levels: undefined, level_order: undefined },
      warnings: [], flagged: {}, rows_in: time.length, rows_out: rows.length,
    });
  }
  return Promise.resolve({
    dataset: { ...body.dataset, values: values.map((r, i) => [i === 2 ? 1 : r[0]]), labels: ["I · despiked"], cat_levels: undefined, level_order: undefined },
    warnings: ["1 spike point(s) replaced by interpolation."],
    flagged: { "0": [2] },
    rows_in: time.length,
    rows_out: time.length,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sigopDataset).mockImplementation(fake);
  useApp.setState({ datasets: [dataset], activeId: dataset.id, yKeys: [0], signalProcessingOpen: true, history: [], future: [] });
});

describe("Signal Processing: despike", () => {
  it("previews with the flagged spike circled, then Create records a sigop transform", async () => {
    const { container } = render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "despike" } });
    expect(await screen.findByText(/1 spike point flagged/)).toBeInTheDocument();
    const body = vi.mocked(sigopDataset).mock.calls.at(-1)![0];
    expect(body).toMatchObject({ method: "despike", channels: [0], args: { window: 5, threshold: 5 } });
    expect(container.querySelectorAll("circle[data-flagged]")).toHaveLength(1);

    const create = screen.getByRole("button", { name: "Create worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    const made = useApp.getState().datasets[1];
    expect(made.name).toBe("raman (despiked)");
    expect(made.data.values[2][0]).toBe(1);
  });

  it("blocks Create with a sentence for a bad window and makes no request", async () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "median" } });
    fireEvent.change(screen.getByLabelText("Window (odd, rows)"), { target: { value: "4" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/odd/);
    expect(screen.getByRole("button", { name: "Create worksheet" })).toBeDisabled();
    expect(sigopDataset).not.toHaveBeenCalledWith(expect.objectContaining({ args: { window: 4 } }), expect.anything());
  });
});

describe("Reduce XY", () => {
  it("keep every Nth row: shows the row counts and creates the smaller dataset", async () => {
    const onClose = vi.fn();
    render(<ReduceXYSection onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Reduce by"), { target: { value: "reduce-nth" } });
    fireEvent.change(screen.getByLabelText("Keep every Nth row"), { target: { value: "2" } });
    expect(await screen.findByText(/6 rows → 3 rows/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create reduced dataset" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    expect(onClose).toHaveBeenCalled();
    const made = useApp.getState().datasets[1];
    expect(made.data.time).toEqual([0, 2, 4]);
    expect(made.name).toBe("raman (every Nth row)");
  });

  it("surfaces the backend's refusal of a non-monotonic X and keeps Create disabled", async () => {
    vi.mocked(sigopDataset).mockRejectedValue(new Error("Reduce is refused: X reverses direction"));
    render(<ReduceXYSection onClose={() => undefined} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/reverses direction/);
    expect(screen.getByRole("button", { name: "Create reduced dataset" })).toBeDisabled();
  });
});
