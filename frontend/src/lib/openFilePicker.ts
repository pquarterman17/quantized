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

export function openFilePicker(onPick: (files: File[]) => void, accept = ""): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  if (accept) input.accept = accept;
  input.onchange = () => {
    if (input.files && input.files.length) onPick(Array.from(input.files));
  };
  input.click();
}
