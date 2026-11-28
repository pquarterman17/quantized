// The dialog basics (`test/dialogA11y.ts`) for the learning aids: Recent hints,
// Sample gallery, Tip of the day, and their shared LearningModal frame.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { auditDialog } from "../../test/dialogA11y";
import { useHintLog } from "../../store/hintLog";
import { useLearningDialogs } from "../../store/learningDialogs";
import LearningModal from "./learning/LearningModal";
import LearningHost from "./learning/LearningHost";

async function openWith(ui: ReactNode, open: () => unknown): Promise<HTMLElement> {
  render(
    <>
      <button type="button">opener</button>
      {ui}
    </>,
  );
  const opener = screen.getByRole("button", { name: "opener" });
  opener.focus();
  await act(async () => {
    await open();
  });
  await screen.findByRole("dialog");
  return opener;
}

let openFrame: (v: boolean) => void = () => {};
function Frame() {
  const [open, setOpen] = useState(false);
  openFrame = setOpen;
  return open ? <LearningModal title="Frame" onClose={() => setOpen(false)}>body</LearningModal> : null;
}

const dialog = () => screen.queryByRole("dialog");

describe("learning aids: dialog basics", () => {
  it("LearningModal", async () => {
    const user = userEvent.setup();
    const opener = await openWith(<Frame />, () => openFrame(true));
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  for (const which of ["hints", "gallery", "tips"] as const) {
    it(`${which} through the host`, async () => {
      useHintLog.getState().clear();
      const user = userEvent.setup();
      const opener = await openWith(<LearningHost />, () => useLearningDialogs.getState().show(which));
      expect(await auditDialog(dialog, { opener, user })).toEqual([]);
    });
  }
});
