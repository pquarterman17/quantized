// COLD-path coverage for the Library render seam taken out of the eager
// bundle on 2026-09-19 (`plans/BUNDLE_HEADROOM.md` slice 6): Library.tsx's
// own flat-list fallback body (`query.trim() === "" && rows.length === 0 &&
// shown.length > 0`) now reaches `DatasetRow.tsx` only through the lazy
// `LibraryFlatRows.tsx` wrapper. `src/architecture.test.ts`'s SEAMS list
// holds the STATIC half (nothing may value-import it, and the loader must
// reach it with a dynamic `import()`) — that grep cannot see whether the
// gate still behaves at runtime, which is what this file asserts. See
// `LibraryFlatRows.test.tsx` for coverage of the wrapper's own render
// output — this file deliberately never imports `LibraryFlatRows` itself
// (statically OR indirectly through a shared module import at the top
// level), because that would fire the tracked mock factory below at
// file-load time instead of at Library.tsx's real runtime `import()` call,
// defeating the whole point of the recorder.
//
// The `shown.length > 0` half of the gate exists ONLY as a belt-and-braces
// guard: adversarial review (2026-09-19) proved from source
// (`lib/libraryHierarchy.ts`'s `buildLibraryHierarchy`/
// `flattenLibraryHierarchy`) — and probed with dangling `workbookId`,
// dangling `folderId`, duplicate ids, cyclic/self-parent folders, an empty
// id, and collapsed containers — that `rows.length === 0 && datasets.length
// > 0` is UNREACHABLE from real app state: every dataset unconditionally
// yields at least one hierarchy row. So in today's app this branch is only
// ever reached with `shown.length === 0` too, and the gate below is
// impossible to open through normal state. The first test proves that: even
// pushed as close to the true-empty edge as real state allows, the chunk is
// never fetched. The second test proves the gate still opens CORRECTLY if
// that invariant ever breaks (a future `libraryHierarchy.ts` change that
// lets `rows` go empty while datasets exist) — reached only by mocking the
// hierarchy hook directly, since no real store state can produce it.
//
// A DOM assertion cannot stand in for either test: even when the gate is
// artificially forced open, `LibraryFlatRows` renders real content only
// because `shown` (computed independently of the mocked hook, straight from
// `datasets`) is non-empty — but whether the SUSPENSE BOUNDARY was ever
// mounted, i.e. whether the chunk was fetched, is exactly the thing only the
// import record can see.

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Library from "./Library";
import { buildLibraryHierarchy } from "../../lib/libraryHierarchy";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { useLibraryHierarchyModel } from "./useLibraryHierarchyRows";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn(), default: () => null }));

/** Records whether LibraryFlatRows has actually been IMPORTED (the chunk
 *  fetched), independent of whether it rendered anything. */
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
vi.mock("./LibraryFlatRows", track("LibraryFlatRows"));

// `useLibraryHierarchyModel` is wrapped in a `vi.fn()` that defaults to the
// REAL implementation, so every test gets genuine hierarchy behavior unless
// it explicitly overrides — only the "forced" test below does, to reach the
// otherwise-unreachable `rows.length === 0, datasets.length > 0` state.
vi.mock("./useLibraryHierarchyRows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useLibraryHierarchyRows")>();
  return { ...actual, useLibraryHierarchyModel: vi.fn(actual.useLibraryHierarchyModel) };
});

const ds = (id: string): Dataset => ({
  id,
  name: id,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
});

const emptyHierarchy = buildLibraryHierarchy({ folders: [], workbooks: [], datasets: [] });

beforeEach(() => {
  loaded.clear();
  vi.mocked(useLibraryHierarchyModel).mockReset();
  useApp.setState({
    datasets: [],
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
  useApp.setState({ datasets: [], originFigures: [], originFidelity: [], figureDocs: [], reports: [], smartFolders: [], collections: [], selectedIds: [] });
});

describe("Library flat-row fallback — chunk-deferred, and unreachable through real state", () => {
  it("never fetches the chunk on any REAL state, including the closest approach to true-empty", async () => {
    // Real state 1: a dataset means at least one hierarchy row, so the tree
    // renders instead (LibraryTree is its own, already-lazy seam) — give it
    // a chance to resolve too, then flush the microtask queue with nothing
    // left pending.
    useApp.setState({ datasets: [ds("a")] });
    const { rerender } = render(<Library />);
    await screen.findByText("a");
    await act(async () => {});
    expect([...loaded]).not.toContain("LibraryFlatRows");

    // Real state 2: the true-empty state (no dataset, no folder, nothing) —
    // `rows.length === 0` AND `shown.length === 0`, the only combination
    // real app state can reach. `HomeScreen` renders instead; the gate never
    // opens because there is nothing in `shown` to draw either way.
    useApp.setState({ datasets: [] });
    rerender(<Library />);
    await act(async () => {});
    expect([...loaded]).not.toContain("LibraryFlatRows");
  });

  it("still fetches the chunk if the otherwise-unreachable gate is forced open", async () => {
    // Force `rows.length === 0` while `datasets` (and therefore `shown`) is
    // non-empty — the state adversarial review confirmed no real app path
    // can reach, reproduced here only via a mocked hierarchy hook so the
    // gate's OPEN side stays covered even though nothing can open it today.
    vi.mocked(useLibraryHierarchyModel).mockReturnValue({ hierarchy: emptyHierarchy, rows: [] });
    useApp.setState({ datasets: [ds("a")] });
    render(<Library />);
    expect([...loaded]).not.toContain("LibraryFlatRows");
    await waitFor(() => expect([...loaded]).toContain("LibraryFlatRows"), { timeout: 5000 });
    expect(await screen.findByText("a")).toBeInTheDocument();
  });
});
