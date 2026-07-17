// Integration: the Library composes the folder tree, and Origin figures nest
// inside it under their project folder (plan item 5). Verifies the wiring the
// buildTreeRows unit tests can't: that a figure actually renders as a tree row
// in tree mode, that the flat Figures section is hidden then (no duplication),
// and that it reappears in the flat no-folders mode.

import { act, fireEvent, render, screen } from "@testing-library/react";
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
    originFidelity: [],
    smartFolders: [],
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

// project-organization plan item 6: the group-chip UI (filter dropdown +
// collapsible group sections) is retired — folders are the one organizational
// model. A dataset that still carries a legacy `.group` (bypassing the
// loadWorkspace migration, e.g. set directly on the store as a stale/edited
// doc would) must NOT resurrect any of that UI; the flat-list fallback keeps
// rendering it normally instead.
describe("Library — group-chip UI retired (item 6)", () => {
  const grouped = (id: string, group: string): Dataset => ({ ...dsWith(id), group });

  it("never renders a group-filter dropdown, regardless of .group data", () => {
    useApp.setState({
      datasets: [grouped("a", "Batch A"), grouped("b", "Batch B")],
      activeId: "a",
      selectedIds: ["a"],
    });
    render(<Library />);
    expect(screen.queryByTitle("Filter the library to one group")).not.toBeInTheDocument();
    expect(screen.queryByText("All groups")).not.toBeInTheDocument();
  });

  it("never splits the list into collapsible group sections — falls back to a flat list", () => {
    useApp.setState({
      datasets: [grouped("a", "Batch A"), grouped("b", "Batch B")],
      activeId: "a",
      selectedIds: ["a"],
    });
    render(<Library />);
    // Both datasets render as plain rows, not headed by a "Batch A"/"Batch B"
    // collapsible section (the retired qzk-group-head rendering).
    expect(screen.queryByText("Batch A")).not.toBeInTheDocument();
    expect(screen.queryByText("Batch B")).not.toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });

  it("still renders normally (fallback intact) once folders exist alongside a stray .group", () => {
    useApp.setState({
      datasets: [grouped("a", "Batch A"), dsWith("b", "f1")],
      folders: [folder("f1", "F1")],
      expandedFolders: ["f1"],
      activeId: "a",
      selectedIds: ["a"],
    });
    render(<Library />);
    expect(screen.getByText("F1")).toBeInTheDocument(); // folder header renders
    expect(screen.getByText("a")).toBeInTheDocument(); // un-foldered dataset still shown at root
    expect(screen.getByText("b")).toBeInTheDocument(); // foldered dataset shown nested
  });
});

describe("Library — Show in folder reveal (GUI_INTERACTION_PLAN #13 sub-item 2)", () => {
  it("clears the filter, expands every ancestor folder, and selects the target", () => {
    useApp.setState({
      datasets: [dsWith("a", "child")],
      folders: [
        { id: "parent", name: "Parent", parentId: null, order: 0 },
        { id: "child", name: "Child", parentId: "parent", order: 0 },
      ],
      expandedFolders: [],
      activeId: null,
      selectedIds: [],
    });
    render(<Library />);
    const input = screen.getByPlaceholderText(/Filter/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "something" } });
    expect(input.value).toBe("something");

    act(() => {
      useApp.getState().requestReveal("a");
    });

    expect(input.value).toBe("");
    expect(useApp.getState().expandedFolders).toEqual(expect.arrayContaining(["parent", "child"]));
    expect(useApp.getState().selectedIds).toEqual(["a"]);
    expect(useApp.getState().revealTarget).toBeNull();
  });

  it("silently no-ops for a stale/removed dataset id", () => {
    useApp.setState({ datasets: [dsWith("a")], folders: [], expandedFolders: [], selectedIds: [] });
    render(<Library />);
    act(() => {
      useApp.getState().requestReveal("gone");
    });
    expect(useApp.getState().revealTarget).toBeNull();
    expect(useApp.getState().selectedIds).toEqual([]);
  });
});

describe("Library — multi-select bar (GUI_INTERACTION_PLAN #13 sub-item 3)", () => {
  it("is absent below 2 selected, appears at >=2 with the N-selected count", () => {
    useApp.setState({ datasets: [dsWith("a"), dsWith("b")], selectedIds: ["a"] });
    const { rerender } = render(<Library />);
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
    useApp.setState({ selectedIds: ["a", "b"] });
    rerender(<Library />);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("Clear empties the multi-selection", () => {
    useApp.setState({ datasets: [dsWith("a"), dsWith("b")], selectedIds: ["a", "b"] });
    render(<Library />);
    fireEvent.click(screen.getByText("Clear"));
    expect(useApp.getState().selectedIds).toEqual([]);
  });
});

describe("Library — smart-folder query grammar in the filter box (item 9)", () => {
  const tagged = (id: string, tags: string[]): Dataset => ({ ...dsWith(id), tags });

  it("a bare term still matches name OR tag (historical behavior)", () => {
    useApp.setState({ datasets: [tagged("loop.dat", ["MvsH"]), dsWith("xrd.raw")] });
    render(<Library />);
    const input = screen.getByPlaceholderText(/Filter/);
    fireEvent.change(input, { target: { value: "mvsh" } });
    expect(screen.getByText("loop.dat")).toBeInTheDocument();
    expect(screen.queryByText("xrd.raw")).not.toBeInTheDocument();
  });

  it("tag: narrows to tags only", () => {
    useApp.setState({
      datasets: [tagged("loop.dat", ["MvsH"]), dsWith("mvsh-named-but-untagged.dat")],
    });
    render(<Library />);
    fireEvent.change(screen.getByPlaceholderText(/Filter/), { target: { value: "tag:mvsh" } });
    expect(screen.getByText("loop.dat")).toBeInTheDocument();
    expect(screen.queryByText("mvsh-named-but-untagged.dat")).not.toBeInTheDocument();
  });

  it("offers ☆ save-as-smart-folder only while a query is typed", () => {
    useApp.setState({ datasets: [dsWith("a")], smartFolders: [] });
    render(<Library />);
    expect(screen.queryByTitle(/Save this filter/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Filter/), { target: { value: "tag:x" } });
    expect(screen.getByTitle(/Save this filter/)).toBeInTheDocument();
  });

  it("renders the smart-folders section when saved queries exist", () => {
    useApp.setState({
      datasets: [tagged("loop.dat", ["MvsH"])],
      smartFolders: [{ id: "s1", name: "Loops", query: "tag:mvsh" }],
    });
    render(<Library />);
    expect(screen.getByText("Smart folders")).toBeInTheDocument();
    expect(screen.getByText("☆ Loops")).toBeInTheDocument();
  });
});
