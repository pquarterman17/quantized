// importPaths (MAIN_PLAN #31): the path entry point that gives a dataset a real
// `source.path`, which is what lets re-import skip the picker.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { importFile, uploadFile } from "../lib/api";
import { pathBasename } from "./importDatasets";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  importFile: vi.fn(),
  uploadFile: vi.fn(),
}));

const payload = () => ({
  time: [0, 1, 2],
  values: [[10], [20], [30]],
  labels: ["M"],
  units: ["emu"],
  metadata: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [], folders: [], activeId: null, selectedIds: [] });
  vi.mocked(importFile).mockResolvedValue(payload());
  vi.mocked(uploadFile).mockResolvedValue(payload());
});

describe("pathBasename", () => {
  it("handles POSIX and Windows separators, and UNC", () => {
    // The backslash is built from a char code, not written as a literal: this
    // test was briefly WRONG because a quoting layer ate one, turning
    // "C:\data\scan.dat" into the escape sequences \d and \s — i.e. the string
    // "C:datascan.dat", which has no separator at all and tests nothing.
    const B = String.fromCharCode(92);
    expect(pathBasename("/data/runs/scan.dat")).toBe("scan.dat");
    expect(pathBasename(`C:${B}data${B}scan.dat`)).toBe("scan.dat");
    expect(pathBasename(`${B}${B}server${B}share${B}scan.dat`)).toBe("scan.dat");
  });

  it("handles a trailing separator", () => {
    const B = String.fromCharCode(92);
    expect(pathBasename(`/data/runs${"/"}`)).toBe("runs");
    expect(pathBasename(`C:${B}data${B}`)).toBe("data");
  });

  it("returns the input when there is no separator", () => {
    expect(pathBasename("scan.dat")).toBe("scan.dat");
  });
});

describe("importPaths", () => {
  it("reads through the PATH route, not upload", async () => {
    await useApp.getState().importPaths(["/data/scan.dat"]);
    expect(importFile).toHaveBeenCalledWith("/data/scan.dat");
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("records source.path so re-import needs no picker", async () => {
    await useApp.getState().importPaths(["/data/scan.dat"]);
    const [ds] = useApp.getState().datasets;
    expect(ds.source).toEqual({ kind: "path", path: "/data/scan.dat" });
  });

  it("names the dataset from the basename, not the whole path", async () => {
    await useApp.getState().importPaths(["/very/long/network/path/scan.dat"]);
    expect(useApp.getState().datasets[0].name).toBe("scan.dat");
  });

  it("imports several paths in one batch", async () => {
    await useApp.getState().importPaths(["/a/one.dat", "/b/two.dat"]);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["one.dat", "two.dat"]);
  });

  it("keeps going when one path fails, and reports it", async () => {
    vi.mocked(importFile)
      .mockRejectedValueOnce(new Error("file not found"))
      .mockResolvedValueOnce(payload());
    await useApp.getState().importPaths(["/gone.dat", "/ok.dat"]);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["ok.dat"]);
    expect(useApp.getState().status).toContain("file not found");
  });
});

describe("importFiles still behaves as before", () => {
  it("uploads bytes and records NO source (a browser cannot know a path)", async () => {
    const file = new File(["T,M\n1,2\n"], "browser.csv", { type: "text/csv" });
    await useApp.getState().importFiles([file]);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    const [ds] = useApp.getState().datasets;
    expect(ds.name).toBe("browser.csv");
    expect(ds.source).toBeUndefined();
  });
});

describe("import roles and provenance (MAIN #33)", () => {
  const withLabels = (labels: string[]) => ({
    time: [0, 1],
    values: [labels.map(() => 1), labels.map(() => 2)],
    labels,
    units: labels.map(() => ""),
    metadata: {},
  });

  it("seeds error roles from the parsed column names", () => {
    vi.mocked(importFile).mockResolvedValue(withLabels(["R", "dR"]));
    return useApp
      .getState()
      .importPaths(["/d/refl.dat"])
      .then(() => {
        expect(useApp.getState().datasets[0].errorRoles).toEqual([
          { channel: 1, target: 0, axis: "y", side: "both" },
        ]);
      });
  });

  it("records asymmetric halves separately, not as one symmetric bar", () => {
    vi.mocked(importFile).mockResolvedValue(withLabels(["M", "M_err+", "M_err-"]));
    return useApp
      .getState()
      .importPaths(["/d/asym.dat"])
      .then(() => {
        const roles = useApp.getState().datasets[0].errorRoles ?? [];
        expect(roles.map((r) => r.side).sort()).toEqual(["+", "-"]);
      });
  });

  it("leaves an AMBIGUOUS error name unbound rather than guessing", () => {
    // The plan's "suggested, never silently forced": a leading error column has
    // nothing defensible to bind to.
    vi.mocked(importFile).mockResolvedValue(withLabels(["err", "M"]));
    return useApp
      .getState()
      .importPaths(["/d/amb.dat"])
      .then(() => {
        expect(useApp.getState().datasets[0].errorRoles).toBeUndefined();
      });
  });

  it("adds no role list to an ordinary numeric file", () => {
    vi.mocked(importFile).mockResolvedValue(withLabels(["Temp", "Moment"]));
    return useApp
      .getState()
      .importPaths(["/d/plain.csv"])
      .then(() => {
        expect(useApp.getState().datasets[0].errorRoles).toBeUndefined();
      });
  });

  it("stamps import provenance on the dataset, since the file is never written", () => {
    vi.mocked(importFile).mockResolvedValue(withLabels(["T", "M"]));
    return useApp
      .getState()
      .importPaths(["/d/plain.csv"])
      .then(() => {
        expect(useApp.getState().datasets[0].importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });
  });
});
