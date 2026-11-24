// Save workspace: StatusBar "k/N" count and Cancel while pending books load
// (RESULT_ACCEPTANCE_AUDIT part 4, rows 8-9). Cancel writes nothing; a late
// book fetch after Cancel never resurrects the save.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData } from "../lib/api";
import { resetBookTransportForTests } from "../lib/bookData";
import { saveBlob } from "../lib/download";
import type { Dataset, DataStruct } from "../lib/types";
import { usePendingOps } from "./pendingOps";
import { useApp } from "./useApp";

vi.mock("../lib/download", () => ({ saveBlob: vi.fn() }));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchBookData: vi.fn(),
}));

const full: DataStruct = { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["m"], units: ["emu"], metadata: {} };

function lazyBook(id: string): Dataset {
  return {
    id,
    name: `${id}.opj`,
    data: { time: [0, 2], values: [[1], [3]], labels: ["m"], units: ["emu"], metadata: { lazy_preview: true } },
    pending: { kind: "path", path: `/${id}.opj`, bookId: "Book1", rows: 3, cols: 1 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetBookTransportForTests();
  usePendingOps.setState({ ops: [] });
  useApp.setState({
    datasets: [lazyBook("b1"), lazyBook("b2")],
    activeId: "b1",
    plotWindows: [],
    focusedWindowId: null,
    currentProject: null,
    projectDirty: false,
  });
});

describe("Save workspace while books load", () => {
  it("shows k/N and Cancel; Cancel writes no file and the late fetch cannot revive the save", async () => {
    const release: Record<string, (d: DataStruct) => void> = {};
    vi.mocked(fetchBookData).mockImplementation(
      (source) => new Promise((resolve) => { release[source.path as string] = resolve; }),
    );

    const saving = useApp.getState().saveWorkspaceToFile();
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));
    expect(usePendingOps.getState().ops[0].label).toBe("Saving workspace: loading books 0/2");

    await vi.waitFor(() => expect(release["/b1.opj"]).toBeDefined());
    release["/b1.opj"](full);
    await vi.waitFor(() => expect(usePendingOps.getState().ops[0].label).toBe("Saving workspace: loading books 1/2"));

    usePendingOps.getState().ops[0].cancel?.();
    await saving;
    expect(useApp.getState().status).toBe("save cancelled — nothing was written");
    expect(usePendingOps.getState().ops).toHaveLength(0);

    release["/b2.opj"](full); // the late answer
    await vi.waitFor(() => expect(useApp.getState().datasets.find((d) => d.id === "b2")?.pending).toBeUndefined());
    await Promise.resolve();
    expect(saveBlob).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe("save cancelled — nothing was written");
  });

  it("a failed fetch after Cancel is not reported as a save failure", async () => {
    let rejectB2: (e: Error) => void = () => {};
    vi.mocked(fetchBookData).mockImplementation((source) =>
      source.path === "/b2.opj" ? new Promise((_, rej) => { rejectB2 = rej; }) : Promise.resolve(full),
    );
    const saving = useApp.getState().saveWorkspaceToFile();
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));
    usePendingOps.getState().ops[0].cancel?.();
    await saving;
    rejectB2(new Error("boom"));
    await new Promise((r) => setTimeout(r, 0));
    expect(useApp.getState().status).toBe("save cancelled — nothing was written");
    expect(saveBlob).not.toHaveBeenCalled();
  });
});
