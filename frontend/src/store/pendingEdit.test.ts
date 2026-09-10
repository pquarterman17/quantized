// BUG-009's honesty half: a book that will NEVER arrive must not be reported
// like one arriving in a moment.
//
// `lib/bookData.ts`'s `installBookData` leaves `pending` set when a fetch fails,
// so a later call retries — right in itself, but it made a moved source or an
// expired upload token indistinguishable from a fetch in flight, and every
// guarded action then promised "try again in a moment" forever.
// `Dataset.pendingError` records why, and the guard says so.
//
// The recorded error is ADVISORY: it changes the message, never what is allowed.
// These tests pin that too — the retry is still kicked, and success clears it.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData } from "../lib/api";
import { installBookData } from "../lib/bookData";
import type { Dataset } from "../lib/types";
import { refusePendingEdit } from "./pendingEdit";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  fetchBookData: vi.fn(),
}));

function pendingDataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "book.opj",
    data: {
      time: [0, 1],
      values: [[10], [20]],
      labels: ["Signal"],
      units: [""],
      metadata: {},
    },
    pending: { kind: "path", path: "/moved.opj", bookId: "b1", rows: 4000, cols: 1, previewSampled: true },
    ...over,
  };
}

const ds = () => useApp.getState().datasets[0];

beforeEach(() => {
  vi.clearAllMocks();
  // A default so the guard's own fire-and-forget `ensureBookData` has something
  // to await; the per-test `*Once` mocks below take precedence over it.
  vi.mocked(fetchBookData).mockResolvedValue({
    time: [0, 1],
    values: [[10], [20]],
    labels: ["Signal"],
    units: [""],
    metadata: {},
  });
  useApp.setState({ datasets: [pendingDataset()], activeId: "d1", status: "" });
});

describe("refusePendingEdit — what the user is told", () => {
  it("promises a retry while the fetch may still be in flight", () => {
    expect(refusePendingEdit(useApp.getState, ds(), "excluding rows")).toBe(true);
    expect(useApp.getState().status).toMatch(/still loading its full data/);
    expect(useApp.getState().status).toMatch(/in a moment/);
  });

  it("names the failure and stops promising 'in a moment' once one is recorded", () => {
    useApp.setState({ datasets: [pendingDataset({ pendingError: "source not found" })] });

    expect(refusePendingEdit(useApp.getState, ds(), "excluding rows")).toBe(true);

    const status = useApp.getState().status;
    expect(status).toMatch(/could not load its full data/);
    expect(status).toContain("source not found");
    expect(status).toMatch(/relink or re-import/);
    // The lie this fixes: a book that will never arrive used to get this.
    expect(status).not.toMatch(/in a moment/);
  });

  it("still REFUSES, and still kicks a retry — the error is advisory, not a lockout", () => {
    const spy = vi.fn();
    useApp.setState({ datasets: [pendingDataset({ pendingError: "network error" })] });

    const refused = refusePendingEdit(
      () => ({ ...useApp.getState(), ensureBookData: spy }),
      ds(),
      "filtering",
    );

    expect(refused).toBe(true);
    expect(spy).toHaveBeenCalledWith("d1");
  });

  it("does not fire at all for a dataset that is not pending", () => {
    useApp.setState({ datasets: [pendingDataset({ pending: undefined, pendingError: "stale" })] });
    expect(refusePendingEdit(useApp.getState, ds(), "excluding rows")).toBe(false);
    expect(useApp.getState().status).toBe("");
  });
});

describe("installBookData records and clears the failure", () => {
  const setter = (fn: (s: { datasets: Dataset[] }) => { datasets: Dataset[] }) =>
    useApp.setState((s) => fn({ datasets: s.datasets }));

  it("records WHY a failed fetch failed, and leaves `pending` set so a retry is possible", async () => {
    vi.mocked(fetchBookData).mockRejectedValueOnce(new Error("source not found"));

    await expect(installBookData(setter, "d1", ds().pending!)).rejects.toThrow("source not found");

    expect(ds().pendingError).toBe("source not found");
    expect(ds().pending).toBeDefined();
  });

  it("re-throws unchanged, so every existing caller's error handling is untouched", async () => {
    const boom = new Error("expired upload token");
    vi.mocked(fetchBookData).mockRejectedValueOnce(boom);

    await expect(installBookData(setter, "d1", ds().pending!)).rejects.toBe(boom);
  });

  it("CLEARS the recorded failure when a later fetch succeeds", async () => {
    useApp.setState({ datasets: [pendingDataset({ pendingError: "network error" })] });
    vi.mocked(fetchBookData).mockResolvedValueOnce({
      time: [0, 1, 2],
      values: [[1], [2], [3]],
      labels: ["Signal"],
      units: [""],
      metadata: {},
    });

    await installBookData(setter, "d1", ds().pending!);

    expect(ds().pendingError).toBeUndefined();
    expect(ds().pending).toBeUndefined();
    expect(ds().data.time).toHaveLength(3);
  });

  it("a non-Error rejection still yields a readable reason", async () => {
    vi.mocked(fetchBookData).mockRejectedValueOnce("plain string failure");
    await expect(installBookData(setter, "d1", ds().pending!)).rejects.toBeTruthy();
    expect(ds().pendingError).toBe("plain string failure");
  });
});
