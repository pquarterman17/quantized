// ZoneWell drop-zone tests. jsdom has no `DragEvent` constructor and RTL's
// fireEvent.drop sugar silently drops the dataTransfer, so we hand-build the
// event (Object.defineProperty for dataTransfer) and dispatch it through RTL's
// low-level fireEvent(el, event) — the AxisDropZones.test.tsx pattern. ZoneWell
// needs no coordinates (unlike the axis bands), only dataTransfer.types +
// getData. This proves the event wiring; the real drag gesture is eyeballed.

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ZoneWell from "./ZoneWell";
import { CHANNEL_DND, encodeChannelDrag } from "../../../lib/dragaxis";

function channelDataTransfer(datasetId: string, channel: number) {
  const payload = encodeChannelDrag({ datasetId, channel });
  return {
    types: [CHANNEL_DND],
    getData: (type: string) => (type === CHANNEL_DND ? payload : ""),
    setData: () => {},
  };
}

const foreignDataTransfer = { types: ["Files"], getData: () => "", setData: () => {} };

function fireDrag(el: Element, type: "dragover" | "drop" | "dragleave", dataTransfer: unknown) {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dataTransfer, configurable: true });
  fireEvent(el, evt);
}

const OPTIONS = [
  { index: 0, label: "x" },
  { index: 1, label: "y" },
];

describe("ZoneWell", () => {
  it("renders the title, hint and an empty placeholder", () => {
    const { getByText } = render(
      <ZoneWell title="X" hint="pick one" datasetId="d1" options={OPTIONS} assigned={[]} onAssign={() => {}} onRemove={() => {}} />,
    );
    expect(getByText("X")).toBeInTheDocument();
    expect(getByText("pick one")).toBeInTheDocument();
    expect(getByText("drop a channel")).toBeInTheDocument();
  });

  it("highlights while a channel drag is over and assigns on drop", () => {
    const onAssign = vi.fn();
    const { container } = render(
      <ZoneWell title="X" datasetId="d1" options={OPTIONS} assigned={[]} onAssign={onAssign} onRemove={() => {}} />,
    );
    const well = container.querySelector(".qzk-zone-well")!;
    const dt = channelDataTransfer("d1", 1);

    fireDrag(well, "dragover", dt);
    expect(well.classList.contains("over")).toBe(true);

    fireDrag(well, "drop", dt);
    expect(onAssign).toHaveBeenCalledWith(1);
    expect(well.classList.contains("over")).toBe(false);
  });

  it("ignores a drop from a different dataset (v1 single-dataset)", () => {
    const onAssign = vi.fn();
    const { container } = render(
      <ZoneWell title="X" datasetId="d1" options={OPTIONS} assigned={[]} onAssign={onAssign} onRemove={() => {}} />,
    );
    fireDrag(container.querySelector(".qzk-zone-well")!, "drop", channelDataTransfer("OTHER", 1));
    expect(onAssign).not.toHaveBeenCalled();
  });

  it("calls onReject('dataset') for a foreign-dataset drop, when provided", () => {
    const onAssign = vi.fn();
    const onReject = vi.fn();
    const { container } = render(
      <ZoneWell
        title="X"
        datasetId="d1"
        options={OPTIONS}
        assigned={[]}
        onAssign={onAssign}
        onRemove={() => {}}
        onReject={onReject}
      />,
    );
    fireDrag(container.querySelector(".qzk-zone-well")!, "drop", channelDataTransfer("OTHER", 1));
    expect(onAssign).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith("dataset");
  });

  it("does not react to a non-channel (OS file) drag", () => {
    const onAssign = vi.fn();
    const { container } = render(
      <ZoneWell title="X" datasetId="d1" options={OPTIONS} assigned={[]} onAssign={onAssign} onRemove={() => {}} />,
    );
    const well = container.querySelector(".qzk-zone-well")!;
    fireDrag(well, "dragover", foreignDataTransfer);
    expect(well.classList.contains("over")).toBe(false);
    fireDrag(well, "drop", foreignDataTransfer);
    expect(onAssign).not.toHaveBeenCalled();
  });

  it("assigns via the click-to-assign Select (keyboard/AT fallback)", () => {
    const onAssign = vi.fn();
    const { getByLabelText } = render(
      <ZoneWell title="X" datasetId="d1" options={OPTIONS} assigned={[]} onAssign={onAssign} onRemove={() => {}} />,
    );
    fireEvent.change(getByLabelText("Assign a channel to X"), { target: { value: "1" } });
    expect(onAssign).toHaveBeenCalledWith(1);
  });

  it("removes an assigned chip", () => {
    const onRemove = vi.fn();
    const { getByLabelText } = render(
      <ZoneWell
        title="Y"
        multiple
        datasetId="d1"
        options={OPTIONS}
        assigned={[{ channel: 1, label: "y" }]}
        onAssign={() => {}}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(getByLabelText("Remove y"));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("offers ordered, accessible one-slot moves for a multi-value well", () => {
    const onMove = vi.fn();
    const { getByLabelText, getByText } = render(
      <ZoneWell
        title="Y"
        multiple
        datasetId="d1"
        options={OPTIONS}
        assigned={[{ channel: 0, label: "x" }, { channel: 1, label: "y" }]}
        onAssign={() => {}}
        onRemove={() => {}}
        onMove={onMove}
      />,
    );
    expect(getByText("1")).toBeInTheDocument();
    expect(getByText("2")).toBeInTheDocument();
    expect(getByLabelText("Move x earlier")).toBeDisabled();
    expect(getByLabelText("Move y later")).toBeDisabled();
    fireEvent.click(getByLabelText("Move y earlier"));
    expect(onMove).toHaveBeenCalledWith(1, -1);
  });
});
