// "Import & append as one dataset" Cancel + determinate progress (OPEN_ITEMS
// row 15). The race is forced: the second upload is held on a deferred that
// only settles when the signal aborts (as a real fetch does), Cancel is pressed
// from the pending-op entry, and state is awaited, never a mock call.

import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./fileCommands";
import { uploadFile } from "../lib/api";
import { openFilePicker } from "../lib/openFilePicker";
import type { DataStruct } from "../lib/types";
import { useImportBatch } from "../store/importBatch";
import { usePendingOps } from "../store/pendingOps";
import { useApp } from "../store/useApp";

vi.mock("../lib/openFilePicker", async (orig) => ({
  ...(await orig<typeof import("../lib/openFilePicker")>()),
  openFilePicker: vi.fn(),
}));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), uploadFile: vi.fn() }));

const ds = (t: number[]): DataStruct => ({ time: t, values: t.map((v) => [v]), labels: ["m"], units: ["emu"], metadata: {} });

beforeEach(() => {
  vi.mocked(uploadFile).mockReset();
  vi.mocked(openFilePicker).mockReset();
  usePendingOps.setState({ ops: [] });
  useImportBatch.setState({ running: false });
  useApp.setState({ datasets: [], activeId: null, selectedIds: [], history: [], future: [], status: "idle" });
});

describe("Import & append: Cancel and progress", () => {
  it("Cancel mid-upload imports nothing, does not degrade to separate imports, and shows i/N", async () => {
    const importFiles = vi.fn(async () => []);
    useApp.setState({ importFiles: importFiles as never });
    vi.mocked(uploadFile).mockImplementation(
      (f: File, signal?: AbortSignal) =>
        f.name === "a.dat"
          ? Promise.resolve(ds([1]))
          : new Promise<DataStruct>((_, reject) => {
              signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            }),
    );
    buildFileCommands(useApp.getState).find((c) => c.id === "import-append")!.run();
    const files = ["a.dat", "b.dat", "c.dat"].map((n) => new File(["x"], n));
    vi.mocked(openFilePicker).mock.calls.at(-1)![0](files);

    // Determinate progress: the second of three is in flight, with its name.
    await waitFor(() => expect(usePendingOps.getState().ops[0]?.label).toBe("Importing 2/3 to append: b.dat…"));
    const cancel = usePendingOps.getState().ops[0]!.cancel;
    expect(cancel).toBeTypeOf("function");
    cancel!();

    await waitFor(() => expect(usePendingOps.getState().ops).toEqual([]));
    expect(useImportBatch.getState().running).toBe(false);
    // No partial scientific state: nothing landed, and no fallback import ran.
    expect(useApp.getState().datasets).toEqual([]);
    expect(importFiles).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe("append cancelled — nothing was imported");
  });
});
