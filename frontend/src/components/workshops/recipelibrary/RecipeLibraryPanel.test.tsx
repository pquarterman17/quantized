import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { PlotRecipe } from "../../../lib/plotRecipeSchema";
import { metaFor } from "../../../lib/recipeIndex";
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
