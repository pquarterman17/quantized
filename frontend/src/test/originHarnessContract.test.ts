// Guard for tools/visual/origin_figures.mjs. That harness drives the store only
// through tools/visual/origin_store_api.mjs; PR #643 changed the store API and
// the harness (which poked internals) was dead for weeks with nothing noticing.
// This runs in CI with a tiny synthetic figure -- no private corpus.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { buildOriginFigureEntries } from "../lib/originFigureEntries";
import type { Dataset, OriginFigure } from "../lib/types";
import { useApp } from "../store/useApp";

interface HarnessApi {
  STORE_CONTRACT: Record<string, number>;
  APPLY_OPTS: Record<string, unknown>;
  IMPORT_OPTS: Record<string, unknown>;
}
// Plain-JS tooling module outside src/ (and import-free by design): evaluated
// from its source text so vite's resolver / tsc never have to reach into tools/.
// vitest runs from frontend/ (jsdom makes import.meta.url an http: URL).
const API_FILE = resolve(process.cwd(), "../tools/visual/origin_store_api.mjs");
const loadApi = async (): Promise<HarnessApi> => {
  const src = readFileSync(API_FILE, "utf8");
  const url = `data:text/javascript;base64,${Buffer.from(src).toString("base64")}`;
  return (await import(/* @vite-ignore */ url)) as HarnessApi;
};

const DS: Dataset = {
  id: "d1",
  name: "Book1",
  data: {
    time: [0, 1, 2],
    values: [[1, 10], [2, 20], [3, 30]],
    labels: ["X", "Y"],
    units: ["", ""],
    metadata: { origin_book: "Book1" },
  },
};
const FIGURE = {
  name: "Graph1",
  layer: 1,
  source_hint: "Book1",
  curves: [{ book: "Book1", x: "X", y: "Y" }],
} as unknown as OriginFigure;

beforeEach(() => {
  useApp.setState({ datasets: [], originFigures: [], activeId: null, folders: [], workbooks: [] });
});

describe("origin_figures.mjs store contract", () => {
  it("every store action the harness calls exists with a compatible arity", async () => {
    const { STORE_CONTRACT } = await loadApi();
    const state = useApp.getState() as unknown as Record<string, unknown>;
    for (const [name, maxArity] of Object.entries(STORE_CONTRACT)) {
      expect(typeof state[name], name).toBe("function");
      expect((state[name] as (...a: unknown[]) => unknown).length, name).toBeLessThanOrEqual(maxArity);
    }
  });

  it("a synthetic figure goes through the entry builder, the store, and the harness's apply call", async () => {
    const { APPLY_OPTS } = await loadApi();
    useApp.getState().addDataset(DS);
    const siblings = useApp.getState().datasets;
    useApp.getState().addOriginFigures(buildOriginFigureEntries("Proj", [FIGURE], siblings));
    const [entry] = useApp.getState().originFigures;
    expect(entry.datasetId).toBe("d1");
    expect(entry.figure.layer).toBe(1);
    expect(() => useApp.getState().applyOriginFigure(entry.id, APPLY_OPTS)).not.toThrow();
    expect(useApp.getState().activeId).toBe("d1");
  });
});
