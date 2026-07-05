// Integration: the Library composes the folder tree, and Origin figures nest
// inside it under their project folder (plan item 5). Verifies the wiring the
// buildTreeRows unit tests can't: that a figure actually renders as a tree row
// in tree mode, that the flat Figures section is hidden then (no duplication),
// and that it reappears in the flat no-folders mode.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import Library from "./Library";
import type { OriginFigureEntry } from "../../lib/originFigures";
import type { Dataset, FolderNode } from "../../lib/types";
import { useApp } from "../../store/useApp";

const dsWith = (id: string, folderId?: string): Dataset => ({
  id,
  name: id,
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} },
  ...(folderId ? { folderId } : {}),
});
const folder = (id: string, name: string): FolderNode => ({ id, name, parentId: null, order: 0 });
const figEntry = (id: string, datasetId: string | null, name: string): OriginFigureEntry => ({
  id,
  stem: "Moke",
  datasetId,
  siblingIds: datasetId ? [datasetId] : [],
  figure: {
    name,
    x_from: 0,
    x_to: 1,
    x_log: false,
    y_from: 0,
    y_to: 1,
    y_log: false,
    n_curves: 1,
    annotations: [],
  },
});

beforeEach(() => {
  useApp.setState({
    datasets: [],
    folders: [],
    expandedFolders: [],
    originFigures: [],
    activeId: null,
    selectedIds: [],
  });
});

describe("Library — figures nested in the tree", () => {
  it("renders a figure inside the tree and hides the flat Figures section (folders exist)", () => {
    useApp.setState({
      datasets: [dsWith("a", "f1")],
      folders: [folder("f1", "Project")],
      expandedFolders: ["f1"],
      originFigures: [figEntry("g1", "a", "MokeGraph")],
      activeId: "a",
      selectedIds: ["a"],
    });
    render(<Library />);
    expect(screen.getByText("Project")).toBeInTheDocument(); // folder header
    expect(screen.getByRole("button", { name: /MokeGraph/ })).toBeInTheDocument(); // figure row
    // The flat "Figures" section header must be absent in tree mode (no dup).
    expect(screen.queryByText("Figures")).not.toBeInTheDocument();
  });

  it("shows figures in the flat Figures section when there are no folders", () => {
    useApp.setState({
      datasets: [dsWith("a")],
      originFigures: [figEntry("g1", "a", "MokeGraph")],
      activeId: "a",
      selectedIds: ["a"],
    });
    render(<Library />);
    expect(screen.getByText("Figures")).toBeInTheDocument(); // flat section header present
    expect(screen.getByRole("button", { name: /MokeGraph/ })).toBeInTheDocument();
  });
});
