// Open the OS file dialog and hand back the chosen File(s). The <input> is
// created imperatively, so any component (Library button, File menu) can
// trigger it without rendering one or sharing a ref.

// The file-dialog filter — one source of truth for every "Open" entry point
// (the MATLAB uigetfile-filter footgun: keep this in lockstep with the backend
// io/registry.py extension map). Covers all registered parsers.
//
// .opj/.opju (Origin projects) ARE registered backend-side but were missing
// here, so a user could not pick an Origin file in the Open dialog even though
// the reader exists — added 2026-07-19. `lib/importFormats.ts` documents these
// and importFormats.test.ts asserts every documented extension appears below,
// so the drift can't silently return.
export const IMPORT_ACCEPT =
  ".dat,.csv,.tsv,.txt,.xrdml,.brml,.raw,.refl,.pnr,.datA,.datB,.datC,.datD," +
  ".jdx,.dx,.nc,.cdf,.cif,.xlsx,.xlsm,.xls,.spc,.opus,.opj,.opju";

// DEFECT B (Sol audit P1-6, 2026-08-21): a canceled OS file dialog used to
// fire NO event at all — `onchange` only fires on an actual pick — so any
// caller awaiting a Promise wrapped around this (store/reimport.ts's
// `pickOneFile`) hung forever on Cancel. Modern Chromium/WebKit fire a
// `cancel` event on the `<input>` when the dialog closes with nothing
// chosen (Firefox does not yet, as of this writing — a Firefox cancel still
// leaves `onPick` uncalled, same as before this fix; there is no browser
// event to listen for there). Listening for it and calling `onPick([])`
// (the same shape `onchange` already produces for "0 files") gives every
// caller ONE settlement path for both "picked nothing" and "canceled",
// rather than a second callback shape to handle. Every existing caller
// already tolerates an empty array one way or another (`files[0] ?? null`,
// `if (files.length === 0) return`, a `for` loop that just doesn't run) —
// see openFilePicker.test.ts's audit note for the full call-site list this
// was checked against.
export function openFilePicker(onPick: (files: File[]) => void, accept = ""): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  if (accept) input.accept = accept;
  input.onchange = () => {
    if (input.files && input.files.length) onPick(Array.from(input.files));
  };
  input.addEventListener("cancel", () => onPick([]));
  input.click();
}
