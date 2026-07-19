import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import WhatIsThis from "./WhatIsThis";
import { useHelp } from "../../store/help";

beforeEach(() => useHelp.setState({ whatIsThis: false, open: false }));
afterEach(() => {
  act(() => useHelp.getState().setWhatIsThis(false));
  document.documentElement.removeAttribute("data-help-mode");
});

describe("WhatIsThis inspect mode", () => {
  it("renders nothing and sets no root flag when off", () => {
    const { container } = render(<WhatIsThis />);
    expect(container).toBeEmptyDOMElement();
    expect(document.documentElement.hasAttribute("data-help-mode")).toBe(false);
  });

  it("flags the document root and shows the hint badge when on", () => {
    render(<WhatIsThis />);
    act(() => useHelp.getState().setWhatIsThis(true));
    expect(document.documentElement.hasAttribute("data-help-mode")).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(/point at a highlighted control/i);
  });

  it("clears the root flag when the mode turns off", () => {
    render(<WhatIsThis />);
    act(() => useHelp.getState().setWhatIsThis(true));
    act(() => useHelp.getState().setWhatIsThis(false));
    expect(document.documentElement.hasAttribute("data-help-mode")).toBe(false);
  });

  it("exits via the Done button", () => {
    render(<WhatIsThis />);
    act(() => useHelp.getState().setWhatIsThis(true));
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(useHelp.getState().whatIsThis).toBe(false);
  });

  it("exits on Escape", () => {
    render(<WhatIsThis />);
    act(() => useHelp.getState().setWhatIsThis(true));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useHelp.getState().whatIsThis).toBe(false);
  });

  it("clears the root flag on unmount (no leaked global state)", () => {
    const { unmount } = render(<WhatIsThis />);
    act(() => useHelp.getState().setWhatIsThis(true));
    unmount();
    expect(document.documentElement.hasAttribute("data-help-mode")).toBe(false);
  });
});
