// P1.3 wave 3, Lane D: the post-import batch-outcome toast cascade,
// extracted from store/importDatasets.ts. Exercises the REAL useApp store
// (same convention store/plotRecipes.test.ts / importTargetFolder.test.ts
// use) so the L0.46 precedence rule and the new recipe-suggestion branch are
// checked against the actual store actions they call, not a stand-in.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureRecipe } from "../lib/plotRecipe";
import { defaultPlotView } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { useGlobalPlotRecipes } from "./globalPlotRecipes";
import { batchOverlayOffer, presentBatchOutcome } from "./importBatchOffers";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

function ds(id: string, technique: string | null, labels = ["2theta", "Intensity", "Ierr"]): Dataset {
  return {
    id,
    name: `${id}.xy`,
    data: {
      time: [0, 1, 2],
      values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
      labels,
      units: ["deg", "cps", "cps"],
      metadata: technique === null ? {} : { technique },
    },
  };
}

beforeEach(() => {
  useApp.setState({
    datasets: [],
    plotRecipes: [],
    pendingRecipeApplication: null,
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    history: [],
    future: [],
    status: "",
    folders: [],
    librarySelection: null,
  });
  useToasts.setState({ toasts: [] });
  // Finding 4/6: the recipe-suggestion branch now reads the GLOBAL scope
  // too -- reset it alongside the project store so no test leaks state
  // (via localStorage/module-level `hydrated`) into another.
  useGlobalPlotRecipes.setState({ recipes: [], hydrated: true });
});

describe("batchOverlayOffer", () => {
  it("offers an overlay when every created dataset shares one non-generic technique", () => {
    useApp.setState({ datasets: [ds("a", "xrd.powder"), ds("b", "xrd.powder")] });
    const offer = batchOverlayOffer(useApp.getState, ["a", "b"]);
    expect(offer).toEqual({ technique: "xrd.powder", ids: ["a", "b"] });
  });

  it("never offers for a single dataset or mixed techniques", () => {
    useApp.setState({ datasets: [ds("a", "xrd.powder")] });
    expect(batchOverlayOffer(useApp.getState, ["a"])).toBeNull();
    useApp.setState({ datasets: [ds("a", "xrd.powder"), ds("b", "magnetometry.mvsh")] });
    expect(batchOverlayOffer(useApp.getState, ["a", "b"])).toBeNull();
  });
});

// UX8-C: ten `Field (Oe), Moment (emu)` CSVs got no offer at all.
describe("batchOverlayOffer — generic files with one column shape", () => {
  const mh = (id: string, labels = ["Field", "Moment"], units = ["Oe", "emu"]): Dataset => ({
    id,
    name: `${id}.csv`,
    data: { time: [0, 1], values: [[1, 2], [3, 4]], labels, units, metadata: {} },
  });

  it("offers an overlay when every generic dataset has the same labels and units", () => {
    useApp.setState({ datasets: [mh("a"), mh("b"), mh("c")] });
    expect(batchOverlayOffer(useApp.getState, ["a", "b", "c"])).toEqual({ technique: "generic", ids: ["a", "b", "c"] });
  });

  it("never offers for one file fanned out into several same-shape datasets (an Origin project)", () => {
    useApp.setState({ datasets: [mh("a"), mh("b"), mh("c")] });
    expect(batchOverlayOffer(useApp.getState, ["a", "b", "c"], 1)).toBeNull();
  });

  it("never offers when a label or a unit differs", () => {
    useApp.setState({ datasets: [mh("a"), mh("b", ["Field", "M"])] });
    expect(batchOverlayOffer(useApp.getState, ["a", "b"])).toBeNull();
    useApp.setState({ datasets: [mh("a"), mh("b", ["Field", "Moment"], ["T", "emu"])] });
    expect(batchOverlayOffer(useApp.getState, ["a", "b"])).toBeNull();
  });

  it("a batch that also qualifies for a folder offers it as a second action on the ONE toast", async () => {
    useApp.setState({ datasets: [mh("MH_010K"), mh("MH_040K")] });
    await presentBatchOutcome(useApp.getState, 2, ["MH_010K", "MH_040K"], undefined);
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].action?.label).toBe("Overlay");
    expect(toasts[0].actions?.map((a) => a.label)).toEqual(['Create folder "MH_0"']);
  });

  it("the toast does not call the files 'generic'", async () => {
    useApp.setState({ datasets: [mh("a"), mh("b")] });
    await presentBatchOutcome(useApp.getState, 2, ["a", "b"], undefined);
    const [t] = useToasts.getState().toasts;
    expect(t.msg).toBe("2 files imported — overlay in one plot?");
    expect(t.action?.label).toBe("Overlay");
  });
});

describe("presentBatchOutcome — L0.46 precedence", () => {
  it("the overlay offer wins and the recipe suggestion never fires", async () => {
    useApp.setState({ datasets: [ds("a", "xrd.powder"), ds("b", "xrd.powder")] });

    await presentBatchOutcome(useApp.getState, 2, ["a", "b"], undefined);

    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toContain("overlay in one plot");
    expect(toasts[0].action?.label).toBe("Overlay");
  });

  it("offers the recipe suggestion for a single-dataset import with a clean match, and NEVER auto-applies", async () => {
    // Seed a clean-matching project recipe for "d1"'s technique.
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
    const recipe = captureRecipe(ds("seed", "xrd.powder"), view, null, { id: "r1", name: "XRD Recipe", appVersion: "0" });
    useApp.setState({ datasets: [ds("d1", "xrd.powder")], plotRecipes: [recipe] });
    const figuresBefore = useApp.getState().editableFigures.length;

    await presentBatchOutcome(useApp.getState, 1, ["d1"], undefined);

    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    // FINDING 7 (code-review): the toast must ALSO state the import
    // succeeded, like every other candidate toast in this cascade.
    expect(toasts[0].msg).toBe('imported 1 file — apply recipe "XRD Recipe"?');
    expect(toasts[0].action?.label).toBe("Apply");
    // Declining (not clicking) applies nothing.
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore);

    // Clicking the action DOES apply it, through the canonical apply path.
    toasts[0].action!.onClick();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore + 1);
  });

  it("falls back to the plain 'imported N files' toast when no recipe cleanly matches", async () => {
    useApp.setState({ datasets: [ds("d1", "xrd.powder")], plotRecipes: [] });

    await presentBatchOutcome(useApp.getState, 1, ["d1"], undefined);

    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toBe("imported 1 file");
    expect(toasts[0].action).toBeUndefined();
  });

  it("never offers a recipe suggestion for a multi-dataset batch, even with a clean-matching recipe on one of them", async () => {
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
    const recipe = captureRecipe(ds("seed", "xrd.powder"), view, null, { id: "r1", name: "XRD Recipe", appVersion: "0" });
    // Mixed techniques -- fails the overlay gate too, so this reaches the
    // fallback without ever getting a chance to check recipe matches.
    useApp.setState({
      datasets: [ds("d1", "xrd.powder"), ds("d2", "magnetometry.mvsh", ["Field", "Moment"])],
      plotRecipes: [recipe],
    });

    await presentBatchOutcome(useApp.getState, 2, ["d1", "d2"], undefined);

    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toBe("imported 2 files");
  });

  it("offers the recipe suggestion for a GLOBAL-only clean match (finding 4)", async () => {
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
    const recipe = captureRecipe(ds("seed", "xrd.powder"), view, null, { id: "g1", name: "Global XRD Recipe", appVersion: "0" });
    useApp.setState({ datasets: [ds("d1", "xrd.powder")], plotRecipes: [] });
    useGlobalPlotRecipes.setState({ recipes: [recipe], hydrated: true });

    await presentBatchOutcome(useApp.getState, 1, ["d1"], undefined);

    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toBe('imported 1 file — apply recipe "Global XRD Recipe"?');
  });

  it("never calls cleanMatchingPlotRecipe when NEITHER scope has a saved recipe (finding 6, perf)", async () => {
    useApp.setState({ datasets: [ds("d1", "xrd.powder")], plotRecipes: [] });
    useGlobalPlotRecipes.setState({ recipes: [], hydrated: true });
    const spy = vi.fn().mockResolvedValue(null);
    useApp.setState({ cleanMatchingPlotRecipe: spy });

    await presentBatchOutcome(useApp.getState, 1, ["d1"], undefined);

    expect(spy).not.toHaveBeenCalled();
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toBe("imported 1 file");
  });

  it("DOES call cleanMatchingPlotRecipe when the project scope alone has a recipe", async () => {
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
    const recipe = captureRecipe(ds("seed", "xrd.powder"), view, null, { id: "r1", name: "XRD Recipe", appVersion: "0" });
    useApp.setState({ datasets: [ds("d1", "xrd.powder")], plotRecipes: [recipe] });
    useGlobalPlotRecipes.setState({ recipes: [], hydrated: true });
    const real = useApp.getState().cleanMatchingPlotRecipe;
    const spy = vi.fn(real);
    useApp.setState({ cleanMatchingPlotRecipe: spy });

    await presentBatchOutcome(useApp.getState, 1, ["d1"], undefined);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
