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
  it.each([
    ["empty.csv", "empty.csv: file empty or only comments: empty.csv", "Couldn't read empty.csv — the file is empty."],
    ["h.csv", "h.csv: no data rows: the file holds only a header (h.csv)", "Couldn't read h.csv — it has a header but no data rows."],
    [
      "eu.csv",
      "eu.csv: Column 'T' in eu.csv writes numbers like '2,000', where the comma could be a decimal or a thousands separator ('1,500' is 1.5 or 1500); pick the decimal separator (Point or Comma) in the Import Wizard.",
      "Couldn't read eu.csv — its commas could be decimals or thousands separators — pick the decimal separator in the import wizard.",
    ],
  ])("names the backend's reason for %s in plain words (UX audit 8 #7)", (name, technical, headline) => {
    expect(importFailureHeadline(name, technical)).toBe(headline);
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
    act(() => toastImportFailure("x.csv", "x.csv: bad numeric value at line 404"));
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't be parsed");
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

describe("several failures (UX audit 8 #9)", () => {
  const fail = (name: string) => toastImportFailure(name, `${name}: file empty or only comments: ${name}`);

  // GROUP_AFTER is 1 (UX10 P2-7): the stack stays short, so a second failure already folds.
  it("one failure stays a rectangle with a × button; two fold into one grouped toast", () => {
    render(<Toaster />);
    act(() => fail("a.csv"));
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveClass("rect");
    expect(screen.getAllByRole("button", { name: "Dismiss notification" })).toHaveLength(1);
    act(() => fail("b.csv"));
    expect(screen.getByRole("alert")).toHaveTextContent("2 files couldn't be read");
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss notification" })[0]);
    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it("three failures render as one grouped toast; Show lists them, × dismisses them all", () => {
    render(<Toaster />);
    act(() => ["a.csv", "b.csv", "c.csv"].forEach(fail));
    const grouped = screen.getByRole("alert");
    expect(grouped).toHaveTextContent("3 files couldn't be read");
    expect(screen.queryByText(/Couldn't read a\.csv/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getAllByRole("alert")).toHaveLength(3);
    expect(screen.getByText(/Couldn't read a\.csv — the file is empty/)).toBeInTheDocument();
    cleanup();
    useToasts.setState({ toasts: [] });
    render(<Toaster />);
    act(() => ["d.csv", "e.csv", "f.csv"].forEach(fail));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("Show from a hovered, focused group lifts its holds (the toasts still time out) and parks focus on the stack", () => {
    vi.useFakeTimers();
    try {
      render(<Toaster />);
      act(() => ["a.csv", "b.csv", "c.csv"].forEach(fail));
      const grouped = screen.getByRole("alert");
      fireEvent.mouseEnter(grouped);
      const show = screen.getByRole("button", { name: "Show" });
      act(() => show.focus());
      fireEvent.click(show);
      expect(screen.getAllByRole("alert")).toHaveLength(3);
      // Not stranded on <body>, where Delete removes the active dataset.
      expect(document.activeElement).not.toBe(document.body);
      act(() => void vi.advanceTimersByTime(60_000));
      expect(useToasts.getState().toasts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
