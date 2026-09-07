// runPackProject (P1.7 PR 6) — no-shell toast/no-op, and the open-panel /
// preview / idle-close sequencing on a real shell. The pack pipeline itself
// (previewPackProject's own state machine) is store/packProject.ts's job;
// this only checks the command wires the panel flag and the store call
// together correctly.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { hasDesktopShell } from "../lib/desktopBridge";
import { usePackProject } from "../store/packProject";
import { usePackProjectPanel } from "../store/packProjectPanel";
import { useToasts } from "../store/toasts";
import { runPackProject } from "./packProjectCommands";

vi.mock("../lib/desktopBridge", () => ({ hasDesktopShell: vi.fn() }));

function lastToast(): string | undefined {
  return useToasts.getState().toasts.at(-1)?.msg;
}

beforeEach(() => {
  vi.mocked(hasDesktopShell).mockReturnValue(false);
  usePackProjectPanel.setState({ open: false });
  usePackProject.setState({
    phase: "idle",
    preview: null,
    previewPackProject: vi.fn().mockResolvedValue(undefined),
  });
  useToasts.setState({ toasts: [] });
});

describe("runPackProject", () => {
  it("without a desktop shell, toasts and never opens the panel or calls previewPackProject", async () => {
    await runPackProject();
    expect(lastToast()).toBe("Pack Project needs the desktop app");
    expect(usePackProjectPanel.getState().open).toBe(false);
    expect(usePackProject.getState().previewPackProject).not.toHaveBeenCalled();
  });

  it("with a shell, opens the panel BEFORE calling previewPackProject", async () => {
    vi.mocked(hasDesktopShell).mockReturnValue(true);
    let openWhenPreviewCalled: boolean | undefined;
    usePackProject.setState({
      previewPackProject: vi.fn().mockImplementation(async () => {
        openWhenPreviewCalled = usePackProjectPanel.getState().open;
      }),
    });
    await runPackProject();
    expect(openWhenPreviewCalled).toBe(true);
  });

  it("with a shell, closes the panel when the phase is idle after the preview resolves", async () => {
    vi.mocked(hasDesktopShell).mockReturnValue(true);
    usePackProject.setState({
      previewPackProject: vi.fn().mockImplementation(async () => {
        usePackProject.setState({ phase: "idle" });
      }),
    });
    await runPackProject();
    expect(usePackProjectPanel.getState().open).toBe(false);
  });

  it("with a shell, leaves the panel open when the phase is awaiting_confirmation after the preview resolves", async () => {
    vi.mocked(hasDesktopShell).mockReturnValue(true);
    usePackProject.setState({
      previewPackProject: vi.fn().mockImplementation(async () => {
        usePackProject.setState({ phase: "awaiting_confirmation" });
      }),
    });
    await runPackProject();
    expect(usePackProjectPanel.getState().open).toBe(true);
  });
});
