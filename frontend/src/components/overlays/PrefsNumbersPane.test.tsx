// Preferences ▸ Numbers rows added by PREFS_AUDIT lane 3.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { NUMBER_PREF_DEFAULTS, numberPrefsSlot, setFormatHooks } from "../../lib/locale";
import { afterEach, describe, expect, it } from "vitest";

import { setFormatOpts } from "../../lib/format";
import PrefsNumbersPane from "./PrefsNumbersPane";

afterEach(() => {
  act(() => numberPrefsSlot.reset());
  setFormatOpts(6, "auto");
  setFormatHooks({});
  localStorage.clear();
});

describe("PrefsNumbersPane", () => {
  it("shows today's behaviour as every default", () => {
    render(<PrefsNumbersPane />);
    expect((screen.getByLabelText("Scientific below") as HTMLSelectElement).value).toBe("-3");
    expect((screen.getByLabelText("Scientific from") as HTMLSelectElement).value).toBe("5");
    expect((screen.getByLabelText("Decimal separator") as HTMLSelectElement).value).toBe("point");
    expect((screen.getByLabelText("Digit grouping") as HTMLSelectElement).value).toBe("default");
    expect((screen.getByLabelText("Date format") as HTMLSelectElement).value).toBe("default");
    expect((screen.getByLabelText("Clock") as HTMLSelectElement).value).toBe("default");
    expect((screen.getByLabelText("Default significance level") as HTMLSelectElement).value).toBe("0.05");
    expect(screen.getByLabelText("Worksheet cells follow these")).not.toBeChecked();
    expect(numberPrefsSlot.load()).toEqual(NUMBER_PREF_DEFAULTS);
  });

  it("writes the slot and the preview follows the decimal separator", () => {
    render(<PrefsNumbersPane />);
    const preview = () => screen.getByLabelText("Number preview").textContent ?? "";
    expect(preview()).toContain("-12345.7");
    fireEvent.change(screen.getByLabelText("Decimal separator"), { target: { value: "comma" } });
    expect(numberPrefsSlot.load().decimal).toBe("comma");
    expect(preview()).toContain("-12345,7");
    expect(preview()).toContain("1,23450e-4"); // auto: exponential below 0.001
    fireEvent.change(screen.getByLabelText("Scientific below"), { target: { value: "-5" } });
    fireEvent.change(screen.getByLabelText("Scientific from"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Default significance level"), { target: { value: "0.01" } });
    fireEvent.click(screen.getByLabelText("Worksheet cells follow these"));
    expect(numberPrefsSlot.load()).toMatchObject({ decimal: "comma", sciLow: -5, sciHigh: 8, alpha: 0.01, worksheetCells: true });
    expect(preview()).toContain("0,00012345"); // threshold moved: fixed, comma decimal
    expect(preview()).not.toContain("0.000123");
  });
});
