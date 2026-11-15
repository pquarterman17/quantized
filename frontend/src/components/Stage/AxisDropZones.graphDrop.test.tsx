// Gap audit 3 N1 (live check): the default layout is ONE maximized window
// whose stage has no frame, so the drop-onto-graph gesture must work on the
// stage itself: a Library dataset dropped on the plot joins the graph as a
// linked curve, with a visible "Add as curves" hint while dragging.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { DATASET_DND } from "../Library/dnd";
import AxisDropZones from "./AxisDropZones";

const sheet = (id: string): Dataset => ({
  id, name: `S${id}`, data: { time: [0, 1], values: [[1], [2]], labels: ["Y"], units: [""], metadata: {} },
});

function drag(el: Element, kind: "dragenter" | "dragover" | "drop", id: string) {
  const evt = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", {
    value: { types: [DATASET_DND], getData: (t: string) => (t === DATASET_DND ? id : ""), setData: () => {} },
  });
  fireEvent(el, evt);
}

beforeEach(() => {
  useApp.setState({ ...defaultPlotView(), datasets: [sheet("a"), sheet("b")], activeId: "a", plotWindows: [], focusedWindowId: null, history: [], future: [] });
});

describe("drop a dataset onto the focused graph's stage (N1)", () => {
  it("shows the add hint, then adds the dataset as a linked curve", async () => {
    render(
      <AxisDropZones className="qzk-stage" onContextMenu={vi.fn()} onAxisDrop={vi.fn()}>
        <div>plot</div>
      </AxisDropZones>,
    );
    const plot = screen.getByText("plot");
    drag(plot, "dragenter", "b");
    drag(plot, "dragover", "b");
    expect(screen.getByText("+ Add as curves")).toBeInTheDocument();
    drag(plot, "drop", "b");
    expect(screen.queryByText("+ Add as curves")).toBeNull();
    await waitFor(() =>
      expect(useApp.getState().datasets.find((d) => d.linkedCurves)?.linkedCurves?.map((c) => c.datasetId)).toEqual(["a", "b"]),
    );
  });
});
