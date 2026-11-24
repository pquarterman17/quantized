// Import: "uploading N%" then "parsing…" in the StatusBar label, driven by
// lib/api's upload progress callback (RESULT_ACCEPTANCE_AUDIT part 4, row 5),
// and the XHR transport behind it.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadFile } from "../lib/api";
import type { DataStruct } from "../lib/types";
import { postImportWithProgress } from "../lib/api/uploadProgress";
import { usePendingOps } from "./pendingOps";
import { importCore } from "./importDatasetsLazy";
import { useImportBatch } from "./importBatch";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  uploadFile: vi.fn(),
}));

const payload = (): DataStruct => ({ time: [0, 1], values: [[1], [2]], labels: ["M"], units: ["emu"], metadata: {} });

beforeAll(async () => {
  await importCore();
});
beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [], folders: [], activeId: null, selectedIds: [] });
  useImportBatch.setState({ running: false });
  usePendingOps.setState({ ops: [] });
});

describe("import label shows upload percent then the parse stage", () => {
  it("single file", async () => {
    let report!: (f: number) => void;
    let done!: (d: DataStruct) => void;
    vi.mocked(uploadFile).mockImplementation((_f, _s, onProgress) => {
      report = onProgress!;
      return new Promise((r) => (done = r));
    });
    const p = useApp.getState().importFiles([new File(["x"], "big.dat")]);
    await vi.waitFor(() => expect(report).toBeDefined());
    report(0.42);
    expect(usePendingOps.getState().ops[0].label).toBe("Importing big.dat · uploading 42%");
    report(1);
    expect(usePendingOps.getState().ops[0].label).toBe("Importing big.dat · parsing…");
    done(payload());
    await p;
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("multi-file keeps the i/N prefix and moves on per file", async () => {
    const reports: ((f: number) => void)[] = [];
    const dones: ((d: DataStruct) => void)[] = [];
    vi.mocked(uploadFile).mockImplementation((_f, _s, onProgress) => {
      reports.push(onProgress!);
      return new Promise((r) => dones.push(r));
    });
    const p = useApp.getState().importFiles([new File(["x"], "a.dat"), new File(["y"], "b.dat")]);
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    reports[0](0.5);
    expect(usePendingOps.getState().ops[0].label).toBe("Importing 1/2: a.dat · uploading 50%");
    dones[0](payload());
    await vi.waitFor(() => expect(usePendingOps.getState().ops[0].label).toBe("Importing 2/2: b.dat…"));
    await vi.waitFor(() => expect(reports).toHaveLength(2));
    dones[1](payload());
    await p;
  });
});

class FakeXhr {
  static last: FakeXhr;
  upload: { onprogress?: (e: unknown) => void; onload?: () => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  status = 200;
  statusText = "OK";
  responseText = JSON.stringify(payload());
  responseType = "";
  abort = vi.fn(() => this.onabort?.());
  open = vi.fn();
  send = vi.fn();
  getResponseHeader = () => null;
  constructor() { FakeXhr.last = this; }
}

describe("postImportWithProgress", () => {
  beforeEach(() => vi.stubGlobal("XMLHttpRequest", FakeXhr));

  it("reports the byte fraction, then 1, and resolves with the parsed body", async () => {
    const seen: number[] = [];
    const p = postImportWithProgress<DataStruct>("/api/parsers/upload", new FormData(), undefined, (f) => seen.push(f));
    const x = FakeXhr.last;
    x.upload.onprogress!({ lengthComputable: true, loaded: 25, total: 100 });
    x.upload.onprogress!({ lengthComputable: true, loaded: 100, total: 100 }); // the final byte is `onload`'s, not a percent
    x.upload.onload!();
    x.onload!();
    expect((await p).labels).toEqual(["M"]);
    expect(seen).toEqual([0.25, 1]);
  });

  it("an abort rejects with an AbortError and aborts the request", async () => {
    const c = new AbortController();
    const p = postImportWithProgress<DataStruct>("/x", new FormData(), c.signal, () => {});
    c.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXhr.last.abort).toHaveBeenCalled();
  });

  it("a non-2xx answer throws the backend's detail through the shared ensureOk", async () => {
    const p = postImportWithProgress<DataStruct>("/x", new FormData(), undefined, () => {});
    FakeXhr.last.status = 422;
    FakeXhr.last.responseText = JSON.stringify({ detail: "bad file" });
    FakeXhr.last.onload!();
    await expect(p).rejects.toThrow("bad file");
  });
});
