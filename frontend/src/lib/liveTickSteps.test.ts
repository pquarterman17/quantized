// Screen == export tick positions (figures integration). The canvas' drawn
// increment rides the export request as x_step / y_step / y2_step; the
// backend half (`tests/test_export_live_tick_steps.py`) reads the same
// `tests/fixtures/wire/live_tick_steps.json` and marks the same ticks.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FigureSpec } from "./api/figures";
import { buildStageFigureSpec } from "./figureSpecStage";
import { drawnIncrement, publishLiveTickSteps, withLiveTickSteps } from "./liveTickSteps";
import { useApp } from "../store/useApp";

const FIXTURE = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/wire/live_tick_steps.json"), "utf8"),
) as { drawn_splits: number[]; x_step: number; ticks: number[] };

const spec = (over: Partial<FigureSpec> = {}): FigureSpec =>
  ({ dataset: { time: [0], values: [[0]], labels: ["y"], units: [""], metadata: {} }, y_keys: [0], x_scale: "linear", y_scale: "linear", ...over }) as FigureSpec;

afterEach(() => publishLiveTickSteps(null));

describe("live tick steps (screen == export ticks)", () => {
  it("reads the drawn increment off the canvas' splits, a broken axis' too", () => {
    expect(drawnIncrement(FIXTURE.drawn_splits)).toBe(FIXTURE.x_step);
    expect(drawnIncrement([0, 2, 4, 996, 998])).toBe(2);
    expect(drawnIncrement([5])).toBeUndefined();
  });

  it("an automatic increment becomes the canvas' one, for the dataset it drew", () => {
    publishLiveTickSteps({ datasetId: "d", x: FIXTURE.x_step, y: 0.5 });
    expect(withLiveTickSteps(spec(), "d")).toMatchObject({ x_step: FIXTURE.x_step, y_step: 0.5 });
    expect(withLiveTickSteps(spec(), "other")).toEqual(spec()); // a refocus race carries nothing
  });

  it("leaves a typed increment, a log axis, a date axis and paneled layouts alone", () => {
    publishLiveTickSteps({ datasetId: "d", x: 2, y: 0.5 });
    expect(withLiveTickSteps(spec({ x_step: 3 }), "d").x_step).toBe(3);
    expect(withLiveTickSteps(spec({ y_scale: "log" }), "d").y_step).toBeUndefined();
    expect(withLiveTickSteps(spec({ x_fmt: { mode: "date", digits: 0 } }), "d").x_step).toBeUndefined();
    expect(withLiveTickSteps(spec({ overrides: { x_breaks: [[1, 2]] } }), "d")).toMatchObject({ x_scale: "linear" });
    expect(withLiveTickSteps(spec({ overrides: { x_breaks: [[1, 2]] } }), "d").x_step).toBeUndefined();
  });

  it("is applied by the Stage export's spec builder", () => {
    useApp.setState({ plotWindows: [], focusedWindowId: null, yKeys: null, xKey: null, xStep: null, yStep: null });
    const ds = { id: "d1", name: "a.csv", data: { time: [2, 21.5], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} } };
    publishLiveTickSteps({ datasetId: "d1", x: FIXTURE.x_step });
    const st = useApp.getState;
    const built = buildStageFigureSpec(vi.fn(() => ({ ...st(), datasets: [ds], activeId: "d1" })) as unknown as typeof st, ds, "a", {
      fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "",
    });
    expect(built.x_step).toBe(FIXTURE.x_step);
  });
});
