// LIBRARY_WORKBOOK_UX_PLAN "Required large-Library engineering safeguards".
// Assertions follow docs/testing.md — the LOAD-INVARIANT property (DOM row
// count, which row is reachable, where focus lands) is the contract, never
// wall-clock timing. jsdom reports zero geometry, so the virtualizer's
// documented deterministic fallbacks define the expected window arithmetic
// — see useListVirtualization's header.
//
// Details also renders the project-wide SEARCH-RESULTS surface (a non-blank
// searchQuery — L0.26), so the "large search result sets" fixture the plan
// names explicitly is exercised via that same prop, not a separate renderer.

import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryDetails from "./LibraryDetails";
import { buildLibraryHierarchy } from "../../lib/libraryHierarchy";
import { VIRTUALIZE_ABOVE } from "./useListVirtualization";
import type { Dataset } from "../../lib/types";
import { defaultVisibleDetailsColumnKeys } from "../../lib/libraryDetailsColumns";
import { useApp } from "../../store/useApp";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const dataset = (i: number): Dataset => ({
  id: `d${i}`,
  name: `run-${String(i).padStart(4, "0")}.csv`,
  workbookId: "w",
  order: i,
  data: { time: [0, 1], values: [[i], [i + 1]], labels: ["signal"], units: ["V"], metadata: {} },
});

const seed = (count: number): { hierarchy: ReturnType<typeof buildLibraryHierarchy> } => {
  const datasets = Array.from({ length: count }, (_, i) => dataset(i));
  const hierarchy = buildLibraryHierarchy({ folders: [], workbooks: [{ id: "w", name: "Run" }], datasets });
  useApp.setState({
    datasets, workbooks: [{ id: "w", name: "Run" }], folders: [],
    selectedIds: [], librarySelection: null, activeId: null,
    expandedWorkbookIds: ["w"], trash: [], history: [], confirmRemove: false,
    visibleDetailsColumns: defaultVisibleDetailsColumnKeys(),
  });
  return { hierarchy };
};

const renderedRows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("tbody tr[data-lib-row]")];

beforeEach(() => {
  useApp.setState({
    datasets: [], workbooks: [], folders: [], selectedIds: [], librarySelection: null,
    activeId: null, expandedWorkbookIds: [], trash: [], history: [], confirmRemove: false,
    visibleDetailsColumns: defaultVisibleDetailsColumnKeys(),
  });
});

describe("LibraryDetails — large-Library virtualization", () => {
  it("a 5,000-row workbook renders a bounded number of <tr> elements, not 5,000", () => {
    const { hierarchy } = seed(5000);
    render(<LibraryDetails hierarchy={hierarchy} />);
    const rows = renderedRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(60);
  });

  it("at or below the threshold every row renders — the small-library DOM is unchanged", () => {
    // VIRTUALIZE_ABOVE - 1 worksheets + 1 workbook row = exactly the
    // threshold; the hook virtualizes only STRICTLY above it.
    const { hierarchy } = seed(VIRTUALIZE_ABOVE - 1);
    render(<LibraryDetails hierarchy={hierarchy} />);
    expect(renderedRows().length).toBe(VIRTUALIZE_ABOVE);
  });

  it("a large SEARCH-RESULT set (L0.26) also renders a bounded window", () => {
    const { hierarchy } = seed(3000);
    render(<LibraryDetails hierarchy={hierarchy} searchQuery="run-" />);
    const rows = renderedRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(60);
  });

  it("Down navigation crosses the rendered-window boundary, scrolling the target into view and focusing it", async () => {
    const { hierarchy } = seed(5000);
    render(<LibraryDetails hierarchy={hierarchy} />);
    const rows = renderedRows();
    const last = rows[rows.length - 1];
    const lastKey = last.getAttribute("data-lib-row");
    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "ArrowDown" });

    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).not.toBe(last);
    });
    const focused = document.activeElement as HTMLElement;
    expect(focused.matches("[data-lib-row]")).toBe(true);
    expect(focused.getAttribute("data-lib-row")).not.toBe(lastKey);
  });

  it("Show in Library reveals and scrolls to a worksheet outside the rendered window", async () => {
    const { hierarchy } = seed(5000);
    render(<LibraryDetails hierarchy={hierarchy} />);
    expect(document.querySelector('[data-lib-row="worksheet:d3000"]')).toBeNull();

    act(() => {
      useApp.setState({ selectedIds: ["d3000"], librarySelection: null });
    });

    await waitFor(() => {
      expect(document.querySelector('[data-lib-row="worksheet:d3000"]')).not.toBeNull();
    });
  });

  it("every rendered window carries exactly ONE tabbable row (Tab-key entry survives scrolling)", () => {
    const { hierarchy } = seed(5000);
    render(<LibraryDetails hierarchy={hierarchy} />);
    const tabbableCount = (): number => renderedRows().filter((r) => r.tabIndex === 0).length;
    expect(tabbableCount()).toBe(1);

    const panel = document.querySelector(".qzk-details-scroll") as HTMLElement;
    fireEvent.scroll(panel, { target: { scrollTop: 40000 } });
    expect(tabbableCount()).toBe(1);
  });

  it("Right-arrow multiselect range spans rows never rendered together — selection is data-indexed, not DOM-scoped", () => {
    seed(5000);
    useApp.getState().selectIds(["d0"]);
    useApp.setState({ activeId: "d0" });

    useApp.getState().selectRange("d3000");

    const selected = useApp.getState().selectedIds;
    expect(selected).toHaveLength(3001);
    expect(selected[0]).toBe("d0");
    expect(selected[3000]).toBe("d3000");
  });

  it("rapid view switching (unmount mid-scroll, remount) never leaves the table blank", () => {
    const { hierarchy } = seed(5000);
    const { unmount } = render(<LibraryDetails hierarchy={hierarchy} />);
    const panel = document.querySelector(".qzk-details-scroll") as HTMLElement;
    fireEvent.scroll(panel, { target: { scrollTop: 40000 } });
    unmount();
    render(<LibraryDetails hierarchy={hierarchy} />);
    expect(renderedRows().length).toBeGreaterThan(0);
  });
});
