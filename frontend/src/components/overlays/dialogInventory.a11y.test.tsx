// The dialog basics, audited with ONE helper (`test/dialogA11y.ts`) across
// the most-used dialogs: the export prompts (`askParams` — Export figure /
// Export page / Export map / Page setup all render ParamDialog), Confirm,
// Preferences, Help, Shortcuts, the annotation-text prompt, recovery, the
// text-format help, the command palette and the shared tool-window host
// (Import wizard, Pack Project, SQLite query and every workshop render it).
// The store-driven dialogs are in `dialogInventoryStores.a11y.test.tsx`;
// `dialogInventory.ratchet.test.ts` fails a new dialog that is in neither.

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import AnnotationTextDialog from "./AnnotationTextDialog";
import CommandPalette from "./CommandPalette";
import ConfirmDialog from "./ConfirmDialog";
import HelpDialog from "./HelpDialog";
import ParamDialog, { askParams } from "./ParamDialog";
import PreferencesDialog from "./PreferencesDialog";
import RecoveryChoiceDialog from "./RecoveryChoiceDialog";
import ShortcutsDialog from "./ShortcutsDialog";
import TextFormatHelp from "./TextFormatHelp";
import ToolWindow from "./ToolWindow";
import { auditDialog } from "../../test/dialogA11y";
import { parseWorkspace, WORKSPACE_FORMAT } from "../../lib/workspace";
import { askAnnotationText, useAnnotationTextDialog } from "../../store/annotationTextDialog";
import { askConfirm, cancelPendingConfirm } from "../../store/confirmDialog";
import { useHelp } from "../../store/help";
import { cancelPendingParams } from "../../store/paramDialog";
import { useRecoveryChoice } from "../../store/recoveryChoice";
import { useApp } from "../../store/useApp";

const dialog = () => screen.queryByRole("dialog");

/** Render `ui` next to a focused opener, open it, and wait for the dialog. */
async function openWith(ui: ReactNode, open: () => void): Promise<HTMLElement> {
  render(
    <>
      <button type="button">opener</button>
      {ui}
    </>,
  );
  const opener = screen.getByRole("button", { name: "opener" });
  opener.focus();
  act(open);
  await screen.findByRole("dialog");
  return opener;
}

beforeEach(() => {
  useApp.setState({ prefsOpen: false, shortcutsOpen: false, textFormatHelpOpen: false, cmdkOpen: false });
  useHelp.setState({ open: false });
  useRecoveryChoice.setState({ pending: null });
  useAnnotationTextDialog.setState({ title: null, initial: "", resolve: null });
});
afterEach(() => {
  cancelPendingConfirm();
  cancelPendingParams();
});

describe("dialog basics — the most-used dialogs", () => {
  it("Export figure (ParamDialog with every field type)", async () => {
    const user = userEvent.setup();
    const opener = await openWith(<ParamDialog />, () => {
      void askParams("Export figure", [
        { key: "format", label: "Format", type: "select", options: ["svg", "pdf"], default: "svg" },
        { key: "width", label: "Width (in)", type: "number", default: 6 },
        { key: "x_label", label: "X label", type: "text", default: "" },
        { key: "legend", label: "Legend", type: "boolean", default: true, hint: "Draw the legend." },
      ]);
    });
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Confirm", async () => {
    const user = userEvent.setup();
    const opener = await openWith(<ConfirmDialog />, () => {
      void askConfirm("Remove 1 dataset?", "This cannot be undone.", "Remove", true);
    });
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Preferences", async () => {
    const user = userEvent.setup();
    const opener = await openWith(<PreferencesDialog />, () => useApp.setState({ prefsOpen: true }));
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Help", async () => {
    const user = userEvent.setup();
    const opener = await openWith(<HelpDialog />, () => useHelp.setState({ open: true }));
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Keyboard shortcuts", async () => {
    const user = userEvent.setup();
    const opener = await openWith(<ShortcutsDialog />, () => useApp.setState({ shortcutsOpen: true }));
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Text formatting help", async () => {
    const user = userEvent.setup();
    const opener = await openWith(<TextFormatHelp />, () => useApp.setState({ textFormatHelpOpen: true }));
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Annotation text", async () => {
    const user = userEvent.setup();
    const opener = await openWith(<AnnotationTextDialog />, () => {
      void askAnnotationText("Edit label", "T_c");
    });
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Recover autosave", async () => {
    const user = userEvent.setup();
    const workspace = parseWorkspace(JSON.stringify({ format: WORKSPACE_FORMAT, version: 4, datasets: [] }));
    const opener = await openWith(<RecoveryChoiceDialog />, () =>
      useRecoveryChoice.setState({
        pending: { workspace, autosaveAt: 0, datasetCount: 0, lastProject: { name: "p.dwk", path: "/p.dwk", at: 0 } },
      }),
    );
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Command palette", async () => {
    const user = userEvent.setup();
    const actions = [{ id: "a", label: "Export figure", group: "File", run: () => {} }];
    const opener = await openWith(<CommandPalette actions={actions} />, () => useApp.setState({ cmdkOpen: true }));
    // The palette is eager, so it loads the inert registry on its first open.
    await waitFor(() => expect(opener.closest("[inert]")).not.toBeNull());
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });
});

function Host({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      {open && (
        <ToolWindow id="audit" title="Pack project" onClose={() => setOpen(false)}>
          {children}
        </ToolWindow>
      )}
    </>
  );
}

describe("tool-window basics (non-modal: no trap, no inert)", () => {
  beforeEach(() => useApp.setState({ toolWindowLayout: {} }));

  it("the shared host is a named, Escape-closable dialog that gives focus back", async () => {
    const user = userEvent.setup();
    render(
      <Host>
        <label htmlFor="dest">Destination</label>
        <input id="dest" />
      </Host>,
    );
    const opener = screen.getByRole("button", { name: "opener" });
    await user.click(opener);
    await screen.findByRole("dialog");
    expect(await auditDialog(dialog, { opener, user, modal: false })).toEqual([]);
  });
});
