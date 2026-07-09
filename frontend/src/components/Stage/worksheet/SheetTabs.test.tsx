import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import SheetTabs from "./SheetTabs";

/** A dataset shaped like one sheet of a multi-sheet Origin workbook
 *  (lib/grouping.originSheetGroups): named "<stem>:<label>" with
 *  origin_book/origin_book_long metadata. */
function sheet(id: string, name: string, originBook: string, long?: string): Dataset {
  return {
    id,
    name,
    data: {
      time: [0],
      values: [[1]],
      labels: ["A"],
      units: [""],
      metadata: { origin_book: originBook, ...(long ? { origin_book_long: long } : {}) },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SheetTabs", () => {
  it("renders nothing for a non-Origin dataset", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "plain.dat", data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} } }],
    });
    const { container } = render(<SheetTabs datasetId="d1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a single-sheet Origin book (nothing to relate)", () => {
    useApp.setState({ datasets: [sheet("d1", "XRD:Book1", "Book1")] });
    const { container } = render(<SheetTabs datasetId="d1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every sheet of the active dataset's multi-sheet book, active one highlighted", () => {
    useApp.setState({
      datasets: [
        sheet("s1", "XRD:Book4", "Book4"),
        sheet("s2", "XRD:Book4 — Book4 (sheet 2)", "Book4@2", "Book4 (sheet 2)"),
        sheet("s3", "XRD:Book4 — Book4 (sheet 3)", "Book4@3", "Book4 (sheet 3)"),
      ],
    });
    render(<SheetTabs datasetId="s2" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
    expect(tabs[2]).toHaveAttribute("aria-selected", "false");
  });

  it("clicking a tab activates that sheet's dataset (setActive)", () => {
    useApp.setState({
      datasets: [sheet("s1", "XRD:Book4", "Book4"), sheet("s2", "XRD:Book4@2", "Book4@2")],
      activeId: "s1",
    });
    render(<SheetTabs datasetId="s1" />);
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(useApp.getState().activeId).toBe("s2");
  });

  it("is hidden when the viewed dataset isn't part of any sheet group", () => {
    useApp.setState({
      datasets: [sheet("s1", "XRD:Book4", "Book4"), sheet("s2", "XRD:Book4@2", "Book4@2"), sheet("other", "Moke:Book1", "Book1")],
    });
    const { container } = render(<SheetTabs datasetId="other" />);
    expect(container).toBeEmptyDOMElement();
  });
});
