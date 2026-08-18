// New P1.1 desktopBridge.ts surface (`openFiles`, `probe`, `openProject`,
// `readProject`, `saveProjectAs`, `saveProjectTo`). Mocks `window.pywebview`
// the same way lib/importEntry.test.ts mocks it for the pre-existing
// `pick_files` surface. The one rule every test here is really checking:
// `null` ("no usable bridge") and a well-formed cancel/empty result must
// never collapse into each other.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CANCELLED,
  openFiles,
  openProject,
  pickNativeFiles,
  probe,
  readProject,
  saveProjectAs,
  saveProjectTo,
} from "./desktopBridge";

interface FakeApi {
  probe?: () => Promise<Record<string, unknown>>;
  pick_files?: (dir?: string, multiple?: boolean) => Promise<Record<string, unknown>>;
  open_project_file?: (dir?: string) => Promise<Record<string, unknown>>;
  read_project_file?: (path: string) => Promise<Record<string, unknown>>;
  save_file_dialog?: (name?: string) => Promise<Record<string, unknown>>;
  write_project_file?: (path: string, content: string) => Promise<Record<string, unknown>>;
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
});
