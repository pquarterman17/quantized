import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureRecipe } from "../../../lib/plotRecipe";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { useApp } from "../../../store/useApp";
import BatchFigureBuilder from "./BatchFigureBuilder";

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

function dataset(id: string, labels = ["2theta", "Intensity"]): Dataset {
  return {
    id,
    name: `${id}.csv`,
    data: {
      time: [0, 1],
      values: labels.map((_, index) => [index + 1, index + 2]),
      labels,
      units: labels.map(() => ""),
      metadata: { technique: "xrd.powder" },
    },
  };
}

beforeEach(() => {
  const source = dataset("source");
  const recipe = captureRecipe(
    source,
    { ...defaultPlotView(), xKey: 0, yKeys: [1] },
    null,
    { id: "recipe-1", name: "Line recipe", appVersion: "test" },
  );
  useGlobalPlotRecipes.setState({ recipes: [], hydrated: true, complete: true });
  useApp.setState({
    datasets: [dataset("target")],
    folders: [],
    workbooks: [],
    plotRecipes: [recipe],
    selectedIds: ["target"],
    activeId: "target",
    librarySelection: null,
    editableFigures: [],
    pages: [],
    figurePageOpen: false,
    pageDocSeed: null,
    history: [],
    future: [],
  });
});

describe("Batch Figure Builder safety", () => {
  it("revalidates a changed worksheet immediately before committing", async () => {
    render(<BatchFigureBuilder seedDatasetIds={["target"]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check compatibility" }));
    await screen.findByRole("button", { name: "Create 1 figure" });

    useApp.setState({ datasets: [dataset("target", ["2theta"])] });
    fireEvent.click(screen.getByRole("button", { name: "Create 1 figure" }));

    await waitFor(() => expect(screen.getByText("Cannot build")).toBeInTheDocument());
    expect(useApp.getState().editableFigures).toHaveLength(0);
    expect(useApp.getState().pages).toHaveLength(0);
  });

  it("stops an in-progress compatibility check without changing the project", async () => {
    render(<BatchFigureBuilder seedDatasetIds={["target"]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check compatibility" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    await screen.findByRole("button", { name: "Check compatibility" });
    expect(useApp.getState().editableFigures).toHaveLength(0);
    expect(useApp.getState().pages).toHaveLength(0);
    expect(useApp.getState().history).toHaveLength(0);
  });
});
