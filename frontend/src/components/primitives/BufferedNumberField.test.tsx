// Commit semantics of BufferedNumberField (2026-11-24): one write on Enter or
// on blur of edited text; Esc reverts; unedited blur writes nothing; `live`
// is the explicit per-keystroke opt-in.

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import BufferedNumberField from "./BufferedNumberField";

// Holds the committed value like the store does: a commit feeds back as `value`.
function Held(props: Partial<React.ComponentProps<typeof BufferedNumberField>> & { spy: (v: number | undefined) => void }) {
  const { spy, value: initial = 1, ...rest } = props;
  const [value, setValue] = useState<number | undefined>(initial);
  return (
    <BufferedNumberField
      aria-label="f"
      {...rest}
      value={value}
      onValue={(v) => {
        spy(v);
        setValue(v);
      }}
    />
  );
}

function setup(props: Partial<React.ComponentProps<typeof BufferedNumberField>> = {}) {
  const onValue = vi.fn();
  const utils = render(<Held spy={onValue} {...props} />);
  return { onValue, field: screen.getByLabelText("f") as HTMLInputElement, ...utils };
}

describe("BufferedNumberField commit semantics", () => {
  it("typing a multi-digit value writes nothing until Enter, then once with the exact value", async () => {
    const user = userEvent.setup();
    const { onValue, field } = setup();
    await user.clear(field);
    await user.type(field, "1.2345");
    expect(onValue).not.toHaveBeenCalled();
    expect(field).toHaveValue("1.2345");
    await user.keyboard("{Enter}");
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue).toHaveBeenCalledWith(1.2345);
    // The value is already committed: the blur that follows writes nothing more.
    await user.tab();
    expect(onValue).toHaveBeenCalledTimes(1);
  });

  it("blur of edited text commits once", async () => {
    const user = userEvent.setup();
    const { onValue, field } = setup();
    await user.clear(field);
    await user.type(field, "42");
    await user.tab();
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue).toHaveBeenCalledWith(42);
  });

  it("Esc reverts, writes nothing and stops propagation", async () => {
    const user = userEvent.setup();
    const onEsc = vi.fn();
    const { onValue, field } = setup();
    await user.clear(field);
    await user.type(field, "99");
    document.addEventListener("keydown", onEsc);
    await user.keyboard("{Escape}");
    document.removeEventListener("keydown", onEsc);
    expect(field).toHaveValue("1");
    expect(onValue).not.toHaveBeenCalled();
    expect(field).not.toHaveFocus();
    // An enclosing window's Escape (a listener above the React root) must not fire.
    expect(onEsc).not.toHaveBeenCalled();
  });

  it("a blur without an edit writes nothing, even when the display text differs from the value", async () => {
    const user = userEvent.setup();
    const { onValue, field } = setup({ value: 0.007617511520737328 });
    await user.click(field);
    await user.tab();
    expect(onValue).not.toHaveBeenCalled();
    expect(field).toHaveValue("0.007617511520737328");
  });

  it("an unchanged numeric edit (1.50 for 1.5) writes nothing", async () => {
    const user = userEvent.setup();
    const { onValue, field } = setup({ value: 1.5 });
    await user.clear(field);
    await user.type(field, "1.50{Enter}");
    expect(onValue).not.toHaveBeenCalled();
  });

  it("invalid, out-of-range and (when required) blank input revert on blur", () => {
    const { onValue, field } = setup({ min: 0, max: 10, required: true });
    for (const bad of ["-", "abc", "11", "-1", ""]) {
      fireEvent.focus(field);
      fireEvent.change(field, { target: { value: bad } });
      fireEvent.blur(field);
      expect(field).toHaveValue("1");
    }
    expect(onValue).not.toHaveBeenCalled();
  });

  it("blank on a non-required field commits undefined (cleared)", () => {
    const { onValue, field } = setup();
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue).toHaveBeenCalledWith(undefined);
  });

  it("shows an external change (undo) while not editing", () => {
    const onValue = vi.fn();
    const { rerender } = render(<BufferedNumberField aria-label="f" value={1} onValue={onValue} />);
    rerender(<BufferedNumberField aria-label="f" value={7} onValue={onValue} />);
    expect(screen.getByLabelText("f")).toHaveValue("7");
  });

  it("chains the caller's onFocus", () => {
    const onFocus = vi.fn();
    const { field } = setup({ onFocus });
    fireEvent.focus(field);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("live opts back in to a write per valid keystroke", async () => {
    const user = userEvent.setup();
    const { onValue, field } = setup({ live: true });
    await user.clear(field);
    await user.type(field, "12");
    expect(onValue.mock.calls.map((c) => c[0])).toEqual([undefined, 1, 12]);
    await user.keyboard("{Enter}");
    expect(onValue).toHaveBeenCalledTimes(3);
  });
});
