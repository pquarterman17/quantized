import { describe, expect, it, vi } from "vitest";

import type { DataStruct } from "./types";

const FAKE_SAMPLE: DataStruct = {
  time: [0, 1, 2],
  values: [[0.1], [0.2], [0.3]],
  labels: ["Moment"],
  units: ["emu"],
  metadata: { x_column_name: "Field", x_column_unit: "Oe", source: "demo" },
};

const fetchDemoSample = vi.fn();
vi.mock("./api", () => ({
  fetchDemoSample: (...args: unknown[]) => fetchDemoSample(...args),
}));

describe("loadSampleDataset", () => {
  it("returns the real bundled sample when the backend endpoint succeeds", async () => {
    fetchDemoSample.mockResolvedValueOnce(FAKE_SAMPLE);
    const { loadSampleDataset } = await import("./sampleDataset");
    const result = await loadSampleDataset();
    expect(result.offline).toBe(false);
    expect(result.name).toBe("demo_vsm.csv");
    expect(result.data).toBe(FAKE_SAMPLE);
  });

  it("falls back to the client-side synthetic demo when the endpoint fails", async () => {
    fetchDemoSample.mockRejectedValueOnce(new Error("offline"));
    const { loadSampleDataset } = await import("./sampleDataset");
    const result = await loadSampleDataset();
    expect(result.offline).toBe(true);
    expect(result.data.labels).toEqual(["Moment"]); // makeDemoDataset() shape
    expect(result.data.metadata.source).toBe("demo");
  });
});
