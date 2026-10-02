import { describe, expect, it, vi } from "vitest";

import { runSequentialBatch } from "./sequentialBatch";

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
});
