// Library click on a 2-D map dataset, window layout (opt-in) mode only
// (owner decision 2026-11-24, WORKSPACE_LAYOUT_PLAN m-1). Instead of rebinding
// the focused plot window (which would draw the map's columns as lines), the
// layout host opens the dataset's own map window, or focuses it when it is
// already open. The host installs the opener while it is mounted, so classic
// mode (no host) never has one and keeps the shared `setActive` rebind. A tiny
// eager seam, the setStyleWindowToggle shape: the opener itself is lazy.

let opener: ((datasetId: string) => void) | null = null;

/** Install (or clear, with null) the opener. Returns the uninstall for an effect. */
export function installLibraryMapOpener(f: (datasetId: string) => void): () => void {
  opener = f;
  return () => {
    if (opener === f) opener = null;
  };
}

/** Hand a Library click on map dataset `id` to the layout host. False when no
 *  host is mounted (classic): the caller then activates the dataset as usual. */
export function openMapFromLibrary(id: string): boolean {
  if (!opener) return false;
  opener(id);
  return true;
}
