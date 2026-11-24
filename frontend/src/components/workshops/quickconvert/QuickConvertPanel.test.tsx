// The in-app Quick Convert: opened by its File-menu command, closed by Esc and the
// title-bar close, and the standalone page mounts only the converter.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAppActions } from "../../../appCommands";
import { isConvertView } from "../../../lib/viewMode";
import { useApp } from "../../../store/useApp";
import { useQuickConvertPanel } from "../../../store/quickConvertPanel";
import QuickConvertPage from "./QuickConvertPage";
import { QuickConvertPanel } from "./QuickConvertPanel";

vi.mock("../../../lib/api/convertQuick", () => ({
  convertConfig: vi.fn().mockResolvedValue({ formats: [], prefill: ["/d/a.dat"], home: "/h" }),
  convertPreview: vi.fn().mockResolvedValue({ out_dir_status: "same", files: [] }),
}));

beforeEach(() => {
  useQuickConvertPanel.setState({ open: false });
  useApp.setState({ toolWindowLayout: {} });
});

describe("Quick Convert panel", () => {
  it("the File-menu command opens it", async () => {
    const cmd = buildAppActions(useApp.getState).find((a) => a.id === "quick-convert");
    expect(cmd?.label).toBe("Quick convert…");
    expect(cmd?.group).toBe("File");
    void cmd?.run();
    await waitFor(() => expect(useQuickConvertPanel.getState().open).toBe(true));
  });

  it("closes from the title bar", async () => {
    useQuickConvertPanel.setState({ open: true });
    render(<QuickConvertPanel />);
    expect(await screen.findByText("Output folder")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(useQuickConvertPanel.getState().open).toBe(false);
  });

  it("closes on Esc from inside the window", async () => {
    useQuickConvertPanel.setState({ open: true });
    render(<QuickConvertPanel />);
    (await screen.findByRole("button", { name: "Add files…" })).focus();
    await userEvent.keyboard("{Escape}"); // from a typing field Esc belongs to the field, by design
    await waitFor(() => expect(useQuickConvertPanel.getState().open).toBe(false));
  });
});

describe("standalone page", () => {
  it("renders the converter prefilled with the launcher's files and nothing of the app", async () => {
    document.title = "x";
    const { container } = render(<QuickConvertPage />);
    expect(screen.getByRole("heading", { name: "Quick convert" })).toBeTruthy();
    expect(await screen.findByText("a.dat")).toBeTruthy();
    expect(document.title).toBe("Quick convert");
    expect(container.querySelector(".qzk-library, .qzk-stage, .qzk-menubar")).toBeNull();
    // UX11-C N11: a way back to the full app.
    expect(screen.getByRole("link", { name: /back to quantized/i })).toHaveAttribute("href", "/");
  });

  it("is selected by the /convert path only", () => {
    const at = (path: string): boolean => {
      window.history.pushState(null, "", path);
      return isConvertView();
    };
    expect([at("/convert"), at("/convert/"), at("/convert?token=x"), at("/"), at("/?view=calc"), at("/converter")]).toEqual([
      true, true, true, false, false, false,
    ]);
    window.history.pushState(null, "", "/");
  });
});
