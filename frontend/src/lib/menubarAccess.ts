// Alt+letter / F10 access to the menu bar (UX menus N13; provisional, owner to confirm). A tiny eager seam shared by
// useGlobalShortcuts (dispatches) and MenuBar (listens), so neither imports the other.

export const MENUBAR_ACCESS_EVENT = "qz:menubar-access";

/** Menu-bar labels by Alt mnemonic: the first letters are unique across the ten menus. */
export const MENUBAR_MNEMONICS: Record<string, string> = {
  f: "File",
  e: "Edit",
  d: "Data",
  p: "Plot",
  i: "Insert",
  a: "Analyze",
  t: "Tools",
  v: "View",
  w: "Window",
  h: "Help",
};

/** Open the named menu, or (no label) put focus on the menu bar. */
export function accessMenuBar(label?: string): void {
  window.dispatchEvent(new CustomEvent(MENUBAR_ACCESS_EVENT, { detail: { label } }));
}
