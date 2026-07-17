// PlotSpecBar tests (GUI_INTERACTION_PLAN #11) — the Save/Save As/Open/
// Duplicate/Rename/Delete toolbar. askParams/askConfirm are the app's global
// promise-based dialogs (mounted once at the root); mocked here the same way
// lib/exportFigureCommand.test.ts mocks them, so this stays a pure props-in
// component test with no store/overlay mounting required.

import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedPlotSpec } from "../../../lib/plotspec";
import PlotSpecBar from "./PlotSpecBar";

vi.mock("../../overlays/ParamDialog", () => ({
  askParams: vi.fn(),
}));
vi.mock("../../overlays/ConfirmDialog", () => ({
  askConfirm: vi.fn(),
}));

import { askConfirm } from "../../overlays/ConfirmDialog";
import { askParams } from "../../overlays/ParamDialog";

beforeEach(() => {
  vi.clearAllMocks();
});

const specA: SavedPlotSpec = {
  id: "a",
  name: "Alpha",
  createdAt: "2026-01-01T00:00:00.000Z",
  modifiedAt: "2026-01-03T00:00:00.000Z",
  spec: { version: 1, zones: { x: null, y: [], group: null, facet: null }, mark: "scatter" },
};
const specB: SavedPlotSpec = {
  id: "b",
  name: "Beta",
  createdAt: "2026-01-01T00:00:00.000Z",
  modifiedAt: "2026-01-02T00:00:00.000Z",
  spec: specA.spec,
};

function baseProps() {
  return {
    specs: [] as SavedPlotSpec[],
    activeSpec: null as SavedPlotSpec | null,
    dirty: false,
    canSave: true,
    onSaveActive: vi.fn(),
    onSaveAs: vi.fn(),
    onOpen: vi.fn(),
    onDuplicate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  };
}

describe("PlotSpecBar — name + dirty display", () => {
  it("shows 'Unsaved graph' with no dirty dot when nothing is active", () => {
    const { getByText, container } = render(<PlotSpecBar {...baseProps()} />);
    expect(getByText("Unsaved graph")).toBeInTheDocument();
    expect(container.querySelector(".qz-dot")).toBeNull();
  });

  it("shows the active spec's name", () => {
    const { getByText } = render(<PlotSpecBar {...baseProps()} activeSpec={specA} />);
    expect(getByText("Alpha")).toBeInTheDocument();
  });

  it("shows a dirty dot only when dirty AND bound to an active spec", () => {
    const { container } = render(<PlotSpecBar {...baseProps()} activeSpec={specA} dirty />);
    expect(container.querySelector(".qz-dot")).not.toBeNull();
  });

  it("disables Save/Save As when canSave is false", () => {
    const { getByText } = render(<PlotSpecBar {...baseProps()} canSave={false} />);
    expect(getByText("Save")).toBeDisabled();
    expect(getByText("Save As…")).toBeDisabled();
  });
});

describe("PlotSpecBar — Save / Save As", () => {
  it("Save with nothing active prompts a name, then calls onSaveAs", async () => {
    vi.mocked(askParams).mockResolvedValueOnce({ name: "New graph" });
    const props = baseProps();
    const { getByText } = render(<PlotSpecBar {...props} />);
    fireEvent.click(getByText("Save"));
    await waitFor(() => expect(props.onSaveAs).toHaveBeenCalledWith("New graph"));
    expect(props.onSaveActive).not.toHaveBeenCalled();
  });

  it("Save with an active spec calls onSaveActive directly, no prompt", () => {
    const props = baseProps();
    const { getByText } = render(<PlotSpecBar {...props} activeSpec={specA} />);
    fireEvent.click(getByText("Save"));
    expect(props.onSaveActive).toHaveBeenCalledTimes(1);
    expect(askParams).not.toHaveBeenCalled();
  });

  it("Save As always prompts, even with an active spec, and cancel is a no-op", async () => {
    vi.mocked(askParams).mockResolvedValueOnce(null);
    const props = baseProps();
    const { getByText } = render(<PlotSpecBar {...props} activeSpec={specA} />);
    fireEvent.click(getByText("Save As…"));
    await waitFor(() => expect(askParams).toHaveBeenCalled());
    expect(props.onSaveAs).not.toHaveBeenCalled();
  });

  it("Save As prefills the active spec's name as the dialog default", async () => {
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Alpha" });
    const props = baseProps();
    const { getByText } = render(<PlotSpecBar {...props} activeSpec={specA} />);
    fireEvent.click(getByText("Save As…"));
    await waitFor(() => expect(askParams).toHaveBeenCalled());
    const fields = vi.mocked(askParams).mock.calls[0][1];
    expect(fields[0].default).toBe("Alpha");
  });
});

describe("PlotSpecBar — saved list", () => {
  it("shows an empty-state hint when there are no saved graphs", () => {
    const { getByText } = render(<PlotSpecBar {...baseProps()} />);
    expect(getByText(/No saved graphs yet/)).toBeInTheDocument();
  });

  it("lists every saved spec, most-recently-modified first", () => {
    const { getByText, container } = render(<PlotSpecBar {...baseProps()} specs={[specA, specB]} />);
    const rows = Array.from(container.querySelectorAll(".qzk-plotspec-open")).map((el) => el.textContent);
    expect(rows).toEqual(["Alpha", "Beta"]); // A modified 01-03, B modified 01-02
    expect(getByText("Alpha")).toBeInTheDocument();
  });

  it("clicking a row's name calls onOpen with its id", () => {
    const props = baseProps();
    const { getByText } = render(<PlotSpecBar {...props} specs={[specA]} />);
    fireEvent.click(getByText("Alpha"));
    expect(props.onOpen).toHaveBeenCalledWith("a");
  });

  it("marks the active row", () => {
    const { container } = render(<PlotSpecBar {...baseProps()} specs={[specA, specB]} activeSpec={specB} />);
    const active = container.querySelector(".qzk-plotspec-row.active");
    expect(active?.textContent).toContain("Beta");
  });

  it("Duplicate calls onDuplicate directly, no dialog", () => {
    const props = baseProps();
    const { getByLabelText } = render(<PlotSpecBar {...props} specs={[specA]} />);
    fireEvent.click(getByLabelText("Duplicate Alpha"));
    expect(props.onDuplicate).toHaveBeenCalledWith("a");
    expect(askParams).not.toHaveBeenCalled();
  });

  it("Rename prompts a name (prefilled with the current name), then calls onRename", async () => {
    vi.mocked(askParams).mockResolvedValueOnce({ name: "Alpha v2" });
    const props = baseProps();
    const { getByLabelText } = render(<PlotSpecBar {...props} specs={[specA]} />);
    fireEvent.click(getByLabelText("Rename Alpha"));
    await waitFor(() => expect(props.onRename).toHaveBeenCalledWith("a", "Alpha v2"));
    const fields = vi.mocked(askParams).mock.calls[0][1];
    expect(fields[0].default).toBe("Alpha");
  });

  it("Delete confirms before calling onDelete; cancel keeps the entry", async () => {
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    const props = baseProps();
    const { getByLabelText } = render(<PlotSpecBar {...props} specs={[specA]} />);
    fireEvent.click(getByLabelText("Delete Alpha"));
    await waitFor(() => expect(askConfirm).toHaveBeenCalled());
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("Delete calls onDelete once confirmed", async () => {
    vi.mocked(askConfirm).mockResolvedValueOnce(true);
    const props = baseProps();
    const { getByLabelText } = render(<PlotSpecBar {...props} specs={[specA]} />);
    fireEvent.click(getByLabelText("Delete Alpha"));
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith("a"));
  });
});
