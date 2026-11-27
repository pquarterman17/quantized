// Exact-method search (acceptance A3 / A6): a method name or acronym ranks its own launcher first and
// opens the workshop on that test or tab; the Classic layout is findable by task; the bare-key analysis
// shortcuts take the same path as the menu and palette.

import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAppActions } from "../appCommands";
import { rankActions } from "../lib/paletteRank";
import type { Dataset } from "../lib/types";
import { useAnalysisCenter } from "../store/analysisCenter";
import { runAction } from "../store/commands";
import { useMultivarStore } from "../store/multivar";
import { useStatsTestsStore } from "../store/statsTests";
import { useApp } from "../store/useApp";
import { useGlobalShortcuts } from "../useGlobalShortcuts";
import { mergeSearchable } from "./hookCommandDocs";

const ds = {
  id: "d1",
  name: "six.csv",
  data: { time: [0, 1, 2], values: [[1, 4, 7], [2, 5, 8], [3, 6, 9]], labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} },
} as unknown as Dataset;

const palette = () => mergeSearchable(buildAppActions(useApp.getState), []);
const top = (q: string) => rankActions(palette(), q, {})[0]?.a.id;
const reset = () => {
  useStatsTestsStore.setState({ open: false, request: null });
  useMultivarStore.setState({ open: false, request: null, launch: null });
  useApp.setState({ datasets: [ds], activeId: "d1", curveFitOpen: false, peaksOpen: false, hysteresisOpen: false });
  localStorage.clear();
  useAnalysisCenter.setState({ recent: [] });
};
beforeEach(reset);
afterEach(reset);

describe("method search ranks the exact launcher first", () => {
  it.each([
    ["fit life by x", "method-fit-life-by-x"],
    ["Fit life by X", "method-fit-life-by-x"],
    ["life by x", "method-fit-life-by-x"],
    ["response screening", "method-response-screening"],
    ["pls", "method-pls"],
    ["PLS", "method-pls"],
    ["partial least squares", "method-pls"],
    ["lda", "method-lda"],
    ["linear discriminant analysis", "method-lda"],
    ["cluster", "method-cluster"],
    ["k-means", "method-cluster"],
    ["dendrogram", "method-cluster"],
    ["hierarchical clustering", "method-cluster"],
  ])("%s -> %s", (query, id) => {
    expect(top(query)).toBe(id);
  });

  it("keeps the generic workshop commands findable", () => {
    const ids = rankActions(palette(), "statistical tests", {}).map((r) => r.a.id);
    expect(ids).toContain("stats-tests");
    expect(rankActions(palette(), "multivariate", {}).map((r) => r.a.id)).toContain("multivar");
  });

  it("does not claim a full gauge R&R study", () => {
    const v = palette().find((a) => a.id === "variability-chart")!;
    expect(v.description).toMatch(/not a full gauge R&R/i);
    expect(rankActions(palette(), "gauge r&r", {})[0]?.a.id).toBe("variability-chart");
  });
});

describe("method launchers open the exact test or tab", () => {
  it.each([
    ["method-fit-life-by-x", "life-by-x"],
    ["method-response-screening", "response-screening"],
  ])("%s opens Statistical tests on %s", (id, test) => {
    runAction(palette().find((a) => a.id === id)!);
    expect(useStatsTestsStore.getState()).toMatchObject({ open: true, request: { testId: test } });
  });

  it.each([["method-pls", "pls"], ["method-lda", "lda"]] as const)("%s opens the PLS / LDA tab on %s", (id, tool) => {
    runAction(palette().find((a) => a.id === id)!);
    expect(useMultivarStore.getState()).toMatchObject({ open: true, launch: { tab: "ext", tool } });
  });

  it("method-cluster opens the Clustering tab", () => {
    runAction(palette().find((a) => a.id === "method-cluster")!);
    expect(useMultivarStore.getState()).toMatchObject({ open: true, launch: { tab: "cluster" } });
  });

  it("a plain Multivariate open clears a typed launch", () => {
    useMultivarStore.getState().openTab({ tab: "ext", tool: "lda" });
    useMultivarStore.getState().setOpen(true);
    expect(useMultivarStore.getState().launch).toBeNull();
  });

  it("are disabled without a worksheet", () => {
    useApp.setState({ datasets: [], activeId: null });
    const a = palette().find((x) => x.id === "method-pls")!;
    expect(typeof a.disabled === "function" ? a.disabled() : a.disabled).toBe(true);
  });
});

describe("Classic layout is findable by task", () => {
  it.each(["worksheet beside plot", "split view", "arrange windows"])("%s ranks the window-layout switch first", (q) => {
    expect(top(q)).toBe("window-layout-preview");
  });

  // "Panel: side by side" (several datasets in one plot) also says side by side, so it may rank first here.
  it("plot and data side by side finds the window-layout switch near the top", () => {
    const ids = rankActions(palette(), "plot and data side by side", {}).map((r) => r.a.id);
    expect(ids.slice(0, 5)).toContain("window-layout-preview");
  });
});

describe("bare-key analysis shortcuts use the shared launcher", () => {
  const press = (key: string, target: Element = document.body) => act(() => { fireEvent.keyDown(target, { key }); });

  it.each([["f", "curvefit", () => useApp.getState().curveFitOpen], ["p", "peaks", () => useApp.getState().peaksOpen], ["y", "hysteresis", () => useApp.getState().hysteresisOpen]] as const)(
    "%s opens the tool and records the same recent entry as the menu",
    async (key, id, opened) => {
      renderHook(() => useGlobalShortcuts());
      press(key);
      await waitFor(() => expect(opened()).toBe(true));
      expect(useAnalysisCenter.getState().recent[0]).toBe(id);
      // The menu/palette path lands on the same state.
      useApp.setState({ curveFitOpen: false, peaksOpen: false, hysteresisOpen: false });
      useAnalysisCenter.setState({ recent: [] });
      runAction(palette().find((a) => a.id === id)!);
      expect(opened()).toBe(true);
      expect(useAnalysisCenter.getState().recent[0]).toBe(id);
    },
  );

  it("refuses with the reason when no worksheet can feed the tool", async () => {
    useApp.setState({ datasets: [], activeId: null, status: "" });
    renderHook(() => useGlobalShortcuts());
    press("f");
    await waitFor(() => expect(useApp.getState().status).toMatch(/Curve fit unavailable/));
    expect(useApp.getState().curveFitOpen).toBe(false);
  });

  it("does nothing while typing in a field", async () => {
    renderHook(() => useGlobalShortcuts());
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    press("f", input);
    await new Promise((r) => setTimeout(r, 50));
    expect(useApp.getState().curveFitOpen).toBe(false);
    input.remove();
  });
});
