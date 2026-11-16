// Soak-fix review 4, F10: while the startup restore is still failing, the
// status-bar label ("previous session not restored") did nothing on click.
// It now retries at once instead of waiting out the backoff.

import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { retryAutosaveRestoreNow, startAutosaveRestore } from "./autosaveStartupRestore";

const { loadAutosaveGeneration } = vi.hoisted(() => ({ loadAutosaveGeneration: vi.fn() }));
vi.mock("./lib/autosave", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/autosave")>()),
  loadAutosaveGeneration,
}));
vi.mock("./lib/api", () => ({ fetchBookData: vi.fn() }));

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

let stop: () => void = () => undefined;
afterEach(() => stop());

describe("retry the startup restore now", () => {
  it("retries at once while it is failing, and is a no-op once it is not", async () => {
    loadAutosaveGeneration.mockRejectedValueOnce(new Error("chunk gone")).mockResolvedValue(null);
    stop = startAutosaveRestore(vi.fn());
    await settle();
    expect(loadAutosaveGeneration).toHaveBeenCalledTimes(1);

    expect(retryAutosaveRestoreNow()).toBe(true); // no 2 s wait
    await settle();
    expect(loadAutosaveGeneration).toHaveBeenCalledTimes(2);

    expect(retryAutosaveRestoreNow()).toBe(false); // nothing pending any more
  });
});
