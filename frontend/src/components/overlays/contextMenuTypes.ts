// The item model rendered by <ContextMenu>, split out of ContextMenu.tsx so the
// component stays under the .tsx ceiling (architecture.test.ts) by moving a
// cohesive sibling out rather than trimming its documentation. ContextMenu.tsx
// re-exports both types, so every existing `from "…/ContextMenu"` import keeps
// working. See ContextMenu.tsx's header for what each variant renders as.

/** One swatch in a `{ swatches }` colour row. */
export interface Swatch {
  key: string;
  title: string;
  /** CSS colour for the swatch fill (e.g. "var(--series-3)", "#000000"). */
  css: string;
  active?: boolean;
  run: () => void;
}

export type ContextMenuItem =
  | { separator: true }
  | { header: string }
  | { swatches: Swatch[] }
  | { label: string; submenu: ContextMenuItem[]; disabled?: boolean }
  | { label: string; run: () => void; disabled?: boolean; danger?: boolean; checked?: boolean; title?: string }; // title: disabled-reason tooltip (L0.36)
