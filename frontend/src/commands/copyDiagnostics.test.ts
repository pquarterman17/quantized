// The command path from #267's follow-up round.
//
// Two defects, both on the failure path — which for THIS feature is the path
// that matters most. A diagnostics bundle exists to be sent to someone when
// things are already broken, so the user most likely to need it is the one in
// the degraded environment: an insecure context, a browser without the async
// clipboard, a stale chunk after a deploy.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAppActions } from "../appCommands";
import { useApp } from "../store/useApp";

vi.mock("../lib/clipboard", () => ({ copyText: vi.fn() }));
vi.mock("../lib/download", () => ({ saveBlob: vi.fn(), filenameFromDisposition: vi.fn() }));

const { copyText } = await import("../lib/clipboard");
const { saveBlob } = await import("../lib/download");

function copyDiagnostics() {
  const a = buildAppActions(useApp.getState).find((x) => x.id === "copy-diagnostics");
  expect(a, "the copy-diagnostics command must exist").toBeDefined();
  return a!;
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [], folders: [], workbooks: [], status: "" });
});

describe("copy diagnostics — failure paths", () => {
  it("falls back to a file download when the clipboard is unavailable", async () => {
    // copyText resolves FALSE in an insecure context or a browser without the
    // async clipboard API — it does not throw. Before this, that produced
    // "could not copy" and nothing else: the bundle was generated and thrown
    // away, leaving the user who most needs it with no way to obtain it.
    vi.mocked(copyText).mockResolvedValue(false);
    copyDiagnostics().run();
    // Wait on resolved STATE, not on the mock call — architecture.test.ts's
    // weak-wait ratchet fails the build for the latter, and it is right to:
    // the status is the thing the user actually observes.
    await vi.waitFor(() => expect(useApp.getState().status).not.toBe(""));
    expect(saveBlob).toHaveBeenCalled();
    const [blob, filename] = vi.mocked(saveBlob).mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(filename).toMatch(/diagnostics.*\.txt$/);
    expect(useApp.getState().status).toMatch(/saved|download/i);
  });

  it("does not download when the clipboard worked", async () => {
    vi.mocked(copyText).mockResolvedValue(true);
    copyDiagnostics().run();
    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/copied/i));
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("reports a failure instead of raising an unhandled rejection", async () => {
    // The detached async body had no outer catch, so a rejected dynamic
    // import — a chunk that 404s after a deploy, or an offline desktop
    // shell — became an unhandled rejection and the user saw nothing at all.
    vi.mocked(copyText).mockRejectedValue(new Error("boom"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      copyDiagnostics().run();
      await vi.waitFor(() => expect(useApp.getState().status).toMatch(/could not|failed/i));
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled, "must not leak an unhandled rejection").not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
