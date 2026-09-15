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
