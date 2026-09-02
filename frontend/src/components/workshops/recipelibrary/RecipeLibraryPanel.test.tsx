import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveCustomModel } from "../../../lib/fitmodels";
import type { PlotRecipe } from "../../../lib/plotRecipeSchema";
import { makeStep } from "../../../lib/pipeline";
import { metaFor, recordUse, setFavorite } from "../../../lib/recipeIndex";
import { supportsOperation } from "../../../lib/recipeLibrary";
import { loadTemplates, saveTemplate } from "../../../lib/template";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { useRecipeManager } from "../../../store/recipeManager";
import { useApp } from "../../../store/useApp";
import ConfirmDialog from "../../overlays/ConfirmDialog";
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
    fireEvent.click(screen.getByRole("button", { name: "More actions for Loop fit" }));
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Export…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Copy to/ })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveClass("danger");
  });

  // P3.5: peak/graph/fitModel gained real serializers, and their row menus
  // must show Export now — inverting the earlier "no serializer" pin rather
  // than deleting it (recipeActions.test.ts / recipeIndex.test.ts carry the
  // dispatcher/capability-table halves of this same inversion).
  it("shows Export for peak, graph, and fit model rows now that they have real serializers", () => {
    saveCustomModel({
      version: 1, name: "Arrhenius", equation: "y=a*x", params: ["a"], guesses: [1], lower: [null], upper: [null],
    });
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Arrhenius" }));
    expect(screen.getByRole("menuitem", { name: "Export…" })).toBeInTheDocument();
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
    // Every other row's actions and inline metadata controls are held too,
    // not just the clicked row's primary button.
    expect(screen.getByRole("button", { name: "More actions for Second" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rename Second" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit tags for Second" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add Second to favorites" })).toBeDisabled();

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

  it("choosing Rename from the overflow menu leaves focus IN the editor", async () => {
    // ContextMenu calls onClose BEFORE the item's run(), so a menu that
    // unconditionally refocuses its trigger queues that focus FIRST and lands
    // it LAST — after the editor's autoFocus. The editor opened and the caret
    // sat on the ⋯ button, so a keyboard user's keystrokes went nowhere.
    saveTemplate({
      version: 1, name: "Loop fit",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<RecipeLibraryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "More actions for Loop fit" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = await screen.findByRole("textbox", { name: "Rename Loop fit" });
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("returns focus to the ⋯ trigger for an item that claims no focus of its own", async () => {
    // The other half of the same guard. Duplicate leaves nothing focused once
    // the menu unmounts, so focus WOULD fall to <body> and strand a keyboard
    // user outside the list; the trigger is the stable landing point. Pinning
    // only the Rename case would let the whole restore be deleted.
    saveTemplate({
      version: 1, name: "Loop fit",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<RecipeLibraryPanel />);

    const trigger = screen.getByRole("button", { name: "More actions for Loop fit" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(loadTemplates()).toHaveLength(2);
  });

  it("does not freeze an OPEN editor when an apply starts on another row", async () => {
    // `busy` gates opening an editor, not one already open. Disabling a live
    // <input> stranded the user's half-typed text for the duration of an
    // unrelated apply — and a real browser blurs a disabled element, dropping
    // focus to <body>. (jsdom keeps activeElement on a disabled input, so only
    // the freeze is assertable here.)
    let release!: (v: boolean) => void;
    useApp.setState({
      plotRecipes: [plot, { ...plot, id: "plot-2", name: "Second" }],
      activeId: "d1",
      datasets: [{ id: "d1", name: "d1", data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} } }],
      applyPlotRecipeObject: () => new Promise<boolean>((r) => { release = r; }),
    });
    render(<RecipeLibraryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Rename XRD publication" }));
    const input = screen.getByRole("textbox", { name: "Rename XRD publication" });
    fireEvent.change(input, { target: { value: "Half typed name" } });

    fireEvent.click(screen.getByRole("button", { name: "Apply: Second" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Apply: Second" })).toBeDisabled(),
    );

    const live = screen.getByRole("textbox", { name: "Rename XRD publication" });
    expect(live, "the open editor was disabled mid-edit").not.toBeDisabled();
    expect((live as HTMLInputElement).value).toBe("Half typed name");

    release(true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Apply: Second" })).not.toBeDisabled(),
    );
  });

  it("deletes through the overflow menu once the confirm is accepted", async () => {
    // Delete moved off the row and behind the ⋯ menu, onto a path nothing
    // exercised end to end — not here and not before this change. The wording
    // matters as much as the deletion: this dialog is the only gate, so it has
    // to name the kind and scope (a peak recipe and a graph template can both
    // be called "Standard") and say whether undo will help.
    saveTemplate({
      version: 1, name: "Doomed",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<><RecipeLibraryPanel /><ConfirmDialog /></>);

    fireEvent.click(screen.getByRole("button", { name: "More actions for Doomed" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName('Delete analysis template "Doomed" (global)?');
    expect(dialog).toHaveAccessibleDescription("This cannot be undone.");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(loadTemplates()).toHaveLength(0));
  });

  it("a CANCELLED delete puts focus back on the row's ⋯ trigger", async () => {
    // ConfirmDialog restores focus to whatever was focused when it opened, and
    // the clicked menu item is already detached by then — so the row has to
    // claim focus before opening the dialog. Otherwise backing out of a delete
    // drops the user on <body>, out of the list entirely.
    saveTemplate({
      version: 1, name: "Safe",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<><RecipeLibraryPanel /><ConfirmDialog /></>);

    const trigger = screen.getByRole("button", { name: "More actions for Safe" });
    const focusSpy = vi.spyOn(trigger, "focus");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await screen.findByRole("dialog");
    // The pre-dialog focus is a focus() like any other on this row, and the
    // menu can close on scroll — so it carries preventScroll too.
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    focusSpy.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(loadTemplates().map((t) => t.name)).toEqual(["Safe"]);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "More actions for Safe" }),
    );
  });

  it("a scroll that closes the menu does not drag the viewport back to the row", async () => {
    // ContextMenu closes on scroll and resize as well as on item-run, so the
    // trigger refocus fires on a plain scroll too. A bare focus() scrolls that
    // button into view — fighting the very scroll that closed the menu. Only
    // the call contract is assertable here: jsdom does not scroll, so a test
    // that merely watched the viewport would pass either way.
    saveTemplate({
      version: 1, name: "Loop fit",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<RecipeLibraryPanel />);

    const trigger = screen.getByRole("button", { name: "More actions for Loop fit" });
    const focusSpy = vi.spyOn(trigger, "focus");
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();

    fireEvent.scroll(window);

    // Wait on STATE (the menu is gone), not on the spy — the weak-wait ratchet
    // in architecture.test.ts bans the latter, and the microtask that refocuses
    // has necessarily run by the time the unmount is observable.
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument(),
    );
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    focusSpy.mockRestore();
  });

  it("Escape out of the menu leaves focus on the trigger, not on <body>", async () => {
    // Claimed in review and never pinned: ContextMenu restores the pre-open
    // focus itself on Escape, so the trigger guard sees a non-<body> target
    // and no-ops. Both paths converge on the same element — this pins the
    // user-visible outcome rather than which of the two got there first.
    saveTemplate({
      version: 1, name: "Loop fit",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: [],
    });
    render(<RecipeLibraryPanel />);

    const trigger = screen.getByRole("button", { name: "More actions for Loop fit" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(trigger);
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

  it("duplicates a quickPlot template from its row menu", async () => {
    // Seed through the real store rather than a hand-rolled QuickPlotTemplate
    // object: `lib/recipeSources.ts` reads `t.signature.channels.length`, and
    // a partial fixture crashes the render.
    useApp.setState({
      datasets: [{
        id: "d1",
        name: "d1.dat",
        data: {
          time: [0, 1, 2],
          values: [[1, 10], [2, 20], [3, 30]],
          labels: ["A", "B"],
          units: ["", ""],
          metadata: { technique: "magnetometry.mvsh" },
        },
      }],
    });
    useApp.getState().saveQuickPlotTemplate(
      "d1",
      { xKey: null, yKeys: [0], errorBindings: [], ignoredKeys: [1] },
      "line",
      "Quick one",
      { kind: "schema" },
    );
    render(<RecipeLibraryPanel />);

    fireEvent.click(screen.getByRole("button", { name: "More actions for Quick one" }));
    const item = screen.getByRole("menuitem", { name: "Duplicate" });
    expect(item).toBeInTheDocument();
    fireEvent.click(item);

    await waitFor(() => expect(useApp.getState().quickPlotTemplates).toHaveLength(2));
    expect(screen.getByText("Quick one copy")).toBeInTheDocument();
  });
});

describe("library-level import (P3.5 slice 4)", () => {
  beforeEach(() => {
    localStorage.clear();
    useApp.setState({ plotRecipes: [], quickPlotTemplates: [], recipeSourcesComplete: true });
    useGlobalPlotRecipes.setState({ recipes: [], hydrated: true, complete: true });
    useRecipeManager.setState({ open: true, library: true });
  });

  it("imports a recipe file, lands a new row, and hands it focus", async () => {
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Import recipe…" }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(
      [
        JSON.stringify({
          version: 1,
          name: "Loop fit",
          steps: [{ kind: "expression", label: "smooth", code: "qz.smooth(5)", params: {} }],
          outputs: [],
        }),
      ],
      "Loop fit.qzt.json",
      { type: "application/json" },
    );
    Object.defineProperty(fileInput, "files", { value: [file] });
    fireEvent.change(fileInput);

    // Wait on STATE (the row's presence and where focus landed), not on a mock.
    await waitFor(() => expect(screen.getByText("Loop fit")).toBeInTheDocument());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename Loop fit" })),
    );
    expect(screen.getByText(/imported "Loop fit"/)).toBeInTheDocument();
  });

  it("shows a refusal on the status line for a file it does not recognise", async () => {
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Import recipe…" }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["not json"], "bad.json", { type: "application/json" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    fireEvent.change(fileInput);

    expect(await screen.findByText(/Not done — /)).toBeInTheDocument();
  });
});

describe("row details disclosure (P3.5 slice 4)", () => {
  beforeEach(() => {
    localStorage.clear();
    useApp.setState({
      datasets: [], activeId: null, plotRecipes: [], quickPlotTemplates: [],
      recipeSourcesComplete: true, pipelineOpen: false, status: "",
    });
    useGlobalPlotRecipes.setState({ recipes: [], hydrated: true, complete: true });
    useRecipeManager.setState({ open: true, library: true });
  });

  it("toggles aria-expanded and reveals the schema-version line, then hides it again", () => {
    useApp.setState({ plotRecipes: [plot] });
    render(<RecipeLibraryPanel />);
    const toggle = screen.getByRole("button", { name: "Show details for XRD publication" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Collapsed: the region is unmounted, so an IDREF to it would dangle.
    expect(toggle).not.toHaveAttribute("aria-controls");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Schema version")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    // Expanded: `aria-controls` names the region that actually exists.
    const regionId = toggle.getAttribute("aria-controls");
    expect(regionId).toBeTruthy();
    expect(document.getElementById(regionId as string)).toContainElement(screen.getByText("Schema version"));

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveAttribute("aria-controls");
    expect(screen.queryByText("Schema version")).not.toBeInTheDocument();
  });

  it("shows a fit model's equation once its Details are opened", () => {
    saveCustomModel({
      version: 1,
      name: "Arrhenius",
      equation: "y = a*exp(-x/t) + c",
      params: ["a", "t", "c"],
      guesses: [1, 2, 3],
      lower: [null, 0, null],
      upper: [10, null, null],
    });
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Show details for Arrhenius" }));
    expect(screen.getByText("y = a*exp(-x/t) + c")).toBeInTheDocument();
  });

  it("a quickPlot row's details say unversioned and never list Export among available actions", () => {
    useApp.setState({
      datasets: [{
        id: "d1",
        name: "d1.dat",
        data: {
          time: [0, 1, 2],
          values: [[1, 10], [2, 20], [3, 30]],
          labels: ["A", "B"],
          units: ["", ""],
          metadata: { technique: "magnetometry.mvsh" },
        },
      }],
    });
    useApp.getState().saveQuickPlotTemplate(
      "d1",
      { xKey: null, yKeys: [0], errorBindings: [], ignoredKeys: [1] },
      "line",
      "Quick one",
      { kind: "schema" },
    );
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Show details for Quick one" }));
    expect(screen.getByText("unversioned")).toBeInTheDocument();
    const actionsRow = screen.getByText("Available actions").closest(".qz-recipe-details-row");
    expect(actionsRow?.textContent).not.toMatch(/Export/);
  });
});
