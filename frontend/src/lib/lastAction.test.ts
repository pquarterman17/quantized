import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Action } from "../store/commands";
import { lastDialogCommand, noteCommand, opensDialog, rememberRepeat, repeatLastAction, resetLastActionForTests } from "./lastAction";

const act = (id: string, label: string, extra: Partial<Action> = {}): Action => ({ id, group: "Analyze", label, run: () => {}, ...extra });

beforeEach(resetLastActionForTests);

describe("repeat last action", () => {
  it("fails closed with nothing to repeat", async () => {
    const r = await repeatLastAction();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/nothing to repeat/);
  });
  it("re-runs a registered operation with its settings", async () => {
    const run = vi.fn();
    rememberRepeat({ label: "Smooth", run });
    expect(await repeatLastAction()).toEqual({ ok: true, message: "repeated Smooth" });
    expect(run).toHaveBeenCalledOnce();
  });
  it("names an unsupported command that ran after the repeatable one", async () => {
    rememberRepeat({ label: "Smooth", run: vi.fn() });
    noteCommand(act("peaks", "Find peaks…"));
    const r = await repeatLastAction();
    expect(r.ok).toBe(false);
    expect(r.message).toContain(`can't repeat "Find peaks"`);
  });
  it("keeps a repeatable registered after the command that opened its dialog", async () => {
    noteCommand(act("smooth", "Smooth…"));
    rememberRepeat({ label: "Smooth", run: vi.fn() });
    expect((await repeatLastAction()).ok).toBe(true);
  });
  it("the repeat / reopen / palette commands never count as the last action", async () => {
    rememberRepeat({ label: "Smooth", run: vi.fn() });
    for (const id of ["repeat-last-action", "reopen-last-dialog", "palette"]) noteCommand(act(id, "X…"));
    expect((await repeatLastAction()).ok).toBe(true);
    expect(lastDialogCommand()).toBeNull();
  });
  it("reports a failed re-run instead of throwing", async () => {
    rememberRepeat({ label: "Smooth", run: () => { throw new Error("bad column"); } });
    expect(await repeatLastAction()).toEqual({ ok: false, message: "repeat of Smooth failed: bad column" });
  });
});

describe("reopen last dialog", () => {
  it("remembers the last ellipsis command, not destructive or per-entity ones", () => {
    noteCommand(act("curvefit", "Curve fit…"));
    noteCommand(act("rm", "Remove all…", { danger: true }));
    noteCommand(act("proj", "Reopen Foo…", { perEntity: true }));
    noteCommand(act("grid", "Show grid"));
    expect(lastDialogCommand()?.id).toBe("curvefit");
  });
  it("prefers the freshest published copy by id", () => {
    noteCommand(act("curvefit", "Curve fit…"));
    const fresh = act("curvefit", "Curve fit…");
    expect(lastDialogCommand([fresh])).toBe(fresh);
  });
  it("opensDialog follows the ellipsis convention", () => {
    expect(opensDialog({ label: "Open…" })).toBe(true);
    expect(opensDialog({ label: "Open" })).toBe(false);
  });
});
