// The Stage side of Origin-style multiple Y axes (gap audit 4 G11): the
// payload's series are re-tagged onto their extra axes, and a view that
// cannot draw them -- or a series on an axis that no longer exists -- says
// so on the status line instead of silently drawing on Y1.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { newExtraYAxis } from "../../lib/multiY";
import type { PlotPayload } from "../../lib/plotdata";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { multiYBlocked } from "../../lib/multiY";
import { loading, useMultiY, useStageMultiY } from "./useMultiY";

const payload = { data: [[0, 1], [1, 2], [3, 4], [5, 6]], series: [{ label: "A", unit: "" }, { label: "B", unit: "" }, { label: "C", unit: "" }], xLabel: "x", xUnit: "" } as unknown as PlotPayload;
const ds: Dataset = { id: "d", name: "d", data: { time: [0, 1], values: [[1, 3, 5], [2, 4, 6]], labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} } };
const view = {
  yAxes: [newExtraYAxis()], yAxisOf: { 2: 3 }, yScale: "linear" as const, yFmt: { mode: "auto" as const, digits: 2 },
  groupKey: null, y2Keys: null, active: ds, multiPanel: false,
};
const panel = { ...view, multiPanel: true };

/** Render, then let the on-demand derivation chunk land. */
async function settle<T>(hook: () => T) {
  const r = renderHook(hook);
  await act(async () => { await loading; });
  r.rerender();
  return r;
}

beforeEach(() => {
  useApp.setState({ status: "", yAxes: [], yAxisOf: {}, groupKey: null, y2Keys: null });
});

describe("useMultiY", () => {
  it("re-tags the extra-axis series and hands the resolved axes to the viewport", async () => {
    const { result } = await settle(() => useMultiY(payload, [0, 1, 2], view, true));
    expect(result.current.payload?.series.map((s) => s.axis)).toEqual([undefined, undefined, 2]);
    expect(result.current.axes.map((a) => a.n)).toEqual([3]);
  });

  it("an orphan draws on Y1 and the status line says so", async () => {
    const orphan = { ...view, yAxes: [], yAxisOf: { 2: 4 } };
    const { result } = await settle(() => useMultiY(payload, [0, 1, 2], orphan, true));
    expect(result.current.payload).toBe(payload);
    expect(useApp.getState().status).toBe("C: assigned to a Y axis that no longer exists — drawn on Y1");
  });

  it("a blocking view draws Y1 / Y2 only, says so, and a background window stays quiet", async () => {
    const { result } = await settle(() => useMultiY(payload, [0, 1, 2], panel, false));
    expect(result.current.axes).toEqual([]);
    expect(useApp.getState().status).toBe("");
    await settle(() => useMultiY(payload, [0, 1, 2], panel, true));
    expect(useApp.getState().status).toMatch(/not drawn in a multi-panel view/);
  });

  it("names the gates the export applies too", () => {
    expect(multiYBlocked(true, true, true)).toBe("a multi-panel view");
    expect(multiYBlocked(false, true, false)).toBe("a group split");
    expect(multiYBlocked(false, false, true)).toBe("a colour/symbol encoding");
    expect(multiYBlocked(false, false, false)).toBeNull();
  });

  it("the focused window reads its Y3+ model from the store, and a group split blocks", async () => {
    useApp.setState({ yAxes: [newExtraYAxis()], yAxisOf: { 2: 3 } });
    const base = { yScale: "linear" as const, yFmt: { mode: "auto" as const, digits: 2 }, groupKey: 0, y2Keys: null, active: ds, multiPanel: false, picks: null };
    const { result } = await settle(() => useStageMultiY(payload, [0, 1, 2], base));
    expect(result.current.axes).toEqual([]);
    expect(useApp.getState().status).toMatch(/group split/);
  });
});
