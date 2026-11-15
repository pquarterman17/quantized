// "Send to Origin" attaches to the Origin session the user already has open
// (owner decision 2026-11-15), so it must confirm first and send nothing on
// cancel.
import { beforeEach, describe, expect, it, vi } from "vitest";

const askConfirm = vi.hoisted(() => vi.fn());
vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm }));

import { runSendToOrigin } from "./fileCommandsLazy";
import type { Dataset } from "../lib/types";
import { useApp } from "../store/useApp";

const mk = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: ["emu"], metadata: {} },
});

const status = vi.fn(async () => ({ available: true }));
const send = vi.fn(async () => ({ books: ["a"] }));
const run = () => runSendToOrigin(useApp.getState, status as never, send as never);

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [mk("a"), mk("b"), mk("c")], activeId: "a", selectedIds: ["a", "b", "c"] });
});

describe("Send to Origin confirmation", () => {
  it("confirm sends the request", async () => {
    askConfirm.mockResolvedValue(true);
    await run();
    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("cancel sends nothing", async () => {
    askConfirm.mockResolvedValue(false);
    await run();
    expect(send).not.toHaveBeenCalled();
  });

  it("names the right count (plural and singular)", async () => {
    askConfirm.mockResolvedValue(false);
    await run();
    expect(askConfirm.mock.calls[0][1]).toBe("Add 3 workbooks to the Origin project you have open?");
    useApp.setState({ selectedIds: [] });
    await run();
    expect(askConfirm.mock.calls[1][1]).toBe("Add 1 workbook to the Origin project you have open?");
  });

  it("does not ask when Origin COM is unavailable", async () => {
    status.mockResolvedValueOnce({ available: false });
    await run();
    expect(askConfirm).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
