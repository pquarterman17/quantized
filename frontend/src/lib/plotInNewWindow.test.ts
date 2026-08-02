// Library discoverability ("Plot in new window"): a plain Library click only
// REBINDS the focused window (unless pinned), so there was no direct "plot
// this dataset in a NEW window" gesture and users could only discover
// multiple windows via Graph Builder. This is the regression pin for the
// resulting workflow — "plot the same data in different formats" — proving
// two windows on one dataset are genuinely independent, not aliases.

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../store/useApp";
import { plotInNewWindow } from "./plotInNewWindow";
import type { Dataset } from "./types";

const d1: Dataset = {
  id: "d1",
  name: "MyData",
  data: {
    time: [1, 2, 3],
    values: [[10], [20], [30]],
    labels: ["Y"],
    units: ["V"],
    metadata: {},
  },
};

beforeEach(() => {
  useApp.setState({ datasets: [d1], activeId: "d1" });
});

describe("plotInNewWindow", () => {
  it("two invocations on the same dataset create TWO windows, each bound to it, with independent views", () => {
    const before = useApp.getState().plotWindows.length;
    const id1 = plotInNewWindow("d1");
    const id2 = plotInNewWindow("d1");
    expect(id1).not.toBe(id2);

    const afterCreate = useApp.getState();
    expect(afterCreate.plotWindows).toHaveLength(before + 2);
    expect(afterCreate.plotWindows.find((w) => w.id === id1)?.datasetId).toBe("d1");
    expect(afterCreate.plotWindows.find((w) => w.id === id2)?.datasetId).toBe("d1");
    expect(afterCreate.focusedWindowId).toBe(id2); // the later call holds focus

    // Style the FIRST window (focus it, change its title, then focus back to
    // the second) — the second window's OWN view must be untouched by the
    // first's edit, and the edit must stick on the first's own record.
    useApp.getState().focusWindow(id1);
    useApp.getState().setPlotTitle("Styled A");
    useApp.getState().focusWindow(id2);

    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === id1)?.view.plotTitle).toBe("Styled A");
    expect(s.plotWindows.find((w) => w.id === id2)?.view.plotTitle).toBe(""); // untouched
    expect(s.plotTitle).toBe(""); // the second window's own LIVE title, unaffected
  });

  it("surfaces the Plot tab even when a different tab was showing", () => {
    useApp.setState({ stageTab: "worksheet" });
    plotInNewWindow("d1");
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("records a macro step (sibling to openFigureDocInWindow's own recording)", () => {
    useApp.getState().startMacro();
    plotInNewWindow("d1");
    const step = useApp.getState().macroSteps.at(-1);
    expect(step?.label).toBe('Plot "MyData" in new window');
    expect(step?.code).toBe('qz.plotInNewWindow("d1")');
  });
});
