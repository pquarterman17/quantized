// `importFilesAppended`'s body loads on first use (bundle diet slice 16,
// plans/BUNDLE_HEADROOM.md): store/importAppend.ts keeps the slice and its
// cheap checks eager, and store/importAppendRun.ts holds the upload/merge
// body. A body that will not load keeps the action's own contract: it never
// produces a dead import, so the files land separately with a danger toast.
// Its own file because `vi.doMock` must be registered before the first load
// of the body (store/importAppend.characterization.test.ts loads it).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadFile } from "../lib/api";
import type { DataStruct } from "../lib/types";
import { useToasts } from "./toasts";
import type { AppState } from "./useApp";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), uploadFile: vi.fn() }));

const file = (name: string) => new File(["xyz"], name);
const ds = (t: number[]): DataStruct => ({ time: t, values: t.map((v) => [v]), labels: ["m"], units: ["emu"], metadata: {} });

let importFiles: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(uploadFile).mockClear();
  vi.mocked(uploadFile).mockImplementation(async (f: File) => ds(f.name === "a.dat" ? [1] : [2]));
  useToasts.setState({ toasts: [] });
  importFiles = vi.fn(async () => {});
  useApp.setState({
    datasets: [],
    history: [],
    future: [],
    status: "idle",
    importFiles: importFiles as unknown as AppState["importFiles"],
  });
});

afterEach(() => {
  vi.doUnmock("./importAppendRun");
});

describe("importFilesAppended: the body's chunk will not load", () => {
  it("imports the files separately with a danger toast, uploading nothing itself", async () => {
    vi.doMock("./importAppendRun", () => {
      throw new Error("network error");
    });
    const files = [file("a.dat"), file("b.dat")];

    await useApp.getState().importFilesAppended(files);

    expect(importFiles).toHaveBeenCalledTimes(1);
    expect(importFiles).toHaveBeenCalledWith(files, { bypassGuard: true });
    // vitest wraps a throwing mock factory's message, so pin the shape only.
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({
        msg: expect.stringMatching(/^append import failed to load: .+ — importing separately instead$/),
        kind: "danger",
      }),
    ]);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toEqual([]);
  });

  it("retries the load on the next append instead of staying broken", async () => {
    vi.doMock("./importAppendRun", () => {
      throw new Error("network error");
    });
    await useApp.getState().importFilesAppended([file("a.dat"), file("b.dat")]);
    expect(importFiles).toHaveBeenCalledTimes(1);

    // A rejected dynamic import is not cached, so the next call refetches.
    vi.doUnmock("./importAppendRun");
    vi.resetModules();
    await useApp.getState().importFilesAppended([file("a.dat"), file("b.dat")]);

    expect(importFiles).toHaveBeenCalledTimes(1);
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().datasets[0].data.time).toEqual([1, 2]);
  });
});
