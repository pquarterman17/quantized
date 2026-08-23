// ORIGIN_FILE_DECODE_PLAN #38: a lazy Origin book opened in the worksheet
// must (a) render without crashing on its small preview `data`, (b) show a
// "loading full data" banner, and (c) trigger ensureBookData so the full
// data arrives without the user needing to do anything else.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useRecode } from "../../../store/recode";
import { useApp } from "../../../store/useApp";
import WorksheetPane from "./WorksheetPane";

const lazyDataset: Dataset = {
  id: "lazy1",
  name: "PNR:Book2",
  data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: ["Oe"], metadata: {} },
  pending: { kind: "path", path: "/PNR.opj", bookId: "Book2", rows: 5000, cols: 4 },
};

const fullDataset: Dataset = {
  id: "full1",
  name: "PNR:Book1",
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["A"], units: ["Oe"], metadata: {} },
};

beforeEach(() => {
  useApp.setState({ datasets: [lazyDataset, fullDataset] });
});

describe("WorksheetPane pending lazy book", () => {
  it("shows a loading banner and triggers ensureBookData for a pending dataset", () => {
    // Stub out the real fetch — this test only asserts the render-side
    // TRIGGER fires; useApp.test.ts covers ensureBookData's own fetch/install
    // behavior against a mocked api.fetchBookData.
    const spy = vi.spyOn(useApp.getState(), "ensureBookData").mockImplementation(() => {});
    render(<WorksheetPane datasetId="lazy1" />);
    expect(screen.getByText(/Loading full data/)).toBeInTheDocument();
    expect(screen.getByText(/5000 rows/)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("lazy1");
  });

  it("shows no loading banner for a fully-loaded dataset", () => {
    render(<WorksheetPane datasetId="full1" />);
    expect(screen.queryByText(/Loading full data/)).not.toBeInTheDocument();
  });
});

// GUI_INTERACTION #14: this is the reported bug end-to-end — two worksheet
// DOCUMENT windows (distinct `windowId`s) on the SAME dataset must select
// independently, with no visible cross-window highlight.
describe("WorksheetPane window-scoped selection (GUI_INTERACTION #14)", () => {
  it("selecting a row in one window's grid never highlights it in another window on the same dataset", () => {
    const a = render(<WorksheetPane datasetId="full1" windowId="win-a" />);
    const b = render(<WorksheetPane datasetId="full1" windowId="win-b" />);
    // Row-number gutter click selects that row (mirrors Worksheet.test.tsx's
    // "Worksheet row selection" convention) — click row index 1 ("2") in A only.
    fireEvent.click(within(a.container).getByText("2"));
    expect(within(a.container).getByText("1 selected")).toBeInTheDocument();
    expect(within(b.container).queryByText(/selected/)).not.toBeInTheDocument();
    // The Stage tab's legacy singleton (no windowId anywhere here) is untouched.
    expect(useApp.getState().selection).toBeNull();
  });

  it("no 'Linked to plot' badge on either document window (never linked, unlike the Stage tab)", () => {
    useApp.setState({ activeId: "full1" }); // even though its OWN dataset IS active
    const a = render(<WorksheetPane datasetId="full1" windowId="win-a" />);
    expect(within(a.container).queryByText(/Linked to plot/)).not.toBeInTheDocument();
  });
});

// J2: the "Recode…" column context-menu entry (categorical columns only).
describe("WorksheetPane column context menu — Recode entry (J2)", () => {
  const withCategorical: Dataset = {
    id: "cat1",
    name: "grades.dat",
    data: {
      time: [0, 1],
      values: [
        [10, 0],
        [20, 1],
      ],
      labels: ["Field", "Grade"],
      units: ["Oe", ""],
      metadata: {},
      cat_levels: { 1: ["Pass", "Fail"] },
    },
  };

  beforeEach(() => {
    useApp.setState({ datasets: [withCategorical], activeId: "cat1" });
    useRecode.setState({ open: false, datasetId: null, channel: null, mapping: { groups: [] }, newColumnName: "", savedMappings: [] });
  });

  const headerFor = (label: string) =>
    screen.getAllByRole("columnheader").find((h) => h.textContent?.startsWith(label))!;

  it("offers Recode… on a categorical column header, opening the workshop on that column", () => {
    render(<WorksheetPane datasetId="cat1" />);
    fireEvent.contextMenu(headerFor("Grade"));
    fireEvent.click(screen.getByText("Recode…"));
    expect(useRecode.getState().open).toBe(true);
    expect(useRecode.getState().datasetId).toBe("cat1");
    expect(useRecode.getState().channel).toBe(1);
  });

  it("offers no Recode… entry on a plain (non-categorical) column header", () => {
    render(<WorksheetPane datasetId="cat1" />);
    fireEvent.contextMenu(headerFor("Field"));
    expect(screen.queryByText("Recode…")).not.toBeInTheDocument();
  });
});

// LIBRARY_WORKBOOK_UX_PLAN PR K slice 2 (L0.50): the derived-worksheet
// identity banner + Freeze Copy action, and K5b's formula-error badge.
describe("WorksheetPane derived worksheet + formula error marking (PR K slice 2)", () => {
  const derived: Dataset = {
    id: "derived1",
    name: "flattened",
    data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: {} },
    derivedFrom: { datasetId: "full1", pipeline: "Corrections: yOff=-10" },
  };

  it("shows the source name and pipeline for a derived worksheet", () => {
    useApp.setState({ datasets: [fullDataset, derived] });
    render(<WorksheetPane datasetId="derived1" />);
    expect(screen.getByText(/Derived worksheet — source: PNR:Book1/)).toBeInTheDocument();
    expect(screen.getByTitle(/Pipeline: Corrections: yOff=-10/)).toBeInTheDocument();
  });

  it("shows no derived-worksheet banner for a plain dataset", () => {
    useApp.setState({ datasets: [fullDataset, derived] });
    render(<WorksheetPane datasetId="full1" />);
    expect(screen.queryByText(/Derived worksheet/)).not.toBeInTheDocument();
  });

  it("Freeze Copy creates an independent snapshot (link severed) and records one history entry", () => {
    useApp.setState({ datasets: [fullDataset, derived] });
    const before = useApp.getState().history.length;
    render(<WorksheetPane datasetId="derived1" />);
    fireEvent.click(screen.getByRole("button", { name: "Freeze Copy" }));
    const frozen = useApp.getState().datasets.find((d) => d.id !== "full1" && d.id !== "derived1");
    expect(frozen?.derivedFrom).toBeUndefined();
    expect(frozen?.corrections).toBeUndefined();
    expect((frozen?.data.metadata as Record<string, unknown>).frozenFrom).toMatchObject({
      datasetId: "derived1",
      sourceId: "full1",
    });
    expect(useApp.getState().history.length).toBe(before + 1);
  });

  it("shows a formula-error badge only on the failing computed column's header", () => {
    const erroring: Dataset = {
      id: "err1",
      name: "erroring",
      data: { time: [0, 1], values: [[1, NaN]], labels: ["A", "S"], units: ["", ""], metadata: {} },
      formulas: [{ name: "S", expr: "A + Z", deps: ["A", "Z"] }],
      formulaErrors: { S: 'unknown variable "Z"' },
    };
    useApp.setState({ datasets: [erroring] });
    render(<WorksheetPane datasetId="err1" />);
    expect(screen.getByTitle(/Formula error: unknown variable/)).toBeInTheDocument();
  });
});
