// The native-vs-browser import branch (MAIN_PLAN #31). The subtle case is
// CANCELLATION: "no bridge" and "user cancelled" must not collapse, or backing
// out of the native dialog pops the browser picker in the user's face.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chooseAndImport } from "./importEntry";

const openFilePicker = vi.fn();
vi.mock("./openFilePicker", () => ({
  IMPORT_ACCEPT: ".dat,.csv",
  openFilePicker: (...a: unknown[]) => openFilePicker(...a),
}));

interface FakeApi {
  pick_files?: (dir?: string, multiple?: boolean) => Promise<Record<string, unknown>>;
}

function setShell(api: FakeApi | null): void {
  const g = globalThis as { pywebview?: { api?: FakeApi } };
  if (api === null) delete g.pywebview;
  else g.pywebview = { api };
}

const store = { importFiles: vi.fn(async () => {}), importPaths: vi.fn(async () => {}) };

beforeEach(() => {
  vi.clearAllMocks();
  setShell(null);
});
afterEach(() => setShell(null));

describe("chooseAndImport — browser (no desktop shell)", () => {
  it("uses the file picker", async () => {
    await chooseAndImport(store);
    expect(openFilePicker).toHaveBeenCalledTimes(1);
    expect(store.importPaths).not.toHaveBeenCalled();
  });

  it("passes the accept filter through to the picker", async () => {
    await chooseAndImport(store, ".xy");
    expect(openFilePicker.mock.calls[0][1]).toBe(".xy");
  });
});

describe("chooseAndImport — desktop shell", () => {
  it("imports natively picked PATHS, never the browser picker", async () => {
    setShell({ pick_files: async () => ({ paths: ["/data/run.dat", "/data/run2.dat"] }) });
    await chooseAndImport(store);
    expect(store.importPaths).toHaveBeenCalledWith(["/data/run.dat", "/data/run2.dat"]);
    expect(openFilePicker).not.toHaveBeenCalled();
    expect(store.importFiles).not.toHaveBeenCalled();
  });

  it("does NOT fall back to the browser picker when the user cancels", async () => {
    // The important one: [] is "cancelled", not "no bridge". Falling back here
    // would shove a second dialog at someone who just backed out of the first.
    setShell({ pick_files: async () => ({ paths: [] }) });
    await chooseAndImport(store);
    expect(openFilePicker).not.toHaveBeenCalled();
    expect(store.importPaths).not.toHaveBeenCalled();
  });

  it("falls back when the bridge is present but UNUSABLE", async () => {
    // e.g. the window is not attached yet. Leaving the user with no dialog at
    // all would be worse than a browser one.
    setShell({ pick_files: async () => ({ paths: "not-an-array" }) });
    await chooseAndImport(store);
    expect(openFilePicker).toHaveBeenCalledTimes(1);
  });

  it("falls back when the bridge throws", async () => {
    setShell({
      pick_files: async () => {
        throw new Error("no display");
      },
    });
    await chooseAndImport(store);
    expect(openFilePicker).toHaveBeenCalledTimes(1);
  });

  it("falls back when the shell exposes no pick_files at all", async () => {
    setShell({});
    await chooseAndImport(store);
    expect(openFilePicker).toHaveBeenCalledTimes(1);
  });
});
