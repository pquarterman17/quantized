// Import wizard memory (P1-10): opt-in, remembers delimiter and header / units
// lines, fails closed when the remembered lines do not fit the new file.

import { beforeEach, describe, expect, it } from "vitest";

import type { ImportSettingsWire } from "./importTypes";
import { rememberImport, withRememberedImport } from "./importWizardMemory";
import { workflowPrefsSlot } from "./workflowPrefs";
import { setWorkflowPrefs } from "./workflowPrefsEdit";

const guess = (over: Partial<ImportSettingsWire> = {}): ImportSettingsWire => ({
  delimiter: "auto",
  header_line: 0,
  units_line: null,
  label_line: null,
  data_start_line: 3,
  column_names: ["a", "b"],
  roles: ["x", "y"],
  ...over,
});

beforeEach(() => localStorage.clear());

describe("import settings memory", () => {
  it("is off by default: nothing is remembered and the guess is untouched", () => {
    rememberImport(guess({ delimiter: "tab" }));
    expect(workflowPrefsSlot.load().importMemory).toBeNull();
    const g = guess();
    expect(withRememberedImport(g)).toBe(g);
  });

  it("remembers the last import and applies it to the next file's guess", () => {
    setWorkflowPrefs({ rememberImportSettings: true });
    rememberImport(guess({ delimiter: "tab", header_line: 1, units_line: 2 }));
    expect(workflowPrefsSlot.load().importMemory).toEqual({ delimiter: "tab", header_line: 1, units_line: 2 });
    const out = withRememberedImport(guess({ data_start_line: 4 }));
    expect(out.delimiter).toBe("tab");
    expect([out.header_line, out.units_line]).toEqual([1, 2]);
    // the guessed columns were read under the old layout: re-read them
    expect(out.column_names).toBeNull();
    expect(out.roles).toBeNull();
  });

  it("a remembered header at or below the new file's data start is ignored", () => {
    setWorkflowPrefs({ rememberImportSettings: true, importMemory: { delimiter: "auto", header_line: 5, units_line: null } });
    const g = guess({ data_start_line: 3 });
    expect(withRememberedImport(g)).toBe(g);
  });

  it("an identical layout leaves the guess (and its column names) alone", () => {
    setWorkflowPrefs({ rememberImportSettings: true, importMemory: { delimiter: "auto", header_line: 0, units_line: null } });
    const g = guess();
    expect(withRememberedImport(g)).toBe(g);
  });
});
