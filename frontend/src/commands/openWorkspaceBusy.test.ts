// P3.4 slice 3 — "Open/Append workspace…" registers a pendingOps busy state
// for the duration of the (now off-main-thread) parse, via the shared
// `withOp` primitive store/pendingOps.ts ships (P3.4 slice 2). Registration
// must happen before the heavy work starts and clear on BOTH success and
// failure — this file is the coverage for that contract; parity between the
// worker and fallback parse paths themselves is covered in
// lib/parseWorkspaceFile.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./fileCommands";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import { openFilePicker } from "../lib/openFilePicker";
import { WORKSPACE_FORMAT } from "../lib/workspace";
import { usePendingOps } from "../store/pendingOps";
import { useApp } from "../store/useApp";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../lib/openFilePicker", async (orig) => ({
  ...(await orig<typeof import("../lib/openFilePicker")>()),
  openFilePicker: vi.fn(),
}));

const WS = JSON.stringify({ format: WORKSPACE_FORMAT, version: 3, datasets: [], folders: [] });

/** A `File`-like object whose `.text()` only resolves once `release()` is
 *  called — lets a test observe the pendingOps state WHILE the parse is
 *  still in flight, not just before/after. */
function deferredFile(text: string): { file: File; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const file = { text: () => gate.then(() => text) } as unknown as File;
  return { file, release };
}

function pickFile(file: File) {
  const cb = vi.mocked(openFilePicker).mock.calls.at(-1)?.[0];
  if (!cb) throw new Error("openFilePicker was never called");
  cb([file]);
}

function runCommand(id: "open-workspace" | "append-workspace") {
  const cmd = buildFileCommands(useApp.getState).find((c) => c.id === id);
  if (!cmd) throw new Error(`${id} command not registered`);
  cmd.run();
}

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  vi.mocked(openFilePicker).mockReset();
  usePendingOps.setState({ ops: [] });
  useApp.setState({ datasets: [], activeId: null, selectedIds: [] });
});

describe("Open workspace — busy state", () => {
  it("registers a busy op labeled 'Opening workspace…' as soon as a file is picked", async () => {
    const { file, release } = deferredFile(WS);
    runCommand("open-workspace");
    pickFile(file);
    await Promise.resolve(); // let the withOp/parseWorkspaceFile call start
    expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["Opening workspace…"]);
    release();
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
  });

  it("clears the busy op on successful parse", async () => {
    runCommand("open-workspace");
    pickFile({ text: () => Promise.resolve(WS) } as unknown as File);
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    expect(useApp.getState().datasets).toEqual([]);
  });

  it("clears the busy op when the parse fails (bad JSON)", async () => {
    runCommand("open-workspace");
    pickFile({ text: () => Promise.resolve("not json {{{") } as unknown as File);
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    expect(useApp.getState().status).toMatch(/open failed/);
  });

  it("clears the busy op when file.text() itself rejects", async () => {
    runCommand("open-workspace");
    pickFile({ text: () => Promise.reject(new Error("disk error")) } as unknown as File);
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    expect(useApp.getState().status).toBe("open failed: disk error");
  });

  it("does not register a busy op before a file is picked (dialog merely open)", () => {
    runCommand("open-workspace");
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });
});

describe("Append workspace — busy state", () => {
  it("registers a busy op labeled 'Appending workspace…'", async () => {
    const { file, release } = deferredFile(WS);
    runCommand("append-workspace");
    pickFile(file);
    await Promise.resolve();
    expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["Appending workspace…"]);
    release();
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
  });

  it("clears the busy op on failure with the append-specific status message", async () => {
    runCommand("append-workspace");
    pickFile({ text: () => Promise.resolve("not json {{{") } as unknown as File);
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    expect(useApp.getState().status).toMatch(/append failed/);
  });
});
