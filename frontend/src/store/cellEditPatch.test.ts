// The cell-edit actions record each new table as a cell edit of the old one
// (lib/api/datasetCache's `noteCellEdit`), so the next plot fetch uploads only
// the changed cells. Checked end to end: edit through the store, then plot the
// new table through the real transport logic against a fake server that
// applies the patch the way routes/datasets.py does.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { postJSONDatasetAware } from "../lib/api/datasetCache";
import type { RawFetchJSON } from "../lib/api/datasetCache";
import { recomputeFromBase } from "../lib/formulaInputs";
import type { ComputedColumn, DataStruct, Dataset } from "../lib/types";
import { useApp } from "./useApp";

const ROWS = 200;

function dataset(formulas?: ComputedColumn[]): Dataset {
  const base: DataStruct = {
    time: Array.from({ length: ROWS }, (_, i) => i),
    values: Array.from({ length: ROWS }, (_, r) => [r, r % 3]),
    labels: ["A", "G"],
    units: ["", ""],
    metadata: {},
    cat_levels: { 1: ["lo", "mid", "hi"] },
  };
  const data = formulas ? recomputeFromBase(base, formulas).data : base;
  return { id: "d1", name: "scan.dat", data, ...(formulas ? { formulas } : {}) };
}

type Wire = { time: unknown[]; values: unknown[][] };

/** Holds decoded wire copies by handle; applies a patch the way the server does. */
function fakeServer() {
  const store = new Map<string, Wire>();
  const paths: string[] = [];
  let next = 0;
  const rawFetch = vi.fn(async (path: string, body: unknown) => {
    paths.push(path);
    const b = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    if (path === "/api/datasets/patch") {
      const copy = structuredClone(store.get(b.dataset_handle as string)!);
      for (const p of b.patches as { row: number; col: number; value: unknown }[]) {
        if (p.col < 0) copy.time[p.row] = p.value;
        else copy.values[p.row][p.col] = p.value;
      }
      const handle = `h${next++}`;
      store.set(handle, copy);
      return { value: { dataset_handle: handle }, handle: null };
    }
    if (b.dataset) {
      const handle = `h${next++}`;
      store.set(handle, b.dataset as Wire);
      return { value: null, handle };
    }
    return { value: null, handle: b.dataset_handle as string };
  }) as unknown as RawFetchJSON;
  /** Plot `ds`; return what the server now holds for it. */
  const plot = async (ds: DataStruct): Promise<Wire> => {
    let held: string | null = null;
    const spy: RawFetchJSON = async (path, body, signal) => {
      const res = await rawFetch(path, body, signal);
      if (path === "/api/plot/series") held = res.handle;
      return res as never;
    };
    await postJSONDatasetAware("/api/plot/series", { dataset: ds }, undefined, spy);
    return store.get(held!)!;
  };
  return { paths, plot };
}

const table = () => useApp.getState().datasets[0].data;
const wire = (ds: DataStruct): unknown => JSON.parse(JSON.stringify(ds));

describe.each([
  ["no formulas", undefined],
  ["a formula column", [{ name: "C", expr: "A * 2" }] as ComputedColumn[]],
])("cell edits with %s send cell patches", (_name, formulas) => {
  beforeEach(() => {
    useApp.setState({ datasets: [dataset(formulas)], activeId: "d1" });
  });

  it("setCellValue", async () => {
    const server = fakeServer();
    await server.plot(table());
    useApp.getState().setCellValue("d1", 5, 0, Number.NaN);
    useApp.getState().setCellValue("d1", 6, -1, -0);
    const held = await server.plot(table());
    expect(server.paths).toEqual(["/api/plot/series", "/api/datasets/patch", "/api/plot/series"]);
    expect(held).toEqual(wire(table()));
  });

  it("setCellBlock", async () => {
    const server = fakeServer();
    await server.plot(table());
    useApp.getState().setCellBlock(
      "d1",
      [
        { row: 1, col: 0, value: 7 },
        { row: 2, col: 0, value: 8 },
      ],
      "Paste",
    );
    const held = await server.plot(table());
    expect(server.paths).toEqual(["/api/plot/series", "/api/datasets/patch", "/api/plot/series"]);
    expect(held).toEqual(wire(table()));
  });

  it("setCategoricalCell", async () => {
    const server = fakeServer();
    await server.plot(table());
    useApp.getState().setCategoricalCell("d1", 3, 1, "hi");
    const held = await server.plot(table());
    expect(server.paths).toEqual(["/api/plot/series", "/api/datasets/patch", "/api/plot/series"]);
    expect(held).toEqual(wire(table()));
  });

  it("a new categorical level changes cat_levels, so the table is sent in full", async () => {
    const server = fakeServer();
    await server.plot(table());
    useApp.getState().setCategoricalCell("d1", 3, 1, "extra");
    const held = await server.plot(table());
    expect(server.paths).toEqual(["/api/plot/series", "/api/plot/series"]);
    expect(held).toEqual(wire(table()));
  });
});
