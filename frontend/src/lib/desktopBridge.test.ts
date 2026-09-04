// New P1.1 desktopBridge.ts surface (`openFiles`, `probe`, `openProject`,
// `readProject`, `saveProjectAs`, `saveProjectTo`). Mocks `window.pywebview`
// the same way lib/importEntry.test.ts mocks it for the pre-existing
// `pick_files` surface. The one rule every test here is really checking:
// `null` ("no usable bridge") and a well-formed cancel/empty result must
// never collapse into each other.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANCELLED,
  LOCK_LOST,
  openFiles,
  openProject,
  pickNativeFiles,
  pickRelinkDirectory,
  pickSaveDestination,
  probe,
  readProject,
  revokeRelinkDir,
  saveProjectAs,
  saveProjectTo,
  saveErrorStatus,
} from "./desktopBridge";

interface FakeApi {
  probe?: () => Promise<Record<string, unknown>>;
  pick_files?: (dir?: string, multiple?: boolean) => Promise<Record<string, unknown>>;
  pick_relink_directory?: (dir?: string) => Promise<Record<string, unknown>>;
  revoke_relink_dir?: () => Promise<Record<string, unknown>>;
  open_project_file?: (dir?: string) => Promise<Record<string, unknown>>;
  read_project_file?: (path: string) => Promise<Record<string, unknown>>;
  save_file_dialog?: (name?: string) => Promise<Record<string, unknown>>;
  write_project_file?: (path: string, content: string, lockToken?: string) => Promise<Record<string, unknown>>;
}

function setShell(api: FakeApi | null): void {
  const g = globalThis as { pywebview?: { api?: FakeApi } };
  if (api === null) delete g.pywebview;
  else g.pywebview = { api };
}

beforeEach(() => setShell(null));
afterEach(() => setShell(null));

describe("probe — no bridge", () => {
  it("reports unavailable", async () => {
    expect((await probe()).available).toBe(false);
  });
});

describe("probe — desktop shell", () => {
  it("narrows an unrecognized shell string to null rather than passing it through", async () => {
    setShell({ probe: async () => ({ shell: "something-new", canPickFiles: true }) });
    const p = await probe();
    expect(p.available).toBe(true);
    expect(p.shell).toBeNull();
  });

  it("passes through a recognized shell kind", async () => {
    setShell({ probe: async () => ({ shell: "pywebview" }) });
    expect((await probe()).shell).toBe("pywebview");
  });
});

describe("openFiles", () => {
  it("returns null with no bridge", async () => {
    expect(await openFiles()).toBeNull();
  });

  it("returns paths on success, forwarding directory/multiple", async () => {
    const pick = async (dir?: string, multiple?: boolean) => ({
      paths: multiple ? [`${dir}/a`, `${dir}/b`] : [`${dir}/a`],
    });
    setShell({ pick_files: pick });
    expect(await openFiles({ directory: "/d", multiple: false })).toEqual(["/d/a"]);
  });

  it("returns [] (not null) on cancel", async () => {
    setShell({ pick_files: async () => ({ paths: [] }) });
    expect(await openFiles()).toEqual([]);
  });

  it("pickNativeFiles delegates identically", async () => {
    setShell({ pick_files: async (dir) => ({ paths: [`${dir}/x`] }) });
    expect(await pickNativeFiles("/d")).toEqual(["/d/x"]);
  });
});

describe("openProject", () => {
  it("returns null with no bridge", async () => {
    expect(await openProject()).toBeNull();
  });

  it("returns {path, content} on success", async () => {
    setShell({ open_project_file: async () => ({ path: "/p/w.dwk", content: '{"v":1}' }) });
    expect(await openProject()).toEqual({ path: "/p/w.dwk", content: '{"v":1}' });
  });

  it("returns CANCELLED (not null) when the dialog reports no path", async () => {
    setShell({ open_project_file: async () => ({ path: null }) });
    expect(await openProject()).toBe(CANCELLED);
  });

  it("returns CANCELLED for a well-formed backend error (no window attached)", async () => {
    setShell({ open_project_file: async () => ({ path: null, error: "no window attached" }) });
    expect(await openProject()).toBe(CANCELLED);
  });

  it("returns null when a path was picked but the read failed", async () => {
    setShell({ open_project_file: async () => ({ path: "/p/w.dwk", error: "permission denied" }) });
    expect(await openProject()).toBeNull();
  });

  it("returns null when the bridge throws", async () => {
    setShell({
      open_project_file: async () => {
        throw new Error("boom");
      },
    });
    expect(await openProject()).toBeNull();
  });

  it("returns null when the shell exposes no open_project_file at all", async () => {
    setShell({});
    expect(await openProject()).toBeNull();
  });
});

describe("readProject", () => {
  it("returns null with no bridge", async () => {
    expect(await readProject("/p/w.dwk")).toBeNull();
  });

  it("returns {path, content} on success", async () => {
    setShell({ read_project_file: async (p) => ({ path: p, content: "hi" }) });
    expect(await readProject("/p/w.dwk")).toEqual({ path: "/p/w.dwk", content: "hi" });
  });

  it("returns null when the path was never consented", async () => {
    setShell({ read_project_file: async () => ({ path: null, error: "not consented" }) });
    expect(await readProject("/p/w.dwk")).toBeNull();
  });
});

// P2 (adversarial review, 2026-08-19): dialog-only half of the old combined
// `saveProjectAs`, split out so a caller (store/workspaceIO.ts's
// `runSaveWorkspaceToFile`) can insert a lock check between the pick and the
// write. Same null/CANCELLED semantics as every other dialog method here.
describe("pickSaveDestination", () => {
  it("returns null with no bridge", async () => {
    expect(await pickSaveDestination("w.dwk")).toBeNull();
  });

  it("returns the picked path, without writing anything", async () => {
    let wrote = false;
    setShell({
      save_file_dialog: async () => ({ path: "/p/w.dwk" }),
      write_project_file: async () => {
        wrote = true;
        return { ok: true };
      },
    });
    expect(await pickSaveDestination("w.dwk")).toBe("/p/w.dwk");
    expect(wrote).toBe(false);
  });

  it("returns CANCELLED (not null) when the dialog is cancelled", async () => {
    setShell({ save_file_dialog: async () => ({ path: null }), write_project_file: async () => ({ ok: true }) });
    expect(await pickSaveDestination("w.dwk")).toBe(CANCELLED);
  });

  it("returns null when the shell exposes only one of the two required methods", async () => {
    setShell({ save_file_dialog: async () => ({ path: "/p/w.dwk" }) });
    expect(await pickSaveDestination("w.dwk")).toBeNull();
  });

  it("returns the dialog's own refusal reason — NOT a silent CANCELLED — when it reports an error with no path (P1.2 box 4)", async () => {
    setShell({
      save_file_dialog: async () => ({
        path: null,
        error: "refusing to save — that path is a data source of the open project",
      }),
      write_project_file: async () => ({ ok: true }),
    });
    expect(await pickSaveDestination("w.dwk")).toEqual({
      refused: "refusing to save — that path is a data source of the open project",
    });
  });
});

describe("saveProjectAs", () => {
  it("returns null with no bridge", async () => {
    expect(await saveProjectAs("w.dwk", "{}")).toBeNull();
  });

  it("returns {path} after a dialog pick + successful write", async () => {
    const write = async (path: string) => ({ ok: true, path });
    setShell({ save_file_dialog: async () => ({ path: "/p/w.dwk" }), write_project_file: write });
    expect(await saveProjectAs("w.dwk", "{}")).toEqual({ path: "/p/w.dwk" });
  });

  it("returns CANCELLED (not null) when the save dialog is cancelled — no write is attempted", async () => {
    let wrote = false;
    setShell({
      save_file_dialog: async () => ({ path: null }),
      write_project_file: async () => {
        wrote = true;
        return { ok: true };
      },
    });
    expect(await saveProjectAs("w.dwk", "{}")).toBe(CANCELLED);
    expect(wrote).toBe(false);
  });

  it("returns null when the write fails after a real pick", async () => {
    setShell({
      save_file_dialog: async () => ({ path: "/p/w.dwk" }),
      write_project_file: async () => ({ ok: false, error: "disk full" }),
    });
    expect(await saveProjectAs("w.dwk", "{}")).toBeNull();
  });

  it("surfaces a dialog refusal and a write refusal as {refused} — never as a cancel or a plain failure (self-review on #291)", async () => {
    setShell({
      save_file_dialog: async () => ({ path: null, error: "refusing to save — that path is a data source of the open project" }),
      write_project_file: async () => ({ ok: true }),
    });
    expect(await saveProjectAs("w.dwk", "{}")).toEqual({
      refused: "refusing to save — that path is a data source of the open project",
    });
    setShell({
      save_file_dialog: async () => ({ path: "/p/raw.csv" }),
      write_project_file: async () => ({ ok: false, error: "refusing to write — that path is a data source of this workspace" }),
    });
    expect(await saveProjectAs("w.dwk", "{}")).toEqual({
      refused: "refusing to write — that path is a data source of this workspace",
    });
  });

  it("returns null when the shell exposes only one of the two required methods", async () => {
    setShell({ save_file_dialog: async () => ({ path: "/p/w.dwk" }) });
    expect(await saveProjectAs("w.dwk", "{}")).toBeNull();
  });
});

describe("saveProjectTo", () => {
  it("returns null with no bridge", async () => {
    expect(await saveProjectTo("/p/w.dwk", "{}")).toBeNull();
  });

  it("writes directly to a known path — no dialog involved", async () => {
    const write = async (path: string) => ({ ok: true, path });
    setShell({ write_project_file: write });
    expect(await saveProjectTo("/p/w.dwk", "{}")).toEqual({ path: "/p/w.dwk" });
  });

  it("returns null when the write is refused (e.g. an unconsented path)", async () => {
    setShell({ write_project_file: async () => ({ ok: false, error: "not consented" }) });
    expect(await saveProjectTo("/p/w.dwk", "{}")).toBeNull();
  });

  it("returns {refused} when the backend declines the destination as a declared source (self-review on #291)", async () => {
    setShell({
      write_project_file: async () => ({ ok: false, error: "refusing to write — that path is a data source of this workspace" }),
    });
    expect(await saveProjectTo("/p/raw.csv", "{}")).toEqual({
      refused: "refusing to write — that path is a data source of this workspace",
    });
    expect(saveErrorStatus("refusing to write — that path is a data source of this workspace")).toBe(
      "save refused — that path is a data source of this workspace",
    );
    expect(saveErrorStatus("no window attached")).toBe("save failed — no window attached");
  });

  // I2 (P0-3/P1-1): the lock-token binding — LOCK_LOST must be
  // distinguishable from a generic write failure (`null`), since the
  // caller's response differs (drop to read-only, no download fallback).
  describe("I2 lock-token binding", () => {
    it("forwards the token as the write call's third argument", async () => {
      const write = vi.fn(async (path: string) => ({ ok: true, path }));
      setShell({ write_project_file: write });
      await saveProjectTo("/p/w.dwk", "{}", "the-token");
      expect(write).toHaveBeenCalledWith("/p/w.dwk", "{}", "the-token");
    });

    it("passes an empty string when no token is supplied — pre-I2 behavior preserved", async () => {
      const write = vi.fn(async (path: string) => ({ ok: true, path }));
      setShell({ write_project_file: write });
      await saveProjectTo("/p/w.dwk", "{}");
      expect(write).toHaveBeenCalledWith("/p/w.dwk", "{}", "");
    });

    it('returns LOCK_LOST (not null) when the backend reports "lock lost"', async () => {
      setShell({ write_project_file: async () => ({ ok: false, error: "lock lost" }) });
      expect(await saveProjectTo("/p/w.dwk", "{}", "stale-token")).toBe(LOCK_LOST);
    });

    it("a generic write failure still returns null, not LOCK_LOST", async () => {
      setShell({ write_project_file: async () => ({ ok: false, error: "disk full" }) });
      expect(await saveProjectTo("/p/w.dwk", "{}", "some-token")).toBeNull();
    });
  });
});

// C1 (relink consent): pickRelinkDirectory is the ONE folder dialog that
// mints a grant — pickNativeDirectory above stays a plain path-selector.
describe("pickRelinkDirectory", () => {
  it("returns null with no bridge — never a false grant", async () => {
    expect(await pickRelinkDirectory()).toBeNull();
  });

  it("returns the granted path on success, forwarding the starting directory", async () => {
    const pick = vi.fn(async (dir?: string) => ({ path: `${dir}/picked` }));
    setShell({ pick_relink_directory: pick });
    expect(await pickRelinkDirectory("/start")).toBe("/start/picked");
    expect(pick).toHaveBeenCalledWith("/start");
  });

  it("returns CANCELLED (not null) when the user backs out — session cancellation", async () => {
    setShell({ pick_relink_directory: async () => ({ path: null }) });
    expect(await pickRelinkDirectory()).toBe(CANCELLED);
  });

  // Review F2: a backend {path:null, error} is a REAL post-pick failure
  // (folder vanished between pick and grant, dialog error) — the caller
  // must be able to say so, never treat it as a silent cancel.
  it("returns the error (not CANCELLED) on a backend {path:null, error} response", async () => {
    setShell({
      pick_relink_directory: async () => ({ path: null, error: "selected path is not a readable directory" }),
    });
    expect(await pickRelinkDirectory()).toEqual({ error: "selected path is not a readable directory" });
  });

  it("returns the error (not null) when the bridge call itself throws — a bridge exists, it failed", async () => {
    setShell({
      pick_relink_directory: async () => {
        throw new Error("boom");
      },
    });
    expect(await pickRelinkDirectory()).toEqual({ error: "Error: boom" });
  });
});

describe("revokeRelinkDir", () => {
  it("is a silent no-op with no bridge", async () => {
    await expect(revokeRelinkDir()).resolves.toBeUndefined();
  });

  it("calls the bridge method when present", async () => {
    const revoke = vi.fn(async () => ({ ok: true }));
    setShell({ revoke_relink_dir: revoke });
    await revokeRelinkDir();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("swallows a bridge error — best-effort, nothing for a caller to act on", async () => {
    setShell({
      revoke_relink_dir: async () => {
        throw new Error("boom");
      },
    });
    await expect(revokeRelinkDir()).resolves.toBeUndefined();
  });
});

// PR I2's filesystem project lock wire calls (acquireProjectLock etc.) —
// see lib/desktopLockBridge.test.ts, split out alongside the module itself.
