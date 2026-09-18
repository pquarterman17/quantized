// COLD-path DOM coverage for the seven Library render seams taken out of the
// eager bundle on 2026-09-18 (`plans/BUNDLE_HEADROOM.md` slice 4): the six
// flat sections `LibrarySections.tsx` now reaches through `lazy()` behind
// their own emptiness gates, and `MultiSelectBar`, which `Library.tsx` gates
// on a second selected row.
//
// `src/architecture.test.ts`'s SEAMS list holds the STATIC half (nothing may
// value-import any of them, and the loader must reach each with a dynamic
// `import()`); that grep cannot see whether the thing still RENDERS. Each test
// below asserts both halves at the DOM layer the user experiences: nothing on
// the first synchronous flush (the `Suspense fallback={null}` while the chunk
// is in flight — which is what proves the seam is real and not a no-op
// refactor), and the real content once it resolves.
//
// The gate half matters as much as the seam half and is asserted too: with the
// store collection EMPTY the section must stay absent even after the
// microtask queue drains, because on that path the chunk is never requested at
// all — that is the whole point of gating instead of mounting a suspended
// boundary on first paint.
//
// These boundaries inherit the repo-wide `lazy()` caveat: a chunk that will
// not load has no reporting of its own and unmounts the React root at the
// nearest boundary. That is UX-003 in `plans/BUGS_AND_ISSUES.md` for every
// such site at once, not something these seams introduced or can fix locally,
// so there is deliberately no load-failure test here.

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Library from "./Library";
import LibrarySections from "./LibrarySections";
import { buildLibraryHierarchy } from "../../lib/libraryHierarchy";
import type { FigureDoc } from "../../lib/figuredoc";
import type { OriginFigureEntry } from "../../lib/originFigures";
import type { ReportEntry } from "../../lib/report";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn(), default: () => null }));

/** Records which section modules have actually been IMPORTED. Each factory
 *  runs once, on that module's first import, and returns the real module — so
 *  the sections still render for real while the set below says, precisely,
 *  which chunks a render asked for. */
const { loaded, track } = vi.hoisted(() => {
  const loaded = new Set<string>();
  const track =
    (name: string) =>
    async (importOriginal: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> => {
      loaded.add(name);
      return await importOriginal();
    };
  return { loaded, track };
});
vi.mock("./FiguresSection", track("FiguresSection"));
vi.mock("./OriginFidelitySection", track("OriginFidelitySection"));
vi.mock("./SavedFiguresSection", track("SavedFiguresSection"));
vi.mock("./ReportsSection", track("ReportsSection"));
vi.mock("./SmartFoldersSection", track("SmartFoldersSection"));
vi.mock("./CollectionsSection", track("CollectionsSection"));

const ds = (id: string, workbookId?: string): Dataset => ({
  id,
  name: id,
  ...(workbookId ? { workbookId } : {}),
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
});

const emptyHierarchy = buildLibraryHierarchy({ folders: [], workbooks: [], datasets: [] });

const figure: OriginFigureEntry = {
  id: "g1",
  stem: "Moke",
  datasetId: "a",
  siblingIds: ["a"],
  figure: {
    name: "MokeGraph",
    x_from: 0,
    x_to: 1,
    x_log: false,
    y_from: 0,
    y_to: 1,
    y_log: false,
    n_curves: 1,
    annotations: [],
  },
};

const figureDoc: FigureDoc = {
  id: "figd-1",
  name: "MH loop",
  datasetId: "a",
  live: true,
  config: {
    xKey: null,
    yKeys: [0],
    xScale: "linear",
    yScale: "linear",
    title: "",
    xLabel: "",
    yLabel: "",
    style: "aps",
    fmt: "pdf",
    dpi: 300,
    overrides: null,
    seriesStyles: null,
  },
};

const report: ReportEntry = {
  id: "rep-1",
  name: "Linear fit — a",
  datasetId: "a",
  report: { title: "Linear fit — a", sections: [{ title: "Fit results", blocks: [{ type: "text", text: "Model" }] }] },
};

const fidelity = {
  id: "fidelity-a",
  stem: "XRD",
  siblingIds: ["a"],
  manifest: {
    version: 1,
    container: "opj",
    status: "best_effort",
    graph_records_total: 1,
    graph_records_actionable: 1,
    graph_records_filtered: 0,
    omissions: [],
    filtered_figures: [],
  },
};

const sections = () => (
  <LibrarySections
    inHierarchy={false}
    searchActive={false}
    hierarchy={emptyHierarchy}
    onFilterTag={vi.fn()}
    onShowInLibrary={vi.fn()}
  />
);

beforeEach(() => {
  useApp.setState({
    datasets: [ds("a")],
    folders: [],
    workbooks: [],
    activeId: null,
    selectedIds: [],
    originFigures: [],
    originFidelity: [],
    figureDocs: [],
    editableFigures: [],
    pages: [],
    reports: [],
    smartFolders: [],
    collections: [],
  });
});

afterEach(() => {
  useApp.setState({ originFigures: [], originFidelity: [], figureDocs: [], reports: [], smartFolders: [], collections: [], selectedIds: [] });
});

/** Each row: the store patch that opens the gate, and the text the resolved
 *  section renders. `null` state must show nothing on the FIRST flush. */
const SECTION_SEAMS: { name: string; patch: Record<string, unknown>; text: string }[] = [
  { name: "FiguresSection", patch: { originFigures: [figure] }, text: "Figures" },
  { name: "OriginFidelitySection", patch: { originFidelity: [fidelity] }, text: "Origin fidelity" },
  { name: "SavedFiguresSection", patch: { figureDocs: [figureDoc] }, text: "Publication figures" },
  { name: "ReportsSection", patch: { reports: [report] }, text: "Reports" },
  { name: "SmartFoldersSection", patch: { smartFolders: [{ id: "s1", name: "Loops", query: "tag:x" }] }, text: "Smart folders" },
  { name: "CollectionsSection", patch: { collections: [{ id: "c1", name: "Loops", query: "tag:x" }] }, text: "⊙ Loops" },
];

// The GATE half cannot be seen in the DOM: every one of these sections also
// returns null internally when its own collection is empty, so deleting the
// outer gate — which would put a suspended boundary on the first paint and
// fetch the chunk there, giving back the entire measured saving — changes
// nothing a `queryByText` can observe. (Measured: removing the `figureDocCount
// > 0` gate left a DOM-only version of these tests green.) What it DOES change
// is whether the module is ever imported, so `loaded` above records that
// directly: each mock factory runs exactly once, the first time something
// imports that module, and hands back the real module.
//
// Hence the shape below. The seams run in a fixed order, and each one asserts
// that NOTHING had fetched its module before its own gate opened — which is a
// claim about every earlier test in this file, all of which rendered the same
// `LibrarySections` tree with this section's collection empty. The first seam
// carries the strongest form of the claim: when only its gate is open, it must
// be the ONLY section fetched out of all six.
describe("Library flat sections — chunk-deferred renderers", () => {
  for (const [index, seam] of SECTION_SEAMS.entries()) {
    it(`${seam.name} is fetched and rendered only once its gate opens`, async () => {
      // The gate half: every earlier test rendered this tree with this
      // section's collection empty, and its chunk was never requested.
      expect([...loaded]).not.toContain(seam.name);

      useApp.setState(seam.patch);
      render(sections());
      // The seam half: the gate is open, so the boundary is mounted — but its
      // fallback is null, so nothing of the section is in the DOM yet.
      expect(screen.queryByText(seam.text)).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByText(seam.text)).toBeInTheDocument());
      expect([...loaded]).toContain(seam.name);

      if (index === 0) {
        // Strongest form, available only on the very first render of the file:
        // one open gate fetched exactly one section.
        expect([...loaded].sort()).toEqual([seam.name]);
      }
    });
  }
});

describe("multi-select bar — chunk-deferred renderer", () => {
  it("renders only after its chunk resolves, and only from the second selected row", async () => {
    useApp.setState({ datasets: [ds("a"), ds("b")], selectedIds: ["a"] });
    const { rerender } = render(<Library />);
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();

    useApp.setState({ selectedIds: ["a", "b"] });
    rerender(<Library />);
    // Gate open, chunk in flight: the count is not in the DOM on this flush.
    expect(screen.queryByText("2 selected")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("2 selected")).toBeInTheDocument());
  });
});
