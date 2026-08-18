// P1.7 desktopBridge.ts surface: `probeSource` / `grantSourceReadPaths` —
// mirrors desktopBridge.test.ts's own mocking convention (a fake
// `window.pywebview.api`) for the two new methods that back relink's
// missing/offline/changed/permission-denied distinction.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { grantSourceReadPaths, probeSource } from "./desktopBridge";

interface FakeApi {
  probe_source?: (path: string) => Promise<Record<string, unknown>>;
  grant_source_paths?: (paths: string[]) => Promise<Record<string, unknown>>;
}

function setShell(api: FakeApi | null): void {
  const g = globalThis as { pywebview?: { api?: FakeApi } };
  if (api === null) delete g.pywebview;
  else g.pywebview = { api };
}

beforeEach(() => setShell(null));
afterEach(() => setShell(null));

describe("probeSource — no bridge", () => {
  it("returns null (never guesses a state)", async () => {
    expect(await probeSource("/data/run1.csv")).toBeNull();
  });
});

describe("probeSource — desktop shell", () => {
  it("parses an ok probe with a checksum", async () => {
    setShell({
      probe_source: async () => ({
        state: "ok",
        path: "/data/run1.csv",
        size: 42,
        mtime: 1700000000,
        checksum: "sha256:abc",
      }),
    });
    const out = await probeSource("/data/run1.csv");
    expect(out).toEqual({
      state: "ok",
      path: "/data/run1.csv",
      size: 42,
      mtime: 1700000000,
      checksum: "sha256:abc",
    });
  });

  it("parses an ok probe with no checksum as null, not undefined/absent", async () => {
    setShell({ probe_source: async () => ({ state: "ok", path: "/data/run1.csv", size: 1, mtime: 1 }) });
    const out = await probeSource("/data/run1.csv");
    expect(out?.checksum).toBeNull();
  });

  it("recognizes the NEW permission_denied state", async () => {
    setShell({ probe_source: async () => ({ state: "permission_denied", path: "/data/run1.csv" }) });
    expect((await probeSource("/data/run1.csv"))?.state).toBe("permission_denied");
  });

  it("narrows an unrecognized state to null rather than passing it through", async () => {
    setShell({ probe_source: async () => ({ state: "something-new" }) });
    expect(await probeSource("/data/run1.csv")).toBeNull();
  });

  it("reports null when the bridge throws", async () => {
    setShell({
      probe_source: async () => {
        throw new Error("boom");
      },
    });
    expect(await probeSource("/data/run1.csv")).toBeNull();
  });

  it("reports null when the method is missing from an otherwise-present api", async () => {
    setShell({});
    expect(await probeSource("/data/run1.csv")).toBeNull();
  });
});

describe("grantSourceReadPaths — no bridge", () => {
  it("returns [] rather than throwing", async () => {
    expect(await grantSourceReadPaths(["/data/run1.csv"])).toEqual([]);
  });
});

describe("grantSourceReadPaths — desktop shell", () => {
  it("returns the granted paths", async () => {
    setShell({ grant_source_paths: async (paths) => ({ paths }) });
    expect(await grantSourceReadPaths(["/data/run1.csv", "/data/run2.csv"])).toEqual([
      "/data/run1.csv",
      "/data/run2.csv",
    ]);
  });

  it("drops non-string entries defensively", async () => {
    setShell({ grant_source_paths: async () => ({ paths: ["/data/run1.csv", 42, null] }) });
    expect(await grantSourceReadPaths(["/data/run1.csv"])).toEqual(["/data/run1.csv"]);
  });

  it("returns [] when the bridge throws", async () => {
    setShell({
      grant_source_paths: async () => {
        throw new Error("boom");
      },
    });
    expect(await grantSourceReadPaths(["/data/run1.csv"])).toEqual([]);
  });
});
