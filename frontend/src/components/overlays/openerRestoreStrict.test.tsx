// Residual R5 (P3.3): under React StrictMode's dev-only mount -> cleanup ->
// mount, `useOpenerRestore`'s cleanup handed focus back to the opener in the
// middle of the open, and the re-run pulled it back in: the opener saw a
// focus/blur pair for a dialog that never closed. A real close must still
// restore, with or without StrictMode.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import ToolWindow from "./ToolWindow";
import { useDialogFocus } from "./useDialogFocus";

function Dialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref, true);
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-label="Strict dialog">
      <button type="button" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

/** A surface that stays in the document when closed, so only the committed
 *  `open` tells the cleanup that the close is real. */
function KeptDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref, open);
  return (
    <div ref={ref} tabIndex={-1} hidden={!open}>
      <button type="button" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

function Harness({ panel }: { panel: "dialog" | "window" | "kept" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      {open && panel === "dialog" && <Dialog onClose={() => setOpen(false)} />}
      {panel === "kept" && <KeptDialog open={open} onClose={() => setOpen(false)} />}
      {open && panel === "window" && (
        <ToolWindow id="strict-r5" title="Strict panel" onClose={() => setOpen(false)}>
          <button type="button" onClick={() => setOpen(false)}>
            Done
          </button>
        </ToolWindow>
      )}
    </>
  );
}

describe.each(["dialog", "window", "kept"] as const)("opener restore under StrictMode (R5): %s", (panel) => {
  it("does not bounce focus through the opener while opening", async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Harness panel={panel} />
      </StrictMode>,
    );
    const opener = screen.getByRole("button", { name: "Opener" });
    let focusEvents = 0;
    opener.addEventListener("focus", () => {
      focusEvents++;
    });

    await user.click(opener);

    expect(focusEvents).toBe(1); // the click itself, and nothing after it
    expect(opener).not.toHaveFocus();
  });

  it("still gives focus back to the opener on a real close", async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Harness panel={panel} />
      </StrictMode>,
    );
    const opener = screen.getByRole("button", { name: "Opener" });
    await user.click(opener);
    expect(opener).not.toHaveFocus();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Done" }));
    });

    expect(opener).toHaveFocus();
  });
});
