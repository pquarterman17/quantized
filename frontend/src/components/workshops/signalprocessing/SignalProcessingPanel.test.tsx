import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import SignalProcessingPanel from "./SignalProcessingPanel";

const { correctionMock } = vi.hoisted(() => ({ correctionMock: vi.fn() }));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  applyCorrections: correctionMock,
}));

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));

const dataset: Dataset = {
  id: "signal-source",
  name: "scan",
  data: {
    time: [1, 2, 3],
    values: [[10, 1], [20, 4], [30, 9]],
    labels: ["primary", "secondary"],
    units: ["V", "A"],
    metadata: { xUnit: "s" },
  },
};
const realCreateDerived = useApp.getState().createDerivedWorksheet;

beforeEach(() => {
  vi.clearAllMocks();
  correctionMock.mockImplementation(async ({ dataset: data }: { dataset: Dataset["data"] }) => structuredClone(data));
  useApp.setState({
    datasets: [dataset],
    activeId: dataset.id,
    yKeys: [1],
    signalProcessingOpen: true,
    createDerivedWorksheet: realCreateDerived,
    history: [],
    future: [],
  });
});

describe("SignalProcessingPanel", () => {
  it("previews the plotted signal through the channel-targeted API", async () => {
    render(<SignalProcessingPanel />);

    const create = screen.getByRole("button", { name: "Create linked worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    expect(correctionMock).toHaveBeenLastCalledWith(expect.objectContaining({
      dataset: dataset.data,
      params: expect.objectContaining({
        signalChannels: [1],
        smoothMethod: "savitzky-golay",
      }),
    }));
    expect(screen.getByText("Preview: secondary")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /original and processed/i })).toBeInTheDocument();
    expect(create).toBeEnabled();
  });

  it("fails closed when the chosen operation cannot propagate a bound Y error", () => {
    useApp.setState({
      datasets: [{
        ...dataset,
        errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }],
      }],
      yKeys: [0],
    });
    render(<SignalProcessingPanel />);

    expect(screen.getByRole("alert")).toHaveTextContent("cannot yet propagate bound Y uncertainty");
    expect(screen.getByRole("button", { name: "Create linked worksheet" })).toBeDisabled();
    expect(correctionMock).not.toHaveBeenCalled();
  });

  it("does not create duplicate outputs from rapid repeated clicks", async () => {
    let settle!: (value: string | null) => void;
    const pending = new Promise<string | null>((resolve) => { settle = resolve; });
    const createDerivedWorksheet = vi.fn(() => pending);
    useApp.setState({ createDerivedWorksheet });
    render(<SignalProcessingPanel />);

    const create = screen.getByRole("button", { name: "Create linked worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    act(() => {
      create.click();
      create.click();
    });
    expect(createDerivedWorksheet).toHaveBeenCalledTimes(1);
    await act(async () => settle(null));
  });
});
