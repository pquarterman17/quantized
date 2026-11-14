// /api/export/opj client: the native Origin project download. It must hit the
// .opj route (not the .ogs-script /origin-project zip), name the fallback
// file after the requested stem, forward the caller's cancel signal, and read
// the writer's matrix-fallback count off the response.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { postDownloadHeaders } from "./http";
import { exportOriginProject } from "./originProject";

vi.mock("./http", () => ({
  postDownloadHeaders: vi.fn().mockResolvedValue(new Headers()),
}));

beforeEach(() => vi.clearAllMocks());

const ds = { time: [0, 1], values: [[1], [2]], labels: ["M"], units: ["emu"], metadata: {} };

describe("exportOriginProject", () => {
  it("posts to /api/export/opj with a .opj fallback name and the signal", async () => {
    const signal = new AbortController().signal;
    const body = { datasets: [{ dataset: ds, name: "LoopA" }], filename: "session" };
    await exportOriginProject(body, signal);
    expect(postDownloadHeaders).toHaveBeenCalledWith("/api/export/opj", body, "session.opj", signal);
  });

  it("falls back to the route's own default stem", async () => {
    const body = { datasets: [{ dataset: ds, name: "LoopA" }] };
    await exportOriginProject(body);
    expect(postDownloadHeaders).toHaveBeenCalledWith("/api/export/opj", body, "project.opj", undefined);
  });

  it("returns how many matrix books went out as worksheet columns", async () => {
    const body = { datasets: [{ dataset: ds }] };
    vi.mocked(postDownloadHeaders).mockResolvedValueOnce(new Headers({ "X-Opj-Matrix-Fallback": "2" }));
    expect(await exportOriginProject(body)).toEqual({ matrixFallbacks: 2 });
    expect(await exportOriginProject(body)).toEqual({ matrixFallbacks: 0 }); // no header
    vi.mocked(postDownloadHeaders).mockResolvedValueOnce(new Headers({ "X-Opj-Matrix-Fallback": "x" }));
    expect(await exportOriginProject(body)).toEqual({ matrixFallbacks: 0 });
  });
});
