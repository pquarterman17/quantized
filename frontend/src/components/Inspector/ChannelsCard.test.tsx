// Drag-to-axis (#49): a Channels card row is a draggable channel chip that
// encodes a CHANNEL_DND payload other drop targets (AxisDropZones) decode.
// The click-driven axis assignment (Select/checkbox/Y2 pill) is exercised
// elsewhere; this file covers only the new drag affordance.

import { fireEvent, render } from "@testing-library/react";
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
