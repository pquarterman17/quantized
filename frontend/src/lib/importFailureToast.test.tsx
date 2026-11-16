// UX-C: a failed import is a red, plain-language toast with working actions —
// driven through the real Toaster, waiting on rendered/store STATE.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Toaster from "../components/overlays/Toaster";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import { importFailureHeadline, toastImportFailure, useWizardHandoff } from "./importFailureToast";

const NO_PARSER = "garbage.dat: no parser registered for 'garbage.dat' (extension '.dat')";

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useWizardHandoff.setState({ file: null });
  useApp.setState({ importWizardOpen: false, status: "" });
});
afterEach(cleanup);

describe("importFailureHeadline", () => {
  it("is plain language, with no parser jargon", () => {
    const h = importFailureHeadline("garbage.dat", NO_PARSER);
    expect(h).toBe("Couldn't read garbage.dat — the format wasn't recognised.");
    expect(h).not.toMatch(/parser|registered/);
  });
  it("names a down server as the cause, not the file", () => {
    expect(importFailureHeadline("a.csv", "a.csv: Failed to fetch")).toMatch(/not responding/);
  });
});

describe("toastImportFailure", () => {
  it("shows a danger toast whose Open import wizard hands the file to the wizard", async () => {
    const file = new File(["\x00\x01"], "garbage.dat");
    render(<Toaster />);
    act(() => toastImportFailure("garbage.dat", NO_PARSER, file));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't read garbage.dat");
    expect(alert).not.toHaveTextContent("no parser registered"); // technical text is behind Details
    fireEvent.click(screen.getByRole("button", { name: "Open import wizard" }));
    await waitFor(() => expect(useApp.getState().importWizardOpen).toBe(true));
    expect(useWizardHandoff.getState().file).toBe(file);
  });

  it("Details reveals the technical text and Copy details copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<Toaster />);
    act(() => toastImportFailure("garbage.dat", NO_PARSER));
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByText(NO_PARSER)).toBeInTheDocument();
    act(() => toastImportFailure("garbage.dat", NO_PARSER));
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(useApp.getState().status).toBe("copied import details"));
    expect(writeText).toHaveBeenCalledWith(NO_PARSER);
    vi.unstubAllGlobals();
  });

  it("says when several files failed (the toast covers the last one)", () => {
    render(<Toaster />);
    act(() => toastImportFailure("c.dat", NO_PARSER, undefined, { added: 2, total: 5 }));
    expect(screen.getByRole("alert")).toHaveTextContent("Imported 2 of 5 files — 3 failed; this is the last.");
  });

  it("offers no wizard for a binary container (its own error says what to do)", () => {
    render(<Toaster />);
    act(() => toastImportFailure("broken.opju", "broken.opju: corrupt project"));
    expect(screen.queryByRole("button", { name: "Open import wizard" })).toBeNull();
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
  });
});
