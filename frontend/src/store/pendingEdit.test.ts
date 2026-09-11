// BUG-009's honesty half: a book that will NEVER arrive must not be reported
// like one arriving in a moment.
//
// `lib/bookData.ts`'s `installBookData` leaves `pending` set when a fetch fails,
// so a later call retries — right in itself, but it made a moved source or an
// expired upload token indistinguishable from a fetch in flight, and every
// guarded action then promised "try again in a moment" forever.
// `lib/bookData.lastBookError` records why, and the guard says so.
//
// The recorded reason is ADVISORY: it changes the message, never what is
// allowed. These tests pin that too — the retry is still kicked, and success
// clears it.
//
// The reason lives in `lib/bookData.ts`'s MODULE scope, not on `Dataset`, and
// the last describe block here is why. The first version of this fix recorded it
// onto the dataset, which gave `datasets` a new identity on every failure —
// re-running the `ensureBookData` effects keyed on it (an unbounded request
// storm) and tripping `useWorkspaceAutosave`'s identity-compared dirty check.
// A failed fetch must write NO store state at all.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData } from "../lib/api";
import { _resetBookTransportForTests, installBookData, lastBookError } from "../lib/bookData";
import type { BookSource, Dataset } from "../lib/types";
import { type AutosaveState, shouldAutosave } from "../useWorkspaceAutosave";
import { refusePendingEdit } from "./pendingEdit";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  fetchBookData: vi.fn(),
}));

const SOURCE: BookSource = { kind: "path", path: "/moved.opj", bookId: "b1", rows: 4000, cols: 1, previewSampled: true };
const OTHER_SOURCE: BookSource = { ...SOURCE, path: "/elsewhere.opj", bookId: "b2" };

const FULL = { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["Signal"], units: [""], metadata: {} };

function pendingDataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "book.opj",
    data: { time: [0, 1], values: [[10], [20]], labels: ["Signal"], units: [""], metadata: {} },
    pending: SOURCE,
    ...over,
  };
}

const ds = () => useApp.getState().datasets[0];
const setter = (fn: (s: { datasets: Dataset[] }) => { datasets: Dataset[] }) =>
  useApp.setState((s) => fn({ datasets: s.datasets }));

/** Drive one real failure through `installBookData`, as the app does. */
async function failOnce(reason: unknown, source: BookSource = SOURCE): Promise<void> {
  vi.mocked(fetchBookData).mockRejectedValueOnce(reason);
  await expect(installBookData(setter, "d1", source)).rejects.toBeTruthy();
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetBookTransportForTests();
  // A default so the guard's own fire-and-forget `ensureBookData` has something
  // to await; the per-test `*Once` mocks take precedence over it.
  vi.mocked(fetchBookData).mockResolvedValue(FULL);
  useApp.setState({ datasets: [pendingDataset()], activeId: "d1", status: "" });
});

describe("refusePendingEdit — what the user is told", () => {
  it("promises a retry while the fetch may still be in flight", () => {
    expect(refusePendingEdit(useApp.getState, ds(), "excluding rows")).toBe(true);
    expect(useApp.getState().status).toMatch(/still loading its full data/);
    expect(useApp.getState().status).toMatch(/in a moment/);
  });

  it("names the failure and stops promising 'in a moment' once one is recorded", async () => {
    await failOnce(new Error("source not found"));

    expect(refusePendingEdit(useApp.getState, ds(), "excluding rows")).toBe(true);

    const status = useApp.getState().status;
    expect(status).toMatch(/the last attempt to load its full data failed/);
    expect(status).toContain("source not found");
    expect(status).toMatch(/relink or re-import/);
    // The lie this fixes: a book that will never arrive used to get this.
    expect(status).not.toMatch(/in a moment/);
  });

  it("still REFUSES, and still kicks a retry — the reason is advisory, not a lockout", async () => {
    await failOnce(new Error("network error"));
    const spy = vi.fn();

    const refused = refusePendingEdit(
      () => ({ ...useApp.getState(), ensureBookData: spy }),
      ds(),
      "filtering",
    );

    expect(refused).toBe(true);
    expect(spy).toHaveBeenCalledWith("d1");
  });

  it("does not fire at all for a dataset that is not pending", async () => {
    await failOnce(new Error("stale"));
    useApp.setState({ datasets: [pendingDataset({ pending: undefined })] });

    expect(refusePendingEdit(useApp.getState, ds(), "excluding rows")).toBe(false);
    expect(useApp.getState().status).toBe("");
  });

  it("caps a pathological reason rather than pasting it into the status bar", async () => {
    // A FastAPI 422 `detail` is an ARRAY, which lib/api/http.ts stringifies;
    // a backend detail can also be arbitrarily long. Neither belongs verbatim
    // in a one-line status.
    await failOnce(new Error("x".repeat(500)));

    refusePendingEdit(useApp.getState, ds(), "excluding rows");

    const status = useApp.getState().status;
    expect(status).toContain("…");
    expect(status.length).toBeLessThan(300);
  });
});

describe("lastBookError — the record itself", () => {
  it("records WHY a failed fetch failed, and leaves `pending` set so a retry is possible", async () => {
    await failOnce(new Error("source not found"));

    expect(lastBookError("d1", SOURCE)).toBe("source not found");
    expect(ds().pending).toBeDefined();
  });

  it("re-throws unchanged, so every existing caller's error handling is untouched", async () => {
    const boom = new Error("expired upload token");
    vi.mocked(fetchBookData).mockRejectedValueOnce(boom);

    await expect(installBookData(setter, "d1", SOURCE)).rejects.toBe(boom);
  });

  it("CLEARS the recorded failure when a later fetch succeeds", async () => {
    await failOnce(new Error("network error"));
    vi.mocked(fetchBookData).mockResolvedValueOnce(FULL);

    await installBookData(setter, "d1", SOURCE);

    expect(lastBookError("d1", SOURCE)).toBeNull();
    expect(ds().pending).toBeUndefined();
    expect(ds().data.time).toHaveLength(3);
  });

  it("a non-Error rejection still yields a readable reason", async () => {
    await failOnce("plain string failure");
    expect(lastBookError("d1", SOURCE)).toBe("plain string failure");
  });

  it("will NOT answer for a different book that inherited the same dataset id", async () => {
    // Dataset ids repeat across a project load, so the entry records WHICH
    // source failed. Without that check, opening a second project would report
    // the first one's failure against a book that has never been fetched.
    await failOnce(new Error("source not found"));

    expect(lastBookError("d1", SOURCE)).toBe("source not found");
    expect(lastBookError("d1", OTHER_SOURCE)).toBeNull();
  });
});

describe("a failed fetch writes NO store state (the two defects this placement avoids)", () => {
  it("leaves the `datasets` ARRAY identity untouched — the request-storm fix", async () => {
    // `WindowCanvas.tsx` and `useMultiPanelStage.ts` both have effects whose
    // deps include `datasets` (or the active Dataset object) and whose bodies
    // call `ensureBookData` when `pending` is set. A new identity on failure
    // re-ran the effect -> re-fetch -> fail -> write -> re-run, unbounded.
    const before = useApp.getState().datasets;

    await failOnce(new Error("source not found"));

    expect(useApp.getState().datasets).toBe(before);
  });

  it("leaves each DATASET's object identity untouched too", async () => {
    // The stack/background windows pass the Dataset object itself as a dep, so
    // array identity alone is not enough — the element must be the same object.
    const before = ds();

    await failOnce(new Error("source not found"));

    expect(ds()).toBe(before);
  });

  it("does not trip the autosave gate — the dirty-project / starved-autosave fix", async () => {
    // `shouldAutosave` compares `state.datasets` by IDENTITY, so a write here
    // both dirtied an untouched project (its result is what calls
    // `markProjectDirty`) and, once the storm above was running, reset the
    // 800 ms debounce faster than it could ever fire — so real user edits were
    // never autosaved.
    //
    // Asserted against `shouldAutosave` DIRECTLY and not via `projectDirty`:
    // the subscriber that sets that flag is registered inside a React effect,
    // so in a store-level test it never runs and the flag stays false whether
    // or not the write happens. The first version of this test did that and
    // survived the sabotage that reintroduced the write.
    const before = useApp.getState() as AutosaveState;

    await failOnce(new Error("source not found"));

    expect(shouldAutosave(useApp.getState() as AutosaveState, before)).toBe(false);
  });

  it("a SECOND failure is still inert, however many times it repeats", async () => {
    const before = useApp.getState().datasets;

    await failOnce(new Error("source not found"));
    await failOnce(new Error("source not found"));
    await failOnce(new Error("a different reason"));

    expect(useApp.getState().datasets).toBe(before);
    expect(lastBookError("d1", SOURCE)).toBe("a different reason");
  });
});
