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
    // Details did not take the way forward away
    expect(screen.getByRole("button", { name: "Open import wizard" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    expect(screen.getByRole("button", { name: "Open import wizard" })).toBeInTheDocument();
    await waitFor(() => expect(useApp.getState().status).toBe("copied import details"));
    expect(writeText).toHaveBeenCalledWith(NO_PARSER);
    vi.unstubAllGlobals();
  });

  it("says when several files failed (the toast covers the last one)", () => {
    render(<Toaster />);
    act(() => toastImportFailure("c.dat", NO_PARSER, undefined, { added: 2, failed: 3, total: 5 }));
    expect(screen.getByRole("alert")).toHaveTextContent("Imported 2 of 5 files — 3 failed, showing the last.");
  });

  it.each([
    ["not found", "gone.dat: file not found", /wasn't found/],
    ["permission", "a.dat: permission denied", /permission was denied/],
    ["server error", "a.dat: 500 internal server error", /server hit an error/],
  ])("a %s failure is not blamed on parsing and offers no wizard", (_n, msg, headline) => {
    render(<Toaster />);
    act(() => toastImportFailure(msg.split(":")[0], msg));
    expect(screen.getByRole("alert").textContent).toMatch(headline);
    expect(screen.queryByRole("button", { name: "Open import wizard" })).toBeNull();
  });

  it("classifies the message, not the file name, and a parser's own 'not found' is still a parse failure", () => {
    render(<Toaster />);
    act(() => toastImportFailure("permission_slip.dat", "permission_slip.dat: no parser registered for 'permission_slip.dat'"));
    expect(screen.getByRole("alert")).toHaveTextContent("the format wasn't recognised");
    expect(screen.getByRole("button", { name: "Open import wizard" })).toBeInTheDocument();
    cleanup();
    useToasts.setState({ toasts: [] });
    render(<Toaster />);
    act(() => toastImportFailure("x.csv", "x.csv: header row not found"));
    expect(screen.getByRole("button", { name: "Open import wizard" })).toBeInTheDocument();
  });

  it("keeps a binary container's own advice visible in the toast", () => {
    render(<Toaster />);
    act(() => toastImportFailure("broken.opju", "broken.opju: file is truncated — re-save it from Origin"));
    expect(screen.getByRole("alert")).toHaveTextContent("file is truncated — re-save it from Origin");
  });

  it("offers no wizard for a binary container (its own error says what to do)", () => {
    render(<Toaster />);
    act(() => toastImportFailure("broken.opju", "broken.opju: corrupt project"));
    expect(screen.queryByRole("button", { name: "Open import wizard" })).toBeNull();
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
  });
});
