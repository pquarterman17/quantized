// E-c3: large-Library safeguards. Assertions follow docs/testing.md — the
// LOAD-INVARIANT property (how many tiles exist in the DOM, which tile is
// tabbable, where focus lands) is the contract; no wall-clock budgets.
// jsdom reports zero geometry, so the virtualizer's documented
// deterministic fallbacks (600px viewport / 200px rows / 4 columns +
// 2 overscan rows) define the expected window arithmetic here.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryWorkspace from "./LibraryWorkspace";
import { VIRTUALIZE_ABOVE } from "./useTileVirtualization";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const worksheet = (i: number): Dataset => ({
  id: `d${i}`,
  workbookId: "w1",
  name: `run-${String(i).padStart(3, "0")}.csv`,
  data: { time: [0, 1], values: [[i], [i + 1]], labels: ["signal"], units: ["V"], metadata: {} },
});

const seed = (count: number): void => {
  useApp.setState({
    workbooks: [{ id: "w1", name: "Big run" }],
    datasets: Array.from({ length: count }, (_, i) => worksheet(i)),
    librarySelection: { kind: "workbook", id: "w1" },
  });
};

const renderedTiles = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("[data-library-tile]")];

beforeEach(() => {
  useApp.setState({
    datasets: [], folders: [], workbooks: [], originFigures: [], editableFigures: [],
    figureDocs: [], pages: [], reports: [], selectedIds: [], librarySelection: null,
    activeId: null, expandedFolders: [], expandedWorkbookIds: [], revealTarget: null,
    workbookLastChild: {}, figurePageOpen: false, cmdkOpen: false, confirmRemove: false,
  });
});

describe("LibraryWorkspace — E-c3 large-Library virtualization", () => {
  it("a 500-item container renders a bounded tile window, not 500 DOM tiles", () => {
    seed(500);
    render(<LibraryWorkspace onClose={vi.fn()} />);

    const tiles = renderedTiles();
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThan(60); // window + overscan, never O(items)
    expect(screen.getByText("500 items")).toBeInTheDocument(); // the summary stays honest
  });

  it("at or below the threshold every tile renders — the small-library DOM is unchanged", () => {
    seed(VIRTUALIZE_ABOVE);
    render(<LibraryWorkspace onClose={vi.fn()} />);
    expect(renderedTiles()).toHaveLength(VIRTUALIZE_ABOVE);
    const grid = screen.getByRole("list", { name: "Big run items" });
    expect(grid.style.paddingTop).toBe(""); // no virtualization spacers
  });

  it("scrolling moves the rendered window", () => {
    seed(500);
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const section = screen.getByLabelText("Library workspace");
    expect(renderedTiles()[0]?.dataset.libraryTile).toBe("worksheet:d0");

    section.scrollTop = 4000; // ~row 20 at the 200px fallback row height
    fireEvent.scroll(section);

    const first = renderedTiles()[0]?.dataset.libraryTile;
    expect(first).toBeDefined();
    expect(first).not.toBe("worksheet:d0");
  });

  it("Arrow navigation crosses the rendered-window boundary by MODEL index", async () => {
    seed(500);
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const tiles = renderedTiles();
    const last = tiles[tiles.length - 1];
    const lastIndex = Number(last.dataset.libraryTile!.replace("worksheet:d", ""));
    last.focus();

    fireEvent.keyDown(last, { key: "ArrowRight" });

    await waitFor(() => {
      expect((document.activeElement as HTMLElement | null)?.dataset.libraryTile).toBe(
        `worksheet:d${lastIndex + 1}`,
      );
    });
  });

  it("opening a large container lands the window on the current selection, still selected", () => {
    seed(500);
    useApp.setState({ selectedIds: ["d400"], librarySelection: null });
    render(<LibraryWorkspace onClose={vi.fn()} />);

    const tile = document.querySelector('[data-library-tile="worksheet:d400"]');
    expect(tile).not.toBeNull();
    expect(tile!.className).toContain("selected");
  });

  it("every rendered window carries exactly ONE tabbable tile (keyboard entry survives scrolling)", () => {
    seed(500);
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const section = screen.getByLabelText("Library workspace");

    const tabbableCount = (): number =>
      renderedTiles().filter((tile) => tile.tabIndex === 0).length;
    expect(tabbableCount()).toBe(1);

    section.scrollTop = 12000; // far past the model tab stop's row
    fireEvent.scroll(section);
    expect(tabbableCount()).toBe(1);
  });

  it("a shrunken item count under a stale deep scroll still renders tiles (clamped window, never blank)", () => {
    seed(500);
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const section = screen.getByLabelText("Library workspace");
    section.scrollTop = 24000; // near the bottom of 500 items
    fireEvent.scroll(section);
    expect(renderedTiles().length).toBeGreaterThan(0);

    // 400 of the 500 vanish out from under the scrolled window.
    act(() => {
      useApp.setState({ datasets: Array.from({ length: 100 }, (_, i) => worksheet(i)) });
    });
    expect(renderedTiles().length).toBeGreaterThan(0); // lib/gridwindow clamping
  });

  it("entering a different container resets the window from a stale deep scroll", () => {
    useApp.setState({
      workbooks: [{ id: "w1", name: "Big run" }, { id: "w2", name: "Second run" }],
      datasets: [
        ...Array.from({ length: 300 }, (_, i) => worksheet(i)),
        ...Array.from({ length: 200 }, (_, i) => ({ ...worksheet(i + 1000), workbookId: "w2" })),
      ],
      librarySelection: { kind: "workbook", id: "w1" },
    });
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const section = screen.getByLabelText("Library workspace");
    section.scrollTop = 12000;
    fireEvent.scroll(section);
    expect(renderedTiles()[0]?.dataset.libraryTile).not.toBe("worksheet:d0");

    // Breadcrumb to the project root, then browse into the second workbook.
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    fireEvent.click(screen.getByRole("listitem", { name: "Second run, Workbook" }));
    expect(renderedTiles()[0]?.dataset.libraryTile).toBe("worksheet:d1000"); // top of w2, not mid-list
  });

  it("a large ROOT container (loose datasets) lands the window on the current selection", () => {
    useApp.setState({
      workbooks: [],
      datasets: Array.from({ length: 200 }, (_, i) => ({ ...worksheet(i), workbookId: null }) as never),
      selectedIds: ["d150"],
      librarySelection: null,
    });
    render(<LibraryWorkspace onClose={vi.fn()} />);

    const tile = document.querySelector('[data-library-tile="worksheet:d150"]');
    expect(tile).not.toBeNull(); // the null-container mount effect ran too
    expect(tile!.className).toContain("selected");
  });

  it("the deferred focus retry stands down when the user focused something else meanwhile", async () => {
    seed(500);
    render(
      <>
        <input aria-label="Sidebar filter" />
        <LibraryWorkspace onClose={vi.fn()} />
      </>,
    );
    const tiles = renderedTiles();
    const last = tiles[tiles.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "ArrowRight" }); // retry loop starts for the next model item
    const input = screen.getByLabelText("Sidebar filter");
    input.focus(); // the user moved on before the target rendered

    // Outlast the retry loop's full budget (8 rAF frames ≈ 130ms in jsdom's
    // timer-backed rAF) so "not stolen" can't be "not finished yet".
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(document.activeElement).toBe(input); // focus was NOT yanked back to the grid
  });

  it("keyboard survives the focused tile scrolling out of the window (no dead-end on <body>)", async () => {
    seed(500);
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const section = screen.getByLabelText("Library workspace");
    const first = renderedTiles()[0];
    first.focus();
    expect(document.activeElement).toBe(first);

    section.scrollTop = 24000; // the focused tile unmounts with its window
    fireEvent.scroll(section);
    expect(document.querySelector('[data-library-tile="worksheet:d0"]')).toBeNull();
    // Focus must NOT be stranded on <body> — the grid takes it, and an arrow
    // key resumes navigation from the roving tile's model position.
    expect(document.activeElement).not.toBe(document.body);

    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    await waitFor(() => {
      expect((document.activeElement as HTMLElement | null)?.dataset.libraryTile).toBe("worksheet:d1");
    });
  });

  it("windowed listitems report their TRUE set size and position to assistive tech", () => {
    seed(500);
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const section = screen.getByLabelText("Library workspace");
    section.scrollTop = 4000;
    fireEvent.scroll(section);

    const tiles = renderedTiles();
    const firstIndex = Number(tiles[0].dataset.libraryTile!.replace("worksheet:d", ""));
    expect(tiles[0]).toHaveAttribute("aria-setsize", "500");
    expect(tiles[0]).toHaveAttribute("aria-posinset", String(firstIndex + 1));
  });

  it("entering a SMALL container from a deep-scrolled large one still resets the scroll", () => {
    useApp.setState({
      workbooks: [{ id: "w1", name: "Big run" }, { id: "w2", name: "Small run" }],
      datasets: [
        ...Array.from({ length: 300 }, (_, i) => worksheet(i)),
        ...Array.from({ length: 20 }, (_, i) => ({ ...worksheet(i + 1000), workbookId: "w2" })),
      ],
      librarySelection: { kind: "workbook", id: "w1" },
    });
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const section = screen.getByLabelText("Library workspace");
    section.scrollTop = 12000;
    fireEvent.scroll(section);

    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    fireEvent.click(screen.getByRole("listitem", { name: "Small run, Workbook" }));
    // The 20-item container is UNVIRTUALIZED — the reset must not be gated
    // on the virtualized path.
    expect(section.scrollTop).toBe(0);
  });

  it("the deferred focus retry stands down when the user focused a DIFFERENT tile meanwhile", async () => {
    seed(500);
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const tiles = renderedTiles();
    const last = tiles[tiles.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "ArrowRight" }); // retry armed for the off-window neighbor
    // A tile that SURVIVES the ensuing window shift (the shifted window
    // keeps the rows just above the old tail) — the user clicks it before
    // the retry's target takes focus.
    const other = tiles[tiles.length - 3];
    other.focus();

    await new Promise((resolve) => setTimeout(resolve, 300)); // outlast the retry budget
    expect(document.activeElement).toBe(other); // never yanked to the retry's target
  });

  it("Escape from a large library still posts the canonical reveal target (Show in Library)", () => {
    const onClose = vi.fn();
    seed(500);
    useApp.setState({ selectedIds: ["d123"], librarySelection: null, activeId: "d123" });
    render(<LibraryWorkspace onClose={onClose} />);

    fireEvent.keyDown(screen.getByLabelText("Library workspace"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(useApp.getState().revealTarget).toBe("worksheet:d123");
  });
});
