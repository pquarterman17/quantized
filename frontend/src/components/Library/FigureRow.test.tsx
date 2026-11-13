// LIBRARY_WORKBOOK_UX_PLAN PR C: FigureRow is REUSED (unmodified open
// semantics) for origin-figure tree rows — this covers only the PR C
// additions: the `data-lib-row` roving-focus anchor and recording L0.6's
// workbookLastChild for the figure's owning workbook on open.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FigureRow from "./FigureRow";
import type { OriginFigureEntry } from "../../lib/originFigures";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { declares, flatRules, readShellCss } from "../../styles/cssRules.testkit";

const entry = (id: string, datasetId: string | null): OriginFigureEntry => ({
  id,
  stem: "Moke",
  datasetId,
  siblingIds: datasetId ? [datasetId] : [],
  figure: { name: "MokeGraph", x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false, n_curves: 1, annotations: [] },
});
const ds = (id: string, workbookId?: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
  ...(workbookId ? { workbookId } : {}),
});
const realOpenOriginFigureSource = useApp.getState().openOriginFigureSource;
const realRemakeOriginFigure = useApp.getState().remakeOriginFigure;

beforeEach(() => {
  useApp.setState({
    datasets: [ds("a", "w1")],
    originFigures: [entry("g1", "a")],
    workbookLastChild: {},
    openOriginFigureSource: realOpenOriginFigureSource,
    remakeOriginFigure: realRemakeOriginFigure,
  });
});

describe("FigureRow — PR C additions", () => {
  it("carries the roving-focus data-lib-row anchor keyed by canonical LibraryNodeKey", () => {
    const { container } = render(<FigureRow entry={entry("g1", "a")} />);
    expect(container.querySelector('[data-lib-row="origin-figure:g1"]')).toBeInTheDocument();
  });

  it("names the recovered object as a Graph without requiring glyph knowledge", () => {
    render(<FigureRow entry={entry("g1", "a")} />);
    expect(screen.getByTitle("Recovered Origin graph")).toHaveTextContent("Graph");
  });

  it("opening records workbookLastChild for the bound dataset's workbook", () => {
    render(<FigureRow entry={entry("g1", "a")} />);
    fireEvent.click(screen.getByRole("button", { name: /MokeGraph/ }));
    expect(useApp.getState().workbookLastChild.w1).toBe("origin-figure:g1");
  });

  it("opening in a new window also records it", () => {
    render(<FigureRow entry={entry("g1", "a")} />);
    fireEvent.click(screen.getByTitle("Open in a new graph window"));
    expect(useApp.getState().workbookLastChild.w1).toBe("origin-figure:g1");
  });

  it("an unresolved figure (no bound dataset) records nothing — the open button is disabled anyway", () => {
    render(<FigureRow entry={entry("g2", null)} />);
    expect(screen.getByRole("button", { name: /MokeGraph/ })).toBeDisabled();
    expect(useApp.getState().workbookLastChild).toEqual({});
  });

  it("an unresolved graph with nothing to recover still shows its raw Origin source hint", () => {
    const bare = { ...entry("g2", null), figure: { ...entry("g2", null).figure, source_hint: "Book7" } };
    render(<FigureRow entry={bare} />);
    expect(screen.queryByRole("button", { name: /Recover unresolved Origin bindings/ })).toBeNull();
    const remake = screen.getByRole("button", { name: "Remake in Graph Builder" });
    expect(remake).toBeDisabled();
    expect(remake).toHaveAttribute("title", "No decoded bindings; Origin hint: Book7");
  });

  it("the tooltip counts the decoded curves, not the legend entries (n_curves)", () => {
    const fig = { ...entry("g1", "a").figure, n_curves: 0, curves: [
      { book: "Book1", x: "A", y: "B" }, { book: "Book1", x: "A", y: "C" },
    ] };
    useApp.setState({
      datasets: [{
        ...ds("a", "w1"),
        data: {
          time: [0, 1], values: [[1, 2], [3, 4]], labels: ["b", "c"], units: ["", ""],
          metadata: { origin_book: "Book1", x_column_name: "A", origin_column_names: ["B", "C"] },
        },
      }],
    });
    render(<FigureRow entry={{ ...entry("g1", "a"), figure: fig }} />);
    const open = screen.getByRole("button", { name: /MokeGraph/ });
    expect(open.getAttribute("title")).toContain("(2 curves)");
  });

  it("an EMPTY decoded curve list falls back to the legend count", () => {
    const fig = { ...entry("g1", "a").figure, n_curves: 3, curves: [] };
    render(<FigureRow entry={{ ...entry("g1", "a"), figure: fig }} />);
    expect(screen.getByRole("button", { name: /MokeGraph/ }).getAttribute("title")).toContain("(3 curves)");
  });

  it("a resolved dataset with no workbookId records nothing", () => {
    useApp.setState({ datasets: [ds("a")] }); // no workbookId this time
    render(<FigureRow entry={entry("g1", "a")} />);
    fireEvent.click(screen.getByRole("button", { name: /MokeGraph/ }));
    expect(useApp.getState().workbookLastChild).toEqual({});
  });

  it("keeps tree indentation inside the row and groups secondary actions for progressive disclosure", () => {
    const { container } = render(<FigureRow entry={entry("g1", "a")} depth={2} treeMode />);
    const row = container.querySelector<HTMLElement>(".qzk-fig-row-tree")!;
    const item = container.querySelector<HTMLElement>(".qzk-fig-item")!;
    const actions = container.querySelector<HTMLElement>(".qzk-origin-figure-actions")!;
    expect(row.style.paddingLeft).toBe("28px");
    expect(item.style.marginLeft).toBe("");
    expect(actions).toContainElement(screen.getByTitle("Open in a new graph window"));
  });

  it("reveals the tree action strip only for the row being used", () => {
    const rules = flatRules(readShellCss());
    const resting = rules.find((r) => r.selector === ".qzk-fig-row-tree .qzk-origin-figure-actions");
    expect(resting).toBeDefined();
    expect(declares(resting!.body, "display", "none")).toBe(true);
    const reveal = rules.find((r) => r.selector.includes(".qzk-fig-row-tree:hover .qzk-origin-figure-actions"));
    expect(reveal).toBeDefined();
    expect(reveal!.selector).toContain(":focus-within");
    expect(declares(reveal!.body, "display", "flex")).toBe(true);
  });

  it("puts the revealed strip beside the graph name, never over it", () => {
    // Origin-replacement audit: an absolutely positioned strip covered the
    // graph name it was revealed for and swallowed the click meant for the
    // row. In the row's own flex flow the name shrinks instead.
    const rules = flatRules(readShellCss()).filter((r) => r.selector.includes(".qzk-origin-figure-actions"));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(declares(r.body, "position", "absolute")).toBe(false);
    const row = flatRules(readShellCss()).find((r) => r.selector === ".qzk-fig-row");
    expect(declares(row!.body, "display", "flex")).toBe(true);
  });

  it("keeps source-recovery controls exposed when the unresolved main button cannot receive focus", () => {
    const unresolvedEntry = {
      ...entry("g2", null),
      siblingIds: ["a"],
      figure: {
        ...entry("g2", null).figure,
        source_hint: "MissingBook",
        curves: [{ book: "MissingBook", x: "A", y: "B" }],
      },
    };
    useApp.setState({ originFigures: [unresolvedEntry] });
    const { container } = render(<FigureRow entry={unresolvedEntry} treeMode />);
    expect(container.querySelector(".qzk-fig-row-tree")).toHaveClass("unresolved");
    expect(screen.getByRole("group", { name: "Recovered graph actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Recover unresolved Origin bindings/ })).toBeVisible();
    const rules = flatRules(readShellCss());
    const unresolved = rules.find((r) => r.selector === ".qzk-fig-row-tree.unresolved .qzk-origin-figure-actions");
    expect(declares(unresolved!.body, "display", "flex")).toBe(true);
  });

  it("opens a focused recovery window instead of an inline workbook selector", async () => {
    const unresolvedEntry = {
      ...entry("g2", null),
      siblingIds: ["a"],
      figure: {
        ...entry("g2", null).figure,
        source_hint: "MissingBook",
        curves: [{ book: "MissingBook", x: "A", y: "B" }],
      },
    };
    useApp.setState({
      datasets: [{
        ...ds("a", "w1"),
        data: {
          ...ds("a", "w1").data,
          metadata: { origin_book: "Book1", x_column_name: "A", origin_column_names: ["B"] },
        },
      }],
      originFigures: [unresolvedEntry],
    });
    render(<FigureRow entry={unresolvedEntry} treeMode />);
    fireEvent.click(screen.getByRole("button", { name: /Recover unresolved Origin bindings/ }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Recover MokeGraph" })).toBeVisible();
    expect(screen.getByText("1 compatible Y column")).toBeVisible();
    expect(screen.getByRole("button", { name: "Inspect columns" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rebuild plot" })).toBeEnabled();
  });

  // strings_testing.opj's shape: the curve binds to NLFit1 (sheet 1) while its
  // column id is on sheet 2 (NLFit1@2). The binding stays; the wording depends
  // on whether NLFit1 itself is in the import.
  const sheetBook = (id: string, originBook: string): Dataset => ({
    ...ds(id, "w1"),
    name: `strings:${originBook}`,
    data: {
      time: [0, 1],
      values: [[1], [2]],
      labels: ["B"],
      units: [""],
      metadata: { origin_book: originBook, x_column_name: "A", origin_column_names: ["B"] },
    },
  });
  const notedEntry = (): OriginFigureEntry => ({
    ...entry("g3", "s1"),
    siblingIds: ["s1", "s2"],
    figure: {
      ...entry("g3", "s1").figure,
      curves: [{ book: "NLFit1", x: "A", y: "B" }],
      curve_sheet_notes: [{ book: "NLFit1", x: "A", y: "B", recorded: "NLFit1@2" }],
      fidelity: { status: "best_effort", recovered: [], omissions: ["curve_sheet_mismatch"] },
    },
  });

  it("offers Recover, recorded sheet first, for a resolved curve the file records on another sheet", async () => {
    const noted = notedEntry();
    useApp.setState({ datasets: [sheetBook("s1", "NLFit1"), sheetBook("s2", "NLFit1@2")], originFigures: [noted] });
    // Decoy: a plain resolved graph has no button.
    const { unmount } = render(<FigureRow entry={entry("g1", "s1")} treeMode />);
    expect(screen.queryByRole("button", { name: /Recover unresolved Origin bindings/ })).toBeNull();
    unmount();
    const { container } = render(<FigureRow entry={noted} treeMode />);
    // Shown without a hover, like an unresolved graph's controls.
    expect(container.querySelector(".qzk-fig-row-tree")).toHaveClass("needs-review");
    const rules = flatRules(readShellCss());
    expect(rules.some((r) => r.selector.includes(".qzk-fig-row-tree.needs-review .qzk-origin-figure-actions")
      && declares(r.body, "display", "flex"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check curves recorded on another sheet for MokeGraph" }));
    const region = await screen.findByRole("region", { name: "Recover MokeGraph" });
    expect(region).toHaveTextContent(
      "1 curve of MokeGraph (NLFit1 column B) is recorded on NLFit1@2 but plotted from NLFit1; check it, or use Recover to choose the sheet",
    );
    const names = [...region.querySelectorAll(".qzk-origin-recovery-candidate strong")].map((n) => n.textContent);
    expect(names).toEqual(["strings:NLFit1@2", "strings:NLFit1"]);
    expect(region).toHaveTextContent("the file records curves on this sheet");
    expect(region).not.toHaveTextContent("not a sheet");
    expect(region).not.toHaveTextContent("not in this import");
  });

  it("never says both 'plotted from' and 'not recorded' when the bound sheet is not in the import", async () => {
    const noted = notedEntry();
    // NLFit1 (sheet 1) did not reach the Library; only its sheet 2 did.
    useApp.setState({ datasets: [sheetBook("s1", "Book1"), sheetBook("s2", "NLFit1@2")], originFigures: [noted] });
    render(<FigureRow entry={noted} treeMode />);
    fireEvent.click(screen.getByRole("button", { name: "Recover unresolved Origin bindings for MokeGraph" }));
    const region = await screen.findByRole("region", { name: "Recover MokeGraph" });
    expect(region).toHaveTextContent(
      "1 curve of MokeGraph (NLFit1 column B) is recorded on NLFit1@2; the sheet the graph would otherwise use (NLFit1) is not in this import; use Recover to choose the sheet",
    );
    expect(region).toHaveTextContent("recorded on NLFit1@2");
    expect(region).not.toHaveTextContent("plotted from");
    expect(region).not.toHaveTextContent("sheet not recorded");
    expect(region).not.toHaveTextContent("not a sheet");
  });

  it("explains an unresolved graph even when no sibling workbook survived import", async () => {
    const unresolvedEntry = {
      ...entry("g2", null),
      figure: {
        ...entry("g2", null).figure,
        curves: [{ book: "MissingBook", x: "A", y: "B" }],
      },
    };
    useApp.setState({ datasets: [], originFigures: [unresolvedEntry] });
    render(<FigureRow entry={unresolvedEntry} treeMode />);
    fireEvent.click(screen.getByRole("button", { name: /Recover unresolved Origin bindings/ }));
    expect(await screen.findByText("No workbooks from this import are available.")).toBeVisible();
  });

  it("keeps recovery open when the chosen workbook cannot be opened", async () => {
    const unresolvedEntry = {
      ...entry("g2", null),
      siblingIds: ["a"],
      figure: {
        ...entry("g2", null).figure,
        curves: [{ book: "MissingBook", x: "A", y: "B" }],
      },
    };
    const openOriginFigureSource = vi.fn(async () => false);
    useApp.setState({
      datasets: [{
        ...ds("a", "w1"),
        data: {
          ...ds("a", "w1").data,
          metadata: { origin_book: "Book1", x_column_name: "A", origin_column_names: ["B"] },
        },
      }],
      originFigures: [unresolvedEntry],
      openOriginFigureSource,
    });
    render(<FigureRow entry={unresolvedEntry} treeMode />);
    fireEvent.click(screen.getByRole("button", { name: /Recover unresolved Origin bindings/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Inspect columns" }));
    expect(openOriginFigureSource).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("region", { name: "Recover MokeGraph" })).toBeVisible();
  });

  it("does not advertise a known-empty saved curve as a renderable graph", async () => {
    const emptyEntry = {
      ...entry("g2", "a"),
      figure: {
        ...entry("g2", "a").figure,
        curves: [{ book: "Book1", x: "A", y: "B" }],
      },
    };
    useApp.setState({
      datasets: [{
        ...ds("a", "w1"),
        data: {
          time: [0], values: [[Number.NaN]], labels: ["empty"], units: [""],
          metadata: { origin_book: "Book1", x_column_name: "A", origin_column_names: ["B"] },
        },
      }],
      originFigures: [emptyEntry],
    });
    const { container } = render(<FigureRow entry={emptyEntry} treeMode />);
    // The name part is the (dimmed) unavailable thing, never the row's actions.
    expect(container.querySelector('[data-lib-row="origin-figure:g2"]')).toHaveAttribute("aria-disabled", "true");
    // Recover… is the row's one action: enabled, a tab stop of the row, and
    // under no aria-disabled ancestor (which disables descendants for AT).
    const recover = screen.getByRole("button", { name: /Recover unresolved Origin bindings/ });
    expect(recover).toBeEnabled();
    expect(recover.closest('[aria-disabled="true"]')).toBeNull();
    fireEvent.click(recover);
    expect(await screen.findByText("Saved columns found, but this layer has no numeric data")).toBeVisible();
    expect(screen.getByRole("button", { name: "Inspect columns" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rebuild plot" })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Bundle diet, 2026-09-14: the saved-preview ToolWindow is chunk-deferred
// (`lazy()` + `<Suspense fallback={null}>` in FigureRow), which took it,
// components/overlays/ToolWindow.tsx and lib/workshopHelp.ts out of the eager
// entry graph. `src/architecture.test.ts` holds the static half of that guard
// (nothing may import it statically); this holds the behavioural half — the
// "▣" still opens the window, one microtask later than it used to.
describe("FigureRow — chunk-deferred saved-Origin-preview window", () => {
  const withPreview = (): OriginFigureEntry => {
    const base = entry("g1", "a");
    return {
      ...base,
      figure: {
        ...base.figure,
        saved_preview: {
          format: "png", mime: "image/png", width: 200, height: 155,
          sha256: "c".repeat(64), data: "iVBORw0KGgo=",
          confidence: "exact_page", page_name: "MokeGraph",
        },
      },
    };
  };

  it("opens the preview after its chunk resolves, not on the click itself", async () => {
    render(<FigureRow entry={withPreview()} />);
    fireEvent.click(screen.getByTitle("Open saved Origin preview for comparison"));

    // Red-first: a STATIC import puts the window in the very first render
    // after the click, so this line fails the moment the seam is reverted.
    expect(screen.queryByAltText(/Saved Origin preview of MokeGraph/)).not.toBeInTheDocument();

    const image = await screen.findByAltText(/Saved Origin preview of MokeGraph/);
    expect(image).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
  });
});
