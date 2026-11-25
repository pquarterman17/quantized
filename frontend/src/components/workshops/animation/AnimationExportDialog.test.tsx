import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigureAnimation } from "../../../lib/api/figureAnimation";
import { createFigureDocument } from "../../../lib/figureDocument";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import AnimationExportDialog from "./AnimationExportDialog";

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
vi.mock("../../../lib/api/figureAnimation", () => ({ exportFigureAnimation: vi.fn(async () => undefined) }));

const series: Dataset = {
  id: "d1",
  name: "RSM series",
  data: {
    time: [0, 1, 0, 1],
    values: [[1, 10], [2, 10], [3, 20], [4, 20]],
    labels: ["signal", "T"],
    units: ["a.u.", "K"],
    metadata: {},
  },
};
const figure = (groupKey: number | null) =>
  createFigureDocument({ id: "f1", name: "Sweep", datasetId: "d1", view: { ...defaultPlotView(), xKey: null, yKeys: [0] }, groupKey });

beforeEach(() => {
  vi.mocked(exportFigureAnimation).mockClear();
  useApp.setState({ datasets: [series], editableFigures: [figure(1)] });
});

describe("AnimationExportDialog", () => {
  it("previews the By-level frames and exports them with the chosen options", async () => {
    let closed!: () => void;
    const closedPromise = new Promise<void>((resolve) => {
      closed = resolve;
    });
    render(<AnimationExportDialog seedDatasetIds={[]} onClose={closed} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview frames" }));
    expect(await screen.findByRole("status")).toHaveTextContent("2 frames: T = 10 K, T = 20 K");
    fireEvent.click(screen.getByRole("button", { name: "Export animation" }));
    await closedPromise;
    const [frames, options] = vi.mocked(exportFigureAnimation).mock.calls[0];
    expect(frames.map((f) => f.label)).toEqual(["T = 10 K", "T = 20 K"]);
    expect(options).toMatchObject({ format: "gif", frameMs: 500, loop: true, fixedAxes: true });
  });

  it("offers no By frames when no saved figure has a By column", () => {
    useApp.setState({ editableFigures: [figure(null)] });
    render(<AnimationExportDialog seedDatasetIds={[]} onClose={vi.fn()} />);
    expect(screen.getByText(/No saved figure has a By column/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export animation" })).toBeDisabled();
  });
});
