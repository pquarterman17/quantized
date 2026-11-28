// B2 (acceptance pass 13): a dialog opened from a toolbar button, committed with Enter, reopened
// itself: the close restored focus to the button inside the Enter keydown, and the Enter's keypress
// then clicked it. Real focus and real keystrokes (user-event), with the real dialog.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { askAnnotationText } from "../../store/annotationTextDialog";
import AnnotationTextDialog from "./AnnotationTextDialog";

describe("Enter commits a dialog without re-pressing its opener", () => {
  it("annotation text: one ask, one result, dialog stays closed, focus is back on the button", async () => {
    const results: (string | null)[] = [];
    let asks = 0;
    render(
      <>
        <button onClick={() => { asks += 1; void askAnnotationText("Edit annotation text", "Tc").then((v) => results.push(v)); }}>Edit text…</button>
        <AnnotationTextDialog />
      </>,
    );
    const opener = screen.getByRole("button", { name: "Edit text…" });
    await userEvent.click(opener);
    const field = await screen.findByRole("textbox");
    await userEvent.clear(field);
    await userEvent.type(field, "Hc2");
    await userEvent.keyboard("{Enter}");
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(results).toEqual(["Hc2"]);
    expect(asks).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("Enter pressed on the opener afterwards still opens the dialog again", async () => {
    let asks = 0;
    render(
      <>
        <button onClick={() => { asks += 1; void askAnnotationText("Edit annotation text", "Tc"); }}>Edit text…</button>
        <AnnotationTextDialog />
      </>,
    );
    screen.getByRole("button", { name: "Edit text…" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(asks).toBe(1);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
