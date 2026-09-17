// Unit tests for the module itself, isolated from `store/diagnostics.ts`'s
// end-to-end coverage — `diagnostics.test.ts` proves the rendered text; this
// proves the two primitives that produce it (P3.4 review round, finding 2 and
// nit 11).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BACKEND_UNREACHABLE, getBackendHealth, recordBackendHealth, resetBackendHealthForTests } from "./backendHealth";

beforeEach(() => {
  resetBackendHealthForTests();
});

afterEach(() => {
  resetBackendHealthForTests();
  vi.useRealTimers();
});

describe("backendHealth", () => {
  it("reports unreachable with a null age before anything is ever recorded", () => {
    expect(getBackendHealth()).toEqual({ reachable: false, app: null, version: null, ageSec: null });
  });

  it("reports the recorded identity with a fresh (0 s) age immediately after recording", () => {
    recordBackendHealth({ reachable: true, app: "quantized", version: "0.25.0" });
    expect(getBackendHealth()).toEqual({ reachable: true, app: "quantized", version: "0.25.0", ageSec: 0 });
  });

  it("computes the age at READ time, not record time, so it grows while the app sits idle", () => {
    vi.useFakeTimers();
    recordBackendHealth({ reachable: true, app: "quantized", version: "0.25.0" });
    vi.advanceTimersByTime(90_000);
    expect(getBackendHealth().ageSec).toBe(90);
    vi.advanceTimersByTime(30_000);
    // Same record, read again later: the age moved again without a second
    // recordBackendHealth call — proof it is not cached at record time.
    expect(getBackendHealth().ageSec).toBe(120);
  });

  it("resets to the unreachable/never-recorded state for tests", () => {
    recordBackendHealth({ reachable: true, app: "quantized", version: "0.25.0" });
    resetBackendHealthForTests();
    expect(getBackendHealth()).toEqual({ reachable: false, app: null, version: null, ageSec: null });
  });

  it("freezes BACKEND_UNREACHABLE so no consumer can poison the shared constant", () => {
    expect(Object.isFrozen(BACKEND_UNREACHABLE)).toBe(true);
    expect(() => {
      (BACKEND_UNREACHABLE as { app: string | null }).app = "poisoned";
    }).toThrow();
    expect(BACKEND_UNREACHABLE.app).toBeNull();
  });
});
