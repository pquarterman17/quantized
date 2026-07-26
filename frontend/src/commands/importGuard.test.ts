// Double-import guard at the command layer (P3.4 slice 1, 2026-07-26 audit
// gap #1): "Import data…" (⌘O) and "Import & append…" both pre-flight check
// `isImportRunning()` before doing anything else, so clicking either while a
// batch is already running doesn't even pop a file dialog. The real
// chokepoint (store/importDatasets.ts's `runImport`) is covered by its own
// test file — this one is scoped to what fileCommands.ts itself adds:
// - the pre-flight short-circuit (no dialog, a toast instead)
// - import-append's own busy-state bookkeeping around `importFilesAppended`
//   (which lives in useApp.ts, off-limits to this slice, so its guard
//   participation has to be wired here instead)

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./fileCommands";
import { chooseAndImport } from "../lib/importEntry";
import { openFilePicker } from "../lib/openFilePicker";
import { ALREADY_RUNNING_MSG, isImportRunning, useImportBatch } from "../store/importDatasets";
import { usePendingOps } from "../store/pendingOps";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";

vi.mock("../lib/importEntry", () => ({ chooseAndImport: vi.fn(() => Promise.resolve()) }));
vi.mock("../lib/openFilePicker", async (orig) => ({
  ...(await orig<typeof import("../lib/openFilePicker")>()),
  openFilePicker: vi.fn(),
}));

function findCmd(id: string) {
  const cmd = buildFileCommands(useApp.getState).find((c) => c.id === id);
  if (!cmd) throw new Error(`${id} command not registered`);
  return cmd;
}

function lastToast(): string | undefined {
  return useToasts.getState().toasts.at(-1)?.msg;
}

beforeEach(() => {
  vi.mocked(chooseAndImport).mockClear();
  vi.mocked(openFilePicker).mockClear();
  useImportBatch.setState({ running: false });
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
});

describe('"Import data…" (⌘O) pre-flight guard', () => {
  it("runs chooseAndImport normally when nothing is importing", () => {
    findCmd("import").run();
    expect(chooseAndImport).toHaveBeenCalledOnce();
  });

  it("short-circuits with a toast, without opening any dialog, while an import runs", () => {
    useImportBatch.setState({ running: true });
    findCmd("import").run();
    expect(chooseAndImport).not.toHaveBeenCalled();
    expect(lastToast()).toBe(ALREADY_RUNNING_MSG);
  });
});

describe('"Import & append as one dataset…" pre-flight guard', () => {
  it("opens the file picker normally when nothing is importing", () => {
    findCmd("import-append").run();
    expect(openFilePicker).toHaveBeenCalledOnce();
  });

  it("short-circuits with a toast, without opening the picker, while an import runs", () => {
    useImportBatch.setState({ running: true });
    findCmd("import-append").run();
    expect(openFilePicker).not.toHaveBeenCalled();
    expect(lastToast()).toBe(ALREADY_RUNNING_MSG);
  });

  it("marks the batch running for the duration of importFilesAppended, and registers a pendingOps entry", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((r) => {
      resolve = r;
    });
    const importFilesAppended = vi.fn(() => pending);
    useApp.setState({ importFilesAppended });

    findCmd("import-append").run();
    const cb = vi.mocked(openFilePicker).mock.calls.at(-1)?.[0];
    if (!cb) throw new Error("openFilePicker was never called");
    const files = [new File(["a"], "a.dat"), new File(["b"], "b.dat")];
    cb(files);

    expect(isImportRunning()).toBe(true);
    expect(importFilesAppended).toHaveBeenCalledWith(files);
    expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["Importing 2 files to append…"]);
    // No cancel affordance for this path — see the module doc: the
    // underlying loop has no AbortController without touching useApp.ts.
    expect(usePendingOps.getState().ops[0].cancel).toBeUndefined();

    resolve();
    await pending;
    await vi.waitFor(() => expect(isImportRunning()).toBe(false));
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
  });

  it("clears the running guard even when importFilesAppended rejects", async () => {
    let reject!: (e: unknown) => void;
    const pending = new Promise<void>((_r, rj) => {
      reject = rj;
    });
    const importFilesAppended = vi.fn(() => pending);
    useApp.setState({ importFilesAppended });

    findCmd("import-append").run();
    const cb = vi.mocked(openFilePicker).mock.calls.at(-1)?.[0];
    if (!cb) throw new Error("openFilePicker was never called");
    cb([new File(["a"], "a.dat"), new File(["b"], "b.dat")]);
    expect(isImportRunning()).toBe(true);

    reject(new Error("boom"));
    await vi.waitFor(() => expect(isImportRunning()).toBe(false));
  });

  it("does nothing when the picker yields no files (no guard left stuck on)", () => {
    findCmd("import-append").run();
    const cb = vi.mocked(openFilePicker).mock.calls.at(-1)?.[0];
    if (!cb) throw new Error("openFilePicker was never called");
    cb([]);
    expect(isImportRunning()).toBe(false);
  });
});
