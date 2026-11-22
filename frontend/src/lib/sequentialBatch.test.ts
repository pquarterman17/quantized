import { describe, expect, it, vi } from "vitest";

import { BatchSkip, runSequentialBatch } from "./sequentialBatch";

const ITEMS = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
  { id: "c", name: "C" },
];

describe("runSequentialBatch", () => {
  it("keeps input order, isolates failures and reports progress", async () => {
    const progress = vi.fn();
    const results = await runSequentialBatch(
      ITEMS,
      async (item) => {
        if (item.id === "b") throw new Error("bad columns");
        return `${item.id}!`;
      },
      { onProgress: progress },
    );
    expect(results).toEqual([
      { item: ITEMS[0], status: "created", value: "a!" },
      { item: ITEMS[1], status: "failed", reason: "bad columns" },
      { item: ITEMS[2], status: "created", value: "c!" },
    ]);
    expect(progress).toHaveBeenLastCalledWith({ done: 3, total: 3, current: null });
  });

  it("stops before the next item and identifies every unstarted item", async () => {
    const ctrl = new AbortController();
    const progress = vi.fn();
    const worker = vi.fn(async (item: (typeof ITEMS)[number]) => {
      ctrl.abort();
      return item.id;
    });
    const results = await runSequentialBatch(ITEMS, worker, { signal: ctrl.signal, onProgress: progress });
    expect(worker).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status)).toEqual(["created", "stopped", "stopped"]);
    expect(progress).toHaveBeenLastCalledWith({ done: 1, total: 3, current: null });
  });

  it("reports a deliberately skipped item as skipped, not failed", async () => {
    const results = await runSequentialBatch(ITEMS, async (item) => {
      if (item.id === "a") throw new BatchSkip("review declined");
      if (item.id === "b") throw new Error("bad columns");
      return item.id;
    });
    expect(results.map((r) => r.status)).toEqual(["skipped", "failed", "created"]);
    expect(results[0]).toEqual({ item: ITEMS[0], status: "skipped", reason: "review declined" });
  });

  it("reports an item that honoured the stop with an AbortError as stopped, with the rest", async () => {
    const ctrl = new AbortController();
    const results = await runSequentialBatch(
      ITEMS,
      async () => {
        ctrl.abort();
        throw new DOMException("aborted", "AbortError");
      },
      { signal: ctrl.signal },
    );
    expect(results.map((r) => r.status)).toEqual(["stopped", "stopped", "stopped"]);
  });

  it("an AbortError with no stop requested is an ordinary failure", async () => {
    const results = await runSequentialBatch([ITEMS[0]], async () => {
      throw new DOMException("aborted", "AbortError");
    });
    expect(results[0].status).toBe("failed");
  });
});
