import { afterEach, describe, expect, it, vi } from "vitest";

import { exportFigureAnimation } from "./figureAnimation";

afterEach(() => vi.unstubAllGlobals());

describe("exportFigureAnimation", () => {
  it("posts frames and options with the wire field names", async () => {
    const fetchMock = vi.fn(async () => new Response("x", { status: 500, statusText: "stop" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(exportFigureAnimation([], { format: "gif", frameMs: 250, loop: true, fixedAxes: false, filename: "talk" })).rejects.toThrow();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/export/figure-animation");
    expect(JSON.parse(String(init.body))).toEqual({ frames: [], format: "gif", frame_ms: 250, loop: true, fixed_axes: false, filename: "talk" });
  });

  it("surfaces the server's refusal reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "121 frames exceeds the limit of 120" }), { status: 422, statusText: "x", headers: { "Content-Type": "application/json" } })));
    await expect(exportFigureAnimation([], { format: "zip", frameMs: 100, loop: false, fixedAxes: true, filename: "" })).rejects.toThrow("exceeds the limit");
  });

  it("explains an oversize body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "too large" }), { status: 413, statusText: "x", headers: { "Content-Type": "application/json" } })));
    await expect(exportFigureAnimation([], { format: "gif", frameMs: 100, loop: true, fixedAxes: true, filename: "a" })).rejects.toThrow("fewer frames");
  });
});
