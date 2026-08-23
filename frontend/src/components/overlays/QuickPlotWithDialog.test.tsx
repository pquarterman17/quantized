// PR H5b: the "Quick Plot With..." chooser dialog.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../lib/types";
import type { QuickPlotTemplate } from "../../lib/quickPlotTemplates";
import { useApp } from "../../store/useApp";
import { openQuickPlotWith, openQuickPlotWithForWorkbook, useQuickPlotWithDialog } from "../../store/quickPlotWithDialog";
import QuickPlotWithDialog from "./QuickPlotWithDialog";

function dataset(id: string, technique = "magnetometry.mvsh", workbookId?: string): Dataset {
  return {
    id,
    name: `${id}.dat`,
    workbookId,
    data: {
      time: [0, 1, 2],
      values: [[1, 10], [2, 20], [3, 30]],
      labels: ["A", "B"],
      units: ["", ""],
      metadata: { technique },
    },
  };
}

function template(overrides: Partial<QuickPlotTemplate> = {}): QuickPlotTemplate {
  return {
    id: "qpt-1",
    name: "My Template",
    createdAt: "x",
    modifiedAt: "x",
    scope: { kind: "schema" },
    technique: "magnetometry.mvsh",
    signature: { channels: [] },
    mapping: { xKey: null, yKeys: [0], errorBindings: [], ignoredKeys: [1] },
    style: "line",
    labels: { 0: "A" },
    ...overrides,
  };
}

beforeEach(() => {
  useApp.setState({
    datasets: [dataset("d1")],
    quickPlotTemplates: [],
    editableFigures: [],
    plotWindows: [],
    history: [],
    future: [],
    status: "",
  });
  useQuickPlotWithDialog.setState({ datasetId: null, workbookId: null });
});

describe("QuickPlotWithDialog — visibility", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<QuickPlotWithDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a fallback when the target dataset has vanished", () => {
    openQuickPlotWith("ghost");
    render(<QuickPlotWithDialog />);
    expect(screen.getByText("The source worksheet was removed.")).toBeInTheDocument();
  });
});

describe("QuickPlotWithDialog — listing + apply", () => {
  it("lists a resolvable template as enabled, and clicking applies + closes", () => {
    useApp.setState({ quickPlotTemplates: [template()] });
    openQuickPlotWith("d1");
    render(<QuickPlotWithDialog />);

    const btn = screen.getByRole("button", { name: /My Template/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    expect(useApp.getState().editableFigures).toHaveLength(1);
    expect(useQuickPlotWithDialog.getState().datasetId).toBeNull();
  });

  it("lists a mismatched template as disabled with the reason, and it stays open on click", () => {
    useApp.setState({ quickPlotTemplates: [template({ technique: "xrd.powder" })] });
    openQuickPlotWith("d1");
    render(<QuickPlotWithDialog />);

    const btn = screen.getByRole("button", { name: /My Template/ });
    expect(btn).toBeDisabled();
    expect(useApp.getState().editableFigures).toHaveLength(0);
  });

  it("shows an empty-state message when no template is in scope", () => {
    openQuickPlotWith("d1");
    render(<QuickPlotWithDialog />);
    expect(screen.getByText(/No saved Quick Plot templates apply/)).toBeInTheDocument();
  });

  it("filters out a workbook-scoped template for a dataset outside that workbook", () => {
    useApp.setState({ quickPlotTemplates: [template({ scope: { kind: "workbook", workbookId: "wb-other" } })] });
    openQuickPlotWith("d1");
    render(<QuickPlotWithDialog />);
    expect(screen.getByText(/No saved Quick Plot templates apply/)).toBeInTheDocument();
  });
});

describe("QuickPlotWithDialog — inline rename/delete (the manage surface)", () => {
  it("renames a template inline", () => {
    useApp.setState({ quickPlotTemplates: [template()] });
    openQuickPlotWith("d1");
    render(<QuickPlotWithDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Rename My Template" });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useApp.getState().quickPlotTemplates[0].name).toBe("Renamed");
  });

  it("deletes a template", () => {
    useApp.setState({ quickPlotTemplates: [template()] });
    openQuickPlotWith("d1");
    render(<QuickPlotWithDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(useApp.getState().quickPlotTemplates).toHaveLength(0);
  });
});

describe("QuickPlotWithDialog — workbook-only mode (review-round P2b)", () => {
  it("lists a workbook-scoped template as disabled with 'workbook has no worksheets', reviewer's exact probe", () => {
    useApp.setState({
      quickPlotTemplates: [template({ scope: { kind: "workbook", workbookId: "w1" } })],
    });
    openQuickPlotWithForWorkbook("w1");
    render(<QuickPlotWithDialog />);

    const btn = screen.getByRole("button", { name: /My Template/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("workbook has no worksheets");
  });

  it("rename and delete stay fully functional in workbook-only mode", () => {
    useApp.setState({
      quickPlotTemplates: [template({ scope: { kind: "workbook", workbookId: "w1" } })],
    });
    openQuickPlotWithForWorkbook("w1");
    render(<QuickPlotWithDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Rename My Template" });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useApp.getState().quickPlotTemplates[0].name).toBe("Renamed");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(useApp.getState().quickPlotTemplates).toHaveLength(0);
  });

  it("filters to only THIS workbook's own workbook-scoped templates -- a schema-scoped template is not listed (nothing to resolve it against)", () => {
    useApp.setState({
      quickPlotTemplates: [
        template({ id: "schema-one", scope: { kind: "schema" } }),
        template({ id: "other-wb", scope: { kind: "workbook", workbookId: "w-other" } }),
      ],
    });
    openQuickPlotWithForWorkbook("w1");
    render(<QuickPlotWithDialog />);
    expect(screen.getByText(/No Quick Plot templates are scoped to this workbook/)).toBeInTheDocument();
  });

  it("does not render the dataset-vanished fallback in workbook-only mode", () => {
    openQuickPlotWithForWorkbook("w1");
    render(<QuickPlotWithDialog />);
    expect(screen.queryByText("The source worksheet was removed.")).not.toBeInTheDocument();
  });
});

describe("QuickPlotWithDialog — close", () => {
  it("Close button clears the dialog state", () => {
    openQuickPlotWith("d1");
    render(<QuickPlotWithDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useQuickPlotWithDialog.getState().datasetId).toBeNull();
  });

  it("Escape clears the dialog state", () => {
    openQuickPlotWith("d1");
    const { container } = render(<QuickPlotWithDialog />);
    fireEvent.keyDown(container.querySelector(".qz-dialog")!, { key: "Escape" });
    expect(useQuickPlotWithDialog.getState().datasetId).toBeNull();
  });
});
