import { describe, expect, it } from "vitest";

import type { ConvertEntry, FilePreview } from "../../../lib/api/convertQuick";
import { baseName, chooserStart, columnText, folderOf, joinPath, plainError, rowStatus, sizeText, summaryText, type QcFile } from "./quickConvertModel";

const file: QcFile = { id: "a", path: "/d/run1.dat", name: "run1.dat", staged: false, phase: "ready" };
const preview = (over: Partial<FilePreview> = {}): FilePreview => ({
  path: file.path, name: file.name, staged: false, kind: "import_qd", kind_label: "Quantum Design magnetometry .dat",
  technique: "magnetometry.mvsh", format: "csv", format_source: "default (provisional)", datasets: [],
  outputs: ["run1.dat.csv"], existing: [], notes: [], error: null, ...over,
});
const entry = (over: Partial<ConvertEntry> = {}): ConvertEntry => ({
  source: file.path, status: "ok", outcome: "done", reason: null, error: null, outputs: ["run1.dat.csv"],
  notes: [], omissions: [], books: [], ...over,
});
const idle = { running: false, overwrite: false };

describe("path helpers", () => {
  it("splits and joins on either separator", () => {
    expect(baseName("/a/b/c.dat")).toBe("c.dat");
    expect(baseName("C:\\data\\c.dat")).toBe("c.dat");
    expect(folderOf("/a/b/c.dat")).toBe("/a/b");
    expect(folderOf("c.dat")).toBe("");
    expect(joinPath("C:\\out", "x.csv")).toBe("C:\\out\\x.csv");
    expect(joinPath("/out", "x.csv")).toBe("/out/x.csv");
  });
  it("formats columns, sizes", () => {
    expect(columnText([{ name: "2-Theta", unit: "deg" }, { name: "n", unit: "" }])).toBe("2-Theta [deg], n");
    expect([12, 3400, 2_500_000].map(sizeText)).toEqual(["12 B", "3.4 kB", "2.5 MB"]);
  });
});

describe("plainError", () => {
  it.each([
    ["file not found", /not found/],
    ["ValueError: no parser registered for 'a.zzz' (extension '.zzz')", /does not know the \.zzz file type/],
    ["ValueError: no data rows: the file holds only a header (w.csv)", /header but no data rows/],
    ["writing failed: PermissionError: [Errno 13] Permission denied: '/x'", /No permission to write/],
    ["writing failed: NotADirectoryError: [Errno 20] Not a directory: '/f/sub'", /file, not a folder/],
    ["/o/a.csv: exists, not overwritten", /already exists/],
    ["no dataset holds numbers", /nothing to write/],
  ])("%s", (raw, re) => expect(plainError(raw)).toMatch(re));
  it("falls back to the message, tidied", () => {
    expect(plainError("RuntimeError: odd thing")).toBe("Odd thing.");
    expect(plainError(null)).toBe("Not converted.");
  });
});

describe("rowStatus", () => {
  it("is ready, then names what exists", () => {
    expect(rowStatus(file, preview(), undefined, idle)).toMatchObject({ tone: "ok", label: "Ready" });
    const exists = preview({ existing: ["run1.dat.csv"] });
    expect(rowStatus(file, exists, undefined, idle)).toMatchObject({ tone: "warn", label: "Output exists: will skip" });
    expect(rowStatus(file, exists, undefined, { ...idle, overwrite: true }).label).toBe("Will replace existing");
  });
  it("says why a file cannot be converted", () => {
    const s = rowStatus(file, preview({ error: "ValueError: no parser registered for 'a.zzz' (extension '.zzz')" }), undefined, idle);
    expect(s.tone).toBe("danger");
    expect(s.detail).toMatch(/\.zzz/);
  });
  it("a finished run wins over the preview", () => {
    expect(rowStatus(file, preview(), entry(), idle).label).toBe("Converted");
    expect(rowStatus(file, preview(), entry({ outputs: ["a.csv", "b.csv"] }), idle).label).toBe("Converted (2 files)");
    expect(rowStatus(file, preview(), entry({ outcome: "skipped-exists", status: "failed" }), idle).label).toBe("Skipped: already exists");
    expect(rowStatus(file, preview(), entry({ outcome: "failed", status: "failed", reason: "writing failed: PermissionError: x" }), idle).detail).toMatch(/No permission/);
  });
  it("covers uploads and queueing", () => {
    expect(rowStatus({ ...file, phase: "staging" }, undefined, undefined, idle).label).toBe("Uploading…");
    expect(rowStatus({ ...file, phase: "failed", error: "413: too big" }, undefined, undefined, idle).tone).toBe("danger");
    expect(rowStatus(file, preview(), undefined, { ...idle, running: true }).label).toBe("Queued…");
  });
  it("summarises a run", () => {
    expect(summaryText([entry(), entry(), entry({ outcome: "failed" }), entry({ outcome: "skipped-exists" })])).toBe(
      "2 converted, 1 skipped (already exist), 1 failed",
    );
    expect(summaryText([])).toBe("Nothing was converted");
  });
});

describe("chooserStart (UX12)", () => {
  const f = (path: string, staged = false) => ({ path, staged });
  it("starts in the typed output folder, else the first real input's folder, else home", () => {
    expect(chooserStart("folder", " /out ", [f("/d/a.dat")], "/home/u")).toBe("/out");
    expect(chooserStart("files", "/out", [f("/d/a.dat"), f("/e/b.dat")], "/home/u")).toBe("/d");
    expect(chooserStart("folder", "", [f("/d/a.dat")], "/home/u")).toBe("/d");
    expect(chooserStart("files", "", [], "/home/u")).toBe("/home/u");
  });
  it("never starts in the temp folder a dropped file was staged in", () => {
    expect(chooserStart("files", "", [f("/tmp/qz-convert-stage/ab/a.dat", true)], "/home/u")).toBe("/home/u");
  });
});
