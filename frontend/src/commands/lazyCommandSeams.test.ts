// COLD-path coverage for the two command seams taken out of the eager bundle
// on 2026-09-14 (`plans/BUNDLE_HEADROOM.md` slice 2's shape: metadata eager,
// handler lazy): the four Data-menu worksheet reshapes
// (`lib/worksheetTransformCommands.ts`) and Page setup
// (`lib/pageSetupCommand.ts`).
//
// `src/architecture.test.ts` holds the STATIC half of the guard (nothing may
// value-import either module). This spec holds the BEHAVIOURAL half, which
// that grep cannot see:
//   * the command still reaches its handler and the handler's effect still
//     lands in the store, now one chunk fetch later; and
//   * a chunk that will not load is REPORTED — the danger toast `runLazy`
//     raises — instead of being a silent no-op with an unhandled rejection
//     behind it, which is what a bare `void import(...).then(...)` would be.
//
// `vi.doMock` (not the hoisted `vi.mock`) is what makes the failure path
// reachable: these seams call `import("…")` inside the click handler, so the
// module is resolved at CALL time, and a doMock registered just before
// `run()` is what that resolution sees.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAppActions } from "../appCommands";
import { useApp } from "../store/useApp";
import { useToasts } from "../store/toasts";

vi.mock("../components/overlays/ParamDialog", () => ({ askParams: vi.fn() }));
const { askParams } = await import("../components/overlays/ParamDialog");
const askParamsMock = vi.mocked(askParams);

function findCommand(id: string) {
  const action = buildAppActions(useApp.getState).find((a) => a.id === id);
  if (!action) throw new Error(`command "${id}" not registered`);
  return action;
}

const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg);

beforeEach(() => {
  askParamsMock.mockReset();
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [
      {
        id: "d1",
        name: "Sample",
        data: {
          time: [1, 2],
          values: [[10, 20], [30, 40]],
          labels: ["a", "b"],
          units: ["", ""],
          metadata: {},
        },
      },
    ],
    activeId: "d1",
    status: "",
    pageSetup: null,
  });
});

afterEach(() => {
  vi.doUnmock("../lib/worksheetTransformCommands");
  vi.doUnmock("../lib/pageSetupCommand");
  vi.resetModules();
});

describe("Data ▸ Transpose worksheet — chunk-deferred handler", () => {
  it("still creates the derived dataset after loading its chunk", async () => {
    askParamsMock.mockResolvedValue({ confirm: true });
    findCommand("transpose").run();

    // The command's own metadata is eager; only the handler is not, so nothing
    // has happened yet on the turn of the click itself.
    expect(useApp.getState().datasets).toHaveLength(1);

    await vi.waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    expect(useApp.getState().datasets[1].name).toBe("Sample (transposed)");
    expect(useApp.getState().status).toBe("created Sample (transposed)");
    expect(dangerToasts()).toEqual([]);
  });

  it("reports a chunk that will not load instead of failing silently", async () => {
    vi.doMock("../lib/worksheetTransformCommands", () => {
      throw new Error("network error");
    });
    findCommand("transpose").run();

    await vi.waitFor(() =>
      expect(dangerToasts().some((t) => t.startsWith("Could not load the worksheet reshape"))).toBe(true),
    );
    // Nothing was created, and the dialog was never opened.
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(askParamsMock).not.toHaveBeenCalled();
  });
});

describe("Plot ▸ Page setup — chunk-deferred handler", () => {
  it("still stores the edited page after loading its chunk", async () => {
    askParamsMock.mockResolvedValue({
      width: 8, height: 6, unit: "in", mleft: 1, mright: 1, mtop: 1, mbottom: 1,
    });
    findCommand("page-setup").run();
    expect(useApp.getState().pageSetup).toBeNull();

    await vi.waitFor(() => expect(useApp.getState().pageSetup).not.toBeNull());
    expect(useApp.getState().pageSetup).toMatchObject({
      width: 8,
      height: 6,
      unit: "in",
      aspectDerived: false,
    });
    expect(dangerToasts()).toEqual([]);
  });

  it("reports a chunk that will not load instead of failing silently", async () => {
    vi.doMock("../lib/pageSetupCommand", () => {
      throw new Error("network error");
    });
    findCommand("page-setup").run();

    await vi.waitFor(() =>
      expect(dangerToasts().some((t) => t.startsWith("Could not load the page setup"))).toBe(true),
    );
    expect(useApp.getState().pageSetup).toBeNull();
    expect(askParamsMock).not.toHaveBeenCalled();
  });
});

// 2026-09-15 review, finding 9: only `transpose` had chunk-load coverage, and
// nothing covered retry. The other three reshapes share `runWorksheetTransform`
// with it, so these are cheap — and they are what keeps the shared wrapper's
// refusal wording from silently drifting per command.
describe("the other three worksheet reshapes report a chunk that will not load", () => {
  it.each([
    ["stack-columns", "runStackWorksheet"],
    ["unstack-columns", "runUnstackWorksheet"],
    ["join-by-key", "runJoinWorksheets"],
  ])("%s", async (id) => {
    vi.doMock("../lib/worksheetTransformCommands", () => {
      throw new Error("network error");
    });
    findCommand(id).run();

    await vi.waitFor(() =>
      expect(dangerToasts().some((t) => t.startsWith("Could not load the worksheet reshape"))).toBe(true),
    );
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(askParamsMock).not.toHaveBeenCalled();
  });

  it("retries after a failed load instead of staying broken", async () => {
    askParamsMock.mockResolvedValue({ confirm: true });
    vi.doMock("../lib/worksheetTransformCommands", () => {
      throw new Error("network error");
    });
    findCommand("transpose").run();
    await vi.waitFor(() =>
      expect(dangerToasts().some((t) => t.startsWith("Could not load the worksheet reshape"))).toBe(true),
    );
    expect(useApp.getState().datasets).toHaveLength(1);

    // A rejected dynamic import is not cached, so the next gesture refetches.
    vi.doUnmock("../lib/worksheetTransformCommands");
    vi.resetModules();
    findCommand("transpose").run();
    await vi.waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
  });
});

// 2026-09-15 review, finding 2. A trailing `.catch` sits AFTER `.then`, so it
// also swallows whatever the loaded handler throws: measured on this very
// seam, a handler that threw produced no toast, no status and no console
// error, where the same throw before the body moved behind an `import()`
// propagated out of `run()` as a loud React event-handler error. The fix is
// the two-argument `.then(onRun, onLoadFailure)`; these two tests are the pair
// that distinguishes it from the trailing-`.catch` shape, which passes the
// second one and fails the first.
describe("a chunk-deferred handler's OWN failure is not swallowed with the load's", () => {
  /** Capture the process-level unhandled rejection a handler throw must still
   *  produce. Vitest's own listener is stood down for the duration and put
   *  back afterwards, so an expected rejection cannot fail the run. */
  async function unhandledRejectionFrom(run: () => void, settled: () => boolean = () => false): Promise<unknown> {
    const prior = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    let captured: unknown;
    const capture = (reason: unknown): void => {
      captured = reason;
    };
    process.on("unhandledRejection", capture);
    try {
      run();
      // Node decides a rejection is unhandled once the microtask queue has
      // drained, i.e. no earlier than the next macrotask turn — so one 50 ms
      // turn is the FLOOR here, never the budget. `run()` must also resolve
      // the seam's own dynamic `import()` first, and under a loaded parallel
      // gate that alone can outlast a fixed 50 ms: measured 2026-09-15, both
      // specs in this block failed once inside the scoped gate and passed in
      // isolation, and shrinking this wait to 0 ms reproduces exactly that
      // pair of failures on demand. Poll on the OUTCOME instead, keeping the
      // 50 ms turn as the minimum so the "no rejection" case still gets a
      // real settle window rather than an early exit.
      const deadline = Date.now() + 5_000;
      do {
        await new Promise((resolve) => setTimeout(resolve, 50));
      } while (captured === undefined && !settled() && Date.now() < deadline);
      return captured;
    } finally {
      process.off("unhandledRejection", capture);
      for (const listener of prior) process.on("unhandledRejection", listener);
    }
  }

  it("lets a throw from the loaded handler surface as a rejection", async () => {
    const boom = new Error("BOOM from the handler");
    vi.doMock("../lib/worksheetTransformCommands", () => ({
      runTransposeWorksheet: () => {
        throw boom;
      },
    }));

    expect(await unhandledRejectionFrom(() => findCommand("transpose").run())).toBe(boom);
    // ...and it is NOT mis-reported as a chunk-load failure.
    expect(dangerToasts()).toEqual([]);
  });

  it("still handles a chunk-load failure itself — toasted, and no unhandled rejection", async () => {
    vi.doMock("../lib/worksheetTransformCommands", () => {
      throw new Error("network error");
    });

    // The toast is this case's positive signal — waiting on it is what makes
    // the `toBeUndefined()` an assertion about a SETTLED seam rather than
    // about one that has not finished loading yet.
    const reason = await unhandledRejectionFrom(
      () => findCommand("transpose").run(),
      () => dangerToasts().length > 0,
    );
    expect(reason).toBeUndefined();
    expect(dangerToasts().some((t) => t.startsWith("Could not load the worksheet reshape"))).toBe(true);
  });
});
