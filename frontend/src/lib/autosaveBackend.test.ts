// Review R4: an IndexedDB open blocked by another tab's older connection used
// to wait forever, which stalled the whole autosave queue. `onblocked` now
// rejects with the remedy. (jsdom has no IndexedDB: a stub request stands in.)

import { afterEach, describe, expect, it, vi } from "vitest";

import { indexedDbBackend } from "./autosaveBackend";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("indexedDbBackend open", () => {
  it("rejects a blocked open with the remedy instead of waiting forever", async () => {
    const req: Record<string, unknown> = {};
    vi.stubGlobal("indexedDB", { open: () => req });
    const read = indexedDbBackend().read();
    (req.onblocked as () => void)();
    await expect(read).rejects.toThrow(/blocked by another quantized tab/);
  });
});
