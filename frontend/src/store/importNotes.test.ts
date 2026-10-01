// A parser that drops or truncates rows says so in `metadata.notes` (one
// sentence per kind of problem) and `metadata.dropped_rows` — see
// src/quantized/io/_row_width.py. Those notes must reach the user: ONE toast
// per import batch summarising them, the full text in the dataset's Metadata.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { importFile, uploadFile } from "../lib/api";
import { probeSource } from "../lib/desktopBridge";
import { metadataRows } from "../lib/metadata";
import { useImportBatch } from "./importBatch";
import { importCore } from "./importDatasetsLazy";
import { usePendingOps } from "./pendingOps";
import { TOAST_ACTION_TTL, useToasts } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  importFile: vi.fn(),
  uploadFile: vi.fn(),
}));
vi.mock("../lib/desktopBridge", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  probeSource: vi.fn(),
}));

const DROPPED = "2 row(s) with fewer than 3 values were dropped.";
const WIDE = "1 row(s) had more values than the 3 columns; the extra values were ignored.";
const payload = (metadata: Record<string, unknown>) => ({
  time: [0, 1], values: [[1], [2]], labels: ["I"], units: [""], metadata,
});
const toastMsgs = () => useToasts.getState().toasts.map((t) => t.msg);

beforeAll(async () => {
  await importCore();
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [], folders: [], activeId: null, selectedIds: [] });
  useImportBatch.setState({ running: false });
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
  vi.mocked(probeSource).mockResolvedValue(null);
});

describe("parser notes after an import", () => {
  it("an upload whose payload carries notes shows one summarising toast", async () => {
    vi.mocked(uploadFile).mockResolvedValue(payload({ dropped_rows: 2, notes: [DROPPED, WIDE] }));
    await useApp.getState().importFiles([new File(["x"], "scan.refl")]);

    const noted = toastMsgs().filter((m) => m.includes(DROPPED));
    expect(noted).toEqual([`scan.refl: ${DROPPED} (+1 more in Metadata)`]);
    const t = useToasts.getState().toasts.find((x) => x.msg.includes(DROPPED));
    expect(t?.kind).toBe("info");
    // Lingers long enough to read (the notifyMigrationWarnings lifetime).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      useToasts.setState({ toasts: [] });
      vi.mocked(uploadFile).mockResolvedValue(payload({ notes: [DROPPED] }));
      await useApp.getState().importFiles([new File(["x"], "b.dat")]);
      expect(toastMsgs()).toContain(`b.dat: ${DROPPED}`);
      vi.advanceTimersByTime(TOAST_ACTION_TTL - 100);
      expect(toastMsgs()).toContain(`b.dat: ${DROPPED}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a batch of noted files still fires exactly one notes toast", async () => {
    vi.mocked(uploadFile)
      .mockResolvedValueOnce(payload({ notes: [DROPPED] }))
      .mockResolvedValueOnce(payload({}))
      .mockResolvedValueOnce(payload({ notes: [WIDE] }));
    await useApp
      .getState()
      .importFiles([new File(["x"], "a.dat"), new File(["x"], "b.dat"), new File(["x"], "c.dat")]);
    const noted = toastMsgs().filter((m) => m.includes("Metadata") || m.includes(DROPPED) || m.includes(WIDE));
    expect(noted).toEqual([`a.dat: ${DROPPED} (+1 more in Metadata)`]);
  });

  it("the path import (native dialog) reports notes the same way", async () => {
    vi.mocked(importFile).mockResolvedValue(payload({ notes: [DROPPED] }));
    await useApp.getState().importPaths(["/data/run/scan.datA"]);
    expect(toastMsgs()).toContain(`scan.datA: ${DROPPED}`);
  });

  it("an append import (several files into one dataset) reports notes too", async () => {
    vi.mocked(uploadFile)
      .mockResolvedValueOnce(payload({ notes: [DROPPED] }))
      .mockResolvedValueOnce(payload({}));
    await useApp.getState().importFilesAppended([new File(["x"], "a.dat"), new File(["x"], "b.dat")]);
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(toastMsgs()).toContain(`a.dat: ${DROPPED}`);
  });

  it("a clean import fires no notes toast", async () => {
    vi.mocked(uploadFile).mockResolvedValue(payload({ sample: "Si" }));
    await useApp.getState().importFiles([new File(["x"], "clean.dat")]);
    expect(toastMsgs().filter((m) => m.startsWith("clean.dat:"))).toEqual([]);
  });

  it("the dataset's Metadata shows the notes as readable sentences", async () => {
    vi.mocked(uploadFile).mockResolvedValue(payload({ dropped_rows: 2, notes: [DROPPED, WIDE] }));
    await useApp.getState().importFiles([new File(["x"], "scan.refl")]);
    const ds = useApp.getState().datasets[0];
    const rows = Object.fromEntries(metadataRows(ds.data.metadata as Record<string, unknown>));
    expect(rows.notes).toBe(`${DROPPED} ${WIDE}`);
    expect(rows.dropped_rows).toBe("2");
  });
});
