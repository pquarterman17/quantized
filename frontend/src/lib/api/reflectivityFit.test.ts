// reflFit runs through the job queue (POST /fit/job): iteration progress is
// forwarded, Cancel stops the server's solve and rejects with an AbortError,
// and an answer that raced the Cancel is discarded (never returned).

import { afterEach, describe, expect, it, vi } from "vitest";

import { reflFit, type ReflFitRequest } from "./reflectivity";

const fake = (body: unknown): Response =>
  ({ ok: true, status: 200, statusText: "OK", headers: new Headers(), json: () => Promise.resolve(body) }) as unknown as Response;
const snap = (status: string, progress: number) => ({ id: "j1", status, progress, message: `iteration ${progress}` });
const REQ = { parameters: [], channels: [] } as unknown as ReflFitRequest;
const RESULT = { success: true, n_evaluations: 9 };

function serve(onStatus: (n: number) => unknown, onSubmit: () => void = () => {}) {
  const urls: string[] = [];
  let polls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      urls.push(`${init?.method ?? "GET"} ${u}`);
      if (u.endsWith("/fit/job")) {
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

describe("reflFit (job queue)", () => {
  it("returns the result and forwards the polled fraction", async () => {
    const urls = serve((n) => (n === 1 ? snap("running", 0.1) : snap("done", 1)));
    const seen: [number, string][] = [];
    await expect(reflFit(REQ, undefined, (f, m) => seen.push([f, m]))).resolves.toEqual(RESULT);
    expect(seen).toEqual([[0.1, "iteration 0.1"], [1, "iteration 1"]]);
    expect(urls[0]).toBe("POST /api/reflectivity/fit/job");
  });

  it("tells the caller the job is still pending (queued), not a fraction", async () => {
    serve((n) => (n === 1 ? { ...snap("pending", 0), message: "" } : snap("done", 1)));
    const statuses: (string | undefined)[] = [];
    await reflFit(REQ, undefined, (_f, _m, st) => statuses.push(st));
    expect(statuses).toEqual(["pending", "done"]);
  });

  it("Cancel posts the job cancel and rejects with an AbortError", async () => {
    const c = new AbortController();
    const urls = serve((n) => { if (n === 2) c.abort(); return snap(n > 2 ? "cancelled" : "running", 0.2); });
    await expect(reflFit(REQ, c.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(urls).toContain("POST /api/jobs/j1/cancel");
  });

  it("an answer that lands after Cancel is discarded", async () => {
    const c = new AbortController();
    // Cancel pressed while the status request is in flight, which then says done.
    const urls = serve(() => { c.abort(); return snap("done", 1); });
    await expect(reflFit(REQ, c.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(urls).toContain("POST /api/jobs/j1/cancel");
  });

  it("Cancel before the job id came back cancels that job when it does", async () => {
    const c = new AbortController();
    const urls = serve(() => snap("running", 0), () => c.abort());
    await expect(reflFit(REQ, c.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(urls).toContain("POST /api/jobs/j1/cancel");
    expect(urls.some((u) => u === "GET /api/jobs/j1")).toBe(false); // never polled
  });
});
