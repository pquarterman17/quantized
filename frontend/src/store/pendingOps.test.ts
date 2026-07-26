import { beforeEach, describe, expect, it, vi } from "vitest";

import { beginOp, endOp, updateOp, usePendingOps, withOp } from "./pendingOps";

beforeEach(() => usePendingOps.setState({ ops: [] }));

describe("pendingOps store", () => {
  it("beginOp registers an op with a label and a numeric timestamp", () => {
    const id = beginOp("Importing…");
    const { ops } = usePendingOps.getState();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ id, label: "Importing…" });
    expect(typeof ops[0].startedAt).toBe("number");
  });

  it("beginOp assigns each op a distinct id", () => {
    const a = beginOp("A");
    const b = beginOp("B");
    expect(a).not.toBe(b);
  });

  it("endOp removes just that op, leaving others intact", () => {
    const a = beginOp("A");
    const b = beginOp("B");
    endOp(a);
    expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["B"]);
    endOp(b);
    expect(usePendingOps.getState().ops).toEqual([]);
  });

  it("endOp with an unknown id is a harmless no-op", () => {
    beginOp("A");
    expect(() => endOp(999_999)).not.toThrow();
    expect(usePendingOps.getState().ops).toHaveLength(1);
  });

  it("ops are ordered oldest-first", () => {
    beginOp("first");
    beginOp("second");
    beginOp("third");
    expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["first", "second", "third"]);
  });

  it("withOp registers the op before calling fn and unregisters after it resolves", async () => {
    let sawWhileRunning: number | null = null;
    const result = await withOp("Working…", async () => {
      sawWhileRunning = usePendingOps.getState().ops.length;
      return 42;
    });
    expect(sawWhileRunning).toBe(1);
    expect(result).toBe(42);
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("withOp unregisters AND rethrows when fn rejects", async () => {
    await expect(
      withOp("Working…", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // The whole point of the finally/rethrow contract: a caller's own
    // try/catch still sees the error, but the op never lingers as "stuck".
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("withOp unregisters exactly its own op when operations overlap", async () => {
    const other = beginOp("Other op");
    await withOp("Mine", async () => {
      expect(usePendingOps.getState().ops.map((o) => o.label).sort()).toEqual(["Mine", "Other op"]);
    });
    expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["Other op"]);
    endOp(other);
  });

  describe("cancel affordance (P3.4 slice 1)", () => {
    it("beginOp without a cancel arg carries no `cancel` field", () => {
      beginOp("Uncancellable");
      expect(usePendingOps.getState().ops[0].cancel).toBeUndefined();
    });

    it("beginOp with a cancel arg stores it on the op", () => {
      const cancel = vi.fn();
      beginOp("Cancellable", cancel);
      expect(usePendingOps.getState().ops[0].cancel).toBe(cancel);
    });
  });

  describe("updateOp (P3.4 slice 1 — per-file progress)", () => {
    it("changes the label without changing id or startedAt", () => {
      const id = beginOp("Importing 1/3: a.dat…");
      const before = usePendingOps.getState().ops[0];
      updateOp(id, "Importing 2/3: b.dat…");
      const after = usePendingOps.getState().ops[0];
      expect(after.label).toBe("Importing 2/3: b.dat…");
      expect(after.id).toBe(before.id);
      expect(after.startedAt).toBe(before.startedAt);
    });

    it("leaves other ops untouched", () => {
      const a = beginOp("A");
      const b = beginOp("B");
      updateOp(a, "A updated");
      expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["A updated", "B"]);
      endOp(a);
      endOp(b);
    });

    it("is a harmless no-op for an unknown id", () => {
      beginOp("A");
      expect(() => updateOp(999_999, "nope")).not.toThrow();
      expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["A"]);
    });
  });
});
