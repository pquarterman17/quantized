// P3.3 "keyboard reachability, focus, order, cancel" — the DOM-layer pins for
// `useDialogFocus`/`useFocusTrap` and for the four gaps the 2026-09-18 audit
// found. Every case drives the real keyboard (`userEvent.tab()` /
// `userEvent.keyboard()`) against rendered components, not the hook in
// isolation: the bug class here is "the handler exists but the key never
// reaches it", which only a DOM-level test can see.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import ConfirmDialog, { askConfirm } from "./ConfirmDialog";
import ParamDialog, { askParams } from "./ParamDialog";
import RecoveryChoiceDialog from "./RecoveryChoiceDialog";
import { parseWorkspace, WORKSPACE_FORMAT } from "../../lib/workspace";
import { useRecoveryChoice, type RecoveryPrompt } from "../../store/recoveryChoice";
import { useApp } from "../../store/useApp";

function recoveryPrompt(): RecoveryPrompt {
  return {
    workspace: parseWorkspace(
      JSON.stringify({
        format: WORKSPACE_FORMAT,
        version: 4,
        datasets: [
          {
            id: "r1",
            name: "recovered.dat",
            data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} },
          },
        ],
      }),
    ),
    autosaveAt: Date.parse("2026-08-18T12:00:00Z"),
    datasetCount: 1,
    lastProject: {
      name: "project.dwk",
      path: "/p/project.dwk",
      at: Date.parse("2026-08-17T09:00:00Z"),
    },
  };
}

beforeEach(() => {
  useApp.setState({ datasets: [], activeId: null, currentProject: null, projectDirty: false });
  useRecoveryChoice.setState({ pending: null });
});

// ── RecoveryChoiceDialog: had NO keyboard cancel at all ──────────────────
describe("RecoveryChoiceDialog keyboard cancel (P3.3)", () => {
  it("Escape cancels — the keyboard twin of the backdrop click", async () => {
    const user = userEvent.setup();
    useRecoveryChoice.setState({ pending: recoveryPrompt() });
    render(<RecoveryChoiceDialog />);

    await user.keyboard("{Escape}");

    expect(useRecoveryChoice.getState().pending).toBeNull();
    // Cancel means "load neither" — the autosave is not applied.
    expect(useApp.getState().datasets).toEqual([]);
  });

  it("moves focus into the dialog on open, so Escape has somewhere to come from", () => {
    useRecoveryChoice.setState({ pending: recoveryPrompt() });
    render(<RecoveryChoiceDialog />);
    // Cancel is the first control in the row — the safe landing spot, the
    // same choice ConfirmDialog makes.
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("gives focus back to the opener when it closes", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">opener</button>
        <RecoveryChoiceDialog />
      </>,
    );
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();

    act(() => {
      useRecoveryChoice.setState({ pending: recoveryPrompt() });
    });
    expect(opener).not.toHaveFocus();

    await user.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });

  it("Tab wraps inside the dialog instead of walking out to the page behind it", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside</button>
        <RecoveryChoiceDialog />
      </>,
    );
    act(() => {
      useRecoveryChoice.setState({ pending: recoveryPrompt() });
    });

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const recover = screen.getByRole("button", { name: "Recover autosave" });
    expect(cancel).toHaveFocus();

    await user.tab(); // Keep project.dwk
    await user.tab(); // Recover autosave (last)
    expect(recover).toHaveFocus();

    await user.tab(); // would leave the modal — must wrap
    expect(cancel).toHaveFocus();
    expect(screen.getByRole("button", { name: "outside" })).not.toHaveFocus();

    await user.tab({ shift: true }); // backwards off the first control
    expect(recover).toHaveFocus();
  });
});

// ── ParamDialog: Escape was dead for a dialog with no focusable field ────
describe("ParamDialog keyboard cancel (P3.3)", () => {
  it("Escape cancels a ZERO-FIELD dialog — its handler was unreachable before", async () => {
    const user = userEvent.setup();
    render(<ParamDialog />);
    let result!: Promise<unknown>;
    act(() => {
      result = askParams("Proceed?", []);
    });

    await user.keyboard("{Escape}");
    await expect(result).resolves.toBeNull();
  });

  it("leaves an autoFocus field alone but still traps Tab and restores the opener", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">opener</button>
        <ParamDialog />
      </>,
    );
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();

    let result!: Promise<unknown>;
    act(() => {
      result = askParams("Smooth", [{ key: "n", label: "Window", type: "number", default: 5 }]);
    });

    // The field's own autoFocus wins — the hook does not override it.
    // ParamFields renders a bare <input> (no type="number" — it coerces on
    // blur instead), so this is queried by value rather than by role.
    const field = screen.getByDisplayValue("5");
    expect(field).toHaveFocus();

    await user.tab(); // Cancel
    await user.tab(); // Run (last)
    expect(screen.getByRole("button", { name: "Run" })).toHaveFocus();
    await user.tab(); // wraps back to the field, not out to "opener"
    expect(field).toHaveFocus();

    await user.keyboard("{Escape}");
    await expect(result).resolves.toBeNull();
    expect(opener).toHaveFocus();
  });
});

// ── ConfirmDialog: focus-in/restore already existed; the trap did not ────
describe("ConfirmDialog focus trap (P3.3)", () => {
  it("Tab wraps between Cancel and the confirm button, never leaving the modal", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">behind the backdrop</button>
        <ConfirmDialog />
      </>,
    );
    let result!: Promise<boolean>;
    act(() => {
      result = askConfirm("Remove everything?", "gone forever", "Remove all", true);
    });

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const remove = screen.getByRole("button", { name: "Remove all" });
    expect(cancel).toHaveFocus();

    await user.tab();
    expect(remove).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    expect(screen.getByRole("button", { name: "behind the backdrop" })).not.toHaveFocus();

    await user.tab({ shift: true });
    expect(remove).toHaveFocus();

    await user.keyboard("{Escape}");
    await expect(result).resolves.toBe(false);
  });
});

