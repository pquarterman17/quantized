// The command-palette route to the Legend dialog (audit 6 lane M): the keyboard
// path to what a legend double-click opens.

import { beforeEach, describe, expect, it } from "vitest";

import { useFigureDialog } from "../store/figureDialogs";
import { useApp } from "../store/useApp";
import { buildPlotCommands } from "./plotCommands";

beforeEach(() => useFigureDialog.setState({ open: null }));

describe("Legend… command", () => {
  it("is in the Plot group and opens the legend dialog", () => {
    const cmd = buildPlotCommands(useApp.getState).find((c) => c.id === "legend-format")!;
    expect(cmd).toMatchObject({ group: "Plot", label: "Legend…" });
    void cmd.run();
    expect(useFigureDialog.getState().open).toEqual({ kind: "legend" });
  });
});
