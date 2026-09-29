// Residual R8 (P3.3): `hiddenWithin` used to move only the trap's WRAP
// boundary. A focusable inside an `aria-hidden` wrapper BETWEEN the first and
// last stops was still reached by an ordinary Tab, because the trap acted at
// the two ends and nowhere else. It now steps over a hidden stop anywhere.

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { useFocusTrap } from "./useDialogFocus";

function TrappedBox({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, true);
  return (
    <div ref={ref} tabIndex={-1} data-testid="box">
      {children}
    </div>
  );
}

function MiddleGhost() {
  return (
    <TrappedBox>
      <button type="button">First</button>
      <div aria-hidden="true">
        <button type="button">Ghost</button>
      </div>
      <button type="button">Last</button>
    </TrappedBox>
  );
}

describe("the focus trap steps over hidden stops between its ends (R8)", () => {
  it("Tab skips a focusable inside an aria-hidden wrapper in the middle", async () => {
    const user = userEvent.setup();
    render(<MiddleGhost />);
    screen.getByRole("button", { name: "First" }).focus();

    await user.tab();

    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  });

  it("Shift+Tab skips it in the other direction", async () => {
    const user = userEvent.setup();
    render(<MiddleGhost />);
    screen.getByRole("button", { name: "Last" }).focus();

    await user.tab({ shift: true });

    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("leaves an ordinary Tab between two visible controls to the browser", () => {
    render(
      <TrappedBox>
        <button type="button">One</button>
        <button type="button">Two</button>
        <button type="button">Three</button>
      </TrappedBox>,
    );
    screen.getByRole("button", { name: "One" }).focus();

    const notClaimed = fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });

    expect(notClaimed).toBe(true); // not preventDefault()ed
    expect(screen.getByRole("button", { name: "One" })).toHaveFocus();
  });

  it("treats a radio group as ONE stop, so Tab from the last group wraps", () => {
    // The browser skips the rest of a group, so a group at the end of the
    // dialog is its last stop even when its checked radio is not the last one.
    render(
      <TrappedBox>
        <button type="button">Before</button>
        <input type="radio" name="unit" aria-label="Kelvin" defaultChecked />
        <input type="radio" name="unit" aria-label="Celsius" />
      </TrappedBox>,
    );
    screen.getByRole("radio", { name: "Kelvin" }).focus();

    const notClaimed = fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });

    expect(notClaimed).toBe(false);
    expect(screen.getByRole("button", { name: "Before" })).toHaveFocus();
  });
});
