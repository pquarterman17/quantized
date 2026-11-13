// Live check (figures integration): the figure dialogs confirmed with the
// generic "Run" -- Export figure, Page setup, Facet by column, Break x-axis.
// Each now says what its button does.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/overlays/ParamDialog", () => ({ askParams: vi.fn() }));
const { askParams } = await import("../components/overlays/ParamDialog");
const { useApp } = await import("../store/useApp");
const { runPageSetupDialog } = await import("../lib/pageSetupCommand");
const { runBreakXAxis, runFacetByColumn } = await import("./plotLayoutCommands");

beforeEach(() => {
  vi.mocked(askParams).mockReset();
  vi.mocked(askParams).mockResolvedValue(null);
  useApp.setState({
    datasets: [{ id: "d", name: "d.csv", data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: {} } }],
    activeId: "d",
  });
});

describe("figure dialogs name their confirm button", () => {
  it.each([
    ["Page setup", runPageSetupDialog, "Apply"],
    ["Facet by column", runFacetByColumn, "Facet"],
    ["Break x-axis at gaps", runBreakXAxis, "Break"],
  ] as const)("%s confirms with %s", async (_title, run, label) => {
    await run(useApp.getState);
    expect(vi.mocked(askParams).mock.calls[0][2]).toEqual({ confirmLabel: label });
  });
});
