// File ▸ Export Origin project (.opj)… — the /api/export/opj route's only
// frontend caller. Pins which datasets become workbooks, that each is
// resolved to full data first (#38: never the lazy-book preview), the book
// names the user sees in the Library, the cancel contract, and that the body
// stays out of the eager bundle.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportOriginProject } from "../lib/api/originProject";
import { usePendingOps } from "../store/pendingOps";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import { buildFileCommands } from "./fileCommands";
import { runExportOriginProject } from "./originProjectExport";

vi.mock("../lib/api/originProject", () => ({ exportOriginProject: vi.fn() }));
const exportMock = vi.mocked(exportOriginProject);

const data = (v: number, label = "M") => ({
  time: [0, 1],
  values: [[v], [v + 1]],
  labels: [label],
  units: ["emu"],
  metadata: {},
});

type Body = Parameters<typeof exportOriginProject>[0];
const lastBody = (): Body => exportMock.mock.calls.at(-1)![0];

beforeEach(() => {
  exportMock.mockReset();
  exportMock.mockResolvedValue(undefined);
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [
      { id: "d1", name: "loopA.dat", data: data(1) },
      { id: "d2", name: "loopB.dat", data: data(2) },
      { id: "d3", name: "rocking", data: data(3) },
    ],
    activeId: "d1",
    selectedIds: ["d1"],
    status: "",
  });
});

describe("runExportOriginProject", () => {
  it("exports every loaded dataset as a named book when nothing is multi-selected", async () => {
    await runExportOriginProject(useApp.getState);
    expect(exportMock).toHaveBeenCalledTimes(1);
    expect(lastBody().datasets.map((d) => d.name)).toEqual(["loopA", "loopB", "rocking"]);
    expect(lastBody().datasets[2].dataset).toEqual(data(3));
    expect(lastBody().filename).toBe("project");
    expect(useApp.getState().status).toBe("exported Origin project (3 books)");
  });

  it("exports only a multi-selection, in Library order", async () => {
    useApp.setState({ selectedIds: ["d3", "d1"] });
    await runExportOriginProject(useApp.getState);
    expect(lastBody().datasets.map((d) => d.name)).toEqual(["loopA", "rocking"]);
  });

  it("resolves full data first instead of sending a lazy preview", async () => {
    const full = data(9, "Moment");
    const resolveDatasets = vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, name: `${id}.opju`, data: full })),
    );
    useApp.setState({ resolveDatasets });
    await runExportOriginProject(useApp.getState);
    expect(resolveDatasets).toHaveBeenCalledWith(["d1", "d2", "d3"]);
    expect(lastBody().datasets.map((d) => d.dataset)).toEqual([full, full, full]);
  });

  it("reports an empty session without calling the route", async () => {
    useApp.setState({ datasets: [], selectedIds: [], activeId: null });
    await runExportOriginProject(useApp.getState);
    expect(exportMock).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe("no datasets to export");
  });

  it("Cancel aborts the request with a status line and no error toast", async () => {
    let signal: AbortSignal | undefined;
    exportMock.mockImplementation((_body, s) => {
      signal = s;
      return new Promise<void>((_, reject) =>
        s?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
      );
    });
    const p = runExportOriginProject(useApp.getState);
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["Exporting Origin project (3 books)…"]);
    usePendingOps.getState().ops[0].cancel?.();
    await p;
    expect(signal?.aborted).toBe(true);
    expect(useApp.getState().status).toBe("export cancelled");
    expect(useToasts.getState().toasts).toEqual([]);
    expect(usePendingOps.getState().ops).toEqual([]);
  });

  it("reports a route failure as a failure", async () => {
    exportMock.mockRejectedValue(new Error("opj_bytes needs at least one DataStruct"));
    await runExportOriginProject(useApp.getState);
    const msg = "export failed: opj_bytes needs at least one DataStruct";
    expect(useApp.getState().status).toBe(msg);
    expect(useToasts.getState().toasts.map((t) => [t.msg, t.kind])).toEqual([[msg, "danger"]]);
  });
});

describe("File ▸ Export Origin project (.opj)…", () => {
  it("is a File-menu command", () => {
    const cmd = buildFileCommands(useApp.getState).find((c) => c.id === "export-origin-project");
    expect(cmd?.group).toBe("File");
    expect(cmd?.label).toBe("Export Origin project (.opj)…");
  });

  it("reaches the route through the lazy chunk", async () => {
    buildFileCommands(useApp.getState).find((c) => c.id === "export-origin-project")!.run();
    await vi.waitFor(() => expect(useApp.getState().status).toBe("exported Origin project (3 books)"));
  });

  it("keeps the body out of the eager bundle", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, "fileCommands.ts"), "utf-8");
    expect(src).toContain('import("./originProjectExport")');
    expect(src).not.toMatch(/^import(?!\s+type)[^;]*from\s+"\.\/originProjectExport"/m);
    expect(src).not.toMatch(/^import(?!\s+type)[^;]*from\s+"\.\.\/lib\/api\/originProject"/m);
  });
});
