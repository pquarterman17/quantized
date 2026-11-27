// A G15 plot (parallel coordinates, hexbin, KDE, Pareto, Bland-Altman) is rendered server-side from the whole sheet and
// cannot honour the plot's row window, so its chip says "this plot kind draws every row" rather than claim a row set.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import Plots2Stage from "./Plots2Stage";

vi.mock("./usePlots2", () => ({
  usePlots2: () => ({ hasData: true, columns: [], picks: {}, setPick: () => {}, title: "", setTitle: () => {}, fmt: "png", setFmt: () => {}, exportNow: async () => {}, notice: null, problem: null, preview: null }),
}));
vi.mock("./useAuxFigureMenu", () => ({ useAuxFigureMenu: () => ({ onContextMenu: () => {}, node: null }) }));
vi.mock("./Plots2Controls", () => ({ default: () => null }));
vi.mock("../ternary/AuxFigureFrame", () => ({ default: () => null }));

const ds: Dataset = { id: "d", name: "d", data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: {} } };

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [ds], activeId: "d", rowRange: { from: 0, to: 0 } });
});

describe("Plots2 stage", () => {
  it("shows the window chip with the draws-every-row note", () => {
    render(<Plots2Stage kind="hexbin" />);
    expect(screen.getByRole("status").textContent).toContain("row 1 · this plot kind draws every row");
  });

  it("shows no chip without a window", () => {
    useApp.setState({ rowRange: undefined });
    render(<Plots2Stage kind="hexbin" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
