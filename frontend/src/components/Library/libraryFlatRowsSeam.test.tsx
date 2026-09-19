// COLD-path coverage for the Library render seam taken out of the eager
// bundle on 2026-09-19 (`plans/BUNDLE_HEADROOM.md` slice 6): Library.tsx's
// own flat-list fallback body (`query.trim() === "" && rows.length === 0`)
// now reaches `DatasetRow.tsx` only through the lazy `LibraryFlatRows.tsx`
// wrapper. `src/architecture.test.ts`'s SEAMS list holds the STATIC half
// (nothing may value-import it, and the loader must reach it with a dynamic
// `import()`) — that grep cannot see whether the gate still behaves at
// runtime, which is what this file asserts. See `LibraryFlatRows.test.tsx`
// for coverage of the wrapper's own render output — this file deliberately
// never imports `LibraryFlatRows` itself (statically OR indirectly through a
// shared module import at the top level), because that would fire the
// tracked mock factory below at file-load time instead of at Library.tsx's
// real runtime `import()` call, defeating the whole point of the recorder.
//
// The gate here is UNUSUALLY strong (see LibraryFlatRows.tsx's own header):
// `rows.length === 0` implies `datasets.length === 0` (every dataset
// unconditionally yields a hierarchy worksheet node), which means `shown` is
// empty too — so a DOM assertion can NEVER distinguish "gate open, chunk
// fetched, nothing to render" from "gate closed, chunk never fetched" on this
// particular seam; only the import record can. That is a stronger version of
// slice 4/5's "a DOM-only test cannot see a render gate" lesson.

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Library from "./Library";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

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

const ds = (id: string): Dataset => ({
  id,
  name: id,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
});

beforeEach(() => {
  loaded.clear();
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

describe("Library flat-row fallback — chunk-deferred, and gated on the true-empty state", () => {
  it("fetches the chunk only once the hierarchy goes from non-empty to truly empty", async () => {
    // Gate CLOSED: a dataset means at least one hierarchy row, so the tree
    // renders instead (LibraryTree is its own, already-lazy seam) — give it a
    // chance to resolve too, then flush the microtask queue with nothing left
    // pending. A real gate never starts LibraryFlatRows's dynamic import at
    // all on this path; only React's own import-cache TIMING makes this
    // ordering (closed first, in the SAME render tree, via `rerender`) the
    // one that actually exercises it — two separate `render()` calls across
    // two tests do not reliably re-trigger `lazy()`'s factory a second time
    // once React has resolved it once for that component reference.
    useApp.setState({ datasets: [ds("a")] });
    const { rerender } = render(<Library />);
    await screen.findByText("a");
    await act(async () => {});
    expect([...loaded]).not.toContain("LibraryFlatRows");

    // Gate OPEN: drop to the true-empty state (no dataset, no folder,
    // nothing) — `rows.length === 0`, so the flat-fallback branch is taken.
    useApp.setState({ datasets: [] });
    rerender(<Library />);
    await waitFor(() => expect([...loaded]).toContain("LibraryFlatRows"), { timeout: 5000 });
  });
});
