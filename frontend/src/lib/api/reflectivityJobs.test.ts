// lib/api/reflectivity's job client RESTATES lib/jobs (see its header for why:
// importing lib/jobs from the reflectivity chunk costs eager bytes). This is
// the parity test that keeps the two from drifting: every job history below
// is run through BOTH, and they must settle identically — same result, same
// progress reports, same error text, same cancellation, same endpoints.

import { afterEach, describe, expect, it, vi } from "vitest";

import { cancelJob, JobCancelledError, pollJob } from "../jobs";
import { cancelReflJob, pollReflJob, ReflJobCancelled } from "./reflectivity";

const fake = (body: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    headers: new Headers(),
    json: () => Promise.resolve(body),
  }) as unknown as Response;

type Snap = { id: string; status: string; progress: number; message: string; error?: string };
const snap = (status: string, progress: number, extra: Partial<Snap> = {}): Snap => ({ id: "j1", status, progress, message: `m${progress}`, ...extra });

/** Serve `history` (then the result) to one poll loop; record the URLs hit. */
function serve(history: (Snap | Response)[], result: unknown = { value: 42 }) {
  const queue = [...history];
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      urls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).endsWith("/result")) return Promise.resolve(fake({ id: "j1", status: "done", result }));
      if (String(url).endsWith("/cancel")) return Promise.resolve(fake(snap("cancelled", 0)));
      const next = queue.shift();
      return Promise.resolve(next instanceof Object && "json" in next ? next : fake(next));
    }),
  );
  return urls;
}

type Outcome = { value?: unknown; error?: string; cancelled?: boolean; progress: [number, string][]; urls: string[] };

async function settle(poll: typeof pollJob, history: (Snap | Response)[]): Promise<Outcome> {
  const urls = serve(history);
  const progress: [number, string][] = [];
  try {
    const value = await poll("j1", (f, m) => progress.push([f, m]), 0);
    return { value, progress, urls };
  } catch (e) {
    const cancelled = e instanceof JobCancelledError || e instanceof ReflJobCancelled;
    return { error: cancelled ? undefined : (e as Error).message, cancelled, progress, urls };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pollReflJob restates lib/jobs pollJob exactly", () => {
  const histories: [string, (Snap | Response)[]][] = [
    ["done after progress", [snap("pending", 0), snap("running", 0.4), snap("done", 1)]],
    ["a job error with its text", [snap("running", 0.2), snap("error", 0.2, { error: "boom: bad model" })]],
    ["an error with no text", [snap("error", 0)]],
    ["cancelled", [snap("running", 0.5), snap("cancelled", 0.5)]],
    ["a failing status request", [snap("running", 0.1), fake({ detail: "unknown job id: j1" }, false, 404)]],
  ];
  for (const [name, history] of histories) {
    it(name, async () => {
      const oracle = await settle(pollJob, history);
      const restated = await settle(pollReflJob, history);
      expect(restated).toEqual(oracle);
    });
  }

  it("cancels through the same endpoint", async () => {
    const a = serve([]);
    await cancelJob("j1");
    const b = serve([]);
    await cancelReflJob("j1");
    expect(b).toEqual(a);
    expect(a).toEqual(["POST /api/jobs/j1/cancel"]);
  });
});
