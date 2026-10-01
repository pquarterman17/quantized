// `previewSeparateWorksheets` loads the plan builder (lib/workbookSeparate.ts)
// on first use (bundle diet slice 16, plans/BUNDLE_HEADROOM.md). A builder
// that will not load is reported and opens no preview; nothing mutates, and
// the next Separate retries the load. Its own file because `vi.doMock` must
// be registered before the builder's first load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../lib/types";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const ds = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  workbookId: "w1",
});

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [ds("d1"), ds("d2")],
    workbooks: [{ id: "w1", name: "Source", folderId: undefined }],
    folders: [],
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    reports: [],
    pages: [],
    history: [],
    future: [],
    status: "",
    separatePreview: null,
  });
});

afterEach(() => {
  vi.doUnmock("../lib/workbookSeparate");
});

describe("previewSeparateWorksheets: the plan builder's chunk will not load", () => {
  it("reports it and opens no preview, mutating nothing", async () => {
    vi.doMock("../lib/workbookSeparate", () => {
      throw new Error("network error");
    });
    const before = useApp.getState();

    await useApp.getState().previewSeparateWorksheets(["d1"]);

    const s = useApp.getState();
    expect(s.separatePreview).toBeNull();
    expect(s.status).toMatch(/^Separate failed to load: .+/);
    expect(useToasts.getState().toasts).toEqual([expect.objectContaining({ msg: s.status, kind: "danger" })]);
    expect(s.datasets).toBe(before.datasets);
    expect(s.workbooks).toBe(before.workbooks);
    expect(s.history).toHaveLength(0);
  });

  it("retries the load on the next Separate instead of staying broken", async () => {
    vi.doMock("../lib/workbookSeparate", () => {
      throw new Error("network error");
    });
    await useApp.getState().previewSeparateWorksheets(["d1"]);
    expect(useApp.getState().separatePreview).toBeNull();

    // A rejected dynamic import is not cached, so the next call refetches.
    vi.doUnmock("../lib/workbookSeparate");
    vi.resetModules();
    await useApp.getState().previewSeparateWorksheets(["d1"]);
    expect(useApp.getState().separatePreview?.movingDatasetIds).toEqual(["d1"]);
  });
});
