// Opens the worksheet-structure windows (column list, time-series pivot, insert into similar
// sheets) from the Columns menu and the command palette without an eager flag or a mount in the app
// shell: each is rendered into its own root, created here on first use, one window per kind. Everything
// that imports this module is itself lazy (the pattern of namedranges/openManager.tsx).

import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import ColumnList from "./ColumnList";

const hosts = new Map<string, { root: Root; el: HTMLDivElement }>();

function close(kind: string): void {
  const host = hosts.get(kind);
  if (!host) return;
  hosts.delete(kind);
  host.root.unmount();
  host.el.remove();
}

function show(kind: string, view: (onClose: () => void) => ReactElement): void {
  let host = hosts.get(kind);
  if (!host) {
    const el = document.createElement("div");
    el.dataset.sheetStructure = kind;
    document.body.appendChild(el);
    host = { root: createRoot(el), el };
    hosts.set(kind, host);
  }
  host.root.render(view(() => close(kind)));
}

export function openColumnList(datasetId: string): void {
  show("column-list", (onClose) => <ColumnList datasetId={datasetId} onClose={onClose} />);
}

export function closeSheetStructure(kind: string): void {
  close(kind);
}
