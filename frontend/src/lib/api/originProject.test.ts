// /api/export/opj client: the native Origin project download. It must hit the
// .opj route (not the .ogs-script /origin-project zip), name the fallback
// file after the requested stem, and forward the caller's cancel signal.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { postDownload } from "./http";
import { exportOriginProject } from "./originProject";

vi.mock("./http", () => ({
  postDownload: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => vi.clearAllMocks());

const ds = { time: [0, 1], values: [[1], [2]], labels: ["M"], units: ["emu"], metadata: {} };

describe("exportOriginProject", () => {
  it("posts to /api/export/opj with a .opj fallback name and the signal", async () => {
    const signal = new AbortController().signal;
    const body = { datasets: [{ dataset: ds, name: "LoopA" }], filename: "session" };
    await exportOriginProject(body, signal);
    expect(postDownload).toHaveBeenCalledWith("/api/export/opj", body, "session.opj", signal);
  });

  it("falls back to the route's own default stem", async () => {
    const body = { datasets: [{ dataset: ds, name: "LoopA" }] };
    await exportOriginProject(body);
    expect(postDownload).toHaveBeenCalledWith("/api/export/opj", body, "project.opj", undefined);
  });
});
