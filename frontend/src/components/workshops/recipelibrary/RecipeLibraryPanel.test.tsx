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
  useApp.setState({ plotRecipes: [], quickPlotTemplates: [] });
  useGlobalPlotRecipes.setState({ recipes: [], hydrated: true });
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
    useApp.setState({ plotRecipes: [plot] });
    render(<RecipeLibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Add XRD publication to favorites/ }));
    expect(metaFor({ kind: "plot", scope: "project", id: "plot-1" }).favorite).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Favorites only" }));
    expect(screen.getByText("XRD publication")).toBeInTheDocument();
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
