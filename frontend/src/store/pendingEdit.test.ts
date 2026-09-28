// BUG-009: resolve-then-apply, and a book that will NEVER arrive must not be
// reported like one arriving in a moment.
//
// `lib/bookData.ts`'s `installBookData` leaves `pending` set when a fetch fails,
// so a later call retries — right in itself, but it made a moved source or an
// expired upload token indistinguishable from a fetch in flight, and the old
// refuse-only guard then promised "try again in a moment" forever while every
// edit, extract and copy was refused. `withResolved` (and `resolvePendingEdit`,
// its synchronous-action shape) resolve FIRST, apply on the full book, and on a
// failed load say what failed, that nothing changed, and offer Re-import.
//
// The recorded reason (`lastBookError`) is ADVISORY: it changes the message,
// never what is allowed — every action still retries, and success clears it.
//
// The reason lives in `lib/bookData.ts`'s MODULE scope, not on `Dataset`, and
// the last describe block here is why. The first version of this fix recorded it
// onto the dataset, which gave `datasets` a new identity on every failure —
// re-running the `ensureBookData` effects keyed on it (an unbounded request
// storm) and tripping `useWorkspaceAutosave`'s identity-compared dirty check.
// A failed fetch must write NO store state at all.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData } from "../lib/api";
import { resetBookTransportForTests, installBookData, lastBookError } from "../lib/bookData";
import type { BookSource, Dataset } from "../lib/types";
import { type AutosaveState, shouldAutosave } from "../useWorkspaceAutosave";
import { resolvePendingEdit, withResolved } from "./pendingEdit";
import { useToasts } from "./toasts";
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

const realReimport = useApp.getState().reimportDataset;
const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger");
/** Let every queued microtask (each awaiter of one shared rejection) run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  resetBookTransportForTests();
  // A default so a fire-and-forget `ensureBookData` has something to await;
  // the per-test `*Once` mocks take precedence over it.
  vi.mocked(fetchBookData).mockResolvedValue(FULL);
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [pendingDataset()], activeId: "d1", status: "", reimportDataset: realReimport });
});

describe("withResolved — resolve first, then apply", () => {
  it("runs `fn` on a dataset that is already loaded, with no fetch", async () => {
    useApp.setState({ datasets: [pendingDataset({ pending: undefined })] });

    const out = await withResolved(useApp.getState, "d1", "excluding rows", (d) => d.data.time.length);

    expect(out).toEqual({ ok: true, value: 2 });
    expect(fetchBookData).not.toHaveBeenCalled();
  });

  it("hands `fn` the FULL book once installed — never the preview", async () => {
    const fn = vi.fn((d: Dataset) => d.data.time.length);

    const out = await withResolved(useApp.getState, "d1", "excluding rows", fn);

    expect(out).toEqual({ ok: true, value: 3 }); // the preview has 2 rows
    expect(fn).toHaveBeenCalledOnce();
    expect(fn.mock.calls[0][0].pending).toBeUndefined();
    expect(ds().pending).toBeUndefined();
  });

  it("a failed load: `fn` never runs, nothing changes, and the message is honest and actionable", async () => {
    vi.mocked(fetchBookData).mockRejectedValueOnce(new Error("source not found"));
    const reimport = vi.fn<(id: string) => Promise<void>>(async () => {});
    useApp.setState({ datasets: [pendingDataset({ source: { kind: "path", path: "/moved.opj" } })], reimportDataset: reimport });
    const before = useApp.getState().datasets;
    const fn = vi.fn();

    const out = await withResolved(useApp.getState, "d1", "excluding rows", fn);

    expect(fn).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toBe(before); // no store write at all
    expect(ds().pending).toEqual(SOURCE); // kept, so the next action retries
    expect(out.ok).toBe(false);
    const status = useApp.getState().status;
    expect(!out.ok && out.error).toBe(status);
    expect(status).toContain('"book.opj"');
    expect(status).toContain("source not found");
    expect(status).toMatch(/Nothing was changed\. Re-import it, or relink it if the file moved\./);
    expect(status).not.toMatch(/in a moment/);
    // The offer is a real action, and it is the recovery path: Re-import.
    const [shown] = dangerToasts();
    expect(shown).toMatchObject({ msg: status, action: { label: "Re-import" } });
    shown.action!.onClick();
    expect(reimport).toHaveBeenCalledWith("d1");
  });

  it("relink is offered only where it can work — never for an upload token or a book with no recorded source", async () => {
    const upload: BookSource = { kind: "upload", token: "tok-1", bookId: "b1", rows: 4000, cols: 1 };
    const cases = [
      pendingDataset({ pending: upload, source: { kind: "path", path: "/moved.opj" } }),
      pendingDataset(), // a path fetch, but nothing recorded for Relink to move
    ];
    for (const d of cases) {
      useApp.setState({ datasets: [d] });
      vi.mocked(fetchBookData).mockRejectedValueOnce(new Error("gone"));

      await withResolved(useApp.getState, "d1", "filtering", vi.fn());

      expect(useApp.getState().status).toMatch(/Nothing was changed\. Re-import the file to continue\.$/);
      expect(useApp.getState().status).not.toMatch(/relink/);
    }
  });

  it("the Re-import offer does nothing once its id names a different book", async () => {
    // Ids repeat across project loads: an offer outliving its book must not
    // re-import whatever the next project put under the same id.
    vi.mocked(fetchBookData).mockRejectedValueOnce(new Error("source not found"));
    const reimport = vi.fn<(id: string) => Promise<void>>(async () => {});
    useApp.setState({ reimportDataset: reimport });
    await withResolved(useApp.getState, "d1", "filtering", vi.fn());
    const [shown] = dangerToasts();

    useApp.setState({ datasets: [pendingDataset({ name: "next project's book", pending: OTHER_SOURCE })] });
    shown.action!.onClick();

    expect(reimport).not.toHaveBeenCalled();
  });

  it("N actions on ONE failed fetch each report, but the user gets one toast, not N", async () => {
    let reject!: (e: unknown) => void;
    vi.mocked(fetchBookData).mockReturnValueOnce(new Promise((_, r) => { reject = r; }));

    const a = withResolved(useApp.getState, "d1", "excluding rows", vi.fn());
    const b = withResolved(useApp.getState, "d1", "filtering", vi.fn());
    useApp.getState().ensureBookData("d1"); // a view's kick joins the same fetch
    reject(new Error("source not found"));
    const [ra, rb] = await Promise.all([a, b]);
    await settle();

    expect(fetchBookData).toHaveBeenCalledOnce();
    expect([ra.ok, rb.ok]).toEqual([false, false]);
    expect(dangerToasts()).toHaveLength(1);
    expect(dangerToasts()[0].action?.label).toBe("Re-import");
  });

  it("does not apply to a dataset that replaced the book while it loaded", async () => {
    let finish!: (d: typeof FULL) => void;
    vi.mocked(fetchBookData).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const fn = vi.fn();

    const pendingOut = withResolved(useApp.getState, "d1", "excluding rows", fn);
    const replacement = pendingDataset({ name: "other project", pending: undefined });
    useApp.setState({ datasets: [replacement] });
    finish(FULL);
    const out = await pendingOut;

    expect(out.ok).toBe(false);
    expect(useApp.getState().status).toMatch(/"book\.opj" changed or closed while its full data loaded, so nothing was changed/);
    expect(fn).not.toHaveBeenCalled();
    expect(ds()).toBe(replacement);
  });

  it("a dataset that is gone is a plain failure, with no fetch", async () => {
    const out = await withResolved(useApp.getState, "nope", "excluding rows", vi.fn());

    expect(out).toEqual({ ok: false, error: "that dataset is no longer open" });
    expect(fetchBookData).not.toHaveBeenCalled();
  });
});

describe("resolvePendingEdit — the synchronous-action shape never promises 'in a moment'", () => {
  it("does nothing for a loaded dataset, so the caller applies inline as before", () => {
    useApp.setState({ datasets: [pendingDataset({ pending: undefined })] });
    const apply = vi.fn();

    expect(resolvePendingEdit(useApp.getState, ds(), "excluding rows", apply)).toBe(false);

    expect(apply).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe("");
  });

  it("a first load says the action will continue, then finishes it on the full book", async () => {
    const apply = vi.fn();

    expect(resolvePendingEdit(useApp.getState, ds(), "excluding rows", apply)).toBe(true);

    expect(useApp.getState().status).toBe('Loading full data for "book.opj" — excluding rows will continue automatically');
    expect(apply).not.toHaveBeenCalled(); // never against the preview
    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/Full data loaded — finished excluding rows/));
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0].data.time).toHaveLength(3);
  });

  it("a RETRY after a recorded failure says the last attempt failed, and still applies when it loads", async () => {
    await failOnce(new Error("source not found"));
    const apply = vi.fn();

    resolvePendingEdit(useApp.getState, ds(), "filtering", apply);

    const status = useApp.getState().status;
    expect(status).toMatch(/^Retrying full data for "book\.opj" \(last attempt failed: source not found\)/);
    expect(status).not.toMatch(/in a moment|automatically/);
    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/Full data loaded — finished filtering/));
    expect(apply).toHaveBeenCalledOnce();
    expect(lastBookError("d1", SOURCE)).toBeNull();
  });

  it("a load that keeps failing ends every attempt in the honest failure — no lingering promise", async () => {
    vi.mocked(fetchBookData).mockRejectedValue(new Error("source not found"));
    const apply = vi.fn();
    const before = useApp.getState().datasets;

    for (const action of ["excluding rows", "editing a cell"]) {
      resolvePendingEdit(useApp.getState, ds(), action, apply);
      await vi.waitFor(() => expect(useApp.getState().status).toMatch(new RegExp(`^Could not finish ${action}`)));
      expect(useApp.getState().status).not.toMatch(/in a moment|will continue/);
    }

    expect(apply).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("caps a pathological reason rather than pasting it into the status bar", async () => {
    // A FastAPI 422 `detail` is an ARRAY, which lib/api/http.ts stringifies;
    // a backend detail can also be arbitrarily long. Neither belongs verbatim
    // in a one-line status — neither the retry notice nor the failure.
    vi.mocked(fetchBookData).mockRejectedValue(new Error("x".repeat(500)));
    await expect(installBookData(setter, "d1", SOURCE)).rejects.toBeTruthy();

    resolvePendingEdit(useApp.getState, ds(), "excluding rows", vi.fn());
    const retrying = useApp.getState().status;
    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/^Could not finish/));

    // Assert the PROPERTY (the reason is capped), with the total length only as a
    // loose backstop — per docs/testing.md, a tight number on something that is
    // really a "don't paste 500 chars in here" rule just breaks on rewording.
    for (const status of [retrying, useApp.getState().status]) {
      expect(status).toContain("…");
      expect(status).not.toContain("x".repeat(130));
      expect(status.length).toBeLessThan(450);
    }
  });
});

describe("ensureBookData — a failed load offers the same recovery", () => {
  it("toasts once, with Re-import", async () => {
    vi.mocked(fetchBookData).mockRejectedValueOnce(new Error("expired upload token"));

    useApp.getState().ensureBookData("d1");

    await vi.waitFor(() => expect(dangerToasts()).toHaveLength(1));
    expect(dangerToasts()[0]).toMatchObject({
      msg: expect.stringContaining("expired upload token"),
      action: { label: "Re-import" },
    });
  });

  it("a view's re-kick that fails the SAME way stays quiet; a NEW reason is announced", async () => {
    // WindowCanvas and the multi-panel stage re-kick on every `datasets` change,
    // so without this a dead book bound to a window toasted on every edit anywhere.
    // A FRESH Error per fetch, as the real transport throws: `mockRejectedValue`
    // reuses one object, so the per-rejection dedupe silences every repeat by
    // itself — the "stays quiet" half would pass with the rule under test
    // deleted, and the reopened-project half failed spuriously.
    const failWith = (reason: string) =>
      vi.mocked(fetchBookData).mockImplementation(() => Promise.reject(new Error(reason)));
    failWith("source not found");
    useApp.getState().ensureBookData("d1");
    await settle();
    expect(dangerToasts()).toHaveLength(1);

    useApp.getState().ensureBookData("d1");
    await settle();
    expect(fetchBookData).toHaveBeenCalledTimes(2); // it DID retry
    expect(dangerToasts()).toHaveLength(1); // …and said nothing new

    failWith("permission denied");
    useApp.getState().ensureBookData("d1");
    await settle();
    expect(dangerToasts()).toHaveLength(2);
    expect(dangerToasts()[1].msg).toContain("permission denied");

    // A reopened project is a NEW dataset object with the same id and source:
    // its first failure is news to the user, and is announced.
    useApp.setState({ datasets: [pendingDataset()] });
    useApp.getState().ensureBookData("d1");
    await settle();
    expect(dangerToasts()).toHaveLength(3);
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

  it("distinguishes each identity field ON ITS OWN — including an upload's token", async () => {
    // Review LOW 1: the assertion above varies `path` AND `bookId` at once, so it
    // passes even if only one of them is compared. Each field is varied alone
    // here, and `token` is the one that matters most: an upload BookSource has NO
    // `path`, so without it the check degenerates to `bookId` for exactly the
    // case BUG-009 names — an EXPIRED UPLOAD TOKEN. That field was genuinely
    // missing from the first version of this comparison.
    const upload: BookSource = { kind: "upload", token: "tok-1", bookId: "b9", rows: 9, cols: 1 };
    useApp.setState({ datasets: [pendingDataset({ pending: upload })] });
    await failOnce(new Error("token expired"), upload);

    expect(lastBookError("d1", upload)).toBe("token expired");
    expect(lastBookError("d1", { ...upload, token: "tok-2" })).toBeNull();
    expect(lastBookError("d1", { ...upload, bookId: "b8" })).toBeNull();
    expect(lastBookError("d1", { ...upload, kind: "path" })).toBeNull();
    // And for a path-kind source, `path` alone must discriminate.
    useApp.setState({ datasets: [pendingDataset()] });
    await failOnce(new Error("moved"), SOURCE);
    expect(lastBookError("d1", { ...SOURCE, path: "/other.opj" })).toBeNull();
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
