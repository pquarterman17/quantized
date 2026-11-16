// Plot > Exchange X-Y axes loads its blocker (lib/exchangeXY.ts) lazily. While
// that chunk is loading, or after it failed to load, the command is OFF with a
// reason ("Loading…"); a later menu render asks again, so a transient failure
// (a stale chunk hash) heals instead of leaving it disabled with no reason.
import { describe, expect, it, vi } from "vitest";

describe("the exchange command's lazy blocker", () => {
  it("reads Loading… and is off after a failed load, then recovers on the next render", async () => {
    vi.resetModules();
    let tries = 0;
    vi.doMock("../lib/exchangeXY", () => {
      tries += 1;
      if (tries === 1) throw new Error("chunk gone");
      return { exchangeBlocker: () => undefined, installExchangeGuard: () => {} };
    });
    const { buildPlotCommands } = await import("./plotCommands");
    const { useApp } = await import("../store/useApp");
    await new Promise((r) => setTimeout(r, 20)); // the first load rejects
    const cmd = buildPlotCommands(useApp.getState).find((a) => a.id === "exchange-xy")!;
    const off = () => (typeof cmd.disabled === "function" ? cmd.disabled() : cmd.disabled);
    const reason = () => (typeof cmd.disabledReason === "function" ? cmd.disabledReason() : cmd.disabledReason);
    expect(off()).toBe(true); // a menu render after the failure: off, and asks again
    expect(reason()).toBe("Loading…");
    await new Promise((r) => setTimeout(r, 20));
    expect(tries).toBeGreaterThanOrEqual(2);
    expect(off()).toBe(false); // recovered
    vi.doUnmock("../lib/exchangeXY");
  });
});
