// The Origin (.ogs) and consolidated-CSV exports designate error columns
// (yErr / xErr) from the dataset's declared `error_roles`. The user's LIVE
// bindings live on `Dataset.errorRoles` (seeded at import, editable in the
// Error columns card), not in the parser metadata, so the export must carry
// them — otherwise an edited or label-inferred binding never reaches Origin.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runExportConsolidated, runExportOrigin } from "./fileCommandsLazy";
import type { Dataset, ErrorBinding } from "../lib/types";
import { useApp } from "../store/useApp";

const live: ErrorBinding[] = [{ channel: 1, target: 0, axis: "y", side: "both" }];
const ds: Dataset = {
  id: "d1",
  name: "scan.dat",
  data: {
    time: [0, 1],
    values: [[1, 0.1], [2, 0.2]],
    labels: ["M", "dM?"],
    units: ["emu", "emu"],
    metadata: { error_roles: [] },
  },
  errorRoles: live,
};

beforeEach(() => {
  useApp.setState({ datasets: [ds], activeId: "d1", selectedIds: [] });
});

describe("Origin-designating exports carry the live error bindings", () => {
  it("Export Origin (.ogs) sends Dataset.errorRoles as metadata.error_roles", async () => {
    const fn = vi.fn(async (_body: { dataset: { metadata: Record<string, unknown> } }) => undefined);
    await runExportOrigin(useApp.getState, fn as never);
    expect(fn.mock.calls[0][0].dataset.metadata.error_roles).toEqual(live);
  });

  it("Export consolidated CSV sends them too", async () => {
    const fn = vi.fn(async (_body: { datasets: { dataset: { metadata: Record<string, unknown> } }[] }) => undefined);
    await runExportConsolidated(useApp.getState, fn as never);
    expect(fn.mock.calls[0][0].datasets[0].dataset.metadata.error_roles).toEqual(live);
  });

  it("leaves a dataset with no live bindings unchanged", async () => {
    const plain: Dataset = { ...ds, errorRoles: undefined };
    useApp.setState({ datasets: [plain] });
    const fn = vi.fn(async (_body: { dataset: unknown }) => undefined);
    await runExportOrigin(useApp.getState, fn as never);
    expect(fn.mock.calls[0][0].dataset).toBe(plain.data);
  });
});

describe("Export Origin (.ogs) carries the plot's reversed x axis", () => {
  it("sends xReversed as graph.x_reversed", async () => {
    useApp.setState({ xReversed: true });
    const fn = vi.fn(async (_body: { graph?: { x_reversed?: boolean } }) => undefined);
    await runExportOrigin(useApp.getState, fn as never);
    expect(fn.mock.calls[0][0].graph?.x_reversed).toBe(true);
  });
});
