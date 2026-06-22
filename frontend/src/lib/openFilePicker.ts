// Open the OS file dialog and hand back the chosen File(s). The <input> is
// created imperatively, so any component (Library button, File menu) can
// trigger it without rendering one or sharing a ref.

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
