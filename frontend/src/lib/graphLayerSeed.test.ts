// A new inset starts with the parent graph's curves, bound to the parent's own
// X (audit 6 lane M review H1): a chosen X column stays chosen, a multi-X sheet
// keeps nearest-preceding-X, a map / no dataset / nothing plotted seeds none,
// and the seed is capped.

import { beforeEach, describe, expect, it } from "vitest";

import { insertGraphLayer } from "./graphLayerCommands";
import type { InsetLayer } from "./graphLayers";
import type { Dataset } from "./types";
import { useFigureDialog } from "../store/figureDialogs";
import { useApp } from "../store/useApp";

const mk = (id: string, labels: string[], extra: Partial<Dataset> = {}, meta: Record<string, unknown> = {}): Dataset => ({
  id, name: id,
  data: { time: [0, 1, 2], values: [0, 1, 2].map((r) => labels.map((_, c) => r + c)), labels, units: labels.map(() => ""), metadata: meta },
  ...extra,
});

function seeded(): { datasetId: string; xKey: number | null; yKey: number }[] | null {
  insertGraphLayer("inset");
  const open = useFigureDialog.getState().open;
  return open?.kind === "graphLayer" ? (open.draft as InsetLayer).curves : null;
}

function setup(ds: Dataset[], active: string | null, over: Record<string, unknown> = {}) {
  useFigureDialog.setState({ open: null });
  useApp.setState({
    datasets: ds, activeId: active, xKey: null, yKeys: null, hiddenChannels: [], seriesOrder: null,
    layers: [], polarMode: false, statMode: false, stackMode: false, ...over,
  });
}

beforeEach(() => useFigureDialog.setState({ open: null }));

describe("inset seeding binds the parent's X", () => {
  it("a chosen X column is carried onto every seeded curve", () => {
    setup([mk("d", ["T", "R", "V"])], "d", { xKey: 1 });
    const c = seeded()!;
    expect(c.map((k) => k.yKey)).toEqual([0, 2]);
    expect(c.every((k) => k.xKey === 1)).toBe(true);
  });

  it("no chosen X seeds the book's own X (null)", () => {
    setup([mk("d", ["a", "b"])], "d");
    expect(seeded()!.every((k) => k.xKey === null)).toBe(true);
  });

  it("a multi-X sheet binds R2 to T2, not T1", () => {
    const ds = mk("m", ["T1", "R1", "T2", "R2"], { columnDesignations: { 0: "X", 1: "Y", 2: "X", 3: "Y" } });
    setup([ds], "m", { xKey: 0 });
    const c = seeded()!;
    expect(c.map((k) => [k.yKey, k.xKey])).toEqual([[1, 0], [3, 2]]);
  });

  it("a 2-D map seeds nothing", () => {
    setup([mk("g", ["x", "y", "z"], {}, { is2D: true })], "g");
    expect(seeded()).toEqual([]);
  });

  it("no active dataset opens nothing (refused)", () => {
    setup([mk("d", ["a"])], null);
    insertGraphLayer("inset");
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("an empty dataset seeds nothing", () => {
    setup([mk("e", [])], "e");
    expect(seeded()).toEqual([]);
  });

  it("caps the seed at 8 curves", () => {
    setup([mk("w", Array.from({ length: 12 }, (_, i) => `c${i}`))], "w");
    expect(seeded()).toHaveLength(8);
  });
});
