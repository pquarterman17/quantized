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

describe("SheetTabs book switcher (item 9)", () => {
  it("renders no book dropdown for a single-book project (nothing to switch to)", () => {
    useApp.setState({ datasets: [sheet("s1", "XRD:Book1", "Book1")] });
    render(<SheetTabs datasetId="s1" />);
    expect(screen.queryByLabelText("switch book")).not.toBeInTheDocument();
  });

  it("lists every distinct book of a multi-book family, current book selected", () => {
    useApp.setState({
      datasets: [
        sheet("b1", "XRD:Book1", "Book1"),
        sheet("b2", "XRD:Book2", "Book2"),
        sheet("b3", "XRD:Book3", "Book3"),
      ],
    });
    render(<SheetTabs datasetId="b2" />);
    const select = screen.getByLabelText("switch book") as HTMLSelectElement;
    expect(select.value).toBe("Book2");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("choosing a book activates its representative dataset (setActive)", () => {
    useApp.setState({
      datasets: [sheet("b1", "XRD:Book1", "Book1"), sheet("b2", "XRD:Book2", "Book2")],
      activeId: "b1",
    });
    render(<SheetTabs datasetId="b1" />);
    fireEvent.change(screen.getByLabelText("switch book"), { target: { value: "Book2" } });
    expect(useApp.getState().activeId).toBe("b2");
  });

  it("does NOT show a book dropdown for a multi-SHEET single-book family (that's the sheet strip's job)", () => {
    // Same fixture as the "lists every sheet" test above: 3 sheets of ONE
    // book sharing the "XRD" stem — must not ALSO read as 3 distinct books.
    useApp.setState({
      datasets: [
        sheet("s1", "XRD:Book4", "Book4"),
        sheet("s2", "XRD:Book4 — Book4 (sheet 2)", "Book4@2"),
        sheet("s3", "XRD:Book4 — Book4 (sheet 3)", "Book4@3"),
      ],
    });
    render(<SheetTabs datasetId="s2" />);
    expect(screen.queryByLabelText("switch book")).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3); // sheet strip still renders
  });

  it("shows BOTH the book dropdown and the sheet strip for a multi-book family whose books are themselves multi-sheet", () => {
    useApp.setState({
      datasets: [
        sheet("a1", "XRD:Book4", "Book4"),
        sheet("a2", "XRD:Book4@2", "Book4@2"),
        sheet("b1", "XRD:Book7", "Book7"),
        sheet("b2", "XRD:Book7@2", "Book7@2"),
      ],
    });
    render(<SheetTabs datasetId="a1" />);
    expect(screen.getByLabelText("switch book")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2); // a1's own sheet group (Book4, Book4@2)
  });
});
