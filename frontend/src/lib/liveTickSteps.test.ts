// The canvas' drawn increments ride an export request as HINTS
// (x_step_hint / y_step_hint / y2_step_hint), never as typed steps, and the
// shared spec builder adds them, so Export and Publication preview send one
// request. The backend's acceptance rule is pinned by
// `tests/fixtures/wire/tick_hint.json` (tickHintFixture.test.ts and
// tests/test_tick_hint_fixture.py).

import { afterEach, describe, expect, it, vi } from "vitest";

import type { FigureSpec } from "./api/figures";
import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { buildStageFigureSpec } from "./figureSpecStage";
import { drawnIncrement, publishLiveTickSteps } from "./liveTickSteps";
import { withLiveTickHints } from "./liveTickStepsSpec";
import { defaultPlotView } from "./plotview";
import { useApp } from "../store/useApp";

const spec = (over: Partial<FigureSpec> = {}): FigureSpec =>
  ({ dataset: { time: [0], values: [[0]], labels: ["y"], units: [""], metadata: {} }, y_keys: [0], x_scale: "linear", y_scale: "linear", ...over }) as FigureSpec;

afterEach(() => publishLiveTickSteps(null));

describe("live tick hints", () => {
  it("reads the drawn increment off the canvas' splits, a broken axis' too", () => {
    expect(drawnIncrement([2, 4, 6, 8])).toBe(2);
    expect(drawnIncrement([0, 2, 4, 996, 998])).toBe(2);
    expect(drawnIncrement([5])).toBeUndefined();
  });

  it("an automatic increment gets the canvas' one as a hint, for the dataset it drew", () => {
    publishLiveTickSteps({ datasetId: "d", x: 2, y: 0.5 });
    const out = withLiveTickHints(spec(), "d");
    expect(out).toMatchObject({ x_step_hint: 2, y_step_hint: 0.5 });
    expect(out.x_step ?? null).toBeNull(); // never a typed step
    expect(withLiveTickHints(spec(), "other")).toEqual(spec()); // a refocus race carries nothing
    expect(withLiveTickHints(spec(), null)).toEqual(spec()); // a frozen document
  });

  it("leaves a typed increment, a log axis, a date axis and paneled layouts alone", () => {
    publishLiveTickSteps({ datasetId: "d", x: 2, y: 0.5 });
    expect(withLiveTickHints(spec({ x_step: 3 }), "d").x_step_hint).toBeUndefined();
    expect(withLiveTickHints(spec({ y_scale: "log" }), "d").y_step_hint).toBeUndefined();
    expect(withLiveTickHints(spec({ x_fmt: { mode: "date", digits: 0 } }), "d").x_step_hint).toBeUndefined();
    expect(withLiveTickHints(spec({ overrides: { x_breaks: [[1, 2]] } }), "d").x_step_hint).toBeUndefined();
  });

  it("Export figure and Publication preview send the same hints", () => {
    const ds = { id: "d1", name: "a.csv", data: { time: [2, 21.5], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} } };
    const view = { ...defaultPlotView(), yKeys: [0] };
    const document = createFigureDocument({ id: "w1", name: "A", datasetId: "d1", view });
    useApp.setState({ plotWindows: [], focusedWindowId: null, yKeys: null, xKey: null, xStep: null, yStep: null });
    publishLiveTickSteps({ datasetId: "d1", x: 2, y: 0.25 });
    const st = useApp.getState;
    const state = vi.fn(() => ({ ...st(), datasets: [ds], activeId: "d1", focusedWindowId: "w1", windowsForSave: () => [{ id: "w1", kind: "plot", datasetId: "d1", view, document }] }));
    const exported = buildStageFigureSpec(state as unknown as typeof st, ds, "a", { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" });
    const preview = buildFigureSpecFromDocument(document, ds, "a", { fmt: "svg" });
    const hints = (s: FigureSpec) => [s.x_step ?? null, s.y_step ?? null, s.x_step_hint, s.y_step_hint];
    expect(hints(exported)).toEqual([null, null, 2, 0.25]);
    expect(hints(preview)).toEqual(hints(exported));
  });
});
