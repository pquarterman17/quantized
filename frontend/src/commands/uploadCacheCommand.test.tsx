// Preferences ▸ Origin upload cache ▸ Clear… — the UI way to delete the
// on-disk copies of uploaded Origin projects (review item: privacy). Pins the
// confirmation (it names the folder, count and size), the cancel path, the
// outcome messages, the Preferences control and that it all stays lazy.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askConfirm } from "../components/overlays/ConfirmDialog";
import { deleteJSON, getJSON } from "../lib/api/http";
import { originFidelityLabel } from "../lib/originFidelity";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import { UploadCachePref } from "../components/overlays/UploadCachePref";
import { formatBytes, runClearUploadCache } from "./uploadCacheCommand";

vi.mock("../lib/api/http", async (orig) => ({
  ...(await orig<typeof import("../lib/api/http")>()),
  getJSON: vi.fn(),
  deleteJSON: vi.fn(),
}));
vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const info = { path: "/home/u/.cache/quantized/origin-uploads", entries: 2, bytes: 3_400_000, max_bytes: 2 ** 31 };
const toasts = () => useToasts.getState().toasts.map((t) => [t.msg, t.kind]);

beforeEach(() => {
  vi.mocked(getJSON).mockReset().mockResolvedValue(info);
  vi.mocked(deleteJSON).mockReset().mockResolvedValue({ removed: 2, bytes: 3_400_000, kept: 0 });
  vi.mocked(askConfirm).mockReset().mockResolvedValue(true);
  useToasts.setState({ toasts: [] });
  useApp.setState({ status: "" });
});

describe("runClearUploadCache", () => {
  it("asks first, naming the folder, the count and the size, then deletes", async () => {
    await runClearUploadCache(useApp.getState);

    const [title, body, label, danger] = vi.mocked(askConfirm).mock.calls[0];
    expect(title).toBe("Clear the Origin upload cache?");
    expect(body).toContain("2 Origin project files (3.4 MB)");
    expect(body).toContain("/home/u/.cache/quantized/origin-uploads");
    expect(body).toContain("will need a Re-import");
    expect([label, danger]).toEqual(["Clear cache", true]);
    expect(deleteJSON).toHaveBeenCalledWith("/api/parsers/upload-cache");
    expect(toasts()).toEqual([
      ["cleared the Origin upload cache — removed 2 Origin project files (3.4 MB)", "ok"],
    ]);
  });

  it("deletes nothing when the user cancels", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    await runClearUploadCache(useApp.getState);
    expect(deleteJSON).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });

  it("says so, without asking, when the cache is already empty", async () => {
    vi.mocked(getJSON).mockResolvedValue({ ...info, entries: 0, bytes: 0 });
    await runClearUploadCache(useApp.getState);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(deleteJSON).not.toHaveBeenCalled();
    expect(toasts()[0][0]).toContain("already empty (/home/u/.cache/quantized/origin-uploads)");
  });

  it("reports uploads an import is still reading as kept", async () => {
    vi.mocked(deleteJSON).mockResolvedValue({ removed: 1, bytes: 1_000_000, kept: 1 });
    await runClearUploadCache(useApp.getState);
    expect(toasts()[0][0]).toMatch(/removed 1 Origin project file \(1\.0 MB\); 1 still being imported was kept$/);
  });

  it("reports a failure as a failure", async () => {
    vi.mocked(deleteJSON).mockRejectedValue(new Error("permission denied"));
    await runClearUploadCache(useApp.getState);
    expect(toasts()).toEqual([
      ["couldn't clear the Origin upload cache: permission denied — nothing was reported removed", "danger"],
    ]);
  });

  it("formats sizes so a small file never reads as zero", () => {
    expect([formatBytes(20_000), formatBytes(1_500_000), formatBytes(123_000_000), formatBytes(2_100_000_000)]).toEqual([
      "0.02 MB", "1.5 MB", "123 MB", "2.10 GB",
    ]);
  });
});

describe("Preferences ▸ Origin upload cache", () => {
  it("offers one uniquely named Clear control that runs the confirmed clear", async () => {
    render(<UploadCachePref />);
    const btn = screen.getByRole("button", { name: "Clear Origin upload cache" });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(btn);
    await vi.waitFor(() => expect(useApp.getState().status).toContain("cleared the Origin upload cache"));
    expect(askConfirm).toHaveBeenCalledTimes(1);
  });

  it("is mounted in the Preferences dialog's Interaction tab", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, "../components/overlays/PreferencesDialog.tsx"), "utf-8");
    expect(src).toMatch(/tab === "Interaction"[\s\S]*<UploadCachePref \/>[\s\S]*tab === "Numbers"/);
  });

  it("stays out of the eager bundle: only the lazy Preferences dialog imports it", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const eager of ["fileCommands.ts", "../AppOverlays.tsx", "../App.tsx"]) {
      expect(readFileSync(resolve(here, eager), "utf-8")).not.toMatch(/uploadCacheCommand|UploadCachePref/);
    }
    expect(readFileSync(resolve(here, "../AppOverlays.tsx"), "utf-8")).toMatch(
      /lazyPanel\(\(\) => import\("\.\/components\/overlays\/PreferencesDialog"\)/,
    );
  });
});

describe("user-facing Origin wording that must not be shortened", () => {
  it("the truncated-file omission says what is missing", () => {
    expect(originFidelityLabel("file_truncated")).toBe(
      "file appears incomplete or truncated — books and columns past the cut are missing",
    );
  });
});
