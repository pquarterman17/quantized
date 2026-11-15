// Gap audit 3 N1: dragging a dataset — or a whole book — from the Library onto
// a graph's PLOT adds its Y columns as linked curves (one undo step); the
// title bar keeps the rebind drop.

import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { DATASET_DND, WORKBOOK_DND } from "../Library/dnd";
import PlotWindowFrame from "./PlotWindowFrame";

const sheet = (id: string, workbookId?: string): Dataset => ({
  id,
  name: `S${id}`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["Y"], units: ["V"], metadata: {} },
  ...(workbookId ? { workbookId } : {}),
});

const win: PlotWindow = {
  id: "w1", kind: "plot", title: "", datasetId: "a", geometry: { x: 0, y: 0, w: 400, h: 300 }, z: 0,
  winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
};

function drop(el: Element, type: string, id: string, kind: "dragover" | "drop" = "drop") {
  const evt = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", {
    value: { types: [type], getData: (t: string) => (t === type ? id : ""), setData: () => {} },
  });
  fireEvent(el, evt);
}

const graph = () => useApp.getState().datasets.find((d) => d.linkedCurves);

beforeEach(() => {
  useApp.setState({
    ...defaultPlotView(),
    datasets: [sheet("a"), sheet("b", "wb"), sheet("c", "wb")],
    activeId: "a", plotWindows: [win], focusedWindowId: "w1", history: [], future: [],
  });
});

function frame() {
  const { container } = render(
    <PlotWindowFrame win={win} focused datasetName="Sa">
      <div className="plot">plot</div>
    </PlotWindowFrame>,
  );
  return container;
}

describe("drop a dataset or book onto a graph (N1)", () => {
  it("a dataset dropped on the plot joins the graph as a linked curve", async () => {
    const c = frame();
    const body = c.querySelector(".plot")!;
    drop(body, DATASET_DND, "b", "dragover");
    expect(c.querySelector(".qzk-plotwin")).toHaveClass("dropping-add");
    drop(body, DATASET_DND, "b");
    await waitFor(() => expect(graph()?.linkedCurves?.map((k) => k.datasetId)).toEqual(["a", "b"]));
    expect(useApp.getState().plotWindows[0].datasetId).toBe(graph()!.id); // the window shows the live graph
    useApp.getState().undo();
    expect(graph()).toBeUndefined();
    expect(useApp.getState().plotWindows[0].datasetId).toBe("a");
  });

  it("a book dropped on the plot adds every sheet in it", async () => {
    drop(frame().querySelector(".plot")!, WORKBOOK_DND, "wb");
    await waitFor(() => expect(graph()?.linkedCurves?.map((k) => k.datasetId)).toEqual(["a", "b", "c"]));
  });

  it("the title bar still rebinds", () => {
    drop(frame().querySelector(".qzk-plotwin-titlebar")!, DATASET_DND, "b");
    expect(useApp.getState().plotWindows[0].datasetId).toBe("b");
    expect(graph()).toBeUndefined();
  });
});
