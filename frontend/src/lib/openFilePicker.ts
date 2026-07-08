// Open the OS file dialog and hand back the chosen File(s). The <input> is
// created imperatively, so any component (Library button, File menu) can
// trigger it without rendering one or sharing a ref.

// The file-dialog filter — one source of truth for every "Open" entry point
// (the MATLAB uigetfile-filter footgun: keep this in lockstep with the backend
// io/registry.py extension map). Covers all registered parsers.
export const IMPORT_ACCEPT =
  ".dat,.csv,.tsv,.txt,.xrdml,.brml,.raw,.refl,.pnr,.datA,.datB,.datC,.datD," +
  ".jdx,.dx,.nc,.cdf,.cif,.xlsx,.xlsm,.xls,.spc,.opus";

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
