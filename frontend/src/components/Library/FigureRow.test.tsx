// LIBRARY_WORKBOOK_UX_PLAN PR C: FigureRow is REUSED (unmodified open
// semantics) for origin-figure tree rows — this covers only the PR C
// additions: the `data-lib-row` roving-focus anchor and recording L0.6's
// workbookLastChild for the figure's owning workbook on open.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import FigureRow from "./FigureRow";
import type { OriginFigureEntry } from "../../lib/originFigures";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

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

beforeEach(() => {
  useApp.setState({
    datasets: [ds("a", "w1")],
    originFigures: [entry("g1", "a")],
    workbookLastChild: {},
  });
});

describe("FigureRow — PR C additions", () => {
  it("carries the roving-focus data-lib-row anchor keyed by canonical LibraryNodeKey", () => {
    const { container } = render(<FigureRow entry={entry("g1", "a")} />);
    expect(container.querySelector('[data-lib-row="origin-figure:g1"]')).toBeInTheDocument();
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

  it("a resolved dataset with no workbookId records nothing", () => {
    useApp.setState({ datasets: [ds("a")] }); // no workbookId this time
    render(<FigureRow entry={entry("g1", "a")} />);
    fireEvent.click(screen.getByRole("button", { name: /MokeGraph/ }));
    expect(useApp.getState().workbookLastChild).toEqual({});
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
