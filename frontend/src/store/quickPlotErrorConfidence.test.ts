// Quick Plot consumes the error-binding CONFIDENCE GRADE
// (lib/errorBindingConfidence.ts): the menu path (`runQuickPlot`) ASKS before
// applying an adjacency-only (`low`) pairing, and never applies a unit-
// `blocked` one. The store action itself takes the already-decided
// `withhold` list.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";

import { reviewSeedErrorBindings } from "../lib/errorBindingConfidence";
import { figureSeedErrorBindings } from "../lib/errorRoles";
import type { Dataset, ErrorBinding } from "../lib/types";
import { useParamDialog } from "./paramDialog";
import { runQuickPlot, seedIsSettled } from "./quickPlotRun";
import { useApp } from "./useApp";

const LOW: ErrorBinding = { channel: 1, target: 0, axis: "y", side: "both" };

function sheet(id: string, labels: string[], units: string[], errorRoles?: ErrorBinding[]): Dataset {
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: [0, 1, 2],
      values: [[1, 0.1], [2, 0.2], [3, 0.3]],
      labels,
      units,
      metadata: { technique: "magnetometry.mvsh" },
    },
    ...(errorRoles ? { errorRoles } : {}),
  };
}

beforeEach(() => {
  useParamDialog.getState().close();
  useApp.setState({
    datasets: [
      sheet("low", ["M", "err"], ["", ""], [LOW]),
      sheet("unit", ["M", "err"], ["emu", "emu"], [LOW]),
      sheet("blocked", ["M", "M_err"], ["emu", "K"], [LOW]),
    ],
    activeId: null,
    selectedIds: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    techniqueViewMemory: {},
    history: [],
    future: [],
    status: "",
  });
});

const lastDoc = () => useApp.getState().editableFigures.at(-1);
const lastView = () => useApp.getState().plotWindows.at(-1)?.view;

describe("quickPlotDataset's withhold list", () => {
  it("creates the figure without a withheld pairing and hides its column", () => {
    expect(useApp.getState().quickPlotDataset("low", [LOW])).toBe(true);
    expect(lastDoc()?.bindings.errors).toEqual([]);
    expect(lastView()?.errKeys).toEqual({});
    expect(lastView()?.hiddenChannels).toContain(1);
  });

  it("with nothing withheld, applies the seed exactly as before", () => {
    expect(useApp.getState().quickPlotDataset("low")).toBe(true);
    expect(lastDoc()?.bindings.errors).toEqual([LOW]);
    expect(lastView()?.errKeys).toEqual({ 0: 1 });
  });
});

interface CorpusCase {
  note: string;
  labels: string[];
  units?: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(
  readFileSync(join(here, "../../../tests/fixtures/error_labels/confidence_corpus.json"), "utf-8"),
) as { cases: CorpusCase[]; label_only: CorpusCase[] };

describe("seedIsSettled -- the synchronous fast path is never wrong", () => {
  const all = [...corpus.cases, ...corpus.label_only].map((c) => sheet("c", c.labels, c.units ?? c.labels.map(() => "")));
  it.each(all.map((ds, i) => [i, ds] as const))("corpus case %i: settled implies nothing to ask or withhold", (_i, ds) => {
    ds.data.values = [ds.data.labels.map(() => 1)];
    if (!seedIsSettled(ds)) return;
    const review = reviewSeedErrorBindings(ds);
    expect(review.confirm).toEqual([]);
    expect(review.apply).toEqual(figureSeedErrorBindings(ds));
  });

  it("the property above is not vacuous: many corpus seeds take the fast path, and some do not", () => {
    const settled = all.filter((ds) => figureSeedErrorBindings(ds).length > 0 && seedIsSettled(ds)).length;
    expect(settled).toBeGreaterThan(20);
    expect(all.filter((ds) => !seedIsSettled(ds)).length).toBeGreaterThan(5);
  });

  it("vouches for the base-name cases and declines an adjacency-only one", () => {
    expect(seedIsSettled(sheet("a", ["M", "M_err"], ["", ""]))).toBe(true);
    expect(seedIsSettled(sheet("b", ["R", "err"], ["", ""]))).toBe(false);
    expect(seedIsSettled(sheet("c", ["M", "M_err"], ["emu", "K"], [LOW]))).toBe(false);
  });
});

describe("runQuickPlot -- the menu path", () => {
  it("asks before applying a low pairing; leaving it unticked plots without it", async () => {
    const done: string[] = [];
    runQuickPlot("low", () => done.push("stage"));
    await waitFor(() => expect(useParamDialog.getState().title).not.toBeNull());
    expect(useApp.getState().editableFigures).toHaveLength(0);
    const field = useParamDialog.getState().fields[0];
    expect(field.default).toBe(false);
    useParamDialog.getState().resolve?.({ [field.key]: false });
    await waitFor(() => expect(useApp.getState().editableFigures).toHaveLength(1));
    expect(lastDoc()?.bindings.errors).toEqual([]);
    expect(done).toEqual(["stage"]);
  });

  it("applies the low pairing when the user ticks it", async () => {
    runQuickPlot("low");
    await waitFor(() => expect(useParamDialog.getState().title).not.toBeNull());
    const field = useParamDialog.getState().fields[0];
    useParamDialog.getState().resolve?.({ [field.key]: true });
    await waitFor(() => expect(useApp.getState().editableFigures).toHaveLength(1));
    expect(lastDoc()?.bindings.errors).toEqual([LOW]);
  });

  it("cancelling the question creates nothing", async () => {
    const done: string[] = [];
    runQuickPlot("low", () => done.push("stage"));
    await waitFor(() => expect(useParamDialog.getState().title).not.toBeNull());
    useParamDialog.getState().resolve?.(null);
    await waitFor(() => expect(useApp.getState().status).toMatch(/cancelled/));
    expect(useApp.getState().editableFigures).toHaveLength(0);
    expect(done).toEqual([]);
  });

  it("a unit-backed position pairing is applied without asking", async () => {
    runQuickPlot("unit");
    await waitFor(() => expect(useApp.getState().editableFigures).toHaveLength(1));
    expect(useParamDialog.getState().title).toBeNull();
    expect(lastDoc()?.bindings.errors).toEqual([LOW]);
  });

  it("a base-name pairing is settled: the figure exists in the same tick, as before", () => {
    useApp.setState((s) => ({ datasets: [...s.datasets, sheet("named", ["M", "M_err"], ["", ""])] }));
    runQuickPlot("named");
    expect(useApp.getState().editableFigures).toHaveLength(1);
    expect(lastDoc()?.bindings.errors).toEqual([LOW]);
  });

  it("never applies a blocked pairing and does not offer it", async () => {
    runQuickPlot("blocked");
    await waitFor(() => expect(useApp.getState().editableFigures).toHaveLength(1));
    expect(useParamDialog.getState().title).toBeNull();
    expect(lastDoc()?.bindings.errors).toEqual([]);
    expect(useApp.getState().status).toMatch(/units contradict/);
  });
});
