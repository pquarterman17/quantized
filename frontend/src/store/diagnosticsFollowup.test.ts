// Follow-up round on #267. Four defects, each asserted on the observable
// behaviour rather than on the shape of the fix.

import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct, Dataset } from "../lib/types";
import { collectDiagnostics } from "./diagnostics";
import { useApp } from "./useApp";

const data: DataStruct = {
  time: [1, 2, 3],
  values: [[1], [2], [3]],
  labels: ["A"],
  units: [""],
  metadata: {},
};

beforeEach(() => {
  useApp.setState({ datasets: [{ id: "d1", name: "s", data } as Dataset], folders: [], workbooks: [] });
  try {
    localStorage.clear();
  } catch {
    /* private mode */
  }
});

describe("storage sizes are actually bytes", () => {
  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    // "µ°Ω" is 3 characters but 6 UTF-8 bytes — and these are exactly the
    // characters this app's stored content is full of (units, Greek symbols
    // in saved calculator inputs and plot labels). Reporting `.length` under
    // a "bytes" label understates a quota problem by up to 3x, in the one
    // report whose entire value is being accurate.
    // A real allowlisted slot: a synthetic key is aggregated into
    // `otherStorage` now (lib/storageKeys.ts) and never appears by name.
    localStorage.setItem("qz.prefs", "µ°Ω");
    const slot = collectDiagnostics().storage.find((e) => e.key === "qz.prefs");
    expect(slot, "the slot must be reported at all").toBeDefined();
    expect(slot!.bytes, "3 chars but 6 UTF-8 bytes").toBe(6);
  });

  it("still reports plain ASCII slots at their obvious size", () => {
    localStorage.setItem("qz.recent", "abcd");
    const slot = collectDiagnostics().storage.find((e) => e.key === "qz.recent");
    expect(slot!.bytes).toBe(4);
  });

  it("counts UTF-8 bytes in the unrecognised-slot aggregate too", () => {
    // The aggregate is a separate code path from the named list, and it is
    // the one that will carry a future feature's slots — the multi-byte
    // undercount would land there first, unnoticed.
    localStorage.setItem("qz.someFutureSlot", "µ°Ω");
    const other = collectDiagnostics().otherStorage;
    expect(other.slots).toBe(1);
    expect(other.bytes, "3 chars but 6 UTF-8 bytes").toBe(6);
  });
});

describe("desktop detection uses the shared bridge helper", () => {
  it("reports browser when window.pywebview exists but its api is not injected yet", () => {
    // pywebview creates `window.pywebview` and injects `.api` afterwards, so
    // `"pywebview" in window` is true during a window in which no native call
    // can actually be made. lib/desktopBridge.hasDesktopShell() checks
    // `window.pywebview?.api`, which is the condition that matters — and is
    // also what a future Tauri shell would satisfy.
    (globalThis as { pywebview?: unknown }).pywebview = {};
    try {
      expect(collectDiagnostics().platform.desktop).toBe(false);
    } finally {
      delete (globalThis as { pywebview?: unknown }).pywebview;
    }
  });

  it("reports desktop once the api is present", () => {
    (globalThis as { pywebview?: unknown }).pywebview = { api: {} };
    try {
      expect(collectDiagnostics().platform.desktop).toBe(true);
    } finally {
      delete (globalThis as { pywebview?: unknown }).pywebview;
    }
  });
});
