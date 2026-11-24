// bootstrapFit runs through the job queue (POST /bootstrap/job): the replicate fraction is
// forwarded, Cancel stops the server run and rejects with an AbortError, and an answer
// that raced the Cancel is discarded (never returned).

import { afterEach, describe, expect, it, vi } from "vitest";

import { bootstrapFit } from "./curvefit";

const fake = (body: unknown): Response =>
  ({ ok: true, status: 200, statusText: "OK", headers: new Headers(), json: () => Promise.resolve(body) }) as unknown as Response;
const snap = (status: string, progress: number) => ({ id: "j1", status, progress, message: `replicate ${progress}` });
const REQ = { model: "Linear", x: [], y: [], p0: [] } as never;
const RESULT = { params: [1, 2], n_boot: 60 };

function serve(onStatus: (n: number) => unknown, onSubmit: () => void = () => {}) {
  const urls: string[] = [];
  let polls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      urls.push(`${init?.method ?? "GET"} ${u}`);
      if (u.endsWith("/bootstrap/job")) {
        onSubmit();
        return Promise.resolve(fake({ job_id: "j1" }));
      }
      if (u.endsWith("/result")) return Promise.resolve(fake({ id: "j1", status: "done", result: RESULT }));
      if (u.endsWith("/cancel")) return Promise.resolve(fake(snap("cancelled", 0)));
      return Promise.resolve(fake(onStatus(++polls)));
    }),
  );
  return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe("bootstrapFit (job queue)", () => {
  it("returns the result and forwards the polled fraction", async () => {
    const urls = serve((n) => (n === 1 ? snap("running", 0.1) : snap("done", 1)));
    const seen: [number, string][] = [];
    await expect(bootstrapFit(REQ, undefined, (f, m) => seen.push([f, m]))).resolves.toEqual(RESULT);
    expect(seen).toEqual([[0.1, "replicate 0.1"], [1, "replicate 1"]]);
    expect(urls[0]).toBe("POST /api/fitting/bootstrap/job");
  });

  it("Cancel posts the job cancel and rejects with an AbortError", async () => {
    const c = new AbortController();
    const urls = serve((n) => { if (n === 2) c.abort(); return snap(n > 2 ? "cancelled" : "running", 0.2); });
    await expect(bootstrapFit(REQ, c.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(urls).toContain("POST /api/jobs/j1/cancel");
  });

  it("an answer that lands after Cancel is discarded", async () => {
    const c = new AbortController();
    // Cancel pressed while the status request is in flight, which then says done.
    const urls = serve(() => { c.abort(); return snap("done", 1); });
    await expect(bootstrapFit(REQ, c.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(urls).toContain("POST /api/jobs/j1/cancel");
  });

  it("Cancel before the job id came back cancels that job when it does", async () => {
    const c = new AbortController();
    const urls = serve(() => snap("running", 0), () => c.abort());
    await expect(bootstrapFit(REQ, c.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(urls).toContain("POST /api/jobs/j1/cancel");
    expect(urls.some((u) => u === "GET /api/jobs/j1")).toBe(false); // never polled
  });
});
