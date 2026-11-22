// Review M2 (gap audit 4 lane A): the region-decor startup chunk also draws the
// error bars, so a failed load must be retried and then reported, never silent.

import { describe, expect, it, vi } from "vitest";

import { useApp } from "../store/useApp";
import { regionDecor, regionDecorSettled, settleDecor } from "./regionDecorLoader";

type DecorModule = NonNullable<ReturnType<typeof regionDecor>>;

describe("the error-bar / region-decor chunk loader", () => {
  it("loads the real chunk, which carries the error-bar drawing", async () => {
    await regionDecorSettled;
    expect(typeof regionDecor()?.drawErrorBars).toBe("function");
    expect(typeof regionDecor()?.drawErrorSpans).toBe("function");
    expect(typeof regionDecor()?.drawErrorBands).toBe("function");
    expect(typeof regionDecor()?.drawColorScatter).toBe("function");
  });

  it("a first failure is retried once and the second attempt's module is used", async () => {
    const mod = {} as DecorModule;
    const load = vi.fn<() => Promise<DecorModule>>().mockRejectedValueOnce(new Error("404")).mockResolvedValueOnce(mod);
    await expect(settleDecor(load)).resolves.toBe(mod);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("two failures resolve to null and tell the user, never silently", async () => {
    useApp.setState({ status: "" });
    const load = vi.fn<() => Promise<DecorModule>>().mockRejectedValue(new Error("offline"));
    await expect(settleDecor(load)).resolves.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    expect(useApp.getState().status).toMatch(/Error bars.*could not load/);
  });

  it("a store that cannot be reached (torn down, half-initialised) still resolves to null, never a rejection", async () => {
    // The fallback imports the store lazily. In the vitest `node` project a test file can end while
    // the startup chunk import is in flight; the later store import then yields a namespace with no
    // `useApp`, and the unguarded `useApp.getState()` surfaced as an unhandled rejection in whichever
    // file happened to be running.
    vi.resetModules();
    vi.doMock("../store/useApp", () => ({ useApp: undefined }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { settleDecor: fresh } = await import("./regionDecorLoader");
      const load = vi.fn<() => Promise<DecorModule>>().mockRejectedValue(new Error("closed"));
      await expect(fresh(load)).resolves.toBeNull();
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      errors.mockRestore();
      vi.doUnmock("../store/useApp");
      vi.resetModules();
    }
  });
});
