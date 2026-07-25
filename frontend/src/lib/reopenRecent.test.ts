// Reopening a Recent entry (MAIN_PLAN #31). The load-bearing distinction:
// "missing" offers to LOCATE the file, "offline" refuses to and says to retry —
// because an unmounted share is not a deleted file, and pushing a picker at the
// user invites them to "fix" something that will fix itself.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { reopenRecent } from "./reopenRecent";
import type { RecentFile } from "./recentFiles";

const openFilePicker = vi.fn();
vi.mock("./openFilePicker", () => ({
  IMPORT_ACCEPT: ".dat,.csv",
  openFilePicker: (...a: unknown[]) => openFilePicker(...a),
}));

const pathState = vi.fn();
vi.mock("./desktopBridge", () => ({ pathState: (p: string) => pathState(p) }));

const store = {
  importFiles: vi.fn(async () => {}),
  importPaths: vi.fn(async () => {}),
  setStatus: vi.fn(),
};

const withPath: RecentFile = {
  name: "scan.dat",
  size: 10,
  at: new Date().toISOString(),
  path: "/data/scan.dat",
};
const noPath: RecentFile = { name: "browser.csv", size: 10, at: new Date().toISOString() };

beforeEach(() => vi.clearAllMocks());

describe("reopenRecent", () => {
  it("imports the saved path when the file is there", async () => {
    pathState.mockResolvedValue("ok");
    expect(await reopenRecent(store, withPath)).toBe("imported");
    expect(store.importPaths).toHaveBeenCalledWith(["/data/scan.dat"]);
    expect(openFilePicker).not.toHaveBeenCalled();
  });

  it("offers to LOCATE a file whose volume is present but file is gone", async () => {
    pathState.mockResolvedValue("missing");
    expect(await reopenRecent(store, withPath)).toBe("located");
    expect(openFilePicker).toHaveBeenCalledTimes(1);
    expect(store.setStatus).toHaveBeenCalledWith(expect.stringContaining("locate it"));
  });

  it("does NOT open a picker when the volume is offline", async () => {
    // The non-destructive case: the file is probably fine, the share is not
    // mounted. Retry is clicking again once it is back.
    pathState.mockResolvedValue("offline");
    expect(await reopenRecent(store, withPath)).toBe("offline");
    expect(openFilePicker).not.toHaveBeenCalled();
    expect(store.importPaths).not.toHaveBeenCalled();
    expect(store.setStatus).toHaveBeenCalledWith(expect.stringContaining("not available"));
  });

  it("treats an unresolvable stored path as locatable", async () => {
    pathState.mockResolvedValue("invalid");
    expect(await reopenRecent(store, withPath)).toBe("located");
    expect(openFilePicker).toHaveBeenCalledTimes(1);
  });

  it("falls back to the picker when there is no bridge to ask", async () => {
    // A browser cannot check the path, so it must not guess the file is gone.
    pathState.mockResolvedValue("unknown");
    expect(await reopenRecent(store, withPath)).toBe("picker");
    expect(openFilePicker).toHaveBeenCalledTimes(1);
    expect(store.setStatus).not.toHaveBeenCalled();
  });

  it("re-opens the picker for a pathless (browser-uploaded) entry", async () => {
    expect(await reopenRecent(store, noPath)).toBe("picker");
    expect(openFilePicker).toHaveBeenCalledTimes(1);
    expect(pathState).not.toHaveBeenCalled(); // nothing to check
  });
});
