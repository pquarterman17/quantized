// E-c1: the visible-only thumbnail scheduler's contract — cache-first
// serving, generation lifecycle, ABORT on unmount, and revision-keyed
// invalidation (a late result from a replaced entity never renders).
// jsdom has no IntersectionObserver, so the hook's documented degrade-to-
// eager path is what runs here; the observer wiring itself is a thin
// platform shim exercised in the real browser via the tiles E2E journey.

import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryNode } from "../../lib/libraryHierarchy";
import {
  clearThumbnailCache,
  registerThumbnailGenerator,
  setCachedThumbnail,
  revisionOf,
  unregisterThumbnailGenerator,
  type ThumbnailResult,
} from "../../lib/thumbnailCache";
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

afterEach(() => {
  clearThumbnailCache();
  unregisterThumbnailGenerator("report");
});

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
    setCachedThumbnail(node.key, revisionOf(node), thumb("cached"));

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
    const generator = vi.fn((_node: LibraryNode, signal: AbortSignal) => {
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

  it("a rejecting generator reports error, not a crash or a stuck loading state", async () => {
    registerThumbnailGenerator("report", vi.fn().mockRejectedValue(new Error("boom")));
    const states: ThumbnailState[] = [];
    render(<Probe node={reportNode({ id: "r1" })} onState={(s) => states.push(s)} />);
    await waitFor(() => expect(states.at(-1)?.status).toBe("error"));
  });
});
