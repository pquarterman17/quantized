// Figures audit #18: on the Map tab the Inspector still offered the XY
// series controls (Line / Scatter / Both, markers, line width) — a map draws
// no curves, so they edited nothing visible there.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import Inspector from "./Inspector";

const data: DataStruct = {
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["A"],
  units: [""],
  metadata: {},
};

beforeEach(() => {
  useApp.setState({ datasets: [{ id: "d1", name: "sample", data }], activeId: "d1", folders: [] });
});

describe("Inspector on the Map tab", () => {
  it("shows the series style card on the Plot tab", () => {
    useApp.setState({ stageTab: "plot" });
    render(<Inspector />);
    expect(screen.getByText(/series style/i)).toBeInTheDocument();
  });

  it("hides the XY series style card on the Map tab", () => {
    useApp.setState({ stageTab: "map" });
    render(<Inspector />);
    expect(screen.queryByText(/series style/i)).toBeNull();
  });
});
