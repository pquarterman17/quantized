// "Pack Project" wire calls (P1.7 PR 4) — quantized/desktop_bridge_pack.py's
// `DesktopPackBridge` methods. Same FakeApi/`setShell` pattern as
// desktopBridge.test.ts / desktopLockBridge.test.ts: `null` = no usable
// bridge, a well-formed `{ok: false, error}` = a named refusal.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  packCancel,
  packPreview,
  packReset,
  packStart,
  packStatus,
  pickPackDestination,
  type PackStatus,
} from "./desktopPackBridge";

interface FakeApi {
  pick_pack_destination?: (dir?: string) => Promise<Record<string, unknown>>;
  pack_preview?: (content: string, projectName: string, destinationParent: string) => Promise<Record<string, unknown>>;
  pack_start?: (token: string, content: string) => Promise<Record<string, unknown>>;
  pack_status?: () => Promise<Record<string, unknown>>;
  pack_cancel?: () => Promise<Record<string, unknown>>;
  pack_reset?: () => Promise<Record<string, unknown>>;
}

function setShell(api: FakeApi | null): void {
  const g = globalThis as { pywebview?: { api?: FakeApi } };
  if (api === null) delete g.pywebview;
  else g.pywebview = { api };
}

beforeEach(() => setShell(null));
afterEach(() => setShell(null));

// -- pickPackDestination --------------------------------------------------

describe("pickPackDestination", () => {
  it("returns null with no bridge", async () => {
    expect(await pickPackDestination()).toBeNull();
  });

  it("returns the chosen path", async () => {
    setShell({ pick_pack_destination: async () => ({ path: "/data/dest" }) });
    expect(await pickPackDestination()).toBe("/data/dest");
  });

  it("returns null on cancel (well-formed {path: null})", async () => {
    setShell({ pick_pack_destination: async () => ({ path: null }) });
    expect(await pickPackDestination()).toBeNull();
  });

  it("returns null when the bridge throws", async () => {
    setShell({
      pick_pack_destination: async () => {
        throw new Error("no display");
      },
    });
    expect(await pickPackDestination()).toBeNull();
  });
});

// -- packPreview ------------------------------------------------------------

const okManifest = {
  format: "quantized-portable-bundle",
  manifest_version: 1,
  dry_run: true,
  project: {
    name: "proj",
    project_file: "proj.dwk",
    workspace_format: "quantized-workspace",
    workspace_version: 4,
    renamed_from: null,
  },
  layout: { manifest_file: "quantized-bundle.json", sources_dir: "sources" },
  sources: [],
  datasets: [],
  warnings: [],
  summary: { datasets: 0, sources: 0, packable: 0, blocked: 0, shared: 0, total_bytes: 0, warnings: 0 },
};

describe("packPreview", () => {
  it("returns null with no bridge", async () => {
    expect(await packPreview("{}", "proj", "/dest")).toBeNull();
  });

  it("parses a successful preview", async () => {
    setShell({
      pack_preview: async () => ({
        ok: true,
        token: "tok123",
        manifest: okManifest,
        destination: { bundle_dir: "/dest/proj", exists: false },
        warnings: [],
        blockers: [],
      }),
    });
    const out = await packPreview("{}", "proj", "/dest");
    expect(out).not.toBeNull();
    if (out === null || !out.ok) throw new Error("expected ok");
    expect(out.token).toBe("tok123");
    expect(out.manifest.summary.packable).toBe(0);
  });

  it("parses a refusal", async () => {
    setShell({
      pack_preview: async () => ({ ok: false, error: { code: "destination_not_consented" } }),
    });
    const out = await packPreview("{}", "proj", "/dest");
    expect(out).toEqual({ ok: false, error: { code: "destination_not_consented" } });
  });

  it("returns null when the bridge throws", async () => {
    setShell({
      pack_preview: async () => {
        throw new Error("boom");
      },
    });
    expect(await packPreview("{}", "proj", "/dest")).toBeNull();
  });

  it("returns null on a malformed response (no `ok` field)", async () => {
    setShell({ pack_preview: async () => ({ token: "x" }) });
    expect(await packPreview("{}", "proj", "/dest")).toBeNull();
  });
});

// -- packStart --------------------------------------------------------------

describe("packStart", () => {
  it("returns null with no bridge", async () => {
    expect(await packStart("tok", "{}")).toBeNull();
  });

  it("parses a successful start", async () => {
    setShell({ pack_start: async () => ({ ok: true }) });
    expect(await packStart("tok", "{}")).toEqual({ ok: true });
  });

  it("parses a rejection", async () => {
    setShell({ pack_start: async () => ({ ok: false, error: { code: "stale_preview" } }) });
    expect(await packStart("tok", "{}")).toEqual({ ok: false, error: { code: "stale_preview" } });
  });
});

// -- packStatus ---------------------------------------------------------

const statusOk: PackStatus = {
  phase: "packing",
  progress: {
    current_file: "sources/a.csv",
    completed_files: 1,
    total_files: 2,
    bytes_copied: 50,
    bytes_total: 100,
    stage: "copying",
  },
  warnings: [],
  errors: [],
  result: null,
  cleanup_ok: null,
  originals_modified: false,
};

describe("packStatus", () => {
  it("returns null with no bridge", async () => {
    expect(await packStatus()).toBeNull();
  });

  it("parses a real status", async () => {
    setShell({ pack_status: async () => statusOk as unknown as Record<string, unknown> });
    const out = await packStatus();
    expect(out).toEqual(statusOk);
  });

  it("returns null on a malformed response (no `phase` field)", async () => {
    setShell({ pack_status: async () => ({ progress: {} }) });
    expect(await packStatus()).toBeNull();
  });

  it("returns null when the bridge throws", async () => {
    setShell({
      pack_status: async () => {
        throw new Error("boom");
      },
    });
    expect(await packStatus()).toBeNull();
  });
});

// -- packCancel / packReset -------------------------------------------------

describe("packCancel", () => {
  it("returns null with no bridge", async () => {
    expect(await packCancel()).toBeNull();
  });

  it("parses the outcome", async () => {
    setShell({ pack_cancel: async () => ({ ok: true, phase: "cancelling" }) });
    expect(await packCancel()).toEqual({ ok: true, phase: "cancelling" });
  });
});

describe("packReset", () => {
  it("returns null with no bridge", async () => {
    expect(await packReset()).toBeNull();
  });

  it("parses a rejection while packing", async () => {
    setShell({ pack_reset: async () => ({ ok: false, error: { code: "already_running" } }) });
    expect(await packReset()).toEqual({ ok: false, error: { code: "already_running" } });
  });

  it("parses success", async () => {
    setShell({ pack_reset: async () => ({ ok: true }) });
    expect(await packReset()).toEqual({ ok: true });
  });
});
