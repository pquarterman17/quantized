import { afterEach, describe, expect, it, vi } from "vitest";

import { isJobSubmit, JobCancelledError, pollJob } from "./jobs";
import type { JobSnapshot } from "./jobs";

const fake = (body: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: () => Promise.resolve(body),
  }) as unknown as Response;

const snap = (status: JobSnapshot["status"], progress: number, error?: string): JobSnapshot => ({
  id: "j1",
  status,
  progress,
  message: "",
  ...(error ? { error } : {}),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isJobSubmit", () => {
  it("narrows a queued-job response", () => {
    expect(isJobSubmit({ job_id: "abc" })).toBe(true);
    expect(isJobSubmit({ popt: [1, 2] })).toBe(false);
    expect(isJobSubmit(null)).toBe(false);
    expect(isJobSubmit("job_id")).toBe(false);
  });
});

describe("pollJob", () => {
  it("polls to done, reports progress, and fetches the result", async () => {
    const statuses = [snap("running", 0.25), snap("running", 0.75), snap("done", 1)];
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      if (String(url).endsWith("/result")) {
        return Promise.resolve(fake({ id: "j1", status: "done", result: { popt: [3] } }));
      }
      return Promise.resolve(fake(statuses.shift()));
    });
    vi.stubGlobal("fetch", fetchMock);

    const fractions: number[] = [];
    const result = await pollJob<{ popt: number[] }>("j1", (f) => fractions.push(f), 0);
    expect(result).toEqual({ popt: [3] });
    expect(fractions).toEqual([0.25, 0.75, 1]);
  });

  it("throws the job error on status=error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fake(snap("error", 0.4, "boom")))),
    );
    await expect(pollJob("j1", undefined, 0)).rejects.toThrow("boom");
  });

  it("throws JobCancelledError on status=cancelled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fake(snap("cancelled", 0.4)))),
    );
    await expect(pollJob("j1", undefined, 0)).rejects.toBeInstanceOf(JobCancelledError);
  });

  it("surfaces an HTTP error detail from the status endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fake({ detail: "unknown job id: j1" }, false, 404))),
    );
    await expect(pollJob("j1", undefined, 0)).rejects.toThrow("unknown job id: j1");
  });
});
