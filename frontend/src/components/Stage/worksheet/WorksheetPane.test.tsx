// ORIGIN_FILE_DECODE_PLAN #38: a lazy Origin book opened in the worksheet
// must (a) render without crashing on its small preview `data`, (b) show a
// "loading full data" banner, and (c) trigger ensureBookData so the full
// data arrives without the user needing to do anything else.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
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
