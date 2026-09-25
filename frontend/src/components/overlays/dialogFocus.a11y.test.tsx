// P3.3 "keyboard reachability, focus, order, cancel" — the DOM-layer pins for
// `useDialogFocus`/`useFocusTrap` and for the four gaps the 2026-09-18 audit
// found. Every case drives the real keyboard (`userEvent.tab()` /
// `userEvent.keyboard()`) against rendered components, not the hook in
// isolation: the bug class here is "the handler exists but the key never
// reaches it", which only a DOM-level test can see.

import { act, render, screen, within } from "@testing-library/react";
import { useRef, useState, type ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import AnnotationTextDialog from "./AnnotationTextDialog";
import ConfirmDialog, { askConfirm } from "./ConfirmDialog";
import ParamDialog, { askParams } from "./ParamDialog";
import PlotRecipeApplyDialog from "./PlotRecipeApplyDialog";
import QuickPlotWithDialog from "./QuickPlotWithDialog";
import RecoveryChoiceDialog from "./RecoveryChoiceDialog";
import ToolWindow from "./ToolWindow";
import { useFocusTrap } from "./useDialogFocus";
import { captureRecipe } from "../../lib/plotRecipe";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { parseWorkspace, WORKSPACE_FORMAT } from "../../lib/workspace";
import { askAnnotationText, useAnnotationTextDialog } from "../../store/annotationTextDialog";
import { openQuickPlotWith, useQuickPlotWithDialog } from "../../store/quickPlotWithDialog";
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
  useApp.setState({
    datasets: [],
    activeId: null,
    currentProject: null,
    projectDirty: false,
    quickPlotTemplates: [],
    plotRecipes: [],
    pendingRecipeApplication: null,
    plotWindows: [],
    editableFigures: [],
    history: [],
    future: [],
    status: "",
  });
  useRecoveryChoice.setState({ pending: null });
  useQuickPlotWithDialog.setState({ datasetId: null, workbookId: null });
  useAnnotationTextDialog.setState({ title: null, initial: "", resolve: null });
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
    // The body is a lazy chunk (bundle diet slice 8): wait for it to mount.
    await screen.findByRole("dialog");

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
    await screen.findByRole("dialog"); // lazy body (bundle diet slice 8)

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
    await screen.findByRole("dialog"); // lazy body (bundle diet slice 8)

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


// ── The three dialogs round 1 fixed with no test at all (review finding 4) ─
// Measured: deleting the `useDialogFocus(...)` call from PlotRecipeApplyDialog,
// QuickPlotWithDialog and AnnotationTextDialog AT ONCE left all 226 tests of
// `components/overlays` green. Their own suites fire Escape AT the dialog box
// (`fireEvent.keyDown(box, { key: "Escape" })`), which passes whether or not
// anything ever moved focus into it — precisely the distinction this pass
// exists to make. These cases press the key the way a user does:
// `userEvent.keyboard` dispatches at `document.activeElement`, so a dialog
// that never took focus never sees it.

/** The staging round-trip PlotRecipeApplyDialog.test.tsx uses: capture a
 *  recipe against the ORIGINAL labels, then swap in a dataset whose
 *  "Intensity" column was renamed — X still resolves, Y does not, which is
 *  the unmatched-but-not-refused shape that stages a pending application. */
function xrd(labels: string[]): Dataset {
  return {
    id: "d1",
    name: "d1.xy",
    data: {
      time: [0, 1, 2],
      values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
      labels,
      units: ["deg", "cps", "cps"],
      metadata: { technique: "xrd.powder" },
    },
  };
}

async function stagePendingRecipe(): Promise<void> {
  useApp.setState({ datasets: [xrd(["2theta", "Intensity", "Ierr"])] });
  const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
  const recipe = captureRecipe(useApp.getState().datasets[0], view, null, {
    id: "r1",
    name: "XRD Recipe",
    appVersion: "0",
  });
  useApp.setState({ plotRecipes: [recipe], datasets: [xrd(["2theta", "Signal", "Ierr"])] });
  await act(async () => {
    await useApp.getState().applyPlotRecipe("r1", "d1");
  });
}

describe("PlotRecipeApplyDialog keyboard cancel (P3.3 round 2)", () => {
  it("moves focus into the dialog on open, onto Cancel — the harmless choice", async () => {
    render(<PlotRecipeApplyDialog />);
    await stagePendingRecipe();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("Escape discards the staged apply without a click first", async () => {
    const user = userEvent.setup();
    render(<PlotRecipeApplyDialog />);
    await stagePendingRecipe();
    expect(useApp.getState().pendingRecipeApplication).not.toBeNull();

    await user.keyboard("{Escape}");

    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    // Cancel means "apply nothing" — no figure was created.
    expect(useApp.getState().plotWindows).toEqual([]);
  });
});

describe("QuickPlotWithDialog keyboard cancel (P3.3 round 2)", () => {
  function mvsh(): Dataset {
    return {
      id: "d1",
      name: "d1.dat",
      data: {
        time: [0, 1],
        values: [[1, 10], [2, 20]],
        labels: ["A", "B"],
        units: ["", ""],
        metadata: { technique: "magnetometry.mvsh" },
      },
    };
  }

  it("normal branch: focus moves in, and Escape closes the chooser", async () => {
    const user = userEvent.setup();
    useApp.setState({ datasets: [mvsh()] });
    render(<QuickPlotWithDialog />);
    act(() => openQuickPlotWith("d1"));

    // With no templates in scope, Close is the only control — and the first.
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(useQuickPlotWithDialog.getState().datasetId).toBeNull();
  });

  it("'source worksheet was removed' branch: focus moves in, and Escape closes it", async () => {
    const user = userEvent.setup();
    useApp.setState({ datasets: [] }); // the worksheet the chooser targets is gone
    render(<QuickPlotWithDialog />);
    act(() => openQuickPlotWith("vanished"));

    expect(screen.getByText("The source worksheet was removed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(useQuickPlotWithDialog.getState().datasetId).toBeNull();
  });
});

describe("AnnotationTextDialog keyboard cancel (P3.3 round 2)", () => {
  it("moves focus into the editor field on open", () => {
    render(<AnnotationTextDialog />);
    act(() => {
      void askAnnotationText("Edit annotation text", "Tc");
    });
    // RichLabelInput's <input> is the first focusable in the dialog.
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("Escape resolves null — the object-menu path focused nothing before", async () => {
    const user = userEvent.setup();
    render(<AnnotationTextDialog />);
    let result!: Promise<string | null>;
    act(() => {
      result = askAnnotationText("Edit annotation text", "Tc");
    });

    await user.keyboard("{Escape}");

    await expect(result).resolves.toBeNull();
  });
});

// ── Two traps open at once (review finding 3) ────────────────────────────
// Measured before the fix: both traps listen on `document` in capture and
// each pulls focus back whenever `document.activeElement` is outside ITS OWN
// root, so the Tab sequence with two open was
// ["Outer A","Inner A","Outer A","Inner A",…] — it never reached the SECOND
// control of either dialog. Latent then (nothing shipped opens two at once),
// live the moment residual R1 puts a trap on PreferencesDialog above an
// `askConfirm` "Reset all preferences?".
describe("stacked focus traps take turns (P3.3 round 2)", () => {
  it("only the TOP trap acts, and closing it hands control back to the outer one", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside</button>
        <RecoveryChoiceDialog />
        <ConfirmDialog />
      </>,
    );
    act(() => {
      useRecoveryChoice.setState({ pending: recoveryPrompt() });
    });
    const outerCancel = screen.getByRole("button", { name: "Cancel" });
    const recover = screen.getByRole("button", { name: "Recover autosave" });
    expect(outerCancel).toHaveFocus();

    let confirmed!: Promise<boolean>;
    act(() => {
      confirmed = askConfirm("Remove everything?", "gone forever", "Remove all", true);
    });
    await screen.findByRole("button", { name: "Remove all" }); // lazy body (bundle diet slice 8)
    const inner = within(screen.getAllByRole("dialog")[1]);
    const innerCancel = inner.getByRole("button", { name: "Cancel" });
    const removeAll = inner.getByRole("button", { name: "Remove all" });
    expect(innerCancel).toHaveFocus();

    // Tab cycles the TOP dialog's controls only — before the stack, the outer
    // trap yanked focus back to its own first button on every Tab.
    await user.tab();
    expect(removeAll).toHaveFocus();
    await user.tab();
    expect(innerCancel).toHaveFocus();
    expect(recover).not.toHaveFocus();

    // Dismiss the top one by CLICKING Cancel: both dialogs own Escape on a
    // window-capture listener, so one Escape would close both — a different
    // question from this one.
    await user.click(innerCancel);
    await expect(confirmed).resolves.toBe(false);
    expect(outerCancel).toHaveFocus(); // ConfirmDialog's own restore-to-opener

    // …and the outer trap is live again: three controls, then a wrap.
    await user.tab();
    await user.tab();
    expect(recover).toHaveFocus();
    await user.tab();
    expect(outerCancel).toHaveFocus();
    expect(screen.getByRole("button", { name: "outside" })).not.toHaveFocus();
  });
});

// ── Round 2's three unpinned "also closed" claims (P3.3 round 3) ─────────
// Review finding 5: reverting the no-yank guard (S18), the `FOCUSABLE`
// widening (S19) and the `hiddenWithin` ancestor walk (S20) each left the
// whole `components/overlays` suite green — the same defect class as round
// 1's finding 4, which round 2 existed to close. One case each, at the DOM.
describe("round-2 focus details, now pinned (P3.3 round 3)", () => {
  /** A minimal trapped surface: `useFocusTrap` is the unit under test, and a
   *  plain box keeps the case about the trap rather than a dialog's chrome. */
  function TrappedBox({ children }: { children: ReactNode }) {
    const ref = useRef<HTMLDivElement | null>(null);
    useFocusTrap(ref, true);
    return (
      <div ref={ref} tabIndex={-1} data-testid="box">
        {children}
      </div>
    );
  }

  it("does NOT yank focus the user has already moved elsewhere (S18)", async () => {
    // The surface closes while focus sits on a live control OUTSIDE it — a
    // toast action, a field behind a non-modal panel. That is where the user
    // wants to be, and the close is not what put them there.
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Opener
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Toast action
          </button>
          {open && <ToolWindow id="yank" title="Find peaks">panel</ToolWindow>}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Opener" });
    const toast = screen.getByRole("button", { name: "Toast action" });

    await user.click(opener); // the panel latches THIS as the place to go back to
    expect(document.querySelector(".qzk-win")).toHaveFocus();

    await user.click(toast); // closes the panel; focus is already on the toast
    expect(document.querySelector(".qzk-win")).toBeNull();
    expect(toast).toHaveFocus();
    expect(opener).not.toHaveFocus();
  });

  it("traps a contenteditable field, not just the classic form controls (S19)", async () => {
    // Round 2 widened FOCUSABLE to `[contenteditable]`, `iframe`, `summary`
    // and `audio`/`video[controls]`. With the narrow selector the rich-text
    // field is invisible to the trap, so the wrap boundary sits one control
    // early and Tab walks straight out of the surface.
    const user = userEvent.setup();
    render(
      <TrappedBox>
        <button type="button">First</button>
        <div contentEditable data-testid="rich" suppressContentEditableWarning>
          rich text
        </div>
      </TrappedBox>,
    );
    screen.getByTestId("rich").focus();

    await user.tab();

    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("orders traps by OPEN order, so reopening an outer one does not steal Tab (NIT 6)", async () => {
    // Measured on the round-2 tree: toggling the OUTER trap closed→open while
    // an inner one stayed open pushed the outer on top, and Tab then cycled
    // the dialog BEHIND the topmost one ("Outer A", "Outer B", "Outer A", …).
    // `seq` is per component instance now, so close/reopen keeps its place.
    const user = userEvent.setup();
    function Stacked() {
      const [outerOpen, setOuterOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOuterOpen((v) => !v)}>
            Toggle outer
          </button>
          <OuterTrap open={outerOpen} />
          <TrappedBox>
            <button type="button">Inner A</button>
            <button type="button">Inner B</button>
          </TrappedBox>
        </>
      );
    }
    function OuterTrap({ open }: { open: boolean }) {
      const ref = useRef<HTMLDivElement | null>(null);
      useFocusTrap(ref, open);
      if (!open) return null;
      return (
        <div ref={ref} tabIndex={-1}>
          <button type="button">Outer A</button>
          <button type="button">Outer B</button>
        </div>
      );
    }
    render(<Stacked />);

    await user.click(screen.getByRole("button", { name: "Toggle outer" })); // close…
    await user.click(screen.getByRole("button", { name: "Toggle outer" })); // …and reopen

    screen.getByRole("button", { name: "Inner B" }).focus();
    await user.tab();

    expect(screen.getByRole("button", { name: "Inner A" })).toHaveFocus();
  });

  it("skips a focusable inside an aria-hidden wrapper, not only a hidden element (S20)", async () => {
    // Round 2 made the hidden check walk ANCESTORS up to the trap root. With
    // the element-only check the ghost button counts as the last Tab stop, so
    // Tab lands on something the attribute exists to deny.
    const user = userEvent.setup();
    render(
      <TrappedBox>
        <button type="button">Real</button>
        <div aria-hidden="true">
          <button type="button">Ghost</button>
        </div>
      </TrappedBox>,
    );
    const real = screen.getByRole("button", { name: "Real" });
    real.focus();

    await user.tab();

    expect(screen.getByText("Ghost")).not.toHaveFocus();
    expect(real).toHaveFocus(); // the only Tab stop, so Tab wraps onto itself
  });
});
