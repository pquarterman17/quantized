// A plot-readouts chunk that will not load is reported once (status line and
// a danger toast); the plot stays up and nothing reaches an error boundary.
import { render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import PlotStageOverlays from "./PlotStageOverlays";
import type { PlotStageActions } from "./usePlotStageActions";
import type { GadgetChipState } from "./useGadgetChip";
import { useToasts } from "../../store/toasts";
import { useApp } from "../../store/useApp";

vi.mock("uplot", () => ({
  default: class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  },
}));
vi.mock("./PlotReadouts", () => {
  throw new Error("chunk fetch failed");
});

const actions = {
  resetView: vi.fn(),
  smartScale: vi.fn(),
  savePng: vi.fn(),
  copyData: vi.fn(),
  copyFigure: vi.fn(),
  snapshot: vi.fn(),
} as PlotStageActions;
const gadget = { mode: "fit", roi: null, cursors: null, busy: false, error: null } as unknown as GadgetChipState;

const overlays = () => (
  <PlotStageOverlays
    displayPayload={null}
    active={null}
    tool="pointer"
    insetMode={false}
    showLegend={false}
    styleList={undefined}
    seriesCycle={{ positions: [], count: 0 } as never}
    plotted={[]}
    hidden={undefined}
    colorByColumns={new Map()}
    isDarkBg={false}
    inkColor="#000"
    defaultTrace="Line"
    actions={actions}
    readout={null}
    measurement={null}
    stats={null}
    integral={null}
    fwhm={null}
    onClearIntegral={vi.fn()}
    onClearFwhm={vi.fn()}
    gadget={gadget}
  />
);

let errorSpy: MockInstance;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  useToasts.setState({ toasts: [] });
  useApp.setState({ status: "" });
});
afterEach(() => errorSpy.mockRestore());

it("reports a readouts chunk that will not load once, in the status line and a danger toast", async () => {
  const view = render(overlays());
  const danger = () => useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg);
  await vi.waitFor(() => expect(danger()).toEqual(["Could not load the plot readouts. Reload to try again."]));
  expect(useApp.getState().status).toBe("Could not load the plot readouts. Reload to try again.");
  view.rerender(overlays()); // a re-render must not report again
  await new Promise((r) => setTimeout(r, 20));
  expect(danger()).toHaveLength(1);
  expect(errorSpy).not.toHaveBeenCalled();
});
