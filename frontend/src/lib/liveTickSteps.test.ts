// The canvas' drawn increments ride an export request as HINTS
// (x_step_hint / y_step_hint / y2_step_hint), never as typed steps, and only
// on the exports of the focused window's own view: Stage Export / Copy figure
// and the Publication preview of that window (review N1). The backend's
// acceptance rule is pinned by `tests/fixtures/wire/tick_hint.json`
// (tickHintFixture.test.ts and tests/test_tick_hint_fixture.py).

import { afterEach, describe, expect, it, vi } from "vitest";

import type { FigureSpec } from "./api/figures";
import { batchFigureSpecs } from "./batchFigureExport";
import { createFigureDocument, type FigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { buildStageFigureSpec } from "./figureSpecStage";
import { drawnIncrement, publishLiveTickSteps } from "./liveTickSteps";
import { readLiveTickSteps, withLiveTickHints } from "./liveTickStepsSpec";
import { defaultPlotView } from "./plotview";
import { sessionTickHints } from "../components/workshops/figurebuilder/canonicalSession";
import { useApp } from "../store/useApp";

const spec = (over: Partial<FigureSpec> = {}): FigureSpec =>
  ({ dataset: { time: [0], values: [[0]], labels: ["y"], units: [""], metadata: {} }, y_keys: [0], x_scale: "linear", y_scale: "linear", ...over }) as FigureSpec;
const DRAWN = { windowId: "w1", x: 2, y: 0.5, y2: 10 };
const hints = (s: FigureSpec) => [s.x_step ?? null, s.y_step ?? null, s.x_step_hint ?? null, s.y_step_hint ?? null];

afterEach(() => publishLiveTickSteps(null));

describe("live tick hints", () => {
  it("reads the drawn increment off the canvas' splits, a broken axis' too", () => {
    expect(drawnIncrement([2, 4, 6, 8])).toBe(2);
    expect(drawnIncrement([0, 2, 4, 996, 998])).toBe(2);
    expect(drawnIncrement([5])).toBeUndefined();
  });

  it("are keyed by the window that drew them", () => {
    publishLiveTickSteps(DRAWN);
    expect(readLiveTickSteps("w1")).toBe(DRAWN);
    expect(readLiveTickSteps("w2")).toBeNull();
    expect(readLiveTickSteps(null)).toBeNull();
  });

  it("an automatic increment becomes a hint, never a typed step", () => {
    const out = withLiveTickHints(spec(), DRAWN);
    expect(hints(out)).toEqual([null, null, 2, 0.5]);
    expect(withLiveTickHints(spec(), null)).toEqual(spec());
  });

  it("leaves typed, log, date, category, Y2-less and paneled axes alone (review N7)", () => {
    const none = (s: FigureSpec) => [s.x_step_hint, s.y_step_hint, s.y2_step_hint].filter((v) => v !== undefined);
    expect(withLiveTickHints(spec({ x_step: 3 }), DRAWN).x_step_hint).toBeUndefined();
    expect(withLiveTickHints(spec({ y_scale: "log" }), DRAWN).y_step_hint).toBeUndefined();
    expect(withLiveTickHints(spec({ x_fmt: { mode: "date", digits: 0 } }), DRAWN).x_step_hint).toBeUndefined();
    const cat = spec({ x_key: 0, dataset: { time: [0], values: [[0]], labels: ["c"], units: [""], metadata: {}, cat_levels: { 0: ["a"] } } as FigureSpec["dataset"] });
    expect(withLiveTickHints(cat, DRAWN).x_step_hint).toBeUndefined();
    expect(withLiveTickHints(spec(), DRAWN).y2_step_hint).toBeUndefined(); // no y2_keys
    expect(withLiveTickHints(spec({ y2_keys: [0] }), DRAWN).y2_step_hint).toBe(10);
    for (const over of [
      { overrides: { x_breaks: [[1, 2]] } },
      { facets: [{}] },
      { polar: {} },
      { encoding: {} },
    ] as Partial<FigureSpec>[]) {
      expect(none(withLiveTickHints(spec(over), DRAWN)), JSON.stringify(over)).toEqual([]);
    }
  });
});

describe("only the focused window's own exports carry hints (review N1)", () => {
  const ds = { id: "d1", name: "a.csv", data: { time: [2, 21.5], values: [[1, 5], [2, 6]], labels: ["y", "r"], units: ["", ""], metadata: {} } };
  const view = { ...defaultPlotView(), yKeys: [0] };
  const doc = (id: string, over = {}): FigureDocument => createFigureDocument({ id, name: id, datasetId: "d1", view: { ...view, ...over } });
  const opts = { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" };
  const stage = (focused: string, document: FigureDocument) => {
    const st = useApp.getState;
    const state = vi.fn(() => ({
      ...st(), datasets: [ds], activeId: "d1", focusedWindowId: focused,
      windowsForSave: () => [{ id: focused, kind: "plot", datasetId: "d1", view, document }],
    }));
    return buildStageFigureSpec(state as unknown as typeof st, ds, "a", opts);
  };

  it("Stage Export and the window's Publication preview send the same hints", () => {
    publishLiveTickSteps(DRAWN);
    const document = doc("w1");
    const exported = stage("w1", document);
    const session = { target: "window", windowId: "w1", draft: document } as never;
    const preview = withLiveTickHints(buildFigureSpecFromDocument(document, ds, "a", { fmt: "svg" }), sessionTickHints({ figurePublicationSession: session, focusedWindowId: "w1" }));
    expect(hints(exported)).toEqual([null, null, 2, 0.5]);
    expect(hints(preview)).toEqual(hints(exported));
  });

  it("another window, another session, a frozen draft, batch and the shared builder carry none", () => {
    // `datasetId` too: what 0.34-style keying matched on, so a dataset-keyed lookup would leak here.
    publishLiveTickSteps({ ...DRAWN, datasetId: "d1" } as typeof DRAWN);
    expect(hints(stage("w2", doc("w2")))).toEqual([null, null, null, null]); // drawn by w1
    // Send figure to report builds through the Stage builder too, and opts out:
    const st = useApp.getState;
    const w1 = vi.fn(() => ({ ...st(), datasets: [ds], activeId: "d1", focusedWindowId: "w1", windowsForSave: () => [{ id: "w1", kind: "plot", datasetId: "d1", view, document: doc("w1") }] }));
    expect(hints(buildStageFigureSpec(w1 as unknown as typeof st, ds, "a", opts, { noTickHints: true }))).toEqual([null, null, null, null]);
    const other = { target: "window", windowId: "w2", draft: doc("w2") } as never;
    expect(sessionTickHints({ figurePublicationSession: other, focusedWindowId: "w1" })).toBeNull();
    const library = { target: "library", draft: doc("w1") } as never;
    expect(sessionTickHints({ figurePublicationSession: library, focusedWindowId: "w1" })).toBeNull();
    const frozen = { target: "window", windowId: "w1", draft: { ...doc("w1"), data: { mode: "frozen" } } } as never;
    expect(sessionTickHints({ figurePublicationSession: frozen, focusedWindowId: "w1" })).toBeNull();
    // A saved figure of the SAME dataset, through the shared builder and batch export:
    const saved = doc("f2", { yKeys: [1] });
    expect(hints(buildFigureSpecFromDocument(saved, ds, "f2", { fmt: "svg" }))).toEqual([null, null, null, null]);
    const batch = batchFigureSpecs([saved, doc("w1")], [ds], { format: "svg", style: "default", dpi: 100 } as never);
    for (const s of batch) expect(hints(s)).toEqual([null, null, null, null]);
  });
});
