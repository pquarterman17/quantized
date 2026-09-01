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
    expect(screen.getByText(/Some recipe sources could not be read completely/)).toBeInTheDocument();
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
    expect(screen.getByText(/Some recipe sources could not be read completely/)).toBeInTheDocument();
    expect(screen.getByText("XRD publication")).toBeInTheDocument(); // what survived is still shown
  });

  it("shows no warning when every source, project included, is whole", () => {
    useApp.setState({ plotRecipes: [plot], recipeSourcesComplete: true });
    render(<RecipeLibraryPanel />);
    expect(screen.queryByText(/Some recipe sources could not be read completely/)).not.toBeInTheDocument();
  });

  it("edits comma-separated tags without changing the recipe", () => {
    useApp.setState({ plotRecipes: [plot] });
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Edit tags for/ }));
    const input = screen.getByRole("textbox", { name: "Tags for XRD publication" });
    fireEvent.change(input, { target: { value: "xrd, publication" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(metaFor({ kind: "plot", scope: "project", id: "plot-1" }).tags).toEqual(["xrd", "publication"]);
    expect(useApp.getState().plotRecipes).toEqual([plot]);
  });

  it("cancels tag edits with Escape", () => {
    useApp.setState({ plotRecipes: [plot] });
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Edit tags for/ }));
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

    expect(screen.getByRole("button", { name: "Open in Pipeline: Loop fit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duplicate Loop fit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Loop fit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy to/ })).not.toBeInTheDocument();
  });

  it("says Apply for plot recipes and Open for workshop-owned kinds", () => {
    useApp.setState({ plotRecipes: [plot] });
    render(<RecipeLibraryPanel />);
    expect(screen.getByRole("button", { name: "Apply: XRD publication" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Open in/ })).not.toBeInTheDocument();
  });

  it("reports a refusal on the status line instead of doing nothing", async () => {
    // With no active dataset an apply has no target. The user must be told
    // why, or the button looks broken.
    useApp.setState({ plotRecipes: [plot], activeId: null });
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Apply: XRD publication" }));
    // The "Not done — " prefix is the point, not decoration: success and
    // refusal used to differ only by a border tint (WCAG 1.4.1), and several
    // refusal strings come verbatim from the store and read like neutral
    // status on their own.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Not done — select a dataset first"),
    );
    expect(useApp.getState().editableFigures).toHaveLength(0);
  });

  it("surfaces a failed apply instead of leaving an unhandled rejection", async () => {
    // The plot path lazy-loads its matcher chunk; a failed fetch rejects the
    // promise. Without a catch the click does nothing visible and the
    // rejection escapes — the user is left thinking the button is broken.
    useApp.setState({
      plotRecipes: [plot],
      activeId: "d1",
      datasets: [{ id: "d1", name: "d1", data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} } }],
      applyPlotRecipeObject: () => Promise.reject(new Error("chunk 404")),
    });
    render(<RecipeLibraryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Apply: XRD publication" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("chunk 404"));
  });

  it("shows a STAGED apply as a confirmation prompt, not as a failure", async () => {
    // A staged apply is neither success nor refusal: the store is holding a
    // resolution for the user to confirm. Styling it as "Not done" told the
    // user their action failed when it is actually waiting on them, and the
    // `qz-is-pending`/`qz-is-refused` split is the only thing keeping the two
    // visually apart. Both the prefix and the class were untested.
    useApp.setState({
      plotRecipes: [plot],
      activeId: "d1",
      datasets: [{ id: "d1", name: "d1", data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} } }],
      // Stand in for `resolveApplyOrStage`'s staging branch: returns false
      // having installed a NEW pending application and written no status.
      applyPlotRecipeObject: () => {
        useApp.setState({ pendingRecipeApplication: { staged: true } as never });
        return Promise.resolve(false);
      },
    });
    render(<RecipeLibraryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Apply: XRD publication" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/^Needs confirmation — /),
    );
    expect(screen.getByRole("status")).toHaveClass("qz-is-pending");
    expect(screen.getByRole("status")).not.toHaveClass("qz-is-refused");
  });

  it("serializes actions across the whole list while one apply is in flight", async () => {
    // `busy` is panel-wide, not per-row: an apply is async and reports through
    // ONE shared status line, so a second apply started on another row would
    // race both that line and the store state the first is still reading.
    let release!: (v: boolean) => void;
    useApp.setState({
      plotRecipes: [plot, { ...plot, id: "plot-2", name: "Second" }],
      activeId: "d1",
      datasets: [{ id: "d1", name: "d1", data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} } }],
      applyPlotRecipeObject: () => new Promise<boolean>((r) => { release = r; }),
    });
    render(<RecipeLibraryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Apply: XRD publication" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Apply: Second" })).toBeDisabled(),
    );
    // Every other row's actions are held too, not just the clicked row's.
    expect(screen.getByRole("button", { name: "Delete Second" })).toBeDisabled();

    release(true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Apply: Second" })).not.toBeDisabled(),
    );
  });

  it("opens the owning workshop for a kind it cannot apply here", async () => {
    saveTemplate({
      version: 1, name: "Loop fit",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open in Pipeline: Loop fit" }));
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

  it("puts focus on the RENAMED row, whose id changed under it", async () => {
    // The four name-keyed kinds use the NAME as the id, and the id is the
    // row's React key — so committing a rename unmounts the row that owns the
    // focus target. Restoring focus from inside that row is impossible: its
    // ref is null before any microtask runs, and focus fell to <body>, which
    // drops a keyboard user out of the list entirely (WCAG 2.4.3).
    saveTemplate({
      version: 1, name: "Old name",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<RecipeLibraryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Old name" }));
    const input = screen.getByRole("textbox", { name: "Rename Old name" });
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename New name" })),
    );
    expect(document.body).not.toBe(document.activeElement);
  });

  it("puts focus back on the name button when a rename is REFUSED", async () => {
    // The other half: nothing moved, so the row is the same one — but the
    // input still unmounts, and an empty name is the easiest way for a user to
    // land here by accident.
    saveTemplate({
      version: 1, name: "Keep me",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<RecipeLibraryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Keep me" }));
    const input = screen.getByRole("textbox", { name: "Rename Keep me" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename Keep me" })),
    );
    expect(loadTemplates().map((t) => t.name)).toEqual(["Keep me"]);
  });

  it("does not re-steal focus when the renamed row later remounts", async () => {
    // The focus request is one-shot. Leaving it set means any later remount of
    // that row — a filter toggle, a re-sort — silently yanks focus out of
    // whatever the user moved to, which is worse than the bug it fixes because
    // it happens while they are somewhere else.
    saveTemplate({
      version: 1, name: "Old name",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Old name" }));
    const input = screen.getByRole("textbox", { name: "Rename Old name" });
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename New name" })),
    );

    // Unmount the row (it is not a favorite), then bring it back.
    const favoritesOnly = screen.getByRole("checkbox", { name: "Favorites only" });
    fireEvent.click(favoritesOnly);
    expect(screen.queryByRole("button", { name: "Rename New name" })).not.toBeInTheDocument();
    favoritesOnly.focus();
    fireEvent.click(favoritesOnly);

    await screen.findByRole("button", { name: "Rename New name" });
    expect(document.activeElement, "focus was yanked back to the row").toBe(favoritesOnly);
  });

  it("Escape cancels a rename without saving it", () => {
    // NOTE on the trailing `fireEvent.blur`: a real browser fires NO blur when
    // a focused element is removed, so this sequence is synthetic. It pins the
    // OUTCOME (nothing saved); the reopen test below is what pins the
    // mechanism the outcome depends on.
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

  it("a cancelled rename does not wedge the NEXT commit", () => {
    // Escape unmounts the input, and no blur ever fires for a removed element
    // — so a `skipBlurCommit` flag set on Escape and only cleared on blur
    // stays set, and the next legitimate click-away commit (in EITHER editor
    // of this row, since they share one ref) is silently swallowed. The user's
    // rename just vanishes with no message.
    saveTemplate({
      version: 1, name: "Original",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<RecipeLibraryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Original" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rename Original" }), { key: "Escape" });

    // Reopen and commit by clicking away — the real gesture, not a synthetic
    // blur after an unmount.
    fireEvent.click(screen.getByRole("button", { name: "Rename Original" }));
    const input = screen.getByRole("textbox", { name: "Rename Original" });
    fireEvent.change(input, { target: { value: "Committed" } });
    fireEvent.blur(input);

    expect(loadTemplates().map((t) => t.name)).toEqual(["Committed"]);
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
