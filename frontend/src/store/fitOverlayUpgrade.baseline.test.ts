// Snapshot to New Window freezes a lean baseline preview at full resolution
// too (audit review of the payload seams), and refuses one it cannot load.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BaselineOverlay } from "../lib/types";
import { SINGLE_X } from "../test/overlayBinding";
import { rememberBaselineFull, snapshotAfterUpgrade, upgradeBaselineOverlay } from "./fitOverlayUpgrade";
import { useApp } from "./useApp";

const lean = (): BaselineOverlay => ({ datasetId: "d1", binding: SINGLE_X, y: [1, undefined, 4] as never, lean: true });

beforeEach(() => useApp.setState({ fitOverlay: null, baselineOverlay: null, status: "" }));

describe("snapshotAfterUpgrade with a lean baseline", () => {
  it("snapshots only once the baseline slot holds the full curve", async () => {
    const o = lean();
    rememberBaselineFull(o, () => Promise.resolve([1, 2, 4]));
    useApp.setState({ baselineOverlay: o });
    const snapshot = vi.fn(() => expect(useApp.getState().baselineOverlay?.y).toEqual([1, 2, 4]));
    await snapshotAfterUpgrade(snapshot);
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it("takes no snapshot, and says so, when the full baseline cannot be loaded", async () => {
    useApp.setState({ baselineOverlay: lean() }); // nothing to fetch it by
    const snapshot = vi.fn();
    await snapshotAfterUpgrade(snapshot);
    expect(snapshot).not.toHaveBeenCalled();
    expect(useApp.getState().status).toMatch(/snapshot not taken: .*baseline/);
  });

  it("upgradeBaselineOverlay is a no-op for a full baseline", async () => {
    const full: BaselineOverlay = { datasetId: "d1", binding: SINGLE_X, y: [1, 2, 4] };
    useApp.setState({ baselineOverlay: full });
    await expect(upgradeBaselineOverlay()).resolves.toBe(true);
    expect(useApp.getState().baselineOverlay).toBe(full);
  });
});
