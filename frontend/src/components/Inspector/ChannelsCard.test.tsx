// Drag-to-axis (#49): a Channels card row is a draggable channel chip that
// encodes a CHANNEL_DND payload other drop targets (AxisDropZones) decode.
// The click-driven axis assignment (Select/checkbox/Y2 pill) is exercised
// elsewhere; this file covers only the new drag affordance.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChannelsCard from "./ChannelsCard";
import { CHANNEL_DND, decodeChannelDrag } from "../../lib/dragaxis";
import type { Dataset, DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [
    [1, 10],
    [2, 20],
    [3, 30],
  ],
  labels: ["Field", "Moment"],
  units: ["Oe", "emu"],
  metadata: {},
};

const dataset: Dataset = { id: "d1", name: "run", data: DATA };

beforeEach(() => {
  useApp.setState({
    xKey: null,
    yKeys: null,
    y2Keys: null,
    errKeys: {},
    waterfall: 0,
  });
});

describe("ChannelsCard drag-to-axis (#49)", () => {
  it("makes a channel row draggable and encodes its CHANNEL_DND payload", () => {
    const { container } = render(<ChannelsCard active={dataset} />);
    const label = container.querySelector(".qz-check")!;
    expect(label).toHaveAttribute("draggable", "true");

    const setData = vi.fn();
    fireEvent.dragStart(label, { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledTimes(1);
    const [type, raw] = setData.mock.calls[0] as [string, string];
    expect(type).toBe(CHANNEL_DND);
    // xKey=null (auto, the dataset's own time column) — both channels render
    // as rows; the first is channel 0 ("Field").
    expect(decodeChannelDrag(raw)).toEqual({ datasetId: "d1", channel: 0 });
  });

  it("skips the current X channel (no chip renders for it, matching the checkbox list)", () => {
    useApp.setState({ xKey: 0 });
    const { container } = render(<ChannelsCard active={dataset} />);
    const labels = Array.from(container.querySelectorAll(".qz-check")).map((el) => el.textContent);
    expect(labels.join(" ")).not.toContain("Field");
    expect(labels.join(" ")).toContain("Moment");
  });
});

describe("ChannelsCard legend-label source (MAIN #33)", () => {
  const withRows = (): Dataset => ({
    id: "d1",
    name: "multi.csv",
    data: {
      time: [1, 2],
      values: [
        [1, 2, 3],
        [4, 5, 6],
      ],
      labels: ["10 Oe", "50 Oe", "100 Oe"],
      units: ["", "", ""],
      metadata: {
        label_rows: [
          { index: 0, role: "label", x: "Temp", cells: ["M1", "M2", "M3"] },
          { index: 2, role: "label", x: "", cells: ["NbAu-1", "", "NbAu-3"] },
          { index: 3, role: "header", x: "", cells: ["10 Oe", "50 Oe", "100 Oe"] },
        ],
      },
    },
  });

  function sourceSelect(): HTMLSelectElement {
    const row = screen.getByText("Legend from").closest("div");
    return row?.querySelector("select") as HTMLSelectElement;
  }

  it("is hidden for a dataset with no alternative header rows", () => {
    const plain: Dataset = {
      id: "d1",
      name: "plain.csv",
      data: {
        time: [1],
        values: [[1, 2]],
        labels: ["A", "B"],
        units: ["", ""],
        metadata: {},
      },
    };
    useApp.setState({ datasets: [plain], activeId: "d1" });
    render(<ChannelsCard active={plain} />);
    expect(screen.queryByText("Legend from")).not.toBeInTheDocument();
  });

  it("offers each preserved row, previewing its own content", () => {
    const ds = withRows();
    useApp.setState({ datasets: [ds], activeId: "d1", seriesLabels: {} });
    render(<ChannelsCard active={ds} />);
    expect(screen.getByRole("option", { name: "M1, M2, M3" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /NbAu-1, NbAu-3/ })).toBeInTheDocument();
  });

  it("applies a chosen row as the legend labels", () => {
    const ds = withRows();
    useApp.setState({ datasets: [ds], activeId: "d1", seriesLabels: {} });
    render(<ChannelsCard active={ds} />);
    fireEvent.change(sourceSelect(), { target: { value: "0" } });
    expect(useApp.getState().seriesLabels).toEqual({ 0: "M1", 1: "M2", 2: "M3" });
  });

  it("leaves a channel alone when its cell is blank", () => {
    // A sparse descriptive row must not blank a real parser-derived label.
    const ds = withRows();
    useApp.setState({ datasets: [ds], activeId: "d1", seriesLabels: {} });
    render(<ChannelsCard active={ds} />);
    fireEvent.change(sourceSelect(), { target: { value: "2" } });
    expect(useApp.getState().seriesLabels).toEqual({ 0: "NbAu-1", 2: "NbAu-3" });
  });
});
