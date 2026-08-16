// E-c1: the visible-only thumbnail scheduler's contract — cache-first
// serving, generation lifecycle, ABORT on unmount, and revision-keyed
// invalidation (a late result from a replaced entity never renders).
// jsdom has no IntersectionObserver, so the hook's documented degrade-to-
// eager path is what runs here; the observer wiring itself is a thin
// platform shim exercised in the real browser via the tiles E2E journey.

import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryNode } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import {
  clearThumbnailCache,
  registerThumbnailGenerator,
  setCachedThumbnail,
  unregisterThumbnailGenerator,
  type ThumbnailResult,
} from "../../lib/thumbnailCache";
import { resolveThumbnailRequest } from "../../lib/thumbnailRequest";
import { registerDefaultThumbnailGenerators } from "../../lib/thumbnailGenerators";
import { useThumbnail, type ThumbnailState } from "./useThumbnail";

const thumb = (url: string): ThumbnailResult => ({ url, width: 160, height: 120 });

const reportNode = (entity: object): LibraryNode =>
  ({ key: "report:r1", entityId: "r1", kind: "report", name: "R", parentKey: null, depth: 0, children: [], entity,
     source: { datasetIds: [], missingDatasetIds: [], usedPlacementFallback: false } } as unknown as LibraryNode);

function Probe({ node, onState }: { node: LibraryNode; onState: (s: ThumbnailState) => void }) {
  const ref = createRef<HTMLDivElement>();
  const state = useThumbnail(node, ref);
  onState(state);
  return <div ref={ref} data-status={state.status} />;
}

beforeEach(() => {
  useApp.setState({ datasets: [], editableFigures: [] });
  unregisterThumbnailGenerator("report");
  unregisterThumbnailGenerator("editable-figure");
});

afterEach(() => {
  clearThumbnailCache();
  unregisterThumbnailGenerator("report");
  unregisterThumbnailGenerator("editable-figure");
});

afterAll(() => registerDefaultThumbnailGenerators());

/** The fingerprint the hook itself will compute for `node` against the
 *  CURRENT store — used to pre-seed the cache in the sync-serve test. */
const liveFingerprint = (node: LibraryNode): string => {
  const { datasets, editableFigures } = useApp.getState();
  return resolveThumbnailRequest(node, { datasets, editableFigures }).fingerprint;
};

describe("useThumbnail — E-c1 scheduler contract", () => {
  it("reports unsupported for a kind with no generator (tile keeps its static placeholder)", () => {
    const states: ThumbnailState[] = [];
    render(<Probe node={reportNode({ id: "r1" })} onState={(s) => states.push(s)} />);
    expect(states.at(-1)?.status).toBe("unsupported");
  });

  it("serves a cached result synchronously without calling the generator", () => {
    const generator = vi.fn();
    registerThumbnailGenerator("report", generator);
    const node = reportNode({ id: "r1" });
    setCachedThumbnail(node.key, liveFingerprint(node), thumb("cached"));

    const states: ThumbnailState[] = [];
    render(<Probe node={node} onState={(s) => states.push(s)} />);

    expect(states.at(-1)).toEqual({ status: "ready", result: thumb("cached") });
    expect(generator).not.toHaveBeenCalled();
  });

  it("generates when visible, caches, and a remount serves the cache (single generation)", async () => {
    const generator = vi.fn().mockResolvedValue(thumb("fresh"));
    registerThumbnailGenerator("report", generator);
    const node = reportNode({ id: "r1" });

    const states: ThumbnailState[] = [];
    const { unmount } = render(<Probe node={node} onState={(s) => states.push(s)} />);
    expect(states.at(-1)?.status).toBe("loading");
    await waitFor(() => expect(states.at(-1)?.status).toBe("ready"));
    unmount();

    render(<Probe node={node} onState={(s) => states.push(s)} />);
    expect(states.at(-1)?.status).toBe("ready");
    expect(generator).toHaveBeenCalledTimes(1);
  });

  it("aborts the in-flight generation on unmount and discards its late result", async () => {
    const captured: { signal?: AbortSignal } = {};
    let release: (r: ThumbnailResult) => void = () => {};
    const generator = vi.fn((_request: unknown, signal: AbortSignal) => {
      captured.signal = signal;
      return new Promise<ThumbnailResult>((resolve) => { release = resolve; });
    });
    registerThumbnailGenerator("report", generator);
    const node = reportNode({ id: "r1" });

    const { unmount } = render(<Probe node={node} onState={() => {}} />);
    expect(captured.signal).toBeDefined();
    unmount();
    expect(captured.signal?.aborted).toBe(true);

    // A late resolve after abort must not populate the cache either.
    await act(async () => release(thumb("late")));
    const generator2 = vi.fn().mockResolvedValue(thumb("fresh"));
    unregisterThumbnailGenerator("report");
    registerThumbnailGenerator("report", generator2);
    const states: ThumbnailState[] = [];
    render(<Probe node={node} onState={(s) => states.push(s)} />);
    await waitFor(() => expect(states.at(-1)?.status).toBe("ready"));
    expect(generator2).toHaveBeenCalledTimes(1); // cache was NOT poisoned by the aborted run
  });

  it("a replaced entity object (new revision) regenerates; the stale result never shows", async () => {
    const generator = vi
      .fn()
      .mockResolvedValueOnce(thumb("v1"))
      .mockResolvedValueOnce(thumb("v2"));
    registerThumbnailGenerator("report", generator);

    const states: ThumbnailState[] = [];
    const { rerender } = render(<Probe node={reportNode({ id: "r1" })} onState={(s) => states.push(s)} />);
    await waitFor(() => expect(states.at(-1)?.status).toBe("ready"));

    rerender(<Probe node={reportNode({ id: "r1" })} onState={(s) => states.push(s)} />); // NEW entity object
    await waitFor(() => {
      const s = states.at(-1);
      expect(s?.status === "ready" && s.result.url === "v2").toBe(true);
    });
    expect(generator).toHaveBeenCalledTimes(2);
  });

  it("a replaced DEPENDENCY under an unchanged entity regenerates (Sol review, case 2)", async () => {
    const generator = vi.fn().mockResolvedValueOnce(thumb("v1")).mockResolvedValueOnce(thumb("v2"));
    registerThumbnailGenerator("editable-figure", generator);
    const figureEntity = { id: "f1", bindings: { datasetId: "d1" } };
    const node = ({ key: "editable-figure:f1", entityId: "f1", kind: "editable-figure", name: "F",
      parentKey: null, depth: 0, children: [], entity: figureEntity,
      source: { datasetIds: ["d1"], missingDatasetIds: [], usedPlacementFallback: false } } as unknown as LibraryNode);
    act(() => useApp.setState({ datasets: [{ id: "d1" } as never], editableFigures: [] }));

    const states: ThumbnailState[] = [];
    render(<Probe node={node} onState={(s) => states.push(s)} />);
    await waitFor(() => expect(states.at(-1)?.status).toBe("ready"));

    // Reimport/pending-load replaces the DATASET object; the figure entity is untouched.
    act(() => useApp.setState({ datasets: [{ id: "d1" } as never] }));
    await waitFor(() => {
      const s = states.at(-1);
      expect(s?.status === "ready" && s.result.url === "v2").toBe(true);
    });
    expect(generator).toHaveBeenCalledTimes(2);
  });

  it("a late result for the OLD dependency fingerprint neither renders nor poisons the new one (Sol review, case 3)", async () => {
    const pending: Array<(r: ThumbnailResult) => void> = [];
    const generator = vi.fn(() => new Promise<ThumbnailResult>((resolve) => pending.push(resolve)));
    registerThumbnailGenerator("editable-figure", generator);
    const figureEntity = { id: "f1", bindings: { datasetId: "d1" } };
    const node = ({ key: "editable-figure:f1", entityId: "f1", kind: "editable-figure", name: "F",
      parentKey: null, depth: 0, children: [], entity: figureEntity,
      source: { datasetIds: ["d1"], missingDatasetIds: [], usedPlacementFallback: false } } as unknown as LibraryNode);
    act(() => useApp.setState({ datasets: [{ id: "d1" } as never], editableFigures: [] }));

    const states: ThumbnailState[] = [];
    render(<Probe node={node} onState={(s) => states.push(s)} />);
    // Wait on STATE the calls commit to (the pending-resolver array), not on
    // the mock call itself — the architecture weak-wait ratchet's rule.
    await waitFor(() => expect(pending.length).toBe(1));

    act(() => useApp.setState({ datasets: [{ id: "d1" } as never] })); // dep replaced mid-flight
    await waitFor(() => expect(pending.length).toBe(2));

    await act(async () => pending[0]!(thumb("old"))); // the OLD run resolves late
    const afterOld = states.at(-1);
    expect(afterOld?.status === "ready" && afterOld.result.url === "old").toBe(false);

    await act(async () => pending[1]!(thumb("new")));
    await waitFor(() => {
      const s = states.at(-1);
      expect(s?.status === "ready" && s.result.url === "new").toBe(true);
    });
  });

  it("a rejecting generator reports error, not a crash or a stuck loading state", async () => {
    registerThumbnailGenerator("report", vi.fn().mockRejectedValue(new Error("boom")));
    const states: ThumbnailState[] = [];
    render(<Probe node={reportNode({ id: "r1" })} onState={(s) => states.push(s)} />);
    await waitFor(() => expect(states.at(-1)?.status).toBe("error"));
  });
});
