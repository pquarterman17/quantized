// Cancel DURING the unit/name review (after every upload resolved): nothing
// may land. The review is the only await between the last abort check and the
// store write, so the abort has to be re-checked after it (OPEN_ITEMS row 15).

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../lib/types";
import { runImportFilesAppended } from "./importAppendRun";
import { useApp } from "./useApp";

let releaseReview!: (v: DataStruct | null) => void;
vi.mock("../lib/transformRun", async (orig) => ({
  ...(await orig<typeof import("../lib/transformRun")>()),
  reviewedAppend: vi.fn(() => new Promise<DataStruct | null>((r) => { releaseReview = r; })),
}));

const ds = (t: number[]): DataStruct => ({ time: t, values: t.map((v) => [v]), labels: ["m"], units: ["emu"], metadata: {} });

beforeEach(() => {
  releaseReview = undefined as never;
  useApp.setState({ datasets: [], activeId: null, selectedIds: [], history: [], future: [], macroSteps: [], status: "idle" });
});

describe("runImportFilesAppended: Cancel while the review dialog is open", () => {
  it.each([
    ["accepted", () => ds([1, 2])],
    ["declined", () => null],
  ])("lands nothing and imports nothing separately when the review resolves %s after Cancel", async (_n, result) => {
    const importFiles = vi.fn(async () => []);
    useApp.setState({ importFiles: importFiles as never });
    const ctl = new AbortController();
    const run = runImportFilesAppended(
      useApp.getState,
      [new File(["x"], "a.dat"), new File(["y"], "b.dat")],
      (async () => ds([1])) as never,
      { signal: ctl.signal },
    );
    await vi.waitFor(() => expect(releaseReview).toBeTypeOf("function"));
    ctl.abort();
    releaseReview(result());
    await run;
    expect(useApp.getState().datasets).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
    expect(useApp.getState().macroSteps).toEqual([]);
    expect(importFiles).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe("append cancelled — nothing was imported");
  });
});
