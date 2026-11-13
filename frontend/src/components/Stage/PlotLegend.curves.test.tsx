// Re-audit #12: the interactive legend listed every hidden column, greyed
// and struck through -- error, Label and Disregard columns included (6 of 7
// rows on the Origin-ASCII specimen). Origin's legend lists the curves the
// graph draws. A hidden NON-curve column is now left out; a curve the user
// hid stays listed (struck), so the legend can show it again.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import PlotLegend from "./PlotLegend";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [[1, 0.1, 5, 7], [2, 0.1, 6, 8], [3, 0.1, 7, 9]],
  labels: ["Signal", "Noise", "Ref", "Junk"],
  units: ["", "", "", ""],
  metadata: {},
};
const series: PlotSeriesSpec[] = DATA.labels.map((label) => ({ label, unit: "" }));

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d", name: "d.csv", data: DATA, columnDesignations: { 3: "Disregard" } } as never],
    activeId: "d",
    errKeys: { 0: 1 }, // "Noise" is bound as Signal's error bars
    hiddenChannels: [1, 2, 3],
    seriesLabels: {},
    legendStatic: false,
    legendTitle: null,
    legendPos: "ne",
    plotTool: "pointer",
  });
});

describe("PlotLegend lists curves only (re-audit #12)", () => {
  it("leaves out a hidden error or Disregard column, keeps a hidden curve struck", () => {
    const { container } = render(
      <PlotLegend series={series} plotted={[0, 1, 2, 3]} hidden={[false, true, true, true]} />,
    );
    const rows = [...container.querySelectorAll(".qzk-legend .it")].map((r) => r.textContent ?? "");
    expect(rows.some((t) => t.includes("Signal"))).toBe(true);
    expect(rows.some((t) => t.includes("Ref"))).toBe(true); // a curve the user hid: still listed
    expect(rows.some((t) => t.includes("Noise"))).toBe(false); // the error column
    expect(rows.some((t) => t.includes("Junk"))).toBe(false); // Disregard
  });

  it("an error column the user chose to show is listed like any curve", () => {
    useApp.setState({ hiddenChannels: [] });
    const { container } = render(
      <PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />,
    );
    expect(container.querySelector(".qzk-legend")).toHaveTextContent("Noise");
  });
});
