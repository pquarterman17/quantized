import { describe, expect, it } from "vitest";

import { formatTrashBytes, purgePreviewLine, trashAge, trashSummary } from "./trashSummary";
import type { TrashEntry } from "../store/trash";

const entry = (kind: TrashEntry["kind"], at: number, bytes: number): TrashEntry => {
  switch (kind) {
    case "dataset":
      return { kind, at, bytes, dataset: { id: "d", name: "d.dat", data: { time: [], values: [], labels: [], units: [], metadata: {} } } };
    case "report":
      return { kind, at, bytes, report: { id: "r", name: "R", datasetId: null, report: { title: "T", sections: [] } } };
    default:
      throw new Error(`unused kind in this test: ${kind}`);
  }
};

describe("trashSummary", () => {
  it("is all-zero/null for an empty trash", () => {
    expect(trashSummary([], 1000)).toEqual({
      count: 0, bytes: 0,
      byKind: { dataset: 0, editableFigure: 0, figureDoc: 0, page: 0, report: 0, folder: 0 },
      oldestAt: null, oldestAgeMs: null,
    });
  });

  it("rolls up count, total bytes, per-kind counts, and oldest/newest", () => {
    const entries = [entry("dataset", 100, 10), entry("dataset", 200, 20), entry("report", 50, 5)];
    const s = trashSummary(entries, 1000);
    expect(s.count).toBe(3);
    expect(s.bytes).toBe(35);
    expect(s.byKind.dataset).toBe(2);
    expect(s.byKind.report).toBe(1);
    expect(s.oldestAt).toBe(50);
    expect(s.oldestAgeMs).toBe(950);
  });
});

describe("formatTrashBytes", () => {
  it("formats bytes, KiB, and MiB", () => {
    expect(formatTrashBytes(500)).toBe("500 B");
    expect(formatTrashBytes(2048)).toBe("2.0 KiB");
    expect(formatTrashBytes(5 * 1024 * 1024)).toBe("5.0 MiB");
  });
});

describe("trashAge", () => {
  it("buckets coarsely, like the Recent menu", () => {
    const now = 100 * 86_400_000;
    expect(trashAge(now, now)).toBe("just now");
    expect(trashAge(now - 5 * 3_600_000, now)).toBe("5h ago");
    expect(trashAge(now - 86_400_000, now)).toBe("yesterday");
    expect(trashAge(now - 3 * 86_400_000, now)).toBe("3d ago");
  });
});

describe("purgePreviewLine", () => {
  it("names every kind present, total size, and the oldest entry's age", () => {
    const now = 10 * 86_400_000;
    const entries = [entry("dataset", now - 3 * 86_400_000, 100), entry("dataset", now, 50), entry("report", now, 10)];
    const line = purgePreviewLine(trashSummary(entries, now), now);
    expect(line).toBe("2 datasets, 1 report — 160 B — oldest 3d ago");
  });

  it("singularizes a lone entry", () => {
    const now = 1000;
    const line = purgePreviewLine(trashSummary([entry("report", now, 10)], now), now);
    expect(line).toBe("1 report — 10 B — oldest just now");
  });
});
