// Opens the Named Ranges manager from anywhere (the Name box, the Data menu, the command palette) without an eager flag
// or mount in the app shell: the manager is rendered into its own root, created here on first use. It is one window: a
// second call updates the open one. Everything that imports this module is itself lazy.

import { createRoot, type Root } from "react-dom/client";

import NamedRangesManager from "./NamedRangesManager";
import type { SelectedBlock } from "./nameBoxModel";

type Selection = { datasetId: string; block: SelectedBlock } | undefined;

let host: { root: Root; el: HTMLDivElement } | null = null;

export function closeNamedRangesManager(): void {
  if (!host) return;
  const { root, el } = host;
  host = null;
  root.unmount();
  el.remove();
}

/** Show the manager; `selection` (the worksheet block selected right now) enables "Use selection" on each row. */
export function openNamedRangesManager(selection?: Selection): void {
  if (!host) {
    const el = document.createElement("div");
    el.dataset.namedRangesManager = "";
    document.body.appendChild(el);
    host = { root: createRoot(el), el };
  }
  host.root.render(<NamedRangesManager onClose={closeNamedRangesManager} selection={selection} />);
}
