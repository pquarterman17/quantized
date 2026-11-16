// The parse-and-commit half of `pasteDataFromClipboard` (store/dataIntake.ts),
// moved verbatim behind a dynamic `import()` (bundle diet slice 30,
// plans/BUNDLE_HEADROOM.md). The clipboard read and its refusals stay in the
// action, in the gesture's own task; this runs once the text is in hand.

import { guessImportSettings, parseImportText } from "../lib/api";
import { lit } from "../lib/macro";
import { plural } from "../lib/plural";
import { nextDatasetId } from "./idSeq";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

// Names successive clipboard pastes "pasted data 1", "pasted data 2", … (gap #47).
let _pasteSeq = 0;

export async function pasteDataRun(text: string, set: SliceSet, get: SliceGet): Promise<void> {
  try {
    const settings = await guessImportSettings(text);
    const data = await parseImportText(text, settings);
    _pasteSeq += 1;
    const id = nextDatasetId();
    const name = `pasted data ${_pasteSeq}`;
    get().addDataset({ id, name, data });
    set({ worksheetId: null }); // the Worksheet tab shows the paste, not a book opened earlier
    get().recordMacro(`Paste ${name}`, `qz.pasteData(${lit(name)})`, {
      kind: "import",
      params: { name },
    });
    const msg = `${name} — ${data.time.length} rows, ${data.labels.length} column${plural(data.labels.length)}`;
    // Worksheet audit #21: the parser's notes (a decimal-comma cell left
    // blank, a column read as text) are part of the outcome — say them,
    // never leave a NaN unexplained.
    const notes = Array.isArray(data.metadata.notes) ? data.metadata.notes.filter((n): n is string => typeof n === "string") : [];
    const full = notes.length ? `${msg}. ${notes.join(" ")}` : msg;
    get().setStatus(full);
    toast(full, notes.length ? "info" : "ok");
  } catch (e) {
    // P3.4 error-quality audit (2026-09-14): a bare `e.message` here is
    // whatever the parser threw ("no delimiter found", or an HTTP status
    // line) — true, but it names neither the operation nor the outcome.
    const msg = `could not create a dataset from the pasted text: ${e instanceof Error ? e.message : "unknown error"} — nothing was added`;
    get().setStatus(msg);
    toast(msg, "danger");
  }
}
