// Drag-to-axis (#49) drop-zone shim: jsdom has no real native DnD (no
// `DragEvent` constructor at all — https://github.com/jsdom/jsdom/issues/2913
// — so RTL's `fireEvent.dragOver`/`.drop` sugar falls back to a plain `Event`
// and silently drops clientX/clientY, the coordinates our zone math needs).
// `fireDrag` below builds the event by hand (`Object.defineProperty` for the
// coordinates + dataTransfer, same trick RTL itself uses for dataTransfer —
// see node_modules/@testing-library/dom/dist/events.js) and dispatches it
// through RTL's low-level `fireEvent(el, event)`. dragenter/dragleave don't
// need coordinates, so those keep the `fireEvent.dragEnter/.dragLeave` sugar.
// getBoundingClientRect is mocked per PreviewOverlay.test.tsx's precedent
// (jsdom has no layout). This proves the event wiring + geometry call-through
// — it is NOT a substitute for eyeballing the real drag gesture in a browser.

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AxisDropZones from "./AxisDropZones";
import { CHANNEL_DND, encodeChannelDrag } from "../../lib/dragaxis";

/** A minimal dataTransfer stand-in: `types` for the isChannelDrag gate,
 *  `getData` for the drop payload. Good enough for our handlers, which never
 *  touch any other dataTransfer member. */
function channelDataTransfer(datasetId: string, channel: number) {
  const payload = encodeChannelDrag({ datasetId, channel });
  return {
    types: [CHANNEL_DND],
    getData: (type: string) => (type === CHANNEL_DND ? payload : ""),
    setData: () => {},
  };
}

const foreignDataTransfer = {
  types: ["Files"],
  getData: () => "",
  setData: () => {},
};

/** Dispatch a drag-family event WITH working clientX/clientY (see file-header
 *  note on why fireEvent.dragOver/.drop can't carry them in jsdom). */
function fireDrag(
  el: Element,
  type: "dragover" | "drop",
  opts: { clientX: number; clientY: number; dataTransfer: unknown },
) {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "clientX", { value: opts.clientX, configurable: true });
  Object.defineProperty(evt, "clientY", { value: opts.clientY, configurable: true });
  Object.defineProperty(evt, "dataTransfer", { value: opts.dataTransfer, configurable: true });
  fireEvent(el, evt);
}

function setStageRect(el: Element, width: number, height: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => "",
  } as DOMRect);
}

describe("AxisDropZones", () => {
  it("renders children and no band overlay while idle", () => {
    const { container, getByText } = render(
      <AxisDropZones className="qzk-stage" onContextMenu={() => {}} onAxisDrop={() => {}}>
        <span>plot content</span>
      </AxisDropZones>,
    );
    expect(getByText("plot content")).toBeInTheDocument();
    expect(container.querySelector(".qzk-axis-drop-zones")).toBeNull();
  });

  it("shows the band overlay once a channel drag enters, and highlights the hovered zone", () => {
    const { container } = render(
      <AxisDropZones className="qzk-stage" onContextMenu={() => {}} onAxisDrop={() => {}}>
        <span>content</span>
      </AxisDropZones>,
    );
    const stage = container.querySelector(".qzk-stage")!;
    setStageRect(stage, 600, 400);
    const dataTransfer = channelDataTransfer("d1", 0);

    fireEvent.dragEnter(stage, { dataTransfer });
    expect(container.querySelector(".qzk-axis-drop-zones")).not.toBeNull();

    fireDrag(stage, "dragover", { dataTransfer, clientX: 300, clientY: 350 }); // bottom band
    expect(container.querySelector(".qzk-axis-zone.x.active")).not.toBeNull();
    expect(container.querySelector(".qzk-axis-zone.y.active")).toBeNull();
  });

  it("moves the highlight as the cursor crosses into a different band", () => {
    const { container } = render(
      <AxisDropZones className="qzk-stage" onContextMenu={() => {}} onAxisDrop={() => {}}>
        <span>content</span>
      </AxisDropZones>,
    );
    const stage = container.querySelector(".qzk-stage")!;
    setStageRect(stage, 600, 400);
    const dataTransfer = channelDataTransfer("d1", 0);

    fireEvent.dragEnter(stage, { dataTransfer });
    fireDrag(stage, "dragover", { dataTransfer, clientX: 40, clientY: 150 }); // left band
    expect(container.querySelector(".qzk-axis-zone.y.active")).not.toBeNull();

    fireDrag(stage, "dragover", { dataTransfer, clientX: 560, clientY: 150 }); // right band
    expect(container.querySelector(".qzk-axis-zone.y.active")).toBeNull();
    expect(container.querySelector(".qzk-axis-zone.y2.active")).not.toBeNull();
  });

  it("does not react to a non-channel drag (e.g. an OS file drop)", () => {
    const { container } = render(
      <AxisDropZones className="qzk-stage" onContextMenu={() => {}} onAxisDrop={() => {}}>
        <span>content</span>
      </AxisDropZones>,
    );
    const stage = container.querySelector(".qzk-stage")!;
    setStageRect(stage, 600, 400);
    fireEvent.dragEnter(stage, { dataTransfer: foreignDataTransfer });
    expect(container.querySelector(".qzk-axis-drop-zones")).toBeNull();
  });

  it("fires onAxisDrop with the decoded payload and landed zone", () => {
    const onAxisDrop = vi.fn();
    const { container } = render(
      <AxisDropZones className="qzk-stage" onContextMenu={() => {}} onAxisDrop={onAxisDrop}>
        <span>content</span>
      </AxisDropZones>,
    );
    const stage = container.querySelector(".qzk-stage")!;
    setStageRect(stage, 600, 400);
    const dataTransfer = channelDataTransfer("d1", 3);

    fireEvent.dragEnter(stage, { dataTransfer });
    fireDrag(stage, "dragover", { dataTransfer, clientX: 40, clientY: 150 }); // left band
    fireDrag(stage, "drop", { dataTransfer, clientX: 40, clientY: 150 });

    expect(onAxisDrop).toHaveBeenCalledWith("y", "d1", 3);
    // The overlay clears after the drop.
    expect(container.querySelector(".qzk-axis-drop-zones")).toBeNull();
  });

  it("does not call onAxisDrop for a drop in the dead interior (cancel semantics)", () => {
    const onAxisDrop = vi.fn();
    const { container } = render(
      <AxisDropZones className="qzk-stage" onContextMenu={() => {}} onAxisDrop={onAxisDrop}>
        <span>content</span>
      </AxisDropZones>,
    );
    const stage = container.querySelector(".qzk-stage")!;
    setStageRect(stage, 600, 400);
    const dataTransfer = channelDataTransfer("d1", 0);

    fireEvent.dragEnter(stage, { dataTransfer });
    fireDrag(stage, "drop", { dataTransfer, clientX: 300, clientY: 200 }); // interior

    expect(onAxisDrop).not.toHaveBeenCalled();
  });

  it("ignores a malformed/foreign payload on an otherwise-valid channel drop", () => {
    const onAxisDrop = vi.fn();
    const { container } = render(
      <AxisDropZones className="qzk-stage" onContextMenu={() => {}} onAxisDrop={onAxisDrop}>
        <span>content</span>
      </AxisDropZones>,
    );
    const stage = container.querySelector(".qzk-stage")!;
    setStageRect(stage, 600, 400);
    const badTransfer = { types: [CHANNEL_DND], getData: () => "not json", setData: () => {} };

    fireEvent.dragEnter(stage, { dataTransfer: badTransfer });
    fireDrag(stage, "drop", { dataTransfer: badTransfer, clientX: 40, clientY: 150 }); // left band

    expect(onAxisDrop).not.toHaveBeenCalled();
  });

  it("resets the overlay after the drag leaves the whole stage subtree", () => {
    const { container } = render(
      <AxisDropZones className="qzk-stage" onContextMenu={() => {}} onAxisDrop={() => {}}>
        <span>content</span>
      </AxisDropZones>,
    );
    const stage = container.querySelector(".qzk-stage")!;
    setStageRect(stage, 600, 400);
    const dataTransfer = channelDataTransfer("d1", 0);

    fireEvent.dragEnter(stage, { dataTransfer });
    expect(container.querySelector(".qzk-axis-drop-zones")).not.toBeNull();
    fireEvent.dragLeave(stage, { dataTransfer });
    expect(container.querySelector(".qzk-axis-drop-zones")).toBeNull();
  });

  it("forwards onContextMenu (right-click still opens the axes menu)", () => {
    const onContextMenu = vi.fn();
    const { container } = render(
      <AxisDropZones className="qzk-stage" onContextMenu={onContextMenu} onAxisDrop={() => {}}>
        <span>content</span>
      </AxisDropZones>,
    );
    fireEvent.contextMenu(container.querySelector(".qzk-stage")!);
    expect(onContextMenu).toHaveBeenCalled();
  });
});
