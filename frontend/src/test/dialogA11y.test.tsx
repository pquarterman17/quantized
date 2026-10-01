// Positive and negative controls for the dialog-basics audit
// (`dialogA11y.ts`): a conforming dialog audits clean, and each defect the
// audit claims to catch is caught, by name, when it is planted on its own.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useId, useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import { useDialogFocus, useOpenerRestore } from "../components/overlays/useDialogFocus";
import { auditDialog, staticDialogIssues } from "./dialogA11y";

type Defect =
  | "none"
  | "noRole"
  | "noTitle"
  | "placeholderOnly"
  | "invalidUnlinked"
  | "disabledTooltip"
  | "noTrap"
  | "noEscape"
  | "noRestore";

function Probe({ defect, open, onClose }: { defect: Defect; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const nameId = useId();
  // The trap and the restore are what the "noTrap"/"noRestore" cases remove.
  const trapRestore = useDialogFocus(ref, open && defect !== "noTrap" && defect !== "noRestore");
  const restoreOnly = useOpenerRestore(ref, open && defect === "noTrap");
  useEffect(() => {
    if (open && (defect === "noTrap" || defect === "noRestore")) ref.current?.querySelector("input")?.focus();
  }, [open, defect]);
  if (!open) return null;
  const close = () => {
    if (defect === "noTrap") restoreOnly();
    else if (defect !== "noRestore") trapRestore();
    onClose();
  };
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={defect === "noRole" ? undefined : "dialog"}
      aria-labelledby={defect === "noTitle" ? undefined : titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape" && defect !== "noEscape") close();
      }}
    >
      <h2 id={titleId}>Export</h2>
      <span id={nameId}>Name</span>
      {defect === "placeholderOnly" ? (
        <input placeholder="file name" />
      ) : (
        <input aria-labelledby={nameId} aria-invalid={defect === "invalidUnlinked" ? true : undefined} />
      )}
      <button type="button" disabled title={defect === "disabledTooltip" ? "Pick a format first." : undefined}>
        Export
      </button>
      <button type="button" onClick={close}>
        Cancel
      </button>
    </div>
  );
}

async function audit(defect: Defect): Promise<string[]> {
  const user = userEvent.setup();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          opener
        </button>
        <Probe defect={defect} open={open} onClose={() => setOpen(false)} />
      </>
    );
  }
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "opener" });
  await user.click(opener);
  const get = () => document.querySelector<HTMLElement>("[tabindex='-1']");
  return auditDialog(get, { opener, user });
}

describe("dialog-basics audit (controls)", () => {
  it("a conforming dialog audits clean", async () => {
    expect(await audit("none")).toEqual([]);
  });

  it.each<[Defect, RegExp]>([
    ["noRole", /role=none, not dialog/],
    ["noTitle", /no aria-labelledby/],
    ["placeholderOnly", /labelled only by its placeholder/],
    ["invalidUnlinked", /aria-invalid with no linked message/],
    ["disabledTooltip", /explains itself only in a tooltip/],
    ["noTrap", /Tab leaves the dialog/],
    ["noEscape", /Escape did not close it/],
    ["noRestore", /focus did not return to the opener/],
  ])("catches %s", async (defect, finding) => {
    const issues = await audit(defect);
    expect(issues.some((i) => finding.test(i)), issues.join("\n")).toBe(true);
  });

  it("accepts aria-label only on a dialog with no visible heading", () => {
    const headed = document.createElement("div");
    headed.setAttribute("role", "dialog");
    headed.setAttribute("aria-label", "Palette");
    act(() => {
      headed.innerHTML = "<h2>Visible title</h2>";
    });
    expect(staticDialogIssues(headed)).toContain("no aria-labelledby pointing at a rendered title");
    headed.innerHTML = "<input aria-label='Command' />";
    expect(staticDialogIssues(headed)).toEqual([]);
  });
});
