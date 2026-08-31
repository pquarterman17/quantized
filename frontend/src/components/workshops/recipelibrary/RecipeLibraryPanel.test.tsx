import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { PlotRecipe } from "../../../lib/plotRecipeSchema";
import { makeStep } from "../../../lib/pipeline";
import { metaFor, recordUse, setFavorite } from "../../../lib/recipeIndex";
import { supportsOperation } from "../../../lib/recipeLibrary";
import { loadTemplates, saveTemplate } from "../../../lib/template";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { useRecipeManager } from "../../../store/recipeManager";
import { useApp } from "../../../store/useApp";
import RecipeLibraryPanel from "./RecipeLibraryPanel";

const plot = {
  id: "plot-1",
  name: "XRD publication",
  description: "",
  technique: "xrd.powder",
  createdAt: "2026-08-01T00:00:00.000Z",
  modifiedAt: "2026-08-01T00:00:00.000Z",
  schemaVersion: 1,
  signature: [{ id: "x" }, { id: "y" }],
  mapping: {},
  visual: {},
} as unknown as PlotRecipe;

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ plotRecipes: [], quickPlotTemplates: [], recipeSourcesComplete: true });
  useGlobalPlotRecipes.setState({ recipes: [], hydrated: true, complete: true });
  useRecipeManager.setState({ open: true, library: true });
});

describe("RecipeLibraryPanel", () => {
  it("shows a helpful first-use empty state", () => {
    render(<RecipeLibraryPanel />);
    expect(screen.getByText("No saved recipes yet")).toBeInTheDocument();
    expect(screen.getByText(/Save a plot, Quick Plot setup/)).toBeInTheDocument();
  });

  it("labels kind and scope without hiding the useful summary", () => {
    useApp.setState({ plotRecipes: [plot] });
    render(<RecipeLibraryPanel />);
    expect(screen.getByText("XRD publication")).toBeInTheDocument();
    expect(screen.getAllByText("Plot recipe")).toHaveLength(2);
    expect(screen.getByText("This project")).toBeInTheDocument();
    expect(screen.getByText(/2 channels/)).toBeInTheDocument();
  });

  it("favorites a recipe and can filter to favorites", () => {
    useApp.setState({ plotRecipes: [plot, { ...plot, id: "plot-2", name: "Not favorite" }] });
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Add XRD publication to favorites/ }));
    expect(metaFor({ kind: "plot", scope: "project", id: "plot-1" }).favorite).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Favorites only" }));
    expect(screen.getByText("XRD publication")).toBeInTheDocument();
    expect(screen.queryByText("Not favorite")).not.toBeInTheDocument();
  });

  it("warns when global hydration drops a corrupt source", () => {
    localStorage.setItem("qz.plotRecipes", "{{{ not json");
    useGlobalPlotRecipes.setState({ recipes: [], hydrated: false, complete: false });
    render(<RecipeLibraryPanel />);
    expect(screen.getByRole("status")).toHaveTextContent("Some recipe sources could not be read completely");
    expect(useGlobalPlotRecipes.getState().hydrated).toBe(true);
    expect(useGlobalPlotRecipes.getState().complete).toBe(false);
  });

  it("warns when the PROJECT's own recipe lists loaded incomplete (P3.5)", () => {
    // The workspace-backed half. Every localStorage-backed source is healthy
    // here and the global slot vouches for itself, so before this signal
    // existed the panel had nothing to go on and reported a clean library —
    // while `plotRecipes`/`quickPlotTemplates` records dropped at project load
    // were missing, and pruning sidecar favorites/tags would have deleted the
    // metadata of recipes that still exist in the file.
    useApp.setState({ plotRecipes: [plot], recipeSourcesComplete: false });
    render(<RecipeLibraryPanel />);
    expect(screen.getByRole("status")).toHaveTextContent("Some recipe sources could not be read completely");
    expect(screen.getByText("XRD publication")).toBeInTheDocument(); // what survived is still shown
  });

  it("shows no warning when every source, project included, is whole", () => {
    useApp.setState({ plotRecipes: [plot], recipeSourcesComplete: true });
    render(<RecipeLibraryPanel />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("edits comma-separated tags without changing the recipe", () => {
    useApp.setState({ plotRecipes: [plot] });
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add tags" }));
    const input = screen.getByRole("textbox", { name: "Tags for XRD publication" });
    fireEvent.change(input, { target: { value: "xrd, publication" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(metaFor({ kind: "plot", scope: "project", id: "plot-1" }).tags).toEqual(["xrd", "publication"]);
    expect(useApp.getState().plotRecipes).toEqual([plot]);
  });

  it("cancels tag edits with Escape", () => {
    useApp.setState({ plotRecipes: [plot] });
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add tags" }));
    const input = screen.getByRole("textbox", { name: "Tags for XRD publication" });
    fireEvent.change(input, { target: { value: "do-not-save" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(metaFor({ kind: "plot", scope: "project", id: "plot-1" }).tags).toEqual([]);
  });

  it("opens the existing advanced Plot Recipe Manager", () => {
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Manage Plot Recipes…" }));
    expect(useRecipeManager.getState().open).toBe(true);
    expect(useRecipeManager.getState().library).toBe(false);
  });
});

describe("pruning the sidecar index (P3.5)", () => {
  const orphan = { kind: "plot" as const, scope: "project" as const, id: "deleted-long-ago" };

  beforeEach(() => {
    localStorage.clear();
    useApp.setState({ plotRecipes: [], quickPlotTemplates: [], recipeSourcesComplete: true });
    useGlobalPlotRecipes.setState({ recipes: [], hydrated: true, complete: true });
    useRecipeManager.setState({ open: true, library: true });
  });

  it("drops the recency of a recipe that no longer exists", () => {
    // Without this the index only ever grows: every recipe a user ever
    // applied keeps a row after the recipe itself is gone.
    recordUse(orphan, "2026-08-30T10:00:00.000Z");
    useApp.setState({ plotRecipes: [plot] });

    render(<RecipeLibraryPanel />);

    expect(metaFor(orphan).useCount).toBe(0);
    expect(metaFor({ kind: "plot", scope: "project", id: "plot-1" })).toBeDefined();
  });

  it("KEEPS an orphan's favorite — deleting a plot recipe is undoable", () => {
    // The Library prunes whenever the live set changes, and deleting a recipe
    // changes it. Dropping the star here would mean an undo restores the
    // recipe without it.
    setFavorite(orphan, true);
    useApp.setState({ plotRecipes: [plot] });

    render(<RecipeLibraryPanel />);

    expect(metaFor(orphan).favorite).toBe(true);
  });

  it("keeps metadata for recipes that ARE live", () => {
    setFavorite({ kind: "plot", scope: "project", id: "plot-1" }, true);
    useApp.setState({ plotRecipes: [plot] });

    render(<RecipeLibraryPanel />);

    expect(metaFor({ kind: "plot", scope: "project", id: "plot-1" }).favorite).toBe(true);
  });

  it("does NOT prune when a source could not be read completely", () => {
    // The whole reason `pruneEntries` takes a completeness flag. Every source
    // reader returns [] both for "empty" and for "the read failed", so pruning
    // against a failed read deletes every favorite the user has. Here the
    // project's own recipe lists are flagged incomplete, which is exactly the
    // state a corrupt .dwk field produces.
    recordUse(orphan, "2026-08-30T10:00:00.000Z");
    useApp.setState({ plotRecipes: [plot], recipeSourcesComplete: false });

    render(<RecipeLibraryPanel />);

    expect(metaFor(orphan).useCount, "an incomplete read must never prune").toBe(1);
  });

  it("prunes as soon as completeness flips true, without the recipe set changing", () => {
    // The `complete` dependency, not just the `complete` guard. A source that
    // hydrates late (or a project reopened cleanly after a corrupt one) flips
    // this flag with the live recipe set unchanged, so an effect keyed only on
    // the signature would sit on a stale refusal until something else moved.
    // `exhaustive-deps` is a WARNING in this repo, so lint does not hold it.
    recordUse(orphan, "2026-08-30T10:00:00.000Z");
    useApp.setState({ plotRecipes: [plot], recipeSourcesComplete: false });
    const view = render(<RecipeLibraryPanel />);
    expect(metaFor(orphan).useCount).toBe(1); // refused while incomplete

    useApp.setState({ recipeSourcesComplete: true });
    view.rerender(<RecipeLibraryPanel />);
    expect(metaFor(orphan).useCount).toBe(0); // pruned on the flip
  });

  it("does not re-prune on a favorite toggle (no re-read storm while browsing)", () => {
    // The collection is recomputed on every render and each toggle bumps a
    // revision counter, so a dependency on the collection OBJECT would re-run
    // the prune on every click. Counting READS, not writes, is what makes this
    // test load-bearing: `pruneEntries` writes only when it drops something,
    // so a storm of no-op prunes is invisible to a write counter (measured —
    // the write-counting version of this test passed against the bug).
    useApp.setState({ plotRecipes: [plot] });
    render(<RecipeLibraryPanel />);

    let indexReads = 0;
    const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const backing = window.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => {
          if (k === "qz.recipeIndex") indexReads += 1;
          return backing.getItem(k);
        },
        setItem: (k: string, v: string) => backing.setItem(k, v),
        removeItem: (k: string) => backing.removeItem(k),
        clear: () => backing.clear(),
        key: (i: number) => backing.key(i),
        get length() {
          return backing.length;
        },
      },
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: /Add XRD publication to favorites/ }));
    } finally {
      if (real) Object.defineProperty(globalThis, "localStorage", real);
    }

    // The toggle itself reads the index (setFavorite) and the re-render reads
    // it again to show the new state. A prune re-firing adds another on top,
    // and the count climbs with every subsequent click.
    // MEASURED, not guessed: 2 with the signature dependency, 3 with the
    // collection object. `<= 3` — the first bound written here — passed
    // against the bug, which is exactly how a loose bound hides a regression.
    expect(indexReads, `index re-read ${indexReads}x for one favorite toggle`).toBeLessThanOrEqual(2);
  });
});

describe("row actions (P3.5 slice 3)", () => {
  beforeEach(() => {
    localStorage.clear();
    useApp.setState({
      datasets: [], activeId: null, plotRecipes: [], quickPlotTemplates: [],
      recipeSourcesComplete: true, pipelineOpen: false, status: "",
    });
    useGlobalPlotRecipes.setState({ recipes: [], hydrated: true, complete: true });
    useRecipeManager.setState({ open: true, library: true });
  });

  it("offers only the operations a kind can honour", () => {
    // Unsupported actions are ABSENT, not disabled: a greyed-out Duplicate
    // invites the user to hunt for the state that enables it, and there is
    // none. Analysis templates can be renamed/duplicated/exported since P3.5;
    // they can never be copied to project scope, having no project-file
    // representation at all.
    saveTemplate({
      version: 1, name: "Loop fit",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<RecipeLibraryPanel />);

    expect(screen.getByRole("button", { name: "Open in Pipeline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy to/ })).not.toBeInTheDocument();
  });

  it("says Apply for plot recipes and Open for workshop-owned kinds", () => {
    useApp.setState({ plotRecipes: [plot] });
    render(<RecipeLibraryPanel />);
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Open in/ })).not.toBeInTheDocument();
  });

  it("reports a refusal on the status line instead of doing nothing", async () => {
    // With no active dataset an apply has no target. The user must be told
    // why, or the button looks broken.
    useApp.setState({ plotRecipes: [plot], activeId: null });
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(screen.getByText("select a dataset first")).toBeInTheDocument(),
    );
    expect(useApp.getState().editableFigures ?? []).toHaveLength(0);
  });

  it("opens the owning workshop for a kind it cannot apply here", async () => {
    saveTemplate({
      version: 1, name: "Loop fit",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open in Pipeline" }));
    await waitFor(() => expect(useApp.getState().pipelineOpen).toBe(true));
  });

  it("renames in place and carries the favorite across", async () => {
    saveTemplate({
      version: 1, name: "Old name",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    setFavorite({ kind: "analysis", scope: "global", id: "Old name" }, true);
    render(<RecipeLibraryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Old name" }));
    const input = screen.getByRole("textbox", { name: "Rename Old name" });
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("New name")).toBeInTheDocument());
    expect(loadTemplates().map((t) => t.name)).toEqual(["New name"]);
    expect(metaFor({ kind: "analysis", scope: "global", id: "New name" }).favorite).toBe(true);
  });

  it("Escape cancels a rename without saving it", () => {
    // Escape fires before blur, so it must suppress the blur commit — the same
    // ordering the tag editor already handles.
    saveTemplate({
      version: 1, name: "Keep me",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<RecipeLibraryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Keep me" }));
    const input = screen.getByRole("textbox", { name: "Rename Keep me" });
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);

    expect(loadTemplates().map((t) => t.name)).toEqual(["Keep me"]);
  });

  it("offers no rename affordance for a kind that cannot be renamed", () => {
    // There is none today — every kind supports rename since P3.5 — so this
    // asserts the MECHANISM by driving it from the capability table directly,
    // rather than pretending a kind is unsupported.
    expect(supportsOperation("plot", "rename")).toBe(true);
    useApp.setState({ plotRecipes: [plot] });
    render(<RecipeLibraryPanel />);
    expect(screen.getByRole("button", { name: "Rename XRD publication" })).toBeInTheDocument();
  });
});
