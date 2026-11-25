// Import wizard memory (PREFS_AUDIT P1-10): with Preferences ▸ General
// "Remember import wizard settings" on, the delimiter and header / units lines
// of the last wizard import start the next file's settings. Off (the default)
// keeps today's behaviour: every file starts from the guess.
//
// Fail closed: the remembered lines apply only when they still sit above the
// guessed data start (a header below the data is a different file's layout),
// and a remembered delimiter re-reads the column names exactly as picking it by
// hand does. Encoding is not remembered: the wizard has no encoding setting
// (it reads files as UTF-8, `File.text()`), so there is nothing to remember.

import type { ImportSettingsWire } from "./importTypes";
import { workflowPrefsSlot, type ImportMemory } from "./workflowPrefs";
import { setWorkflowPrefs } from "./workflowPrefsEdit";

/** `guessed` with the remembered layout applied (or `guessed` itself when off / none / no change). */
export function withRememberedImport(guessed: ImportSettingsWire): ImportSettingsWire {
  const { rememberImportSettings, importMemory: m } = workflowPrefsSlot.load();
  if (!rememberImportSettings || !m) return guessed;
  const fits = (n: number | null): boolean => n === null || n < guessed.data_start_line;
  let out = guessed;
  if (m.delimiter !== guessed.delimiter)
    out = { ...out, delimiter: m.delimiter, column_names: null, roles: null, time_formats: null };
  if (fits(m.header_line) && fits(m.units_line) && (m.header_line !== guessed.header_line || m.units_line !== guessed.units_line))
    out = { ...out, header_line: m.header_line, units_line: m.units_line, column_names: null };
  return out;
}

/** Remember the layout a successful import used (a no-op unless the pref is on). */
export function rememberImport(settings: ImportSettingsWire): void {
  if (!workflowPrefsSlot.load().rememberImportSettings) return;
  const memory: ImportMemory = { delimiter: settings.delimiter, header_line: settings.header_line, units_line: settings.units_line };
  setWorkflowPrefs({ importMemory: memory });
}
