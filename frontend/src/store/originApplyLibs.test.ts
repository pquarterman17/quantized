// COLD-path coverage for the lazily-chunked Origin-apply library (bundle
// headroom slice 1, `plans/BUNDLE_HEADROOM.md`).
//
// `store/useApp.test.ts` and `store/originFallback.test.ts` warm the chunk in
// a `beforeAll`, so they exercise the warm/synchronous apply that every apply
// after a session's first takes. Nothing there would notice if the deferral,
// its latest-request-wins guard, or its failure handling regressed — this
// spec owns those.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, OriginFigure } from "../lib/types";
import { resetOriginApplyLibsForTests } from "./originApplyLibs";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

// Swapped per test so the chunk-fetch failure path is reachable. The rest of
// the module (notably `originApplyLibs()`, which owns the real cache the store
// reads) stays real, so a "load" here really does populate what the store
// checks.
vi.mock("./originApplyLibs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./originApplyLibs")>();
  return { ...actual, loadOriginApplyLibs: () => load() };
});

// `importActual` (not the file's own import, which resolves to the mock —
// that recurses) yields the SAME module instance the spread above kept, so
// this really does populate the cache `originApplyLibs()` reads.
const realLoad = (
  await vi.importActual<typeof import("./originApplyLibs")>("./originApplyLibs")
).loadOriginApplyLibs;
let load: () => Promise<unknown> = realLoad;

const book = (id: string, bookName: string): Dataset => ({
  id,
  name: `Project:${bookName}`,
  data: {
    time: [1, 2],
    values: [[10], [20]],
    labels: ["signal"],
    units: [""],
    metadata: { origin_book: bookName, x_column_name: "A", origin_column_names: ["B"] },
  },
});

const figure = (name: string, xTo: number): OriginFigure => ({
  name,
  x_from: 0, x_to: xTo, x_log: false,
  y_from: 0, y_to: 20, y_log: false,
  n_curves: 1, annotations: [],
  curves: [{ book: "Book1", x: "A", y: "B", style: "line" }],
});

const entry = (id: string, fig: OriginFigure) => ({
  id, stem: "Project", figure: fig, datasetId: "d1", siblingIds: ["d1"],
});

beforeEach(() => {
  load = realLoad;
  resetOriginApplyLibsForTests(); // every test starts COLD
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [book("d1", "Book1")],
    activeId: null,
    originFigures: [entry("a", figure("GraphA", 2)), entry("b", figure("GraphB", 7))],
    xLim: null,
    macroRecording: false,
    macroSteps: [],
    status: "",
  });
});

describe("applyOriginFigure — cold lazy-chunk path", () => {
  it("defers the first apply of a session, then lands it", async () => {
    useApp.getState().applyOriginFigure("a");
    // Red-first: with the apply half statically imported this assertion fails,
    // because the whole body would already have run synchronously.
    expect(useApp.getState().xLim).toBeNull();

    await vi.waitFor(() => expect(useApp.getState().xLim).toEqual([0, 2]));
    expect(useApp.getState().activeId).toBe("d1");
  });

  it("is synchronous once the chunk is loaded", async () => {
    useApp.getState().applyOriginFigure("a");
    await vi.waitFor(() => expect(useApp.getState().xLim).toEqual([0, 2]));

    useApp.setState({ xLim: null });
    useApp.getState().applyOriginFigure("b");
    expect(useApp.getState().xLim).toEqual([0, 7]); // no await — warm path
  });

  it("drops a superseded apply: the LAST request wins across the load", async () => {
    useApp.getState().applyOriginFigure("a");
    useApp.getState().applyOriginFigure("b"); // while the chunk is still in flight

    await vi.waitFor(() => expect(useApp.getState().xLim).not.toBeNull());
    expect(useApp.getState().xLim).toEqual([0, 7]); // GraphB, not GraphA

    // And the superseded request must not land LATER either.
    await Promise.resolve();
    await Promise.resolve();
    expect(useApp.getState().xLim).toEqual([0, 7]);
  });

  it("drops a chunk-deferred apply superseded by a later one (stale-completion guard)", async () => {
    // The shared-promise case above cannot see this guard: two chunk-deferred
    // requests resolve in registration order, so the newer one overwrites the
    // older and the end state is right either way. It becomes observable when
    // the newer request is deferred on something SLOWER — here a pending source
    // book — so the older request's completion would otherwise land last: a
    // transient wrong plot AND a spurious macro/history entry for a figure the
    // user has already moved on from.
    let releaseSources = (): void => {};
    useApp.setState({
      macroRecording: true,
      macroSteps: [],
      datasets: [
        book("d1", "Book1"),
        { ...book("d2", "Book1"), pending: { kind: "path", path: "/p.opj", bookId: "b2", rows: 4, cols: 1 } },
      ],
      originFigures: [
        entry("a", figure("GraphA", 2)),
        { ...entry("b", figure("GraphB", 7)), datasetId: "d2", siblingIds: ["d2"] },
      ],
      resolveDatasets: () => new Promise<Dataset[]>((resolve) => {
        releaseSources = () => {
          // What a real source fetch does: swap the pending book for loaded
          // data, so the re-entry finds nothing left to wait for.
          useApp.setState((st) => ({
            datasets: st.datasets.map((d) => (d.id === "d2" ? book("d2", "Book1") : d)),
          }));
          resolve(useApp.getState().datasets);
        };
      }),
    });

    useApp.getState().applyOriginFigure("a"); // defers on the chunk
    useApp.getState().applyOriginFigure("b"); // defers on the pending source book

    await vi.waitFor(() => expect(useApp.getState().status).toContain("Origin source book"));
    // The chunk has landed by now; "a" must NOT have applied behind "b"'s back.
    expect(useApp.getState().xLim).toBeNull();
    expect(useApp.getState().macroSteps).toEqual([]);

    releaseSources();
    await vi.waitFor(() => expect(useApp.getState().xLim).toEqual([0, 7]));
    expect(useApp.getState().macroSteps).toHaveLength(1);
  });

  it("records exactly one macro step for a deferred apply", async () => {
    useApp.setState({ macroRecording: true, macroSteps: [] });
    useApp.getState().applyOriginFigure("a");

    await vi.waitFor(() => expect(useApp.getState().xLim).toEqual([0, 2]));
    expect(useApp.getState().macroSteps).toHaveLength(1);
  });

  it("reports a chunk-load failure and leaves the plot untouched", async () => {
    load = () => Promise.reject(new Error("network error"));
    useApp.getState().applyOriginFigure("a");

    await vi.waitFor(() =>
      expect(useApp.getState().status).toBe("couldn't apply Origin figure — network error"),
    );
    expect(useApp.getState().xLim).toBeNull();
    expect(useToasts.getState().toasts.some((t) => t.kind === "danger")).toBe(true);
  });

  it("retries after a failed load instead of staying broken", async () => {
    load = () => Promise.reject(new Error("network error"));
    useApp.getState().applyOriginFigure("a");
    await vi.waitFor(() => expect(useApp.getState().status).toContain("network error"));

    load = realLoad;
    useApp.getState().applyOriginFigure("a");
    await vi.waitFor(() => expect(useApp.getState().xLim).toEqual([0, 2]));
  });
});

describe("loadOriginApplyLibs caching", () => {
  it("does not cache a FAILED load — a later apply retries the fetch", async () => {
    // Exercises the real loader (not the swappable `load` above, which bypasses
    // exactly the caching this asserts): a genuinely rejecting dynamic import,
    // then a successful one on the SAME module instance. Without the `finally`
    // that clears the in-flight slot, the second call replays the rejection and
    // Origin figures stay permanently unappliable after one transient chunk 404.
    vi.resetModules();
    vi.doMock("../lib/originSpatialPanels", () => {
      throw new Error("chunk 404");
    });
    const mod = await import("./originApplyLibs");
    await expect(mod.loadOriginApplyLibs()).rejects.toThrow();

    vi.doUnmock("../lib/originSpatialPanels");
    await expect(mod.loadOriginApplyLibs()).resolves.toBeTruthy();
    vi.resetModules();
  });
});
