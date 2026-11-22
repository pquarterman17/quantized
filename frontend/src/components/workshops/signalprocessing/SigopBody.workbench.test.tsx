// Lane WB fail-before: Cancel while a filter's Create is pending must leave no
// worksheet behind. Before the shell, the sigop commit carried no AbortSignal,
// so the output landed after the window had closed. The race is forced: the
// commit's backend call is held open until after Cancel.
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SigopRequest, SigopResult } from "../../../lib/api/sigop";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
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
  data: { time: [0, 1, 2, 3, 4, 5], values: [[1], [1], [90], [1], [1], [1]], labels: ["I"], units: ["cts"], metadata: { xUnit: "nm" } },
};
const answer = (body: SigopRequest): SigopResult => ({
  dataset: { ...body.dataset, labels: ["I · despiked"], cat_levels: undefined, level_order: undefined },
  warnings: [], flagged: { "0": [] }, rows_in: body.dataset.time.length, rows_out: body.dataset.time.length,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sigopDataset).mockImplementation((body) => Promise.resolve(answer(body)));
  useApp.setState({ datasets: [dataset], activeId: dataset.id, yKeys: [0], signalProcessingOpen: true, history: [], future: [] });
});

describe("Signal Processing filters: Cancel during Create (lane WB)", () => {
  it("leaves no worksheet when the backend answers after Cancel", async () => {
    const { unmount } = render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "despike" } });
    const create = screen.getByRole("button", { name: "Create worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    let release: (() => void) | undefined;
    let commitSignal: AbortSignal | undefined;
    // A transport that cannot abort: it answers anyway, AFTER Cancel.
    vi.mocked(sigopDataset).mockImplementation((body, signal?: AbortSignal) => {
      commitSignal = signal;
      return new Promise((resolve) => { release = () => resolve(answer(body)); });
    });
    fireEvent.click(create);
    await waitFor(() => expect(release).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    unmount(); // the window closes
    expect(commitSignal?.aborted).toBe(true);
    await act(async () => { release?.(); await Promise.resolve(); await Promise.resolve(); });
    expect(useApp.getState().datasets).toEqual([dataset]);
    expect(useApp.getState().history).toEqual([]);
    expect(useApp.getState().status).toBe("cancelled — nothing was created");
  });
});
